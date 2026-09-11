# Implementation gaps from `checklist.md`

Audit date: 2026-09-09. This report lists only checklist items that are incomplete, contradicted by the current implementation, or have not yet been verified by an automated test. A modeled type or UI is not counted as a working runtime feature.

## Critical — executable workflow and safety gaps

- **Only safe function tools are executable.** The compiler now executes registered function tools through `ToolRuntime`, with server-side timeout and an opt-in side-effect gate. HTTP, database, search, file, MCP, CLI, and custom categories still fail explicitly; retries, telemetry, and approval policies remain incomplete. Evidence: `apps/server/src/compiler/workflowCompiler.ts`, `src/tools/toolRuntime.ts`, `src/tools/notImplementedToolExecutor.ts`.
- **Tool registry execution is now server-authoritative when Studio persistence is configured.** The runs router resolves persisted tool records and carries that snapshot through approval resume. Browser-supplied records remain a fallback only when no Studio store is configured. Non-function categories, retries, telemetry, and approval policies remain incomplete. Evidence: `apps/server/src/api/runs.ts`, `apps/server/src/runtime/runExecutor.ts`.
- **CLI policies are guardrails, not an OS sandbox.** CLI execution now requires both per-agent permissions and server-owned executable/workspace allowlists, bounds output, supports cancellation, and uses non-interactive provider defaults. A compromised allowed executable can still exceed declarative filesystem/network intent unless deployed inside an OS/container sandbox. Evidence: `src/agents/runtime/cliAgentExecutor.ts` and `src/agents/runtime/executionPolicy.ts`.
- **CLI and local backends are implemented.** Codex CLI, Claude Code, agy, Ollama, and LM Studio execute through their real runtime adapters. Local endpoints are restricted to server-owned exact-origin allowlists. Deployment health checks and container-level isolation remain operational work. Evidence: `src/agents/runtime/cliAgentExecutor.ts`, `src/agents/runtime/localAgentExecutor.ts`, and `tests/agentExecutor.test.ts`.
- **Loops are deliberately blocked, not supported.** Server validation rejects every cycle while the editor can represent one. Therefore LangGraph loop compilation, exits, and loop-runtime semantics are incomplete. Evidence: `apps/server/src/compiler/validation.ts`.
- **Parallel branches are structurally possible but lack verified runtime semantics.** There is no dedicated compiler/runtime test proving fan-out, concurrent execution, convergence, cancellation, and event ordering. Evidence: `apps/server/src/compiler/workflowCompiler.ts`, `tests/`.

## High — validation and runtime guardrails

- **Node-type validation is incomplete.** The server does not explicitly reject an unknown `node.type`; a malformed inbound node can reach compiler fallback behavior. Evidence: `apps/server/src/compiler/validation.ts`.
- **Connection validation is not a complete compatibility matrix.** It covers input/output direction, condition edge kind, and conditional source, but does not validate every supported source/target pair. Evidence: `apps/server/src/compiler/validation.ts`.
- **Approval branch vocabulary is not enforced.** Conditional approval routes are not limited to the runtime decisions `approved` and `rejected`. Evidence: `apps/server/src/compiler/workflowCompiler.ts` and `apps/server/src/compiler/validation.ts`.
- **Retry limits are absent.** The runtime has no general agent/model/tool retry policy or attempt tracking. Evidence: `apps/server/src/runtime/runExecutor.ts`, `src/agents/runtime/apiAgentExecutor.ts`.
- **Concurrent-branch limits are absent.** `WORKFLOW_MAX_BRANCHES` limits configured router branches, not live concurrent work. Evidence: `apps/server/src/runtime/guardrails.ts`.
- **Token and cost budgets are absent.** API generations do not normalize token usage or enforce run/agent budgets. Evidence: `src/agents/runtime/apiAgentExecutor.ts`, `src/observability/telemetry.ts`.
- **Redaction is not yet a single persistence boundary.** Some direct agent events and failed-run messages are appended before a shared sanitizer, and the history endpoint returns stored events directly. Evidence: `apps/server/src/runtime/runExecutor.ts`, `apps/server/src/runtime/runStore.ts`, `apps/server/src/api/runs.ts`.
- **Resource controls need broader coverage.** Run request bodies are capped at 1 MiB, graph/runtime durations are bounded, and memory retrieval is bounded, but tool output, generic RunEvent payloads, and streaming-client buffering have no explicit limits. Evidence: `apps/server/src/api/runs.ts`, `apps/server/src/runtime/guardrails.ts`.

## High — observability and evaluation

- **Legacy Langfuse tracing remains in the repository.** `src/integrations/langfuse.ts` uses deprecated v3-style `Langfuse.trace()`/`flushAsync`, and `src/agents/core/graphEngine.ts` imports it. It should be retired or migrated to the OTel integration. Evidence: `src/integrations/langfuse.ts`, `src/agents/core/graphEngine.ts`.
- **The web dashboard still polls Langfuse directly and derives fabricated cost.** This conflicts with the Studio/control-plane boundary and the no-fake-cost rule. Evidence: `apps/web/src/app/api/dashboard/route.ts`.
- **CLI, local, tool, approval-wait, and retry observations are missing.** Only workflow, API-agent/generation, and memory observations are currently wired. Evidence: `src/observability/telemetry.ts`, `src/agents/runtime/apiAgentExecutor.ts`, `src/agents/runtime/runtimeMemory.ts`.
- **Model usage/cost and detailed retrieval diagnostics are missing.** No normalized token/cached-token/cost capture, embedding observations, or retrieval selected-ID/score diagnostics are exported. Evidence: `src/observability/telemetry.ts`.
- **Observability resilience is incomplete.** The boundary recognizes only telemetry errors with selected names/messages, and bootstrap warning paths log raw error objects. Evidence: `src/observability/telemetry.ts`, `apps/server/src/observability/bootstrap.ts`.
- **Studio deep-trace navigation and evaluation foundation are missing.** No safe `View Deep Trace` link, evaluation data model, dataset/run linkage, or score/outcome workflow exists. Evidence: `apps/web/src`, `packages/types/src`, `apps/server/src`.

## Medium — product-flow verification gaps

- **Dashboard status coverage is incomplete/unverified.** Runtime domain types include `queued`, `running`, `waiting_for_human`, `completed`, `failed`, and `cancelled`; `waiting_for_agent`, `waiting_for_tool`, and `paused` are not run states. Evidence: `packages/types/src/index.ts`.
- **Task lifecycle and dependency execution need an end-to-end audit.** The checklist requires server-side dependency enforcement, retries, pause/resume, run/result linkage, and deterministic failure behavior. These have not been verified as a complete flow. Evidence: `src/studio/`, `apps/web/src/app/api/tasks/route.ts`.
- **Tool-related graph-editor checklist items are blocked by the runtime tool gap.** The node can be designed and persisted, but it cannot participate in a successful executable workflow. Evidence: `packages/types/src/index.ts`, `apps/server/src/compiler/workflowCompiler.ts`.
- **Execution timeline and graph visualization need E2E verification.** SSE and `RunEvent` infrastructure exist, but no browser test proves live updates, reconnect behavior, and graph/node synchronization. Evidence: `apps/server/src/api/runs.ts`, `apps/web/src/services/runService.ts`.

## Medium — production hardening and developer experience

- **CI does not run lint or standalone typecheck.** The workflow runs Jest plus server/web builds; only the web package has a lint script. Evidence: `.github/workflows/ci.yml`, `package.json`, `apps/server/package.json`, `apps/web/package.json`.
- **No E2E suite covers the critical Studio path.** Create agent → workflow → task → run → live timeline → approval → result, including failure paths, remains unverified. Evidence: `tests/`.
- **Docker/Compose is stale relative to the workspace.** Existing Docker assets target the legacy application shape and do not provide the current `apps/web` + `apps/server` development environment with its persistence dependencies. Evidence: `infrastructure/docker/Dockerfile`, `infrastructure/docker/docker-compose.yml`.
- **Documentation is incomplete/stale.** Architecture, workflow schema, edge schema, event schema, backend model, deployment, and environment documentation are not maintained as one authoritative set. Evidence: `docs/architecture.md`, `docs/development.md`.
- **Structured logging coverage is narrow.** JSON logs/redaction exist for run start/failure, but node, agent, tool, retry, and request-level correlation is not consistently emitted. Evidence: `apps/server/src/logging.ts`, `apps/server/src/runtime/runExecutor.ts`.
- **Performance and leak testing are absent.** No benchmark/load review covers React Flow scale, SSE fan-out/reconnect, Postgres/vector queries, long-running runs, parallelism, or telemetry volume. Evidence: `tests/`, `.github/workflows/ci.yml`.
- **Authentication/authorization coverage is incomplete.** Memory authorization exists, but a platform-wide authn/authz model and tests for runs, tasks, workflows, agents, and tools have not been verified. Evidence: `apps/server/src/memory/access.ts`, `apps/server/src/api/`.

## Verification work still required

1. Add runtime integration tests for real tool execution, parallel branches, cancellation, timeout, retry, and redaction-at-storage.
2. Add browser E2E coverage for the critical Studio workflow and approval recovery.
3. Run a clean-install, production server startup, and Compose smoke test after modernizing Docker assets.
4. Remove/migrate legacy Langfuse code and replace dashboard trace polling with a safe backend-provided trace reference.
5. Re-run this checklist after each gap is resolved, marking individual checklist entries only when backed by source evidence and tests.
