# Feature Specification: Server-Owned Agent Adapters and Guided First-Run Onboarding

**Feature Branch**: `004-agent-adapters-onboarding`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "extend existing API/local/CLI agent backends with safe server-owned adapters for (a) an allowlisted local process and (b) an external HTTP/webhook agent, plus guided local first-run onboarding. The spec must cover operator setup, agent creation, invocation, result/errors, cancellation/timeouts, policy boundaries, tenant isolation, no arbitrary executable/network destination, credential handling through existing broker, and backwards compatibility. Onboarding should check prerequisites and guide the user through the existing PostgreSQL/migrations setup to a first working agent/run; do not silently create paid-provider calls or write secrets into persisted records. Prove current gaps by reading relevant code/docs. Do not touch untracked examples/ or any secrets. Make reasonable assumptions without asking routine questions."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Guided First-Run Local Onboarding (Priority: P1)

An operator or developer setting up the platform locally initiates a guided onboarding command that checks environment prerequisites, inspects database connectivity and migration state, safely applies pending schema migrations, and completes an offline self-test agent run without triggering paid external API calls or persisting credentials into stored records. Real provider readiness is reported via safe configuration probes rather than billable invocations.

**Why this priority**: A dependable onboarding experience allows developers and operators to immediately achieve a verified, functioning local installation without accidentally incurring API charges, risking secret leakage, or encountering schema errors.

**Independent Test**: Can be tested on a clean machine by invoking the onboarding command; it checks storage and runtime prerequisites, applies database migrations if needed, executes a self-test run using an offline backend, and verifies that zero outbound paid-provider network requests and zero plaintext secrets are saved.

**Acceptance Scenarios**:

1. **Given** a local deployment pointing to a PostgreSQL instance with pending migrations, **When** the operator runs the onboarding command, **Then** the system detects missing tables, applies schema migrations idempotently, and confirms database health.
2. **Given** an environment without paid external API keys configured, **When** onboarding executes its self-test run, **Then** it uses a dedicated safe offline self-test execution path to verify end-to-end node scheduling, event streaming, and state persistence without calling external paid endpoints.
3. **Given** an environment with optional external providers configured, **When** the operator checks provider status during onboarding, **Then** the system performs diagnostic presence and connectivity checks without invoking generative token generation or billing calls.
4. **Given** configuration values supplied by the operator, **When** stored by onboarding, **Then** zero secret tokens or passwords are saved into agent definition records or database tables.

---

### User Story 2 - Allowlisted Local Process Agent Execution (Priority: P1)

An administrator registers and executes a local executable as an agent under strict server-governed allowlists, bounded execution parameters, and explicit isolation boundaries. Host process execution is restricted to trusted operators; untrusted or multi-tenant workloads must enforce container isolation or fail closed.

**Why this priority**: Unlocks custom executables, local scripting, and internal CLI tools as workflow agents without allowing arbitrary command execution, path traversal, or cross-tenant contamination on the host server.

**Independent Test**: Can be tested by invoking an agent configured with an approved executable on an allowlisted path. The process runs within configured bounds and streams output. In contrast, invoking a non-allowlisted executable, specifying a path traversal argument, or attempting untrusted multi-tenant host execution is rejected with a policy denial.

**Acceptance Scenarios**:

1. **Given** a server-level allowlist defining approved executables and permitted workspace paths, **When** a trusted-context agent configured with an allowlisted command runs, **Then** the process spawns within the allowed working directory, streams standard output/error events, and completes cleanly.
2. **Given** an agent configuration specifying a binary, argument, or directory not on the server allowlist, **When** the agent is validated or invoked, **Then** the server rejects the execution with an immediate policy denial prior to process spawn.
3. **Given** a multi-tenant environment without container isolation enabled, **When** an agent attempts host process execution, **Then** the execution fails closed with an isolation requirement error.
4. **Given** an active process agent execution, **When** a cancellation signal is triggered or the execution timeout is reached, **Then** the process receives a termination signal, escalates to force-kill if unresponsive within a grace window, and releases all system handles.

---

### User Story 3 - External HTTP / Webhook Agent Execution (Priority: P2)

An operator integrates an external service or remote agent over HTTP/webhook. Task execution is dispatched to a remote endpoint governed by strict destination allowlists, anti-SSRF protections (DNS resolution checks, private/metadata address blocking, redirect restrictions), strict response ceilings, and automated credential leases from the credential broker.

**Why this priority**: Enables delegating workflow nodes to external microservices and remote agent runtimes while preventing server-side request forgery (SSRF), internal network scanning, and secret sprawl.

**Independent Test**: Can be tested by dispatching a workflow task to a mock HTTP webhook endpoint matching the server allowlist. The system leases an authentication token via the credential broker, posts the task envelope, validates response size and structure, and returns output. Requests to unlisted hosts, private IP ranges (e.g., `127.0.0.1`, `169.254.169.254`), or attempts to redirect to unapproved destinations are blocked.

**Acceptance Scenarios**:

1. **Given** an agent configured with an allowlisted external HTTP destination and a credential alias, **When** invoked, **Then** the server requests a single-use lease from the credential broker for provider `webhook`, attaches the authentication token to the request header, posts the task payload, and maps the response to an agent completion event.
2. **Given** an external agent whose destination URL resolves to a loopback address, private network (RFC 1918), cloud metadata service, or unapproved domain, **When** validated or invoked, **Then** the request is blocked by DNS-level SSRF checks before transmission.
3. **Given** an external HTTP agent response that attempts to redirect to an unapproved destination or exceeds the maximum response byte limit, **When** received, **Then** the connection is aborted and a typed policy violation or size-limit error is raised.
4. **Given** an external HTTP agent call that times out or is cancelled, **When** aborted, **Then** the outbound HTTP request is terminated and the credential lease is promptly revoked or allowed to expire.

---

### User Story 4 - Agent Diagnostics & Backwards Compatibility (Priority: P3)

An operator upgrades an existing deployment containing existing `api`, `cli`, and `local` (Ollama/LM Studio) agents, ensuring all existing configurations and workflows continue to function with zero regressions, while all agent types benefit from consistent diagnostics, validation, and secret sanitization.

**Why this priority**: Protects existing investments and active workflows while guaranteeing unified security policies and diagnostic health reporting across every agent backend.

**Independent Test**: Can be tested by verifying that existing API and CLI agent definitions pass validation and execute according to current semantics, while any agent configuration containing embedded secret keys is rejected at save time.

**Acceptance Scenarios**:

1. **Given** existing workflows utilizing `api`, `cli`, or `local` backends, **When** loaded and executed on the updated platform, **Then** they run without modification or change in event structure.
2. **Given** an agent record of any backend type containing inline API keys, bearer tokens, or plaintext secrets, **When** saved or updated, **Then** validation rejects the configuration and prevents storage.
3. **Given** a diagnostic check requested for any agent, **When** evaluated, **Then** the server returns status (`ready`, `misconfigured`, `unavailable`) without disclosing secret values, token contents, or internal server paths.

---

### Edge Cases

- **DNS Rebinding & Redirection in Webhook Dispatch**: An external endpoint host may initially resolve to an allowlisted public IP but resolve to `127.0.0.1` upon subsequent connection or redirect to an internal IP. The runtime must validate IP addresses immediately before socket connection and strictly validate any HTTP redirect targets against the SSRF allowlist.
- **Unresponsive Local Process on Cancel**: If a child process ignores SIGTERM during cancellation or timeout, an escalating timer (e.g. 500ms) issues a SIGKILL to guarantee no process leak on the host.
- **Oversized Webhook Response**: An external server may stream indefinitely or send gigabytes of data. The HTTP client must enforce a streaming byte ceiling (e.g., 2MB) and abort the stream if exceeded.
- **Multi-Tenant Host Process Request**: In a multi-tenant environment without container workers configured, a local process backend must fail closed rather than running on the shared host.
- **Credential Broker Outage**: If the credential broker cannot issue a lease for an external webhook agent, the execution fails closed with a typed credential error and records an audit log.
- **Partial or Divergent Database Migrations**: Onboarding must detect both unapplied migrations and unexpected schema states, presenting actionable resolution steps without corrupting data.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support an allowlisted local process agent backend that executes server-approved binaries within restricted directory roots.
- **FR-002**: System MUST reject any local process execution whose binary, arguments, or working directory are not present on the server-owned allowlist.
- **FR-003**: System MUST treat host process execution as trusted-operator only; untrusted or multi-tenant workloads MUST be isolated via container runtimes or fail closed.
- **FR-004**: System MUST support an external HTTP/webhook agent backend that dispatches task payloads to remote HTTP endpoints.
- **FR-005**: System MUST enforce server-owned destination allowlists for external HTTP agents, blocking private IP ranges, loopback addresses, cloud metadata endpoints, and DNS rebinding attacks.
- **FR-006**: System MUST obtain authentication credentials for external HTTP agents via single-use, time-bounded leases from the credential broker using the `webhook` provider and `agent` purpose.
- **FR-007**: System MUST validate all agent configurations at save time and execution time, rejecting any inline secrets, private keys, or credential tokens.
- **FR-008**: System MUST support execution timeouts and cancellation signals for all agent backends, terminating child processes, sockets, and credential leases upon cancellation.
- **FR-009**: System MUST emit standard lifecycle events (`agent.started`, `agent.output`, `agent.completed`, `agent.failed`) across all backends to ensure unified observability.
- **FR-010**: System MUST provide a guided onboarding assistant in the CLI that verifies storage prerequisites, checks database connectivity, and safely runs schema migrations.
- **FR-011**: System MUST provide an offline self-test execution path during onboarding that verifies workflow scheduling and state storage without contacting paid external LLMs.
- **FR-012**: System MUST support non-billable diagnostic checks for external providers during onboarding to report configuration readiness without invoking generative token generation.
- **FR-013**: System MUST maintain backwards compatibility for existing `api`, `cli`, and `local` (Ollama/LM Studio) agent configurations and workflow node contracts.
- **FR-014**: System MUST redact sensitive variables, tokens, and authorization headers from error messages, debug output, and telemetry events.

### Key Entities

- **AgentBackend (Extended)**:
  - `process`: server-governed local binary execution (`command`, `args`, `workspaceRoot`).
  - `webhook`: server-governed HTTP agent dispatch (`url`, `method`, `credentialAlias`, `timeoutMs`).
- **LocalProcessRuntimePolicy**: Server configuration specifying permitted binary paths, allowed arguments, workspace directories, and tenant execution mode (`trusted-host` vs `container-required`).
- **WebhookDestinationPolicy**: Server configuration specifying allowed hostnames/schemes, private IP blocking rules, max response bytes, and redirect policies.
- **OnboardingReport**: Structured result summarizing prerequisite status, database migration state, self-test verification result, and provider readiness.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operators can complete environment inspection, database migration, and self-test verification via onboarding in under 3 minutes.
- **SC-002**: 100% of unauthorized local executables, invalid workspace directories, and private/unapproved HTTP destinations are blocked with zero process spawns or network leaks.
- **SC-003**: 0 paid external API calls and 0 persisted secrets occur during the entire first-run onboarding flow.
- **SC-004**: 100% of cancelled or timed-out process and HTTP executions release all system handles within 1 second.
- **SC-005**: 100% of existing workflows and agent configurations execute without breaking changes or regression in event schemas.
- **SC-006**: Diagnostic health and readiness status for all agent backends responds in under 500ms without disclosing credentials.

## Assumptions

- **Isolation Boundaries**: Host process execution with filesystem allowlisting is strictly intended for trusted/single-tenant deployments. Multi-tenant deployments require containerized workers (`workerMode: "container"`) or will fail closed.
- **Credential Broker**: The credential broker contract is extended to include provider `webhook` with purpose `agent` to provide token leasing for outbound HTTP agents.
- **Anti-SSRF Enforcement**: Outbound HTTP requests to webhook agents resolve DNS to check target IP addresses against private/reserved ranges before establishing connections.
- **Offline Self-Test**: The first-run verification task utilizes an internal self-test execution mode that proves scheduler, persistence, and event pipelines without relying on external network calls.
- **Database Migrations**: Existing migration runners in `src/studio/infrastructure/migrate.ts` and `src/memory/infrastructure/migrate.ts` are leveraged idempotently by the onboarding CLI.
