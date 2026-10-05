# Implementation Plan: Server-Owned Agent Adapters and Guided First-Run Onboarding

**Branch**: `004-agent-adapters-onboarding` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-agent-adapters-onboarding/spec.md`

## Summary

Extend the multi-agent execution server with safe, server-owned adapters for:
1. Allowlisted local process execution (`type: "process"`) utilizing existing `WorkerRuntime` / process sandboxing, with strict operator allowlists, argument pattern checks (`PROCESS_AGENT_ALLOWED_ARG_PATTERNS`), canonical executable path verification, and trusted-only host semantics (`PROCESS_AGENT_TRUSTED_HOST_ALLOWED=true`).
2. External HTTP/webhook agent execution (`type: "webhook"`) with robust anti-SSRF protections (socket connection-time DNS lookup pinning via `createPinnedSsrfDispatcher`, fail-closed empty allowlists, private/metadata address blocking, redirect restrictions with origin-change token stripping, full-stream timeout/abort handling, response size bounds), and credential resolution via the existing credential broker.
3. Guided local first-run onboarding CLI (`pnpm cli onboard`) that validates prerequisites, surfaces pending PostgreSQL migrations (and applies them on explicit `--migrate`), runs a safe offline in-memory event smoke test, and probes provider readiness passively without billable external API calls.

## Technical Context

**Language/Version**: TypeScript 5.7 (Node.js 20+ execution server and CLI)

**Primary Dependencies**: `@multi-agent/types`, existing `WorkerRuntime` (`LocalProcessWorkerRuntime`, `ContainerWorkerRuntime`), `CredentialGateway`, `AgentRuntime`, `pg` (PostgreSQL client)

**Storage**: PostgreSQL via existing migration infrastructure (`src/studio/infrastructure/migrate.ts` and `src/memory/infrastructure/migrate.ts`), in-memory stores for testing

**Testing**: Jest (unit and integration tests), TypeScript compilation (`tsc --noEmit`)

**Target Platform**: Linux / macOS / Windows Node.js server environments

**Project Type**: Monorepo library, execution server, and CLI

**Performance Goals**: Onboarding finishes checks and in-memory event smoke in < 5 seconds; Webhook DNS resolution and anti-SSRF check adds < 10ms overhead; Process execution cancellation escalates to SIGKILL within 500ms.

**Constraints**:
- Host process execution is trusted-only (`PROCESS_AGENT_TRUSTED_HOST_ALLOWED=true`); multi-tenant requires container isolation or fails closed.
- Anti-SSRF must block loopback, private RFC 1918, cloud metadata (`169.254.169.254`), and socket-level DNS rebinding via transport-level lookup pinning. Empty host allowlist fails closed.
- Credential broker provider/purpose matrix must be safely extended with `webhook` provider and `agent` purpose. Leased bearer tokens must never be sent over plain HTTP or across cross-origin redirects.
- Zero secrets in persisted agent records or workflow definitions; secrets redacted from error messages.
- Zero paid API calls during onboarding; truthful reporting as in-memory event smoke.

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Tenant Isolation | PASS | Host process requires explicit operator opt-in; untrusted/multi-tenant fails closed unless container isolation is enabled. |
| Credential Safety | PASS | Outbound HTTP auth resolved through credential broker single-use leases; bearer tokens forbidden over HTTP; secrets redacted from errors. |
| Anti-SSRF Protection | PASS | Connection-time DNS lookup pinning in Undici dispatcher prevents DNS rebinding; private/loopback/metadata destinations blocked; empty allowlist fails closed. |
| Non-paid Onboarding | PASS | Self-test truthfully reported as in-memory event smoke; provider check is passive environment inspection; never implicitly targets test DB. |
| Backwards Compatibility | PASS | Existing API, CLI, and Local backends continue unmodified. |

## Project Structure

### Documentation (this feature)

```text
specs/004-agent-adapters-onboarding/
├── spec.md
├── checklists/
│   └── requirements.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md
```

### Source Code Architecture

```text
packages/types/src/
├── index.ts                     # Extend AgentBackend union with process and webhook
└── agentConfiguration.ts       # Validation for process & webhook backends, reject inline secrets

src/broker/
├── contract.ts                 # Add 'webhook' provider and purpose 'agent' | 'tool'

src/security/
├── credentialGateway.ts        # Support 'webhook' provider in CredentialGatewayRequest

src/agents/runtime/
├── types.ts                    # Runtime types
├── processAgentExecutor.ts     # Local process agent executor via WorkerRuntime
├── webhookAgentExecutor.ts     # External HTTP agent executor with anti-SSRF and broker leasing
├── ssrfProtection.ts           # DNS resolution, private IP filtering, redirect validation
├── agentExecutorFactory.ts     # Instantiate ProcessAgentExecutor & WebhookAgentExecutor
└── executionPolicy.ts          # Policy assertions for process and webhook backends

src/cli/
├── index.ts                    # Register 'onboard' CLI command
└── onboard.ts                  # Guided onboarding workflow (prereqs, migrations, offline self-test)
```
