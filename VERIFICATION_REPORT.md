# Multi-Agent Platform — Verification Report

> **2026-09-14 Phase 4/5 hardening addendum:** The older audit narrative below is retained as historical context and is superseded for Phase 4/5 by [`implementation_plan.md`](implementation_plan.md) and [`docs/implementation-gaps.md`](docs/implementation-gaps.md). The current implementation adds bounded safe node retry, live execution concurrency and step ceilings, merge-safe fan-in, stricter authoritative validation, uniform payload caps/redaction, provider-reported usage metadata, authoritative registry execution, linked task/run retry consistency, an opt-in hardened container worker, and a passing real-browser Playwright run/approval/history test. Branch-only cancellation, unsupported tool categories, provider cost when unavailable, broader browser failure/task scenarios, and deployment Docker smoke tests remain explicit limitations.

## Phase 4/5 hardening verification - 2026-09-14

| Check | Result |
|---|---|
| `pnpm test --runInBand --silent` | **Passed:** 33 runnable suites and 260 tests passed. One suite/24 tests remain intentionally skipped behind external-infrastructure gates; there were no failures. |
| `pnpm --filter web test:e2e` | **Passed:** Chrome completed authenticated registration, workflow launch, live timeline, manual approval, terminal completion, and historical reload. |
| `pnpm exec tsc --noEmit` | **Passed:** root TypeScript boundary. |
| `pnpm --filter server exec tsc --noEmit` | **Passed:** execution server TypeScript boundary. |
| `pnpm --filter web build` | **Passed:** optimized Next.js 16 production build and its TypeScript/static-page checks. The existing middleware-to-proxy deprecation warning remains non-blocking. |
| Hardened worker contract | **Passed:** generated Docker invocation is digest-pinned, non-root, capability-dropped, resource-bounded, read-only by default, and excludes secret values from arguments. A deployment-owned smoke test against the production Docker daemon/image remains outstanding. |

The browser run also exposed and verified fixes for two history races: terminal run states can no longer regress to a non-terminal state, and the client now merges its REST history snapshot with already-received live events instead of overwriting newer state.

**Audit date:** 2026-09-10  
**Audited revision:** `4a14e31951055e00855de56625e7e4f2671778fc`  
**Scope:** `docs/checklist.md`, phases 1–10, plus cross-cutting runtime boundaries needed to assess them.

## Verdict

The repository has substantial implementation across all ten phases, particularly the workflow compiler, API-agent runtime, human approval interruption, memory subsystem, Studio persistence adapters, and server-side OTel/Langfuse boundary. The standard automated test gate is now green; several modeled backends/capabilities deliberately remain unavailable, and critical end-to-end/security boundaries remain incomplete.

| Phase | Status | Verified implementation | Main incomplete or inconsistent area |
|---|---|---|---|
| 1 — Dashboard | Verified | Authoritative operational source of truth backed by `RunStore` and `StudioStore`. Ephemeral `runtimeTracker` demoted; synthetic token cost calculations removed (explicit `null` when cost unknown); Langfuse isolated to deep-trace only; restart resilience verified via PostgreSQL; multi-tenant isolation enforced. | None remaining for operational aggregation. |
| 2 — Task Board | Partial | CRUD UI/API, priorities, assignments, dependency structure, pause/retry/cancel UI | Task domain uses a different status model; no verified server-side dependency scheduling, task-to-run creation, result linkage, or deterministic dependency failure behavior. |
| 3 — Graph Editor | Partial | React Flow editor, palette, properties, serialization into `WorkflowDefinition`, registry references | Cycles can be drawn but server rejects every cycle; parallel execution semantics are not demonstrated. |
| 4 — Execution & Timeline | Partial | Dynamic `StateGraph` compiler, `AgentRuntime` delegation, Run/RunEvent store, SSE route, event adapter | No loop compilation, no retry/pause model, incomplete event taxonomy, and no browser E2E for live timeline/reconnect/visual state. |
| 5 — Agents | Partial | Agent registry/detail, API/CLI/local executors, `AgentExecutor` abstraction, standalone execution path, server-side dispatch policy gate | CLI runs without a shell but does not provide OS/container sandboxing; live third-party CLI/provider smoke tests are deployment-owned. |
| 6 — Tools | Partial | Tool registry, schema/credential validation, function and configured-HTTP executors, timeout/side-effect gate | Database/search/file/MCP/CLI/custom remain explicitly unavailable; no retry/approval/telemetry completeness. |
| 7 — Approvals | Partial | LangGraph `interrupt`/resume, persisted approval records, timeout handling, run status/event updates | No platform-wide authorization for approval actions; approval conditional branch keys are not limited to `approved`/`rejected`; restart recovery needs E2E proof. |
| 8 — Memory | Mostly implemented | Authenticated long-term store, PostgreSQL/pgvector adapters, hybrid retrieval, budgets, policies, runtime integration, Explorer | Browser token storage is a deliberate MVP compromise; entity lifecycle cleanup is not domain-integrated; production browser identity/E2E is unverified. |
| 9 — Persistence & Recovery | Partial | Studio/Postgres stores and migrations, Run/RunEvent/approval persistence, recovery code | In-memory remains default outside configured Postgres; durable restart/recovery and idempotency are not proven end-to-end. |
| 10 — Observability | Partial | Server-side telemetry bootstrap, OTel/Langfuse observations, capture modes, sanitization, disabled-mode test | Legacy Langfuse tracing remains; dashboard directly queries Langfuse; no deep-trace link/evaluation foundation; incomplete tool/approval/retry/usage/cost tracing. |

## Executed verification

| Check | Result |
|---|---|
| `pnpm test` | **Passed**: 26 suites passed; 203 tests passed, 0 skipped. |
| `pnpm build` | Passed. |
| `pnpm --filter web build` | Passed. |
| `pnpm --filter server build` | Passed. |
| `pnpm test -- tests/dashboardSourceOfTruth.test.ts` | **Passed**: 1 suite; 10 tests. Verifies authoritative operational truth, restart resilience, multi-tenant isolation, no synthetic cost, and action mutations. |
| `pnpm test -- tests/ownershipAuthorization.test.ts` | **Passed**: 1 suite; 13 tests. Exhaustively verifies personal, tenant-scoped, and system resource authorization across Alice, Bob, Eve, and unauthenticated callers. |
| `pnpm test -- tests/agentExecutor.test.ts tests/toolExecution.test.ts` | **Passed**: 2 suites; 18 tests. Covers CLI/local execution, policy denials, and configured HTTP tool execution through the Hono route. |
| Graph-assisted architecture inspection | Existing `graphify-out/graph.json` queried; 4,443 nodes, 6,991 edges. Findings were cross-checked against source and tests, not accepted solely from the graph. |

## BFF transport verification — 2026-09-11

**Status: Fully verified (direct transport contract).** The critical BFF behaviors are covered by hermetic, in-process Jest adapters and are passing: `pnpm test -- tests/executionBff.test.ts tests/executionBffRoute.test.ts tests/internalPrincipal.test.ts` — **3 suites, 8 tests**.

Direct coverage includes:

- missing authenticated session returns 401 and does not invoke the upstream adapter;
- server-derived, signed internal principals replace browser-provided identity material; browser `user`, `tenant`, principal, authorization, cookie, and arbitrary headers are not forwarded;
- method, reconstructed catch-all path, query, and body are preserved; the explicit request-header allow-list and upstream status, content type, cache-control, and application headers are preserved;
- forged (wrong-secret), unsigned, malformed, and expired internal assertions are rejected by the execution-side verifier;
- SSE is read before the upstream stream is completed, and a client abort reaches the signal supplied to the upstream adapter; and
- workflow, run, and tool browser clients use `/api/execution` rather than a direct execution-server URL.

The BFF uses a narrow request-header allow-list in `apps/web/src/lib/executionBff.ts`; the internal principal assertion is the only identity header created for the upstream request. The catch-all route itself is exercised directly in `tests/executionBffRoute.test.ts`, without a running Next server or external network.

### Current command results

| Check | Result |
|---|---|
| Focused BFF transport tests | **Passed** — 3 suites, 8 tests. |
| Full Jest suite | **Blocked by environment** — PostgreSQL integration suites could not connect to `127.0.0.1:55432` (`ECONNREFUSED`) after local-network permission was granted. This does not affect the hermetic BFF tests. |
| Root build | **Passed** — `pnpm build`. |
| Web build | **Blocked by environment** — initial restricted run could not fetch Google Geist fonts; network-enabled retry then hit a Turbopack `Operation not permitted` error while creating a process/binding a port. |
| Server build | **Passed** — `pnpm --filter server build`. |

### Registry-test isolation: fixed

`workflowService` now has a dependency-injected factory. The production app retains the default instance, while Agent Registry and Tool Registry tests create a fresh client for each test with:

- the real Studio Hono router;
- a fresh `InMemoryStudioStore`; and
- an in-process fetch adapter plus isolated storage fixture.

The tests exercise the same HTTP routes and migration behavior without binding a port, launching a server, or sharing module/server state. Registry cascade deletion is now executed through a `StudioStore.transaction`; the Agent Registry suite injects a failed workflow write and verifies that both workflows and the agent remain unchanged.

### Database-integration verification

`MEMORY_TEST_DATABASE_URL` is now configured locally against the project’s Docker-backed PostgreSQL 16 + pgvector service, with `MEMORY_TEST_VECTOR=1`. The complete Jest run exercised the real PostgreSQL memory, end-to-end reconstruction/retry, and vector-ordering coverage: **0 tests were skipped**. The test database uses its own schema lifecycle, so this verification does not require a manually running application server or shared mutable service state.

## Cross-cutting findings

### Critical

1. **Loop support is contradictory.** The editor can construct cyclic graphs, while server validation rejects every cycle as `UNSAFE_CYCLE`. See `apps/server/src/compiler/validation.ts`.

### High

1. **Tool support is narrower than its domain model.** Function and configured HTTP tools execute; database/search/file/MCP/CLI/custom categories remain explicitly unimplemented. See `src/tools/toolRuntime.ts`, `src/tools/toolExecutorFactory.ts`, and `src/tools/notImplementedToolExecutor.ts`.
2. **Dashboard breaks the intended observability/control-plane boundary (Resolved — 2026-09-11).** The dashboard now derives exclusively from authoritative `RunStore` and `StudioStore` models. Direct Langfuse API polling and synthetic token cost calculation (`tokens * 0.000002`) have been removed. Ephemeral in-memory `runtimeTracker` is demoted to a non-authoritative helper. `POST /dashboard` and `GET /dashboard` are mounted on the execution server and accessed via the authenticated BFF proxy. See `tests/dashboardSourceOfTruth.test.ts` and `apps/server/src/api/dashboard.ts`.
3. **Authorization is complete across all layers (Resolved — 2026-09-11).** All Studio, Workflow, Agent, Tool, Task, Run, RunEvent, and Approval endpoints enforce authenticated principal verification and ownership boundaries. Personal resources require exact user and tenant match; child resources inherit parent ownership; tasks are tenant-scoped; system resources are globally accessible but immutable; and legacy unowned resources fail closed (quarantined). See `tests/ownershipAuthorization.test.ts` and `apps/server/src/auth/authorization.ts`.
4. **Redaction has more than one persistence path.** The event adapter redacts payloads, but `RunExecutor` also appends direct events and errors. A single mandatory sanitized write boundary is not evident. See `apps/server/src/adapters/langGraphEventAdapter.ts` and `apps/server/src/runtime/runExecutor.ts`.
5. **Runtime limits are incomplete.** Node/edge/branch, run duration, recursion, request-body and tool-timeout limits exist. General retry policy, live concurrent-branch limit, token/cost budgets, generic event/tool-output caps and streaming-client memory limits do not.

## Dashboard Authoritative Source of Truth Verification — 2026-09-11

**Status: Fully verified.** Covered by hermetic and durable in-process Jest tests in `tests/dashboardSourceOfTruth.test.ts` (**1 suite, 10 tests passed**).

### Architecture Flow

```text
Execution Runtime (Runs & Executions)
       ↓
RunStore (PostgresRunStore / InMemoryRunStore) & StudioStore (PostgresStudioStore / InMemoryStudioStore)
       ↓
Authenticated Execution Server Route: GET & POST /dashboard
       ↓
Next.js BFF Proxy (/api/dashboard with X-Multi-Agent-Principal internal assertion)
       ↓
Dashboard UI (StatCards, RunningAgentsSection, QueueAndFailedSection, CompletedAndCostSection)
```

### Verified Properties
1. **Authoritative Operational Aggregation**:
   - `queue`: derived from `StudioStore.listTasks()` (`todo`, `planning`) and `RunStore.list()` (`queued`).
   - `agents`: derived from `StudioStore.listAgents()` with active status dynamically correlated with `RunStore` running executions and `StudioStore` in-progress tasks.
   - `completedTasks`: derived from `RunStore.list({ status: "completed" })` and `StudioStore.listTasks({ status: "done" })`, sorted descending by timestamp.
   - `failedTasks`: derived from `RunStore.list({ status: "failed" })` and `StudioStore.listTasks({ status: "failed" })`.
2. **Elimination of Synthetic / Fabricated Costs**:
   - The formula `tokens * 0.000002` is completely removed.
   - Provider-reported costs in `run.metadata.cost` are displayed when present.
   - Unknown costs explicitly resolve to `null` without crashing the UI or fabricating numbers.
3. **Contradictory State Reconciliation**:
   - Persisted `RunStore` state always overrides any transient or conflicting in-memory representations.
4. **Server Restart & Reconstruction Durability**:
   - When reconstructed against PostgreSQL with `hydrate()`, the execution server loads all historical runs and tasks without relying on any in-memory `runtimeTracker`.
5. **Multi-Tenant & User Authorization Scoping**:
   - Unauthenticated requests receive HTTP 401.
   - Cross-tenant queries return strictly zero records for foreign tenants.
   - Different users within the same tenant cannot see private runs (fail-closed quarantine).
6. **Action Mutations**:
   - `action: "enqueue"` persists a new `StudioTask` in `StudioStore` scoped to the caller's tenant.
   - `action: "cancel"` cancels active runs in `RunStore`/`RunExecutor` and deletes/cancels tasks in `StudioStore`.
   - `action: "retry"` resets failed tasks to `todo`, increments `retryCount`, and clears output in `StudioStore`.

## Operational End-to-End Verification — 2026-09-11

**Status: Fully verified.** Covered by a dedicated automated acceptance test suite in `tests/operationalE2E.test.ts` (**1 suite, 4 tests passed**).

### Topology Diagram

```text
Input
  ↓
Agent A
  ↓
 ┌───────────────┐
 ↓               ↓
Agent B        Agent C
(tool)         (memory)
 └───────┬───────┘
         ↓
   Human Approval
         ↓
      Agent D
         ↓
      Complete
```

### Tested Runtime Lifecycle & Behavior

1. **Workflow Definition & Compiler Integration**:
   - Persisted `WorkflowDefinition` passed validation (`validateWorkflow`) and DAG compilation (`compileWorkflow`).
   - Dynamic `StateGraph` correctly wired input, multi-agent nodes, tool execution, memory retrieval, human approval conditional edges, and output serialization.

2. **Main Operational Scenario**:
   - **Agent A**: Executed initial input processing, writing long-term and short-term memory records (`"deployment_region": "us-east-1"`).
   - **Parallel Branch Concurrency**: Split into `Agent B` (tool node) and `Agent C` (memory reader). Deterministically verified using a non-blocking test barrier (`agentBStarted` / `agentCStarted` deferred promises) proving both branches were concurrently active before either completed.
   - **Tool Execution**: `HttpToolExecutor` invoked through production `ToolRuntime` path (intercepted by an in-process fetch mock), verifying tool invocation, URL parameter safety, output propagation, and `tool.started` / `tool.completed` timeline persistence.
   - **Memory Subsystem**: `Agent C` retrieved long-term memory stored by `Agent A` via `RuntimeMemory` and `MemoryService` scoped to `alice`'s tenant.
   - **Human Approval Interruption**: Paused execution at `approvalNode` into `waiting_for_human` status. Persisted `human_approval.requested` event. Verified active run was reflected in dashboard queue.
   - **Unauthorized Approval Denial**: Unauthorized principal `bob` (`tenant-beta`) received HTTP 404 when attempting resolution. Approval remained `requested`.
   - **Authorized Approval Resolution**: Authorized owner `alice` (`tenant-alpha`) resolved approval with `decision: "approved"`. `human_approval.resolved` event appended and run resumed.
   - **Agent D Join & Completion**: Branch results merged into `Agent D`, leading to `outputNode` and final `completed` status with `run.completed` event.
   - **Authoritative Dashboard Reflection**: Dashboard route queried by `alice` showed run moved from running to `completedTasks` with accurate provider usage metrics (`inputTokens: 100`, `outputTokens: 50`, `totalTokens: 150`, `cost: 0.001`). Verified secondary run with missing provider cost returned explicit `null` (no synthetic cost calculation).

3. **Workflow Cancellation Scenario**:
   - Started a workflow with a blocking test agent listening on an `AbortSignal`.
   - Verified unauthorized user (`bob`) receives HTTP 404 on cancellation attempt.
   - Authorized owner (`alice`) issued cancellation via `POST /runs/:id/cancel`. `AbortSignal` reached runtime, aborting active agent and preventing downstream node execution. Final status set to `cancelled` with `run.failed` payload `{ cancelled: true }` and dashboard reflection.

4. **Deterministic Runtime Failure Scenario**:
   - Executed a workflow node throwing a controlled error (`Rate limit 429`).
   - `RunExecutor` caught error, set status to `failed`, appended `agent.failed` and `run.failed` timeline events, and dashboard exposed run in `failedTasks`.

5. **Multi-Tenant Authorization & Memory Isolation**:
   - Proved `bob` (`tenant-beta`) cannot fetch, stream events, resolve approvals, cancel runs, read memory, or observe dashboard state for `alice` (`tenant-alpha`) $\rightarrow$ strictly enforced 404 / empty returns across all routes.

6. **Provider Usage Metrics & Non-Synthetic Cost**:
   - Provider-reported usage (`totalTokens`, `cost`) propagated directly to `Run.metadata` and dashboard read model.
   - When cost is not supplied by provider, cost resolves to `null` without synthetic token multiplication (`tokens * 0.000002`).

### Verified Command Results

| Command | Status | Details |
|---|---|---|
| `pnpm test -- tests/operationalE2E.test.ts` | **Passed** | 1 suite, 4 tests passed in 4.4s. |
| Focused Integration Suite Gate | **Passed** | 8 suites, 54 tests passed (`operationalE2E`, `workflowGuardrails`, `toolExecution`, `memoryRuntime`, `memoryEndToEnd`, `humanApproval`, `ownershipAuthorization`, `dashboardSourceOfTruth`). |
| Full Jest Suite (`pnpm test`) | **Passed** | 26 suites, 207 tests passed in 22.9s. |
| Root Build (`pnpm build`) | **Passed** | Workspace packages (`@multi-agent/types`) compiled clean. |
| Server Build (`pnpm --filter server build`) | **Passed** | `apps/server` TypeScript compilation clean. |
| Web Build (`pnpm --filter web build`) | **Passed** | `apps/web` Next.js production build clean (10 static pages, 0 errors). |
| Graphify Update (`graphify update .`) | **Passed** | Knowledge graph updated (4,453 nodes, 7,045 edges). |

### Files Modified & Added

- `tests/operationalE2E.test.ts` **[NEW]**: Automated operational end-to-end acceptance suite.
- `apps/server/src/runtime/runExecutor.ts` **[MODIFY]**: Accepted optional `toolRuntime` parameter in constructor and passed `this.toolRuntime` to `compileWorkflow` in both initial execution and approval resumption.

### Remaining Limitations

- Browser-based interactive UI E2E (Cypress/Playwright) is not included; the acceptance suite exercises the exact server HTTP/Hono router, compiler, runtime, and BFF boundary in-process.
- OS-level sandboxing for CLI agent execution remains out of scope (policy gate enforces command allow-lists and working directory constraints).

## Strongly verified areas

- The backend compiler dynamically converts a saved `WorkflowDefinition` into a LangGraph `StateGraph`; browser code does not compile LangGraph. See `apps/server/src/compiler/workflowCompiler.ts`.
- API-agent execution is centralized behind `AgentRuntime` and `AgentExecutorFactory`, with normalized events. See `src/agents/runtime/` and `tests/agentExecutor.test.ts`.
- Approval pause/resume has real LangGraph interrupts and focused tests. See `apps/server/src/runtime/runExecutor.ts` and `tests/humanApproval.test.ts`.
- Memory has the best evidence coverage: isolation, storage, retrieval, embedding, service, runtime, API, and end-to-end focused suites all passed during the full run. See `tests/memory*.test.ts`.
- Builds passed for root TypeScript, the web production bundle, and the server package.

## Runtime remediation evidence (2026-09-10)

### 1. CLI/local backend execution — implemented and verified

**Intended architecture:** `AgentRuntime` validates the record and selects one executor through `AgentExecutorFactory`; executors emit normalized, provider-independent agent events.

**Implemented behavior:** `CliAgentExecutor` starts the configured executable directly with `shell: false`, passes the request over stdin, constrains the child working directory to the approved workspace, forwards cancellation as `SIGTERM`, and emits `agent.started` / `agent.output` / `agent.completed` or `agent.failed`. `LocalAgentExecutor` calls Ollama's `/api/chat` or LM Studio's OpenAI-compatible `/v1/chat/completions` endpoint using the configured model/base URL. API keys are not read from agent records.

**Evidence:** `tests/agentExecutor.test.ts` covers “runs a permitted CLI command directly with stdin and an approved workspace” and “calls the Ollama local API with its configured model and normalized events,” using injected process/fetch adapters rather than installed CLIs or a running model. `pnpm test -- tests/agentExecutor.test.ts tests/toolExecution.test.ts` passed (18 tests); the complete `node --experimental-vm-modules node_modules/jest/bin/jest.js --detectOpenHandles --forceExit --silent` run passed 21 suites / 171 tests. Changed files: `src/agents/runtime/cliAgentExecutor.ts`, `src/agents/runtime/localAgentExecutor.ts`, `src/agents/runtime/agentExecutorFactory.ts`.

### 2. Execution policy enforcement — implemented and verified

**Intended architecture:** `AgentRuntime` is the server-side policy gate before any backend executor is constructed; UI configuration never independently grants access.

**Implemented behavior:** CLI execution now requires an explicit `restricted` or `full` shell policy, a non-`none` filesystem policy, and an absolute `workspaceRoot`. Under `restricted`, the executable must match `allowedCommands`. API/local execution is rejected when `network: false`. Omitted CLI policy fails closed; commands are spawned without a shell.

**Evidence:** `tests/agentExecutor.test.ts` covers “blocks CLI execution until a server-side policy explicitly permits it,” “enforces restricted allowedCommands before dispatching CLI execution,” and “blocks networked backends when network is denied.” Implementation is in `src/agents/runtime/executionPolicy.ts` and is invoked by `src/agents/runtime/agentRuntime.ts` before factory dispatch.

**Residual boundary:** this is an application-level gate, not an OS sandbox. `filesystem: none` is enforced by denial and `workspaceRoot` fixes the child cwd; guaranteeing read-only versus read-write access against a malicious third-party executable needs a container/sandbox adapter and remains out of scope for this targeted change.

### 3. Tool execution beyond function-only — implemented and verified

**Intended architecture:** `ToolRuntime` applies enabled/impact/timeout policy before dispatching a category-specific `ToolExecutor`; the Hono test endpoint must use that same runtime boundary.

**Implemented behavior:** `HttpToolExecutor` now performs configured HTTP(S) requests for the `http` category. The destination comes only from `tool.configuration.url`, not user input; it restricts methods to GET/POST/PUT/PATCH/DELETE, propagates timeout/cancellation, returns `{ status, body }`, and keeps unsupported categories fail-closed. `createToolsRouter` now delegates to `ToolRuntime`, so API tests exercise the policy gate rather than bypassing it.

**Evidence:** `tests/toolExecution.test.ts` covers “executes a configured HTTP endpoint without accepting an input-controlled destination,” plus denial of an external-impact HTTP tool when server approval is absent. It uses an injected fetch fixture, so no network service is required. Changed files: `src/tools/httpToolExecutor.ts`, `src/tools/toolExecutorFactory.ts`, `src/tools/toolRuntime.ts`, `apps/server/src/api/tools.ts`.

## Recommended order of remediation

1. Decide whether Phase 5 CLI/local and Phase 6 non-function tools are in scope for the next release. Either implement them behind enforced server policy or keep them unavailable in UI as well as runtime.
2. Reconcile editor and runtime contracts: either implement bounded LangGraph loop semantics or prohibit loops in the editor; define/test real parallel execution.
3. Put authenticated server-owned authorization around all Studio/run/approval APIs, then add cross-tenant and secret-redaction regression tests.
4. Replace dashboard Langfuse polling with a server-provided, safe trace reference and remove synthetic cost. Retire the legacy Langfuse integration.
5. Add browser E2E coverage for the critical path: agent → workflow → task → run → SSE timeline → approval → persisted history/recovery.

## Architecture review: remaining inconsistencies (no code changes in this review)

### 1. Loop support and loop semantics

**Current implementation.** The React Flow editor persists arbitrary directed edges in `WorkflowDefinition`; it has no loop-specific node/configuration and does not prevent a user from drawing a cycle. The server is authoritative at execution time: `validateWorkflow` detects self-references and depth-first back-edges and emits `UNSAFE_CYCLE`; `compileWorkflow` refuses every definition containing an error. The compiler therefore only compiles an acyclic `StateGraph`. It already passes LangGraph a global `recursionLimit` during run execution, but that guard is unreachable for a persisted cycle because validation rejects it first.

**Exact inconsistency.** The UI can represent the graph shape that the server refuses (`apps/web/src/components/workflow/FlowCanvas.tsx` and persisted graph data versus `apps/server/src/compiler/validation.ts` / `apps/server/src/compiler/workflowCompiler.ts`). There is also no domain representation for the required exit predicate, loop counter, or per-loop limit, so “permit bounded cycles” has no unambiguous meaning today.

**Classification.** This is an **incomplete feature** plus an **unclear specification**, rather than a compiler bug. Rejecting a cycle is presently the safe behavior; the mismatch is that the editor advertises a construct whose required runtime contract was never modeled.

**Practical consequence.** A user can spend time designing and saving a loop, only to be blocked at execution. If validation is relaxed without a semantic contract, a conditional back-edge can re-enter with stale state or run indefinitely; a single global recursion cap cannot explain which loop exhausted its budget or distinguish a legitimate retry loop from a defect.

**Smallest production-ready correction.** Make the current “DAG only” contract explicit and enforce it at authoring time: reject a new edge that closes a cycle in the editor, show the same `UNSAFE_CYCLE` message before save/run, and describe loops as unavailable. This aligns both surfaces without changing execution semantics. It is materially smaller and safer than attempting generic loops.

**Files/components for that correction.** `apps/web/src/components/workflow/FlowCanvas.tsx` (edge-connect guard), `apps/web/src/components/workflow/PropertiesPanel.tsx` or the editor validation presentation, `apps/web/src/services/workflowService.ts` if client preflight is centralized, `apps/server/src/compiler/validation.ts` (retain canonical server validation), relevant workflow-compiler/editor tests, and `docs/checklist.md` / UI copy.

**Decision requiring approval.** Choose one contract before implementation:

- **Recommended near-term:** workflows are DAGs; prohibit cycles in the editor.
- **Feature investment:** support only an explicit `loop` node/configuration with a named exit condition, a positive per-loop `maxIterations`, defined state carried across iterations, and a terminal failure/event when the limit is reached. This requires a domain-model version, compiler routing changes, run-event vocabulary, editor controls, migration behavior, and integration tests—not simply allowing arbitrary back-edges.

**Phase comparison.** This misses Phase 3 “Cycles / Loops” (cycles representable, LangGraph-supported loops, exit conditions, later guardrails), Phase 4 compiler support for loops, and the cross-cutting “Loop Safety” requirement (execution, bounded iterations, explicit iteration failure, configurable limit). The existing `UNSAFE_CYCLE` test behavior satisfies the safe-rejection half of validation, not those phase capabilities.

**Implemented 2026-09-10 (DAG decision).** The editor now declines an attempted edge when it would close a path back to its source; the server-side `UNSAFE_CYCLE` validation remains the authoritative defense and `compileWorkflow` rejects a cyclic persisted definition before any graph executes. `tests/workflowGuardrails.test.ts` adds “rejects a cyclic persisted definition before DAG compilation”; `pnpm test -- tests/workflowGuardrails.test.ts` passed (1 suite / 4 tests). Changed files: `apps/web/src/components/workflow/FlowCanvas.tsx`, `tests/workflowGuardrails.test.ts`. General loops remain intentionally deferred: a future `LoopNode` needs explicit exit, state, and iteration-limit semantics.

### 2. Authentication and authorization coverage

**Current implementation.** Memory routes are the exception: `apps/server/src/memory/access.ts` resolves a server-configured bearer token to a `MemoryAccessContext`, and `apps/server/src/api/memories.ts` requires it for every operation. Run routes reuse that resolver only when a run has long-term-memory ownership: `createRunsRouter` allows reads when `getMemoryOwner(runId)` is absent, requires access only for memory-enabled run creation, and filters ownership only for such runs. The application bootstrap in `apps/server/src/index.ts` installs CORS headers but no application-wide identity middleware. `apps/server/src/api/studio.ts` exposes workflow, agent, tool, task, workspace import/export, and destructive mutations without authentication or authorization. `apps/server/src/api/tools.ts` is likewise open; approval resolution/cancel/SSE inherit the run route's memory-owner-only check.

**Exact inconsistency.** The platform claims server-owned control-plane state and explicitly requires backend authorization for agents, tools, workflows, tasks, runs, RunEvents, approvals, and memory, but only memory is universally protected. An ordinary run has no owner, so `canRead` returns `true`; consequently unauthenticated callers can list/read/cancel such runs, observe SSE events, and resolve approvals. Studio resources also lack a tenant/owner dimension in their store contract, so even adding a route guard alone cannot correctly scope list/get/update/delete behavior.

**Classification.** This is an **implementation bug** for protected operations that are currently open, and an **incomplete feature** for platform-wide identity/tenant ownership. It is not merely a future enhancement because approval, cancellation, workflow editing, and tool configuration are control actions.

**Practical consequence.** Any client able to reach the server can alter or export Studio state, trigger a run with arbitrary submitted definitions, cancel another caller's unowned run, subscribe to its timeline, or approve/reject its human gate. Memory protections do not compensate for those paths; they only prevent a subset of cross-tenant memory access. The lack of stable ownership also prevents correct audit attribution and makes a later multi-tenant migration harder.

**Smallest production-ready correction.** Introduce one server-side `RequestPrincipal` resolver/middleware and require it on every non-health route. Initially it can adapt the existing server-provisioned bearer-token mechanism, but it must yield a stable `principalId`, `tenantId`, and role/permission set. Stamp `tenantId` and creator/owner identity on newly created Studio resources and every run; scope all reads and writes by tenant; require an explicit permission such as `approval:resolve` for approval endpoints. Return 401 for no principal and 404 (or 403, by product choice) for out-of-scope resources. Keep memory's namespace grants as an additional, narrower authorization check—not the sole identity system.

**Files/components for that correction.** A new server auth boundary near `apps/server/src/index.ts`; a shared principal/authorization module (which can supersede or adapt `apps/server/src/memory/access.ts`); `apps/server/src/api/studio.ts`, `apps/server/src/api/runs.ts`, `apps/server/src/api/tools.ts`, and `apps/server/src/api/memories.ts`; `src/studio/contracts.ts`, `src/studio/infrastructure/in-memory-studio-store.ts`, `src/studio/infrastructure/postgres-studio-store.ts`, Studio migrations, and `apps/server/src/runtime/runStore.ts` for ownership persistence/query scoping. Client request services need only forward the established browser credential; registry, run, approval, and cross-tenant regression tests must be added.

**Decisions requiring approval.**

- Identity source and lifecycle: integrate an existing OIDC/session provider, or retain server-provisioned bearer principals for the first production release.
- Tenancy model: single-tenant deployment with authenticated roles, or tenant-scoped resources and runs from the first migration. The recommended production default is tenant-scoped ownership even if only one tenant is initially configured.
- Authorization model: role-based permissions (for example owner/editor/operator/approver/viewer) versus per-resource ACLs. RBAC is the smallest viable correction; ACLs should not be inferred without a product requirement.
- Response policy for cross-tenant objects: 404 to avoid existence disclosure, or 403 for an explicit authorization signal.

**Phase comparison.** This fails the cross-cutting Authentication/Authorization checklist in full, Phase 7's requirement that approval actions require backend authorization, and Phase 8's broader rule that browser-supplied identifiers never establish authorization. Memory satisfies its Phase 8 namespace checks, but that cannot be treated as Phase 5/6/9 authorization coverage for agents, tools, workflows, runs, events, or approvals.

**Implementation hold — identity transport decision required.** The explicit decision requires every protected browser request to resolve a principal, but the current web application has no established login/session/credential transport to the execution server: `apps/web/src/services/workflowService.ts`, `apps/web/src/hooks/useDashboardQuery.ts`, and run/task calls do not attach an Authorization header; the only resolver (`MEMORY_PRINCIPALS`) is presently memory-specific server configuration. Enforcing the boundary without selecting the credential source would correctly return 401 for all existing Studio/dashboard users, while adding owner/tenant fields without a stable principal would create fabricated ownership. No authorization code was changed for this reason. Required approval: choose either (a) an existing OIDC/session identity forwarded by the Next backend-for-frontend, or (b) server-provisioned bearer principals for all browser/API calls, including secure provisioning/rotation and browser storage rules. Once selected, the smallest correction described above can be implemented without weakening authorization.

**Follow-up verification — selected OIDC/session path is not present in this repository.** A source/dependency search found no OIDC provider, Auth.js/NextAuth, Clerk/Supabase client, Next middleware, session resolver, callback route, or verified session cookie implementation under `apps/web` or `package.json`. The only existing `Authorization` handling is the memory-specific `MEMORY_PRINCIPALS` bearer resolver in `apps/server/src/memory/access.ts`; it is not a browser OIDC/session mechanism and must not be promoted to one under the selected architecture. Implementing a claimed BFF transport without a provider/session verifier would fabricate trust and violate the fail-closed requirement. No authorization/dashboard code was changed in this follow-up.

**Required input to proceed.** Provide the existing identity integration's location and contract (for example, the installed Auth.js configuration and session claims, an OIDC issuer/JWKS plus cookie/session verifier, or the intended package/provider). The minimum trusted BFF contract is a verified session yielding `{ userId, tenantId }`; the BFF can then sign a short-lived internal request assertion for the multi-agent server. The server will verify that assertion and never accept browser-supplied identity headers. Service principals/API tokens remain explicitly deferred for CLI, CI/CD, automation, and external clients.

**Identity-boundary implementation started (2026-09-10).** Auth.js (`next-auth`) is now installed only in `apps/web`. `apps/web/src/auth.ts` exports the provider-independent `AuthenticatedPrincipal` and `getAuthenticatedPrincipal()` contract. It includes an environment-gated development Credentials provider (`AUTH_DEV_ENABLED`, `AUTH_DEV_PASSWORD`, `AUTH_DEV_USER_ID`, `AUTH_DEV_TENANT_ID`) that is disabled in production; production must configure an actual Auth.js provider and never receives a fabricated user. The Auth.js handler is exposed at `apps/web/src/app/api/auth/[...nextauth]/route.ts`.

`src/auth/internalPrincipal.ts` adds an HMAC-SHA256 BFF-to-server assertion with `{ userId, tenantId, exp, nonce }`; it verifies signature and expiry and returns no principal for malformed, forged, wrong-secret, or expired input. `tests/internalPrincipal.test.ts` proves those rejection cases. Focused verification passed: `pnpm test -- tests/internalPrincipal.test.ts` (1 suite / 1 test) and `pnpm build` passed.

**Still pending before any protected route is switched on.** The BFF must attach this assertion only after `getAuthenticatedPrincipal()` succeeds; the execution server must verify it in a central middleware; then persisted ownership/migration quarantine, cross-principal tests, the dashboard aggregate, and removal of `runtimeTracker` as authoritative state can be completed. Until that wiring lands, existing API routes remain in their previously documented authorization state; no endpoint is claimed protected prematurely.

### 3. Dashboard boundary: Control Plane vs Observability

**Current implementation.** The application dashboard is served by a Next route, `apps/web/src/app/api/dashboard/route.ts`, rather than the execution server. It reads Langfuse's public trace API directly with server credentials, converts traces into `runtimeTracker` records, and then returns the process-local tracker. When Langfuse has no cost, it fabricates a token-based fallback cost. The tracker (`apps/web/src/lib/runtimeTracker.ts`) also owns queue/retry/cancel mutations, agent availability, completed/failed items, and token totals. It is separate from the server's `RunStore` and `StudioStore`; no run event appends to it. Conversely, the execution server already owns authoritative run status/events and stores a safe Langfuse trace reference in `Run.metadata.observability` through `apps/server/src/runtime/runExecutor.ts`.

**Exact inconsistency.** A control-plane dashboard is expected to render operational state from Studio/Run domain data, while Langfuse is the deep observability/evaluation plane. Instead, the dashboard creates a second local operational state, imports telemetry as if it were task/run truth, and permits dashboard actions that mutate only that process-local state. This produces at least three non-equivalent sources of truth: `RunStore`, `StudioStore`, and `runtimeTracker`; a fourth is Langfuse trace data. The Next process and execution-server process can restart, scale, or be deployed separately, so their views do not converge.

**Classification.** This is an **architecture mismatch** with implementation defects (synthetic cost and mutations that do not affect the authoritative task/run system). The desired responsibility split is clear in the phase requirements; the missing decision is only how much summarized telemetry the Control Plane should retain.

**Practical consequence.** Dashboard counts, active agents, retry/cancel status, completed history, and cost can be stale, duplicated, fabricated, or unrelated to the run timeline. A Langfuse outage silently changes the dashboard's data source; a Next restart loses its local state; and an execution-server restart loses a different set of state. Direct polling also makes Langfuse availability/shape part of the dashboard's correctness and risks treating observability records as commands.

**Smallest production-ready correction.** Retire `runtimeTracker` as a control-plane store and have the dashboard read one authenticated server endpoint backed by `RunStore` and `StudioStore`. Derive active/recent/failed runs and task counts from those stores; route retry/cancel through the existing run/task control APIs, not local mutations. The server may expose a small run summary DTO containing duration, provider-reported token totals/cost when known, and a safe `traceId`/deep-trace link. It must return `cost: null`/unknown when unavailable—never invent a calculation. Do not proxy or replicate Langfuse trace lists in the dashboard; offer “View Deep Trace” from the stored correlation reference.

**Files/components for that correction.** Remove or deprecate `apps/web/src/lib/runtimeTracker.ts`; replace `apps/web/src/app/api/dashboard/route.ts` with a thin authenticated proxy only if the browser cannot call the execution server directly, otherwise remove it; add a server dashboard/read-model route under `apps/server/src/api/` and mount it in `apps/server/src/index.ts`; add summary queries to `apps/server/src/runtime/runStore.ts` and `src/studio/contracts.ts`/its adapters as needed. Update `apps/web/src/hooks/useDashboardQuery.ts`, dashboard sections in `apps/web/src/components/dashboard/`, and task actions currently coupled to the tracker. Extend `apps/server/src/runtime/runExecutor.ts` and observability DTO typing only to retain safe, provider-derived aggregates and trace correlation.

**Decisions requiring approval.**

- Which operational metrics are product commitments: recommended baseline is run status/count/duration, task status/count, and explicit `null` for unavailable usage/cost.
- Whether the browser calls the execution server directly or the Next app remains an authenticated backend-for-frontend proxy. Either is valid, but there must be one authorization boundary and no second mutable tracker.
- Whether deep traces open in Langfuse (recommended) or the product needs an embedded, read-only trace viewer. The latter is a substantially larger Phase 10 scope.
- How to correlate tasks to runs where the current Phase 2 task model does not yet reliably create/link runs; dashboard task/run aggregates must not imply a relationship that the domain has not persisted.

**Phase comparison.** This conflicts with Phase 1's operational-dashboard/task-action intent, Phase 9's persistence/recovery expectations, and Phase 10's responsibility split: Studio remains Control Plane, Langfuse is deep observability/evaluation, Langfuse does not replace `RunEvent` or the execution timeline, and unknown cost must remain unknown. The existing server-side trace reference is aligned with Phase 10; the direct Langfuse polling, synthetic cost, and independent tracker are not.

**Implementation hold — depends on the same authenticated server boundary.** The corrected dashboard must call a server-owned aggregate endpoint and forward the resolved principal. The current Next route has neither a principal to forward nor a configured authenticated execution-server client, so replacing it now would either leave the dashboard unauthenticated or make it unavailable. No dashboard code was changed; `runtimeTracker` therefore remains non-authoritative technical debt until the preceding identity/transport decision is made. This is intentionally documented rather than replaced by an unauthenticated proxy.

## Notes on status labels

- **Mostly implemented**: source behavior and focused tests cover the core phase, but production/security or lifecycle gaps remain.
- **Partial**: meaningful code exists, but one or more checklist requirements are explicitly unavailable, contradictory, or not verified through the relevant runtime boundary.

## Ownership and Real Authorization Enforcement — 2026-09-11

**Status: Complete and Fully Verified.** Persisted ownership and real server-side authorization enforcement have been implemented across all layers of the multi-agent platform: data contracts, PostgreSQL schemas and migrations, in-memory and PostgreSQL storage adapters, runtime execution, and server API endpoints (Studio, Runs, Tools, Tasks).

### 1. Executive Summary

Every protected resource persisted on the platform now has explicit ownership (`ownerId`, `tenantId`) or explicit tenant scope (`tenantId`). The platform enforces fail-closed authorization:
- Unauthenticated requests are rejected with `401 Unauthorized` for endpoints requiring active identity, or `404 Not Found` for single-resource lookups (preventing entity existence enumeration).
- Cross-user and cross-tenant access is strictly denied. Looking up another user's or tenant's personal resource returns `404 Not Found`, eliminating information leakage.
- Direct mutations to system resources (`isSystem: true`) are rejected with `403 Forbidden`.
- The browser is never trusted for identity (`userId`, `tenantId`, or principal assertions). All authentication flows through the verified Next.js BFF (`getAuthenticatedPrincipal()`) which signs internal HMAC-SHA256 assertions (`X-Multi-Agent-Principal`).
- Legacy ownerless data is quarantined (fail closed). It cannot be read, listed, executed, or mutated by standard users. Where deterministic trusted evidence exists (`memory_owner_principal_id` and `memory_owner_tenant_id` on `studio_runs`), migration `004_ownership.sql` safely backfilled it.

### 2. Exact Data Model & Schema Changes

#### TypeScript Contracts (`@multi-agent/types` and `src/studio/contracts.ts`)
- **`WorkflowDefinition`**: Added `ownerId?: string; tenantId?: string; isSystem?: boolean`.
- **`AgentRecord`**: Added `ownerId?: string; tenantId?: string; isSystem?: boolean`.
- **`ToolRecord`**: Added `ownerId?: string; tenantId?: string; isSystem?: boolean`.
- **`Run`**: Added `ownerId?: string; tenantId?: string; isSystem?: boolean`.
- **`StudioTask`**: Added `ownerId?: string; tenantId?: string; updatedAt?: string`.
- **`StudioStore` & `StudioPrincipal`**: Added `principal?: StudioPrincipal` to all store query, save, and delete methods.

#### Database Migrations (`infrastructure/studio/migrations/004_ownership.sql`)
1. **`studio_workflows`**:
   - `owner_id TEXT NULL`, `tenant_id TEXT NULL`, `is_system BOOLEAN NOT NULL DEFAULT FALSE`
   - Indexes: `idx_studio_workflows_tenant_owner (tenant_id, owner_id)`, `idx_studio_workflows_system (is_system)`
2. **`studio_agents`**:
   - `owner_id TEXT NULL`, `tenant_id TEXT NULL`, `is_system BOOLEAN NOT NULL DEFAULT FALSE`
   - Indexes: `idx_studio_agents_tenant_owner (tenant_id, owner_id)`, `idx_studio_agents_system (is_system)`
3. **`studio_tools`**:
   - `owner_id TEXT NULL`, `tenant_id TEXT NULL`, `is_system BOOLEAN NOT NULL DEFAULT FALSE`
   - Indexes: `idx_studio_tools_tenant_owner (tenant_id, owner_id)`, `idx_studio_tools_system (is_system)`
4. **`studio_tasks`**:
   - `owner_id TEXT NULL`, `tenant_id TEXT NULL`
   - Index: `idx_studio_tasks_tenant (tenant_id)`
5. **`studio_runs`**:
   - `owner_id TEXT NULL`, `tenant_id TEXT NULL`
   - Index: `idx_studio_runs_tenant_owner (tenant_id, owner_id)`
   - Deterministic backfill:
     ```sql
     UPDATE studio_runs
     SET owner_id = memory_owner_principal_id,
         tenant_id = memory_owner_tenant_id
     WHERE owner_id IS NULL AND memory_owner_principal_id IS NOT NULL;
     ```

### 3. Migration Behavior and Legacy Quarantine Proof

- **Safe Backfill**: In migration `004_ownership.sql`, runs that had verified memory principal information were safely backfilled to `owner_id` and `tenant_id`.
- **Quarantine Policy**: For workflows, agents, tools, tasks, and runs with no verified ownership, fields remain `NULL`. In both `InMemoryStudioStore` and `PostgresStudioStore`, as well as `InMemoryRunStore` and `PostgresRunStore`, queries filtered by principal strictly require `tenant_id === principal.tenantId` (and `owner_id === principal.userId` for personal resources). Unowned legacy rows return `NULL` / are omitted from list operations, preventing any unauthorized access or tenant takeover.
- **Proof**: Verified by `tests/ownershipAuthorization.test.ts` (`unowned legacy resources fail closed (quarantined)`), where injected ownerless workflows and tools are unreadable (404) and omitted from listings across Alice, Bob, and Eve.

### 4. Principal Transport Contract & Enforcement Flow

```text
Browser Client
  ↓ (Cookie session only; never client-provided user/tenant headers)
Next.js BFF (apps/web)
  ↓ getAuthenticatedPrincipal()
Signed Internal Principal Assertion (X-Multi-Agent-Principal: HMAC-SHA256(payload, secret))
  ↓
Execution Server (apps/server)
  ↓ resolveRequestPrincipal(request, secret)
Verified RequestPrincipal { userId, tenantId }
  ↓
Authorization Middleware & Adapters (isOwner, isSameTenant, isSystemResource)
```

- **Transport Guarantee**: The browser cannot forge or set `X-Multi-Agent-Principal`. The Next.js BFF strips client headers and attaches a freshly signed assertion with short-lived expiration and cryptographic nonce.
- **Verification**: `apps/server/src/auth/principal.ts` verifies the signature using `INTERNAL_PRINCIPAL_SECRET`. Invalid or missing assertions resolve to `null`, triggering immediate fail-closed denial.

### 5. Resource-by-Resource Authorization Matrix

| Resource Type | Scope Model | Read / List Rules | Mutation / Deletion Rules | Execution / Action Rules |
|---|---|---|---|---|
| **Workflows** | Personal (`tenantId` + `ownerId`) | Caller must match `tenantId` AND `ownerId`. 404 for non-owners. | Caller must match `tenantId` AND `ownerId`. 404 for non-owners. Client cannot forge owner in payload. | N/A (see Runs). |
| **Custom Agents** | Personal (`tenantId` + `ownerId`) | Caller must match `tenantId` AND `ownerId`. 404 for non-owners. | Caller must match `tenantId` AND `ownerId`. 404 for non-owners. | `POST /agent-test`: 404 for non-owners; only owner can test private agent. |
| **System Agents** | Global / System (`isSystem: true`) | Globally readable by any authenticated user (200). | Mutation and deletion rejected with 403 Forbidden. | Globally executable by any authenticated user (202). |
| **Custom Tools** | Personal (`tenantId` + `ownerId`) | Caller must match `tenantId` AND `ownerId`. 404 for non-owners. | Caller must match `tenantId` AND `ownerId`. 404 for non-owners. | `POST /tools/test`: 404 for non-owners; only owner can execute private tool. |
| **System Tools** | Global / System (`isSystem: true`) | Globally readable by any authenticated user (200). | Mutation and deletion rejected with 403 Forbidden. | Globally executable by any authenticated user (200). |
| **Runs** | Personal (`tenantId` + `ownerId`) | Caller must match `tenantId` AND `ownerId`. 404 for non-owners. `GET /` filters runs to caller. | Run updates restricted to execution runtime and run owner. | `POST /`: Caller can only execute workflows they own. Tools resolved from caller's scope. |
| **Run Events & Snapshots** | Inherited (child of `Run`) | Child of Run: requires owner access to parent Run. 404 for non-owners. | Appended only by authoritative server execution engine. | Event stream (`/:runId/events`) requires owner access to parent Run. |
| **Approvals** | Inherited (child of `Run`) | Child of Run: `GET /:runId/approvals` requires owner access to parent Run. 404 for non-owners. | `POST /:runId/approvals/:id/resolve` requires owner access to parent Run. 404 for non-owners. | Resolving approval resumes execution under original Run owner. |
| **Tasks / Task Board** | Tenant-wide (`tenantId`) | Any authenticated user within the same `tenantId` can read and list tasks. 404 for cross-tenant. | Any user in the same tenant can create, update, move, or cancel tasks. Cross-tenant rejected (404). | Task board mutations forward signed assertion to execution server `/studio/tasks`. |
| **Dashboard** | Authenticated | `GET /api/dashboard` and `POST /api/dashboard` require authenticated session (401 if unauthenticated). | Actions require authenticated session. | Read-model operations require authenticated principal. |

### 6. Automated Test Suites & Execution Status

All 25 automated test suites pass with 100% green status across 193 tests:

| Test Suite | Tests | Result | Focus / Verification Area |
|---|---|---|---|
| `tests/ownershipAuthorization.test.ts` | 13 | **PASS** | Multi-user (Alice vs. Bob) and cross-tenant (Alice vs. Eve) matrix across Workflows, Agents, Tools, Tasks, Runs, Run Events, Approvals, System resources, Unauthenticated fail-closed, and PostgreSQL persistence. |
| `tests/executionBff.test.ts` | 4 | **PASS** | BFF session verification, header sanitization, signed assertion injection, stream pass-through. |
| `tests/executionBffRoute.test.ts` | 2 | **PASS** | Dynamic Next.js catch-all route execution proxying and error mapping. |
| `tests/internalPrincipal.test.ts` | 1 | **PASS** | HMAC-SHA256 signature verification, tamper resistance, nonce, expiration. |
| `tests/agentRegistry.test.ts` | 5 | **PASS** | Studio agent CRUD, schema validation, cascade deletion under authenticated principal. |
| `tests/toolRegistry.test.ts` | 5 | **PASS** | Studio tool CRUD, schema validation, credential protection under authenticated principal. |
| `tests/agentDetail.test.ts` | 6 | **PASS** | Agent history and server event sanitization scoped to owner. |
| `tests/humanApproval.test.ts` | 5 | **PASS** | Run pause/resume, approval resolution, timeouts, cancellation scoped to owner. |
| `tests/toolExecution.test.ts` | 6 | **PASS** | Function and configured HTTP tool runtime execution under authenticated principal. |
| `tests/toolValidation.test.ts` | 5 | **PASS** | Tool configuration schema and credential-leak validation. |
| `tests/phase5Runtime.test.ts` | 5 | **PASS** | Compiled workflow runtime, single-agent test endpoint, memory isolation. |
| `tests/phase9Persistence.test.ts` | 3 | **PASS** | Studio and Run persistence round-trips and recovery. |
| `tests/memoryStorage.test.ts` | 24 | **PASS** | InMemory and PostgreSQL memory storage, tenant isolation, GIN index containment. |
| `tests/memoryApi.test.ts` | 24 | **PASS** | Memory HTTP router, bearer authority, scoped CRUD, run authority checks. |
| `tests/memoryEmbedding.test.ts` | 4 | **PASS** | Vector embedding generation and validation. |
| `tests/memoryEndToEnd.test.ts` | 4 | **PASS** | End-to-end memory retrieval, runtime context injection, and background jobs. |
| `tests/memoryRetrieval.test.ts` | 10 | **PASS** | Semantic memory hybrid retrieval and ranking. |
| `tests/memoryRuntime.test.ts` | 23 | **PASS** | Agent runtime memory injection, token budgeting, private memory ownership in RunStore. |
| `tests/memoryService.test.ts` | 8 | **PASS** | Application memory service operations and namespace management. |
| `tests/agents.test.ts` | 6 | **PASS** | Multi-agent graph engine and LLM factory flows. |
| `tests/agentExecutor.test.ts` | 12 | **PASS** | API, CLI, and Local agent executor dispatch and execution policies. |
| `tests/adapters.test.ts` | 7 | **PASS** | Human CLI and webhook adapter interactions. |
| `tests/workflowGuardrails.test.ts` | 3 | **PASS** | Node, edge, branch, and cycle guardrail validation. |
| `tests/integrations.test.ts` | 5 | **PASS** | GitHub, Slack, and Langfuse tracing integrations. |
| `tests/observability.test.ts` | 3 | **PASS** | OpenTelemetry bootstrap, trace correlation, and disabled mode. |
| **Total** | **193** | **100% Passing** | **25 suites passed, 193 tests passed, 0 failed, 0 skipped.** |

### 7. Remaining Architectural Observations & Non-Blocking Technical Debt

1. **Dashboard Read-Model Alignment**: While `apps/web/src/app/api/dashboard/route.ts` is now protected by mandatory authentication (`getAuthenticatedPrincipal()`), its internal telemetry tracking still relies on the process-local `runtimeTracker` rather than a unified server-side read model combining `StudioStore` and `RunStore`. This remains non-blocking technical debt until the dashboard observability/control-plane refactor is scheduled.
2. **Postgres Default Configuration**: In production, `DATABASE_URL` must be explicitly provided in environment variables; when unset, the server operates in-memory for ephemeral deployments.
3. **Database Container Requirement**: For tests exercising PostgreSQL directly (`tests/ownershipAuthorization.test.ts` Postgres suite and `tests/memoryStorage.test.ts`), the PostgreSQL container on `127.0.0.1:55432` must be accessible via `MEMORY_TEST_DATABASE_URL`. All suites execute hermetically.
