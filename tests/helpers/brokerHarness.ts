import { InMemoryAuditRecorder, verifyAuditChain } from "../../src/broker/audit";
import { DEFAULT_LEASE_LIMITS, type LeaseRequestLimits } from "../../src/broker/contract";
import { InMemoryLeaseStore } from "../../src/broker/leaseStore";
import { BrokerPolicy, type AuthorizationSource, type QuotaUsageSource } from "../../src/broker/policy";
import { DEFAULT_RATE_LIMITS, RateLimiter, type RateLimitConfig } from "../../src/broker/rateLimit";
import { CredentialBrokerService } from "../../src/broker/service";
import { InMemorySecretStore } from "../../src/broker/secretStore";

/** Shared fake wiring for broker service tests: no real provider, no real secret store. */
export interface BrokerHarness {
  service: CredentialBrokerService;
  leases: InMemoryLeaseStore;
  secrets: InMemorySecretStore;
  audit: InMemoryAuditRecorder;
  rateLimiter: RateLimiter;
  setNow(now: number): void;
  authorization: MutableAuthorization;
}

export interface MutableAuthorization extends AuthorizationSource {
  activeTenants: Set<string>;
  tenantPrincipals: Map<string, Set<string>>;
  tenantRuns: Map<string, Set<string>>;
  agentProviders: Map<string, Set<string>>;
  toolAliases: Map<string, Set<string>>;
  provisioned: Set<string>;
}

export function mutableAuthorization(): MutableAuthorization {
  return {
    activeTenants: new Set(["tenant-a", "tenant-b"]),
    tenantPrincipals: new Map([
      ["tenant-a", new Set(["user-a", "user-a2"])],
      ["tenant-b", new Set(["user-b"])],
    ]),
    tenantRuns: new Map([
      ["tenant-a", new Set(["run-a", "run-a2"])],
      ["tenant-b", new Set(["run-b"])],
    ]),
    agentProviders: new Map([["agent-1", new Set(["codex", "database", "openai"])]]),
    toolAliases: new Map([["tool-1", new Set(["database/main", "search/web"])]]),
    provisioned: new Set([
      "tenant-a/database/main",
      "tenant-a/search/web",
      "tenant-a/mcp/local",
      "tenant-a/codex/dev",
      "tenant-a/openai/team",
      "tenant-b/database/main",
    ]),
    async isTenantActive(tenantId) { return this.activeTenants.has(tenantId); },
    async principalBelongsToTenant(tenantId, principalId) { return this.tenantPrincipals.get(tenantId)?.has(principalId) ?? false; },
    async runBelongsToTenant(tenantId, runId) { return this.tenantRuns.get(tenantId)?.has(runId) ?? false; },
    async agentAllowedProvider(_tenantId, agentId, provider) { return this.agentProviders.get(agentId)?.has(provider) ?? false; },
    async toolAllowedAlias(_tenantId, toolId, provider, alias) { return this.toolAliases.get(toolId)?.has(`${provider}/${alias}`) ?? false; },
    async credentialProvisioned(tenantId, provider, alias) { return this.provisioned.has(`${tenantId}/${provider}/${alias}`); },
  };
}

export function createBrokerHarness(options: {
  rateLimits?: Partial<RateLimitConfig>;
  limits?: Partial<LeaseRequestLimits>;
  usage?: QuotaUsageSource;
  now?: () => number;
  secrets?: InMemorySecretStore;
} = {}): BrokerHarness {
  let clock = options.now?.() ?? Date.now();
  const leases = new InMemoryLeaseStore();
  const secrets = options.secrets ?? new InMemorySecretStore([
    { tenantId: "tenant-a", provider: "database", alias: "main", value: "postgres://fake-broker-db/tenant-a" },
    { tenantId: "tenant-a", provider: "search", alias: "web", value: "search-fake-key" },
    { tenantId: "tenant-a", provider: "mcp", alias: "local", value: "mcp-fake-token" },
    { tenantId: "tenant-a", provider: "codex", alias: "dev", value: "codex-fake-key" },
    { tenantId: "tenant-a", provider: "openai", alias: "team", value: "sk-fake-not-real" },
    { tenantId: "tenant-b", provider: "database", alias: "main", value: "postgres://fake-broker-db/tenant-b" },
  ]);
  const audit = new InMemoryAuditRecorder();
  const authorization = mutableAuthorization();
  const rateLimits: RateLimitConfig = {
    ...DEFAULT_RATE_LIMITS,
    ...options.rateLimits,
  };
  const rateLimiter = new RateLimiter(rateLimits, () => clock);
  const policy = new BrokerPolicy(
    authorization,
    { maxCredentialUsesPerRun: 1_000 },
    options.usage ?? { async runUsage() { return 0; }, async tenantSpend() { return 0; } },
  );
  const service = new CredentialBrokerService({
    leases,
    secrets,
    audit,
    policy,
    rateLimiter,
    limits: { ...DEFAULT_LEASE_LIMITS, ...options.limits },
    sourceService: "test-broker",
    activeLeases: {
      async countActive(tenantId) {
        return leases.countActive(tenantId, clock);
      },
    },
    now: () => clock,
  });
  return {
    service,
    leases,
    secrets,
    audit,
    rateLimiter,
    setNow(now: number) { clock = now; },
    authorization,
  };
}

export function leaseRequest(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: "1",
    tenantId: "tenant-a",
    principalId: "user-a",
    runId: "run-a",
    provider: "database",
    alias: "main",
    purpose: "database",
    ...overrides,
  };
}

export { verifyAuditChain };
