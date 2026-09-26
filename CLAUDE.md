# Credential Broker — completed work (2026-09-24)

## Status
All work complete. Full suite green: 63 suites / 918 tests. Root + server typecheck clean. Server + web builds pass. `git diff --check` clean.

## Verification results (run 2026-09-24)
- `pnpm test --runInBand` → 63 suites, 918 tests pass
- `npx tsc --noEmit` (root) + `apps/server` → clean
- `pnpm --filter server build`, `pnpm --filter web build` → pass
- `git diff --check` → clean
- Broker test suites (5): contract 19, service 24, http 15, security 25, persistence 18 = 101
- PostgreSQL persistence (tests/brokerPersistence.test.ts): 18/18 — run with
  `MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"`
  (PG 16 compose started; studio_memory DB from infrastructure/memory/compose.yml).
  Per-test random schema create/drop, appends trigger blocks UPDATE/DELETE on audit.
- Docker is not required in this environment; PG 16 was present on the host.

## Architecture (new `src/broker/`)
- contract.ts — v1 contract, 28 BrokerErrorCodes, validation for issue/consume/revoke,
  TTL/alias/provider/purpose bounds, purpose-by-provider matrix.
- leaseStore.ts — LeaseStore interface; InMemory (scan/countActive) + Postgres (atomic
  conditional UPDATE single-use consume, re-read disambiguation), DDL + 4 required
  indexes + partial unique idempotency index, startLeaseCleanup.
- audit.ts — InMemoryAuditRecorder + PostgresAuditRecorder; SHA-256 hash chain;
  verifyAuditChain; field whitelist; append-only trigger; AUDIT_TABLE_DDL.
- secretStore.ts — SecretStore interface; InMemorySecretStore (fault injection,
  shared-alias deny-by-default) + VaultSecretStore (KV v2, fail-closed, path-safe
  segments, tenant→_shared fallback only after explicit sharedPolicy).
- policy.ts — BrokerPolicy deny-by-default (tenant active, principal/run membership,
  agent provider, tool alias, provisioned, run quota, budget).
- rateLimit.ts — RateLimiter (issue/tenant/min, consume attempts/lease = failures,
  active leases/tenant, consume/tenant/min; from environment).
- service.ts — CredentialBrokerService: issue w/ idempotency, consume (audit single-deny),
  revoke idempotent + context mismatch w/o existence disclosure, cleanupExpired, health,
  queryAudit, active-lease check.
- httpApp.ts — Hono: POST /v1/leases, POST /v1/leases/:id/consume, POST /v1/leases/:id/revoke,
  GET /v1/health, GET /v1/audit/leases; StaticServiceAuth (constant-time compare, scopes,
  forbidden query keys, 16KB body cap, path/body leaseId match).
- config.ts — brokerClientConfigFromEnvironment; assertValidBrokerClientEnvironment
  (production requires URL+token+mTLS files exist+FAIL_CLOSED+HTTPS); brokerServerConfigFromEnvironment.
- server.ts — startBroker (Postgres/Vault/deny-all fallback; HTTPS+mTLS; require.main entrypoint).
- index.ts — barrel. infrastructure/broker/migrate.cjs — DDL runner.

## Execution-server client changes (`src/security/`)
- credentialGateway.ts: HttpCredentialGateway (requestTimeoutMs, issueRetries w/
  Idempotency-Key retry, revoke(), mTLS undici Agent, CredentialGatewayError w/ code,
  lease-binding assertions) + EnvironmentCredentialGateway dev-only + credentialGatewayFromEnvironment
  (production throws if invalid). Provider union widened (CLI/API providers).
- providerCredentials.ts: BrokerApiCredentialResolver, apiProviderCredentialResolverFromEnvironment, NO_API_CREDENTIALS.
- llmFactory.ts: optional per-invocation apiKey in providers/factory.
- apiAgentExecutor.ts: resolves leased key when credentialPrincipal present (fail-closed).
- agentExecutorFactory.ts + agentRuntime.ts: accept apiCredentialResolver.
- workerCredentials.ts: BrokerWorkerCredentialResolver (server-mediated; production requires
  CREDENTIAL_BROKER_TRUSTED_SERVER_DELIVERY=true; injected isProduction for tests) + composite
  [broker, codexFile, claudeFile, env]. src/agents/runtime/index.ts exports added.

## Server wiring (`apps/server/src/`)
- composition.ts: createCredentialComposition.
- index.ts: composition first; passes credentials.workerCredentials/apiCredentials into AgentRuntime;
  closes on shutdown.

## Docs updated
- deferred-credential-gateway.md (rewrite + production checklist), development.md (new broker section),
  architecture.md (broker section + code structure), implementation-gaps.md, verification.md,
  production-saas-readiness-gaps.md, roadmap.md, README.md.

## Env precedence
CREDENTIAL_BROKER_* wins over TOOL_CREDENTIAL_GATEWAY_*. Production never silently falls back.

## Notes / remaining gaps (for the report)
- Standalone broker entrypoint defaults to deny-all authorization; deployment must
  supply AuthorizationSource/QuotaUsageSource (directory wiring is deployment-specific).
- Rate-limiters are process-local; multi-instance brokers need shared store.
- Client-side issue retries with Idempotency-Key: network retry counts as consume failure
  only after issue; consume attempts rate limit counts failures.
- mTLS is code-verified but not proven against real certificates; Vault adapter proven
  only against the fake HTTP store.
- Worker delivery is currently server-mediated; worker-direct lease consumption is a future target.
