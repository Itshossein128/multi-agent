# Credential Gateway — Deferred Architecture

> **DO NOT IMPLEMENT YET**
>
> This document describes a planned production security improvement.
> The Credential Gateway is intentionally **deferred** and must **not be implemented during the current CLI worker authentication work**.
>
> The current priority is to complete and validate the simpler development authentication path, prove real Codex/Claude container execution, and finish operational acceptance first.
>
> Implement this gateway only when the platform is moving toward production-grade multi-tenant agent execution or when provider credentials must no longer enter worker containers.

## Status

**Status:** Deferred

**Priority:** Production hardening

**Current implementation:** Trusted server-side credential resolution with controlled per-run credential delivery.

**Target implementation:** External credential gateway where long-lived provider credentials never enter agent worker containers.

---

# Problem

CLI workers execute potentially autonomous and partially untrusted workloads.

Even when provider credentials are injected securely by the server, environment-based credentials remain accessible to:

* the CLI process itself,
* potentially compromised agent processes,
* processes capable of reading the worker environment,
* Docker administrators through container inspection.

This creates an important security boundary problem.

An autonomous coding agent should ideally be able to call OpenAI or Anthropic without possessing the long-lived provider credential used to authorize those requests.

This becomes especially important when supporting:

* multiple tenants,
* multiple users,
* autonomous agents,
* untrusted repositories,
* long-running workers,
* external tools,
* prompt-injection-prone workloads.

---

# Target Architecture

The long-term architecture should separate worker identity from provider credentials.

```text
Authenticated User / Tenant
          │
          ▼
     RunExecutor
          │
          ▼
Credential Resolver
          │
          ▼
Short-lived Run Capability
          │
          ▼
┌─────────────────────────┐
│ Isolated Agent Worker   │
│                         │
│ Codex / Claude Code     │
│                         │
│ NO provider credential  │
└────────────┬────────────┘
             │
             │ short-lived capability
             ▼
┌─────────────────────────┐
│ Credential Gateway      │
│                         │
│ validates:              │
│ - tenant                │
│ - principal             │
│ - run                   │
│ - agent                 │
│ - provider              │
│ - expiration            │
│ - policy                │
└────────────┬────────────┘
             │
             │ inject provider auth
             ▼
     OpenAI / Anthropic
```

The worker receives only a short-lived capability scoped to a specific execution.

The real provider credential remains outside the worker security boundary.

---

# Security Goals

The gateway should guarantee that:

1. Long-lived OpenAI/Anthropic credentials never enter worker containers.
2. Credentials never enter `/workspace`.
3. Credentials never appear in workflow or agent definitions.
4. Credentials never appear in RunEvents, logs, memory, telemetry, traces, or diagnostics.
5. Tenant A cannot use Tenant B's provider account.
6. A capability issued for one Run cannot be reused for another Run.
7. Capabilities expire quickly.
8. Capabilities can be revoked.
9. Workers can access only approved providers/endpoints.
10. Provider requests can be audited without recording sensitive payloads.
11. Compromising a worker does not reveal the underlying long-lived provider credential.

---

# Capability Scope

A gateway capability should be bound to trusted server-side identity.

Conceptually:

```text
capability
├── tenantId
├── principalId
├── runId
├── agentId
├── provider
├── credentialId
├── allowedOperations
├── issuedAt
├── expiresAt
└── nonce / unique identifier
```

Do not trust tenant, user, provider, or credential identifiers supplied directly by workflow/agent configuration.

Authorization must originate from authenticated server context.

---

# Credential Storage

Long-lived provider credentials should eventually live in an encrypted secret-management system.

Possible implementations include:

* managed cloud secret managers,
* Vault-compatible systems,
* KMS-backed encrypted storage,
* another dedicated credential service.

The application database should contain only references such as:

```text
credentialId
tenantId
provider
displayName
status
createdAt
lastUsedAt
```

It should not contain plaintext provider secrets.

---

# Request Flow

Expected production flow:

```text
Run starts
    │
    ▼
Server authenticates principal
    │
    ▼
Server resolves authorized provider credential
    │
    ▼
Server issues short-lived run capability
    │
    ▼
Worker receives capability
    │
    ▼
Worker sends provider request through gateway
    │
    ▼
Gateway validates capability + policy
    │
    ▼
Gateway retrieves provider credential
    │
    ▼
Gateway authenticates upstream request
    │
    ▼
Provider response
    │
    ▼
Gateway
    │
    ▼
Worker
```

The worker must never receive the resolved provider credential.

---

# Network Isolation

When the gateway is implemented, container networking should ideally move away from unrestricted Docker bridge access.

Preferred model:

```text
Worker
   │
   ├── Credential Gateway   ✓
   │
   ├── arbitrary internet  ✗
   │
   └── provider directly   ✗
```

Deployment-level firewall/proxy controls should enforce this.

Application-level URL validation alone must not be treated as the network security boundary.

---

# Auditing

The gateway should produce security audit events containing metadata such as:

```text
tenantId
principalId
runId
agentId
provider
credentialId
operation
timestamp
result
latency
token/request metadata where safe
```

Never log:

```text
API keys
OAuth tokens
refresh tokens
Authorization headers
raw credentials
sensitive request headers
```

Prompt/request contents should also not automatically become security audit records.

---

# Rate and Cost Controls

The gateway is a useful enforcement point for future limits such as:

* requests per Run,
* requests per Agent,
* requests per Tenant,
* token budgets,
* provider/model allowlists,
* concurrency limits,
* daily/monthly cost budgets,
* emergency credential revocation.

These controls should complement, not replace, existing workflow execution limits.

---

# Failure Behavior

Authentication must fail closed.

Examples:

```text
expired capability       -> DENY
unknown run              -> DENY
wrong tenant             -> DENY
wrong provider           -> DENY
revoked credential       -> DENY
invalid signature        -> DENY
gateway unavailable      -> FAIL RUN / RETRY BY POLICY
```

Never silently fall back to a global provider credential.

---

# Relationship to Current Authentication Work

The current development authentication implementation is intentionally simpler.

It may use:

```text
Server
   ↓
Credential Resolver
   ↓
Trusted per-run secret delivery
   ↓
Worker environment
   ↓
Codex / Claude
```

This is acceptable for controlled private development and initial operational validation.

It is **not the intended final multi-tenant production security boundary**.

The current abstractions should therefore avoid coupling credential resolution directly to environment-variable delivery.

Prefer an abstraction such as:

```text
CredentialResolver
        ↓
CredentialDelivery
        ├── EnvironmentDelivery
        ├── TmpfsFileDelivery
        └── GatewayDelivery   ← future
```

This allows the gateway to be introduced later without redesigning the execution architecture.

---

# When to Implement

Do not implement the Credential Gateway merely because this document exists.

Implementation should begin when at least one of these becomes true:

* the platform is preparing for multi-tenant production deployment,
* autonomous agents will execute untrusted repositories,
* workers must not receive long-lived provider credentials,
* multiple users/provider accounts must be isolated,
* provider credential rotation becomes operationally important,
* security review requires provider-secret isolation,
* production network egress needs centralized enforcement,
* cost/rate enforcement needs to happen outside the worker.

---

# Prerequisites

Before implementing this gateway, the following should already work reliably:

* hardened `ContainerWorkerRuntime`,
* immutable digest-pinned CLI worker image,
* Codex container execution,
* Claude Code container execution,
* trusted principal propagation,
* credential resolver abstraction,
* per-run credential scoping,
* disposable workspace execution,
* cancellation and cleanup,
* secret-redaction tests,
* tenant isolation tests,
* operational E2E execution.

---

# Future Implementation Tasks

When this work is activated:

* [ ] Choose secret-storage backend.
* [ ] Define `CredentialRecord` metadata model.
* [ ] Define gateway capability format.
* [ ] Implement short-lived capability issuance.
* [ ] Bind capabilities to tenant/principal/run/agent/provider.
* [ ] Implement capability expiration and revocation.
* [ ] Implement gateway authentication.
* [ ] Implement provider credential resolution.
* [ ] Implement OpenAI forwarding.
* [ ] Implement Anthropic forwarding.
* [ ] Prevent provider credentials from entering workers.
* [ ] Add deployment-level egress restrictions.
* [ ] Add provider/model allowlists.
* [ ] Add rate/token/cost enforcement.
* [ ] Add security audit events.
* [ ] Add credential rotation.
* [ ] Add tenant-isolation tests.
* [ ] Add capability replay tests.
* [ ] Add prompt-injection credential-exfiltration tests.
* [ ] Add gateway failure/recovery tests.
* [ ] Perform security review before production rollout.

---

# Acceptance Criteria

The gateway should not be considered complete until a compromised worker can:

* read its own environment,
* read its writable filesystem,
* execute arbitrary allowed subprocesses,
* inspect its workspace,

and **still cannot recover the underlying OpenAI or Anthropic provider credential**.

Additionally:

```text
Tenant A credential -> inaccessible to Tenant B
Run A capability    -> unusable by Run B
Expired capability  -> unusable
Revoked capability  -> unusable
Worker internet     -> restricted by deployment policy
Provider secrets    -> absent from worker/logs/events/traces
```

Only after these properties are demonstrated through automated and operational tests should the Credential Gateway be treated as the production credential boundary.
