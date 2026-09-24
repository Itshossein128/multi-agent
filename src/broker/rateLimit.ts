import { BrokerError } from "./contract";

/**
 * In-process fixed-window rate limits and counters.
 *
 * Limits (all deny with machine-readable codes and an audit event, never with
 * policy detail in the message):
 * - lease issuance per tenant per minute
 * - lease consumption attempts per lease
 * - active (unexpired, issued) leases per tenant
 * - provider consumptions per tenant per minute
 * - credential uses per run (delegated to policy quotas)
 * - maximum TTL (enforced in contract validation)
 *
 * This limiter is process-local by design: a horizontally scaled broker must
 * share counters via the lease/audit tables or a shared cache. That limitation
 * is recorded in docs/implementation-gaps.md.
 */

export interface RateLimitConfig {
  enabled: boolean;
  /** Lease issuances allowed per tenant per window. */
  issuePerTenantPerMinute: number;
  /** Consumption attempts allowed per lease (single success still enforced by the store). */
  consumeAttemptsPerLease: number;
  /** Concurrent active leases allowed per tenant. */
  activeLeasesPerTenant: number;
  /** Successful provider consumptions per tenant per window. */
  consumePerTenantPerMinute: number;
  windowMs: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  enabled: true,
  issuePerTenantPerMinute: 60,
  consumeAttemptsPerLease: 10,
  activeLeasesPerTenant: 25,
  consumePerTenantPerMinute: 120,
  windowMs: 60_000,
};

export function rateLimitFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): RateLimitConfig {
  const number = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    enabled: env.CREDENTIAL_BROKER_RATE_LIMIT_ENABLED !== "false",
    issuePerTenantPerMinute: number(env.CREDENTIAL_BROKER_ISSUE_PER_TENANT_PER_MIN, DEFAULT_RATE_LIMITS.issuePerTenantPerMinute),
    consumeAttemptsPerLease: number(env.CREDENTIAL_BROKER_CONSUME_ATTEMPTS_PER_LEASE, DEFAULT_RATE_LIMITS.consumeAttemptsPerLease),
    activeLeasesPerTenant: number(env.CREDENTIAL_BROKER_ACTIVE_LEASES_PER_TENANT, DEFAULT_RATE_LIMITS.activeLeasesPerTenant),
    consumePerTenantPerMinute: number(env.CREDENTIAL_BROKER_CONSUME_PER_TENANT_PER_MIN, DEFAULT_RATE_LIMITS.consumePerTenantPerMinute),
    windowMs: number(env.CREDENTIAL_BROKER_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_LIMITS.windowMs),
  };
}

interface WindowCounter {
  windowStart: number;
  count: number;
}

export class RateLimiter {
  private readonly issueWindows = new Map<string, WindowCounter>();
  private readonly consumeWindows = new Map<string, WindowCounter>();
  private readonly consumeAttempts = new Map<string, number>();

  constructor(private readonly config: RateLimitConfig = DEFAULT_RATE_LIMITS, private readonly now: () => number = Date.now) {}

  checkIssue(tenantId: string): void {
    if (!this.config.enabled) return;
    const key = `issue:${tenantId}`;
    const counter = this.roll(key, this.issueWindows);
    if (counter.count >= this.config.issuePerTenantPerMinute) throw new BrokerError("rate_limited");
  }

  noteIssue(tenantId: string): void {
    if (!this.config.enabled) return;
    this.roll(`issue:${tenantId}`, this.issueWindows).count += 1;
  }

  checkConsumeAttempt(leaseId: string): void {
    if (!this.config.enabled) return;
    const failures = this.consumeAttempts.get(leaseId) ?? 0;
    if (failures >= this.config.consumeAttemptsPerLease) throw new BrokerError("rate_limited");
  }

  /** Record a failed consumption (wrong context, expired, store error) for this lease. */
  noteConsumeFailure(leaseId: string): void {
    if (!this.config.enabled) return;
    const failures = this.consumeAttempts.get(leaseId) ?? 0;
    this.consumeAttempts.set(leaseId, failures + 1);
    // Bound memory: drop state for leases that can no longer be retried.
    if (this.consumeAttempts.size > 10_000) this.pruneAttempts();
  }

  checkConsume(tenantId: string): void {
    if (!this.config.enabled) return;
    const counter = this.roll(`consume:${tenantId}`, this.consumeWindows);
    if (counter.count >= this.config.consumePerTenantPerMinute) throw new BrokerError("rate_limited");
  }

  noteConsume(tenantId: string): void {
    if (!this.config.enabled) return;
    this.roll(`consume:${tenantId}`, this.consumeWindows).count += 1;
  }

  checkActiveLeases(activeForTenant: number): void {
    if (!this.config.enabled) return;
    if (activeForTenant >= this.config.activeLeasesPerTenant) throw new BrokerError("rate_limited");
  }

  /** Called when a lease id can never be retried again (consumed/revoked/expired). */
  forgetLease(leaseId: string): void {
    this.consumeAttempts.delete(leaseId);
  }

  private roll(key: string, store: Map<string, WindowCounter>): WindowCounter {
    const now = this.now();
    const existing = store.get(key);
    if (!existing || now - existing.windowStart >= this.config.windowMs) {
      const fresh = { windowStart: now, count: 0 };
      store.set(key, fresh);
      return fresh;
    }
    return existing;
  }

  private pruneAttempts(): void {
    // Cheap heuristic: halve the map by clearing the oldest half of keys.
    const keys = [...this.consumeAttempts.keys()].slice(0, Math.floor(this.consumeAttempts.size / 2));
    for (const key of keys) this.consumeAttempts.delete(key);
  }
}
