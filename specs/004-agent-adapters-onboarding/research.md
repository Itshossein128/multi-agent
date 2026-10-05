# Research: Server-Owned Agent Adapters and Guided First-Run Onboarding

**Feature**: [spec.md](./spec.md) | **Date**: 2026-10-04

## Research Overview

This document resolves technical choices, security constraints, and integration contracts for:
1. Server-owned allowlisted local process execution.
2. External HTTP/webhook agent task dispatch with anti-SSRF protections.
3. Credential leasing for HTTP agents through the existing credential broker.
4. Guided first-run onboarding CLI separating database setup/offline self-test from real provider readiness probes.

---

## 1. Local Process Isolation & Security Boundaries

### Finding / Gap Analysis
- Currently, `CliAgentExecutor` runs CLI providers (`codex`, `claude-code`, `agy`, `cursor`) via `WorkerRuntime`.
- A host process allowlist and workspace path check do **not** provide OS-level tenant isolation. If a process runs directly on the host OS as the application user, it shares host resources, memory, and potential loopback networking.
- **Decision**:
  - Host process execution (`workerMode: "local"`) is strictly **trusted-only** (e.g. single-tenant / operator-owned workflows).
  - For untrusted or multi-tenant workloads, execution must use container isolation (`workerMode: "container"`) or fail closed with a typed isolation error (`ISOLATION_UNSUPPORTED`).
  - The process backend requires explicit server allowlisting of:
    - Approved binary commands / absolute paths.
    - Approved workspace directory roots.
    - Argument allowlist patterns (preventing argument injection or shell metacharacter expansion).
    - Shell invocation is always disabled (`shell: false`).

---

## 2. External HTTP / Webhook Agent & Anti-SSRF Protections

### Finding / Gap Analysis
- `HttpToolExecutor` currently executes arbitrary HTTP calls without DNS rebinding protection or IP validation.
- An external HTTP agent poses SSRF risks: an agent or user might configure `http://169.254.169.254/latest/meta-data/` or `http://127.0.0.1:5432/` or an external domain that rebinds to an internal IP.
- **Decision**:
  - Implement a dedicated anti-SSRF HTTP dispatcher:
    1. **Allowed Schemes**: Only `http:` and `https:`. No credentials in URL (`username`, `password`), no fragments.
    2. **Domain/Host Allowlist**: Configurable server-level allowlist (`WEBHOOK_AGENT_ALLOWED_HOSTS`).
    3. **DNS Resolution & Rebinding Protection**: Prior to connecting, resolve the hostname via DNS. Check all returned IPv4 and IPv6 addresses against blocked ranges:
       - Loopback: `127.0.0.0/8`, `::1`
       - Private networks: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`
       - Link-local / Cloud metadata: `169.254.0.0/16`, `fe80::/10`
       - Carrier-grade NAT: `100.64.0.0/10`
    4. **Redirect Policy**: Redirects (`301`, `302`, `307`, `308`) must either be disabled (`redirect: "manual"`) or each redirect target must be re-checked against the anti-SSRF validator. Disabling automatic redirects or strictly validating redirect hops prevents SSRF bypasses.
    5. **Response Bounds**: Enforce `maxResponseBytes` (default 2MB) using a streaming reader. Abort connection if exceeded.
    6. **Timeouts**: Enforce request timeouts via `AbortSignal.timeout(timeoutMs)`.

---

## 3. Credential Broker Integration for HTTP Webhook Agents

### Finding / Gap Analysis
- `src/broker/contract.ts` defines `CREDENTIAL_PROVIDERS` and `PURPOSES_BY_PROVIDER`.
- Currently, allowed providers are: `openai`, `anthropic`, `gemini`, `codex`, `claude-code`, `cursor`, `agy`, `database`, `search`, `mcp`.
- The existing broker enforces `PURPOSES_BY_PROVIDER` strictly (deny-by-default).
- **Decision**:
  - Safely extend `CredentialProvider` with `"webhook"`.
  - In `PURPOSES_BY_PROVIDER`, register `webhook: new Set<CredentialPurpose>(["agent", "tool"])`.
  - When an HTTP webhook agent specifies a `credentialAlias` (e.g. `"payment-service"`), the server requests a single-use lease from the broker for `provider: "webhook"`, `alias: "payment-service"`, `purpose: "agent"`.
  - The server consumes the lease immediately before making the outbound request and attaches the token (e.g. `Authorization: Bearer <secret>`).
  - No secret tokens are ever stored in agent records or workflow definitions.

---

## 4. Guided Local Onboarding Design

### Finding / Gap Analysis
- Existing setup requires manually running migrations or docker containers.
- Users need a guided first-run experience in the CLI (`pnpm cli onboard` or similar) that:
  1. Checks Node.js runtime and environment variables.
  2. Probes PostgreSQL connectivity using `DATABASE_URL` or `MEMORY_TEST_DATABASE_URL` / `infrastructure/memory/compose.yml`.
  3. Checks migration status across `studio` and `memory` stores.
  4. Runs migrations idempotently on operator approval.
  5. Runs a safe offline self-test agent run that verifies the end-to-end execution pipeline (input node -> agent node -> output node, run event streaming, status transitions) **without** making external API calls.
  6. Reports provider readiness (e.g., checking if CLI tools or API keys are set in environment) without making paid generative requests.
