import { BrokerError, CREDENTIAL_BROKER_CONTRACT_VERSION, validateConsumeRequest, validateLeaseRequest, validateRevokeRequest, type CredentialLease, type CredentialLeaseRequest, type LeaseRequestLimits } from "./contract";
import type { AuditRecorder } from "./audit";
import type { LeaseContext, LeaseStore } from "./leaseStore";
import { generateLeaseId } from "./leaseStore";
import type { BrokerPolicy } from "./policy";
import type { RateLimiter } from "./rateLimit";
import type { SecretStore } from "./secretStore";

/**
 * CredentialBrokerService — the broker's use-case layer.
 *
 * Flow (issue): validate contract -> rate limit -> authorize policy -> create
 * single-use lease (no secret inside) -> audit. The secret is only ever read
 * from the SecretStore during consume, returned exactly once, and never stored,
 * logged, or echoed into error messages.
 *
 * Fail-closed: any SecretStore outage during consume aborts with
 * secretstore_unavailable; no degraded path returns a stale or empty secret.
 */

export interface BrokerServiceDependencies {
  leases: LeaseStore;
  secrets: SecretStore;
  audit: AuditRecorder;
  policy: BrokerPolicy;
  rateLimiter: RateLimiter;
  limits: LeaseRequestLimits;
  /** Identity recorded on audit records. */
  sourceService: string;
  /** Supplies the per-tenant active-lease count for the concurrency limit. */
  activeLeases?: ActiveLeaseCounter;
  now?: () => number;
}

/** Count of active (issued, unexpired) leases for tenant concurrency limits. */
export interface ActiveLeaseCounter {
  countActive(tenantId: string, now: number): Promise<number>;
}

export class CredentialBrokerService {
  private readonly now: () => number;

  constructor(private readonly deps: BrokerServiceDependencies) {
    this.now = deps.now ?? Date.now;
  }

  async issue(input: unknown, idempotencyKey?: string): Promise<CredentialLease> {
    const request = validateLeaseRequest(input, this.deps.limits);
    return this.issueValidated(request, idempotencyKey);
  }

  private async issueValidated(request: CredentialLeaseRequest, idempotencyKey?: string): Promise<CredentialLease> {
    const now = this.now();
    const auditBase = {
      tenantId: request.tenantId,
      principalId: request.principalId,
      runId: request.runId,
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.toolId ? { toolId: request.toolId } : {}),
      provider: request.provider,
      alias: request.alias,
      correlationId: request.correlationId,
      sourceService: this.deps.sourceService,
    };

    await this.deps.audit.record({ ...auditBase, operation: "lease.issue.requested", result: "succeeded" }, now);

    try {
      // Idempotent replay: same tenant + key returns the original lease.
      if (idempotencyKey) {
        const existing = await this.deps.leases.findIdempotent(request.tenantId, idempotencyKey);
        if (existing) {
          if (existing.provider !== request.provider || existing.alias !== request.alias ||
              existing.principalId !== request.principalId || existing.runId !== request.runId) {
            throw new BrokerError("contract_idempotency_conflict");
          }
          return this.toLease(existing.leaseId, existing.expiresAt, existing.provider, existing.alias, existing.tenantId, existing.principalId, existing.runId);
        }
      }

      this.deps.rateLimiter.checkIssue(request.tenantId);
      await this.deps.policy.authorizeIssue({ request, now });
      if (this.deps.activeLeases) {
        const active = await this.deps.activeLeases.countActive(request.tenantId, now);
        this.deps.rateLimiter.checkActiveLeases(active);
      }

      const leaseId = generateLeaseId();
      const expiresAt = now + (request.requestedTtlMs ?? this.deps.limits.defaultTtlMs);
      await this.deps.leases.create({
        leaseId,
        contractVersion: CREDENTIAL_BROKER_CONTRACT_VERSION,
        tenantId: request.tenantId,
        principalId: request.principalId,
        runId: request.runId,
        ...(request.agentId ? { agentId: request.agentId } : {}),
        ...(request.toolId ? { toolId: request.toolId } : {}),
        provider: request.provider,
        alias: request.alias,
        purpose: request.purpose,
        ...(request.audience ? { audience: request.audience } : {}),
        ...(request.correlationId ? { correlationId: request.correlationId } : {}),
        issuedAt: now,
        expiresAt,
        status: "issued",
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      this.deps.rateLimiter.noteIssue(request.tenantId);

      await this.deps.audit.record({ ...auditBase, operation: "lease.issue.succeeded", result: "succeeded", leaseId }, this.now());
      return this.toLease(leaseId, expiresAt, request.provider, request.alias, request.tenantId, request.principalId, request.runId);
    } catch (error) {
      const code = error instanceof BrokerError ? error.code : "internal_error";
      await this.deps.audit.record({ ...auditBase, operation: "lease.issue.denied", result: "denied", reasonCode: code }, this.now()).catch(() => undefined);
      throw error;
    }
  }

  async consume(input: unknown): Promise<string> {
    const request = validateConsumeRequest(input);
    const now = this.now();
    const auditBase = {
      tenantId: request.tenantId,
      principalId: request.principalId,
      runId: request.runId,
      provider: request.provider,
      alias: request.alias,
      leaseId: request.leaseId,
      sourceService: this.deps.sourceService,
    };

    const deny = async (error: unknown): Promise<never> => {
      const code = error instanceof BrokerError ? error.code : "internal_error";
      // Failed consumption attempts count against the per-lease limit so a
      // compromised worker cannot brute-force a foreign lease binding.
      if (code !== "rate_limited") this.deps.rateLimiter.noteConsumeFailure(request.leaseId);
      await this.deps.audit.record({ ...auditBase, operation: "lease.consume.denied", result: "denied", reasonCode: code }, this.now()).catch(() => undefined);
      throw error instanceof BrokerError ? error : new BrokerError("internal_error");
    };

    try {
      this.deps.rateLimiter.checkConsumeAttempt(request.leaseId);
      this.deps.rateLimiter.checkConsume(request.tenantId);

      const context: LeaseContext = {
        tenantId: request.tenantId,
        principalId: request.principalId,
        runId: request.runId,
        provider: request.provider,
        alias: request.alias,
        now,
      };

      // Atomic single-use claim first: at most one caller can win, even across
      // processes when backed by PostgreSQL.
      const consumed = await this.deps.leases.consume(request.leaseId, context);
      this.deps.rateLimiter.forgetLease(request.leaseId);
      this.deps.rateLimiter.noteConsume(request.tenantId);

      let secret: string;
      try {
        const stored = await this.deps.secrets.getSecret({
          provider: consumed.provider,
          alias: consumed.alias,
          tenantId: consumed.tenantId,
        });
        secret = stored.value;
      } catch (error) {
        // Fail closed: the lease stays consumed; a retry must issue a new lease.
        // The outer catch records the single consume.denied audit event.
        throw error instanceof BrokerError ? error : new BrokerError("secretstore_unavailable");
      }

      await this.deps.audit.record({ ...auditBase, operation: "lease.consume.succeeded", result: "succeeded" }, this.now()).catch(() => undefined);
      return secret;
    } catch (error) {
      return deny(error);
    }
  }

  async revoke(input: unknown): Promise<{ revoked: true }> {
    const request = validateRevokeRequest(input);
    const now = this.now();
    const auditBase = {
      tenantId: request.tenantId,
      principalId: request.principalId,
      runId: request.runId,
      leaseId: request.leaseId,
      sourceService: this.deps.sourceService,
    };
    try {
      const existing = await this.deps.leases.get(request.leaseId);
      if (existing && (
        existing.tenantId !== request.tenantId ||
        existing.principalId !== request.principalId ||
        existing.runId !== request.runId
      )) {
        // Do not confirm or deny existence to a foreign context.
        throw new BrokerError("context_mismatch");
      }
      await this.deps.leases.revoke(request.leaseId, "requested_by_service", now);
      this.deps.rateLimiter.forgetLease(request.leaseId);
      await this.deps.audit.record({ ...auditBase, operation: "lease.revoked", result: "succeeded" }, this.now()).catch(() => undefined);
      return { revoked: true };
    } catch (error) {
      const code = error instanceof BrokerError ? error.code : "internal_error";
      await this.deps.audit.record({ ...auditBase, operation: "lease.revoked", result: "denied", reasonCode: code }, this.now()).catch(() => undefined);
      throw error;
    }
  }

  async cleanupExpired(): Promise<number> {
    const now = this.now();
    const removed = await this.deps.leases.deleteExpired(now);
    return removed;
  }

  async health(): Promise<{ status: "ok"; contractVersion: string }> {
    // Deliberately minimal: no store reachability, counts, or config disclosed.
    return { status: "ok", contractVersion: CREDENTIAL_BROKER_CONTRACT_VERSION };
  }

  async queryAudit(query: { tenantId?: string; runId?: string; limit?: number }) {
    return this.deps.audit.query(query);
  }

  private toLease(leaseId: string, expiresAt: number, provider: string, alias: string, tenantId: string, principalId: string, runId: string): CredentialLease {
    return { leaseId, expiresAt, provider, alias, tenantId, principalId, runId, singleUse: true, contractVersion: CREDENTIAL_BROKER_CONTRACT_VERSION };
  }
}
