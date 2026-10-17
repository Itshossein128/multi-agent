# Organization lifecycle operations

Apply Studio migrations through `028_organization_lifecycle.sql` with
`pnpm db:migrate` before starting the updated execution server. Run migrations as
the privileged migration owner, as with the existing membership/recovery
functions. The narrow `SECURITY DEFINER` discovery functions pin their schema,
revoke public execution, and grant user discovery to `studio_app` and deletion
discovery to `studio_worker`. Ordinary table access remains subject to FORCE RLS.

Creation establishes the new organization scope before inserting its profile,
owner membership, audit entry, and last-organization pointer. Organization and
invitation discovery use the authenticated account id supplied by the server.

## Broker-backed deletion

Before enabling `ORG_DELETION_ENABLED=true`:

1. Apply the broker DDL with `node infrastructure/broker/migrate.cjs`, using its
   isolated `CREDENTIAL_BROKER_DATABASE_URL`. This adds a persistent tenant denial
   table alongside the existing leases and audit tables.
2. Provision a dedicated broker identity in `CREDENTIAL_BROKER_SERVICE_TOKENS`,
   such as `organization-cleanup:<separate-token>:tenants:purge`. Existing tokens
   without explicit scopes do not receive the purge scope.
3. Set `CREDENTIAL_BROKER_PURGE_TOKEN` on the execution server to that identity's
   token. It uses the configured broker URL, timeout, and mTLS material.
4. Give the broker's Vault identity `list` permission on the tenant's KV v2
   metadata hierarchy and `delete` permission on tenant secret metadata. Cleanup
   uses `/<mount>/metadata/<tenant>/...`; metadata deletion removes all versions,
   as defined by the [Vault KV v2 API](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#delete-metadata-and-all-versions).
   `_shared` credentials and other tenants are preserved.
5. Configure every managed workspace root through `STUDIO_WORKSPACE_STORAGE_ROOT`
   and `CLI_AGENT_WORKSPACE_ROOTS`. Cleanup removes only the requested tenant's
   direct subdirectory beneath those roots. Unmanaged external directories are
   outside this cleanup contract.

The server supplies run, budget, organization-goal, memory, credential, and
workspace cleanup to the deletion worker. Disabled memory retrieval still
cleans persisted memory data when a database URL is configured. Development
environment credentials are process-wide configuration; deleting a tenant
removes its leases and blocks further delivery in that development process.

Checkpoint cleanup removes LangGraph payloads using the tenant's durable run ids
before deleting those runs. Saver setup grants the worker only checkpoint
thread-id reads and deletion, and installs the migration's checkpoint write
fence. Delayed checkpoint writes are rejected once deletion starts or the run
has been removed. The saver setup account must own its checkpoint tables to
install these grants and triggers.

## Responses and recovery

An owner must confirm the exact organization name. Missing cleanup capabilities
return HTTP 503 before changing the organization or canceling its runs.
Configured deletion first commits the durable `deleting` marker, preventing new
organization access and writes, then performs cleanup. Successful deletion
returns HTTP 200 with `status: completed`.

An external cleanup failure returns HTTP 202 with `status: pending`. The
organization remains inaccessible. The server polls pending deletion markers at
startup and every five seconds, including when accepting new deletions is
disabled. Cleanup steps are retryable; the profile is removed only after the
last transaction succeeds. Configure the missing dependency and restart the
server to resume older pending deletions.

Broker cleanup durably blocks credential issuance/consumption before deleting
secrets and leases. Retries retain that denial, and broker audit history remains
append-only. The broker records a secret-free successful purge event. Minimal
deletion denial records are retained to prevent delayed writes and credential
delivery from recreating a deleted organization.

## Local verification

Use a disposable PostgreSQL database and set `MEMORY_TEST_DATABASE_URL` when
running `organizationLifecycleCompletion`, `deletionFailClosedRegression`,
`repairRlsRegression`, `brokerTenantPurge`, and `brokerPersistence` tests. They
cover actual `studio_app`/`studio_worker` roles, mounted signed authentication,
broker HTTP cleanup, failure/retry, restart discovery, and neighboring-tenant
preservation. Vault is exercised through a fake HTTP adapter; production Vault
permissions and mTLS certificates require deployment verification.
