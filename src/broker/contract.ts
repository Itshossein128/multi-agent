/**
 * Versioned contract between execution servers and the external Credential Broker.
 *
 * Design rules enforced here (deny-by-default):
 * - Every lease request is bound to tenant + principal + run identity.
 * - Aliases are matched against a strict pattern; they can never become a path,
 *   an environment-variable name, or an arbitrary secret-store selector.
 * - Providers and purposes are allowlisted by configuration, never taken from
 *   raw request input alone.
 * - TTL is bounded server-side; clients can only request a smaller window.
 * - Errors are machine-readable codes with generic messages. Messages must
 *   never contain secret values, request bodies, or policy internals.
 */

export const CREDENTIAL_BROKER_CONTRACT_VERSION = "1";

export type CredentialProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "codex"
  | "claude-code"
  | "cursor"
  | "agy"
  | "database"
  | "search"
  | "mcp";

/** Every built-in provider. Deployments narrow this with an enabled-providers allowlist. */
export const CREDENTIAL_PROVIDERS: ReadonlySet<string> = new Set<CredentialProvider>([
  "openai",
  "anthropic",
  "gemini",
  "codex",
  "claude-code",
  "cursor",
  "agy",
  "database",
  "search",
  "mcp",
]);

export type CredentialPurpose = "tool" | "agent" | "embedding" | "database" | "search" | "mcp";

export const CREDENTIAL_PURPOSES: ReadonlySet<string> = new Set<CredentialPurpose>([
  "tool",
  "agent",
  "embedding",
  "database",
  "search",
  "mcp",
]);

/** Purpose compatibility by provider. Deny-by-default: anything unlisted is rejected. */
const PURPOSES_BY_PROVIDER: Readonly<Record<string, ReadonlySet<CredentialPurpose>>> = {
  database: new Set<CredentialPurpose>(["database", "tool"]),
  search: new Set<CredentialPurpose>(["search", "tool"]),
  mcp: new Set<CredentialPurpose>(["mcp", "tool"]),
  openai: new Set<CredentialPurpose>(["agent", "embedding"]),
  anthropic: new Set<CredentialPurpose>(["agent"]),
  gemini: new Set<CredentialPurpose>(["agent", "embedding"]),
  codex: new Set<CredentialPurpose>(["agent"]),
  "claude-code": new Set<CredentialPurpose>(["agent"]),
  cursor: new Set<CredentialPurpose>(["agent"]),
  agy: new Set<CredentialPurpose>(["agent"]),
};

export interface CredentialLeaseRequest {
  contractVersion: string;
  tenantId: string;
  principalId: string;
  runId: string;
  agentId?: string;
  toolId?: string;
  provider: CredentialProvider | string;
  alias: string;
  purpose: CredentialPurpose;
  requestedTtlMs?: number;
  audience?: string;
  correlationId?: string;
}

export interface CredentialLease {
  leaseId: string;
  expiresAt: number;
  provider: string;
  alias: string;
  tenantId: string;
  principalId: string;
  runId: string;
  singleUse: true;
  contractVersion: string;
}

export interface CredentialConsumeRequest {
  contractVersion: string;
  leaseId: string;
  tenantId: string;
  principalId: string;
  runId: string;
  provider: string;
  alias: string;
}

export interface CredentialRevokeRequest {
  contractVersion: string;
  leaseId: string;
  tenantId: string;
  principalId: string;
  runId: string;
}

/**
 * Machine-readable error codes. Clients must branch on `code`, never on
 * message text. Messages are static, generic strings.
 */
export type BrokerErrorCode =
  | "invalid_request"
  | "invalid_alias"
  | "invalid_provider"
  | "invalid_purpose"
  | "invalid_ttl"
  | "ttl_out_of_bounds"
  | "unsupported_contract_version"
  | "unauthenticated"
  | "forbidden"
  | "policy_denied"
  | "tenant_inactive"
  | "principal_mismatch"
  | "run_mismatch"
  | "provider_not_allowed"
  | "purpose_not_allowed"
  | "credential_not_provisioned"
  | "lease_not_found"
  | "lease_expired"
  | "lease_consumed"
  | "lease_revoked"
  | "context_mismatch"
  | "rate_limited"
  | "quota_exceeded"
  | "secret_unavailable"
  | "secretstore_unavailable"
  | "idempotency_conflict"
  | "contract_idempotency_conflict"
  | "internal_error";

const ERROR_STATUS: Readonly<Record<BrokerErrorCode, number>> = {
  invalid_request: 400,
  invalid_alias: 400,
  invalid_provider: 400,
  invalid_purpose: 400,
  invalid_ttl: 400,
  ttl_out_of_bounds: 400,
  unsupported_contract_version: 400,
  unauthenticated: 401,
  forbidden: 403,
  policy_denied: 403,
  tenant_inactive: 403,
  principal_mismatch: 403,
  run_mismatch: 403,
  provider_not_allowed: 403,
  purpose_not_allowed: 403,
  credential_not_provisioned: 403,
  lease_not_found: 404,
  lease_expired: 410,
  lease_consumed: 409,
  lease_revoked: 409,
  context_mismatch: 403,
  rate_limited: 429,
  quota_exceeded: 429,
  secret_unavailable: 503,
  secretstore_unavailable: 503,
  idempotency_conflict: 409,
  contract_idempotency_conflict: 409,
  internal_error: 500,
};

/** Generic, static messages. Never interpolate request bodies or secrets. */
const ERROR_MESSAGE: Readonly<Record<BrokerErrorCode, string>> = {
  invalid_request: "The credential request is invalid.",
  invalid_alias: "The credential alias is invalid.",
  invalid_provider: "The credential provider is not allowed.",
  invalid_purpose: "The credential purpose is not allowed for this provider.",
  invalid_ttl: "The requested TTL is invalid.",
  ttl_out_of_bounds: "The requested TTL exceeds the broker limit.",
  unsupported_contract_version: "The contract version is not supported.",
  unauthenticated: "Service authentication is required.",
  forbidden: "The service identity may not perform this operation.",
  policy_denied: "The credential request was denied by policy.",
  tenant_inactive: "The credential request was denied by policy.",
  principal_mismatch: "The credential request was denied by policy.",
  run_mismatch: "The credential request was denied by policy.",
  provider_not_allowed: "The credential provider is not allowed.",
  purpose_not_allowed: "The credential purpose is not allowed for this provider.",
  credential_not_provisioned: "The credential is not provisioned for this tenant.",
  lease_not_found: "The credential lease was not found.",
  lease_expired: "The credential lease has expired.",
  lease_consumed: "The credential lease was already consumed.",
  lease_revoked: "The credential lease was revoked.",
  context_mismatch: "The credential lease is bound to another execution context.",
  rate_limited: "The credential request was rejected by a rate limit.",
  quota_exceeded: "The credential request was rejected by a quota.",
  secret_unavailable: "The credential is unavailable.",
  secretstore_unavailable: "The credential store is unavailable.",
  idempotency_conflict: "The idempotency key was reused with a different request.",
  contract_idempotency_conflict: "The idempotency key was reused with a different request.",
  internal_error: "The credential broker failed to process the request.",
};

export class BrokerError extends Error {
  readonly code: BrokerErrorCode;
  readonly status: number;

  constructor(code: BrokerErrorCode, message?: string) {
    super(message ?? ERROR_MESSAGE[code] ?? ERROR_MESSAGE.internal_error);
    this.name = "BrokerError";
    this.code = code;
    this.status = ERROR_STATUS[code] ?? 500;
  }
}

export function brokerErrorMessage(code: BrokerErrorCode): string {
  return ERROR_MESSAGE[code] ?? ERROR_MESSAGE.internal_error;
}

export interface LeaseRequestLimits {
  maxTtlMs: number;
  defaultTtlMs: number;
  minTtlMs: number;
  enabledProviders: ReadonlySet<string>;
}

export const DEFAULT_LEASE_LIMITS: LeaseRequestLimits = {
  maxTtlMs: 30_000,
  defaultTtlMs: 30_000,
  minTtlMs: 1_000,
  enabledProviders: CREDENTIAL_PROVIDERS,
};

/** Identifier bound: short, URL-safe, never a path or expression. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** Alias bound: strictly safer than an env-var segment; no slashes, no spaces, no leading dot. */
const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const LEASE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new BrokerError("invalid_request", `The ${field} field is invalid.`);
  }
  return value;
}

export function validateAlias(alias: unknown): string {
  if (typeof alias !== "string" || !ALIAS_PATTERN.test(alias)) {
    throw new BrokerError("invalid_alias");
  }
  return alias;
}

export function validateProvider(provider: unknown, limits: LeaseRequestLimits): string {
  if (typeof provider !== "string" || provider.length > 64 || !/^[a-z0-9][a-z0-9-]*$/.test(provider)) {
    throw new BrokerError("invalid_provider");
  }
  if (!limits.enabledProviders.has(provider)) throw new BrokerError("provider_not_allowed");
  return provider;
}

export function derivePurpose(provider: string): CredentialPurpose | undefined {
  if (provider === "database" || provider === "search" || provider === "mcp") return provider;
  if (CREDENTIAL_PROVIDERS.has(provider)) return "agent";
  return undefined;
}

export function validatePurpose(purpose: unknown, provider: string, limits: LeaseRequestLimits): CredentialPurpose {
  let resolved: string | undefined;
  if (purpose === undefined || purpose === null || purpose === "") {
    resolved = derivePurpose(provider);
    if (!resolved) throw new BrokerError("invalid_purpose");
  } else if (typeof purpose !== "string" || !CREDENTIAL_PURPOSES.has(purpose)) {
    throw new BrokerError("invalid_purpose");
  } else {
    resolved = purpose;
  }
  const allowed = PURPOSES_BY_PROVIDER[provider];
  if (!allowed || !allowed.has(resolved as CredentialPurpose)) throw new BrokerError("purpose_not_allowed");
  return resolved as CredentialPurpose;
}

function validateOptionalCorrelation(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !CORRELATION_PATTERN.test(value)) {
    throw new BrokerError("invalid_request", `The ${field} field is invalid.`);
  }
  return value;
}

export function validateTtl(requested: unknown, limits: LeaseRequestLimits): number {
  if (requested === undefined || requested === null) {
    return Math.min(Math.max(limits.defaultTtlMs, limits.minTtlMs), limits.maxTtlMs);
  }
  if (typeof requested !== "number" || !Number.isInteger(requested) || requested <= 0) {
    throw new BrokerError("invalid_ttl");
  }
  if (requested > limits.maxTtlMs) throw new BrokerError("ttl_out_of_bounds");
  if (requested < limits.minTtlMs) throw new BrokerError("invalid_ttl");
  return requested;
}

/**
 * Validate and normalize an untrusted lease request.
 * Throws {@link BrokerError} with a machine-readable code on any violation.
 */
export function validateLeaseRequest(input: unknown, limits: LeaseRequestLimits): CredentialLeaseRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BrokerError("invalid_request");
  const raw = input as Record<string, unknown>;

  const contractVersion = raw.contractVersion === undefined || raw.contractVersion === null
    ? CREDENTIAL_BROKER_CONTRACT_VERSION
    : raw.contractVersion;
  if (contractVersion !== CREDENTIAL_BROKER_CONTRACT_VERSION) throw new BrokerError("unsupported_contract_version");

  const tenantId = requireId(raw.tenantId, "tenantId");
  const principalId = requireId(raw.principalId, "principalId");
  const runId = requireId(raw.runId, "runId");
  const agentId = raw.agentId === undefined || raw.agentId === null ? undefined : requireId(raw.agentId, "agentId");
  const toolId = raw.toolId === undefined || raw.toolId === null ? undefined : requireId(raw.toolId, "toolId");
  const provider = validateProvider(raw.provider, limits);
  const alias = validateAlias(raw.alias);
  const purpose = validatePurpose(raw.purpose, provider, limits);
  const requestedTtlMs = validateTtl(raw.requestedTtlMs, limits);
  const audience = validateOptionalCorrelation(raw.audience, "audience");
  const correlationId = validateOptionalCorrelation(raw.correlationId, "correlationId");

  return { contractVersion, tenantId, principalId, runId, agentId, toolId, provider, alias, purpose, requestedTtlMs, audience, correlationId };
}

export function validateConsumeRequest(input: unknown): CredentialConsumeRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BrokerError("invalid_request");
  const raw = input as Record<string, unknown>;
  const contractVersion = raw.contractVersion === undefined || raw.contractVersion === null
    ? CREDENTIAL_BROKER_CONTRACT_VERSION
    : raw.contractVersion;
  if (contractVersion !== CREDENTIAL_BROKER_CONTRACT_VERSION) throw new BrokerError("unsupported_contract_version");
  if (typeof raw.leaseId !== "string" || !LEASE_ID_PATTERN.test(raw.leaseId)) throw new BrokerError("invalid_request", "The leaseId field is invalid.");
  return {
    contractVersion,
    leaseId: raw.leaseId,
    tenantId: requireId(raw.tenantId, "tenantId"),
    principalId: requireId(raw.principalId, "principalId"),
    runId: requireId(raw.runId, "runId"),
    provider: validateBareName(raw.provider, "provider"),
    alias: validateAlias(raw.alias),
  };
}

export function validateRevokeRequest(input: unknown): CredentialRevokeRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BrokerError("invalid_request");
  const raw = input as Record<string, unknown>;
  const contractVersion = raw.contractVersion === undefined || raw.contractVersion === null
    ? CREDENTIAL_BROKER_CONTRACT_VERSION
    : raw.contractVersion;
  if (contractVersion !== CREDENTIAL_BROKER_CONTRACT_VERSION) throw new BrokerError("unsupported_contract_version");
  if (typeof raw.leaseId !== "string" || !LEASE_ID_PATTERN.test(raw.leaseId)) throw new BrokerError("invalid_request", "The leaseId field is invalid.");
  return {
    contractVersion,
    leaseId: raw.leaseId,
    tenantId: requireId(raw.tenantId, "tenantId"),
    principalId: requireId(raw.principalId, "principalId"),
    runId: requireId(raw.runId, "runId"),
  };
}

function validateBareName(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 64 || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new BrokerError("invalid_request", `The ${field} field is invalid.`);
  }
  return value;
}
