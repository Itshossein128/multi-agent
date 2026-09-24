export {
  BrokerError,
  CREDENTIAL_BROKER_CONTRACT_VERSION,
  CREDENTIAL_PROVIDERS,
  CREDENTIAL_PURPOSES,
  brokerErrorMessage,
  derivePurpose,
  validateAlias,
  validateConsumeRequest,
  validateLeaseRequest,
  validateProvider,
  validatePurpose,
  validateRevokeRequest,
  validateTtl,
  DEFAULT_LEASE_LIMITS,
} from "./contract";
export type {
  BrokerErrorCode,
  CredentialConsumeRequest,
  CredentialLease,
  CredentialLeaseRequest,
  CredentialProvider,
  CredentialPurpose,
  CredentialRevokeRequest,
  LeaseRequestLimits,
} from "./contract";

export { InMemorySecretStore, VaultSecretStore } from "./secretStore";
export type { SecretStore, SecretStoreInput, SharedSecretPolicy, StoredSecret } from "./secretStore";

export { generateLeaseId, InMemoryLeaseStore, LEASE_TABLE_DDL, PostgresLeaseStore, startLeaseCleanup } from "./leaseStore";
export type { CredentialLeaseRecord, LeaseContext, LeaseStore } from "./leaseStore";

export { auditEvent, AUDIT_TABLE_DDL, InMemoryAuditRecorder, PostgresAuditRecorder, verifyAuditChain } from "./audit";
export type { AuditInput, AuditOperation, AuditQuery, AuditRecord, AuditRecorder } from "./audit";

export { BrokerPolicy } from "./policy";
export type { AuthorizationSource, BrokerPolicyConfig, QuotaUsageSource } from "./policy";

export { DEFAULT_RATE_LIMITS, RateLimiter, rateLimitFromEnvironment } from "./rateLimit";
export type { RateLimitConfig } from "./rateLimit";

export { CredentialBrokerService } from "./service";
export type { ActiveLeaseCounter, BrokerServiceDependencies } from "./service";

export { createBrokerApp, StaticServiceAuth } from "./httpApp";
export type { BrokerAppOptions, BrokerServiceAuth, Scope, ServiceIdentity } from "./httpApp";

export {
  assertValidBrokerClientEnvironment,
  brokerClientConfigFromEnvironment,
  brokerServerConfigFromEnvironment,
} from "./config";
export type { BrokerClientConfig, BrokerServerConfig, BrokerTlsConfig } from "./config";

export { createBrokerHttpApp, createCredentialBrokerService, denyAllAuthorization, startBroker } from "./server";
export type { BrokerCompositionOptions, RunningBroker } from "./server";
