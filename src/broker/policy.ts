import { BrokerError, type CredentialLeaseRequest } from "./contract";

/**
 * Deny-by-default authorization. Every check must pass; the first failure
 * throws a BrokerError with a machine-readable code. Messages never disclose
 * which other tenants/runs exist.
 */

export interface PolicyDecisionContext {
  request: CredentialLeaseRequest;
  /** Clock in epoch ms. */
  now: number;
}

export interface AuthorizationSource {
  isTenantActive(tenantId: string): Promise<boolean>;
  principalBelongsToTenant(tenantId: string, principalId: string): Promise<boolean>;
  runBelongsToTenant(tenantId: string, runId: string): Promise<boolean>;
  agentAllowedProvider(tenantId: string, agentId: string, provider: string): Promise<boolean>;
  toolAllowedAlias(tenantId: string, toolId: string, provider: string, alias: string): Promise<boolean>;
  /** True when the tenant has the credential provisioned (checked against secret store). */
  credentialProvisioned(tenantId: string, provider: string, alias: string): Promise<boolean>;
}

export interface BrokerPolicyConfig {
  /** Per-run limits. */
  maxCredentialUsesPerRun: number;
  /** Optional per-tenant monthly credential budget; unset disables the check. */
  tenantBudgets?: Readonly<Record<string, number>>;
}

export interface QuotaUsageSource {
  /** Count of successful credential consumptions for this run. */
  runUsage(runId: string): Promise<number>;
  /** Accumulated spend units for this tenant (provider-reported cost). */
  tenantSpend(tenantId: string): Promise<number>;
}

export class BrokerPolicy {
  constructor(
    private readonly authorization: AuthorizationSource,
    private readonly config: BrokerPolicyConfig,
    private readonly usage: QuotaUsageSource,
  ) {}

  async authorizeIssue(context: PolicyDecisionContext): Promise<void> {
    const { request } = context;

    if (!(await this.authorization.isTenantActive(request.tenantId))) {
      throw new BrokerError("tenant_inactive");
    }
    if (!(await this.authorization.principalBelongsToTenant(request.tenantId, request.principalId))) {
      throw new BrokerError("principal_mismatch");
    }
    if (!(await this.authorization.runBelongsToTenant(request.tenantId, request.runId))) {
      throw new BrokerError("run_mismatch");
    }
    if (request.agentId && !(await this.authorization.agentAllowedProvider(request.tenantId, request.agentId, request.provider))) {
      throw new BrokerError("policy_denied");
    }
    if (request.toolId && !(await this.authorization.toolAllowedAlias(request.tenantId, request.toolId, request.provider, request.alias))) {
      throw new BrokerError("policy_denied");
    }
    if (!(await this.authorization.credentialProvisioned(request.tenantId, request.provider, request.alias))) {
      throw new BrokerError("credential_not_provisioned");
    }

    await this.authorizeQuotas(request);
  }

  private async authorizeQuotas(request: CredentialLeaseRequest): Promise<void> {
    const runUses = await this.usage.runUsage(request.runId);
    if (runUses >= this.config.maxCredentialUsesPerRun) {
      throw new BrokerError("quota_exceeded");
    }
    const budget = this.config.tenantBudgets?.[request.tenantId];
    if (budget !== undefined) {
      const spend = await this.usage.tenantSpend(request.tenantId);
      if (spend >= budget) throw new BrokerError("quota_exceeded");
    }
  }
}
