# Tasks: Server-Owned Agent Adapters and Guided First-Run Onboarding

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-04

## Task Breakdown

### Phase 1: Core Types & Broker Contract Extension
- [x] T001: Extend `AgentBackend` in `packages/types/src/index.ts` with `process` and `webhook` variants.
- [x] T002: Update validation in `packages/types/src/agentConfiguration.ts` to validate `process` and `webhook` backends, asserting no credentials and strict URL/path formats.
- [x] T003: Safely extend `src/broker/contract.ts` with provider `"webhook"` and purpose compatibility (`"agent"` and `"tool"`).
- [x] T004: Update `src/security/credentialGateway.ts` to include `"webhook"` in `CredentialGatewayRequest` and environment alias naming.

### Phase 2: Anti-SSRF Protection & Webhook Agent Executor
- [x] T005: Create `src/agents/runtime/ssrfProtection.ts` with DNS pre-resolution, private/metadata/loopback IP blocking, and redirect policy.
- [x] T006: Create `src/agents/runtime/webhookAgentExecutor.ts` implementing `AgentExecutor` with anti-SSRF client, broker lease acquisition, response size bounds, and timeout handling.
- [x] T007: Wire `webhook` executor into `src/agents/runtime/agentExecutorFactory.ts`.

### Phase 3: Process Agent Executor & Policy
- [x] T008: Create `src/agents/runtime/processAgentExecutor.ts` utilizing `WorkerRuntime` with allowlists, argument validation, and trusted-host enforcement.
- [x] T009: Update `src/agents/runtime/executionPolicy.ts` with assertions for process execution policy (allowlist verification, container requirement for untrusted tenants).
- [x] T010: Wire `process` executor into `src/agents/runtime/agentExecutorFactory.ts`.

### Phase 4: Guided Onboarding Assistant
- [x] T011: Create `src/cli/onboard.ts` implementing prerequisite checks, PostgreSQL migration validation/execution, and offline self-test agent run.
- [x] T012: Register the `onboard` command in `src/cli/index.ts`.

### Phase 5: Testing & Verification
- [x] T013: Add unit tests for `ssrfProtection.ts` (blocking private IPs, loopbacks, metadata, and allowing approved public hosts).
- [x] T014: Add unit and integration tests for `webhookAgentExecutor.ts` (successful dispatch with broker lease, rejection of SSRF targets, timeout, cancellation).
- [x] T015: Add unit and integration tests for `processAgentExecutor.ts` (allowlist enforcement, denial of unauthorized executables, cancellation, timeout).
- [x] T016: Add tests for `onboard.ts` (prerequisite reporting, migration detection, offline self-test execution without paid calls).
- [x] T017: Run root and server typecheck, and ensure all new and existing tests pass.
