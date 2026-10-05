# Agent detail page

Open the independent registry at `/org/agents`, or use **Details** in the Graph Editor palette. Individual agents live at `/org/agents/<agentId>`.

The page reuses `AgentRecord`, `AgentBackend`, `AgentExecutionPolicy`, `Run` and `RunEvent` from the shared types package. Configuration is saved through `workflowService`; React Query owns loaded data and mutations, while the form maintains its own editable draft. The page never imports LangGraph or executor implementations.

## Configuration and navigation

General configuration, lifecycle, API/CLI/local backend fields, execution policy and tool ID assignments can be edited. Duplicate creates an independent ID and deep copy without adding permissions. Disabled agents fail validation before executor creation. Switching backend type asks before resetting incompatible fields and preserves the policy. Codex CLI, Claude Code, agy, Ollama, and LM Studio are supported by the runtime.

API model fields come from the shared provider/model schema registry in `packages/types/src/agentConfiguration.ts`. Temperature, Top P and output limits flow through the runtime to provider constructors. Blank fields use provider defaults (Anthropic defaults to 4096 output tokens). Conservative OpenAI reasoning profiles expose output limits only. Unsupported settings must be reset when changing providers/models. Authentication remains server environment configuration.

Agent memory includes bounded conversation history inside one run. Agent scope shares history across sequential instances; node scope isolates them. Read, write and read/write modes are enforced by AgentRuntime, with 1–100 entries and normalized memory events. A fresh standalone test starts with empty history. [Memory backend](phase-6-memory.md) adds checkpointed short-term state and authenticated backend long-term memory; [Memory Explorer](phase-8-memory-explorer.md) provides the corresponding inspect/search/delete UI.

Edits remain pending until Save succeeds. Save failures are surfaced and keep the draft intact. Page actions and browser reload/close protect unsaved changes; browser history navigation within the SPA is not globally intercepted. Deletion is blocked while any saved workflow references the agent, with instructions to remove the nodes and save first. The client currently treats failed agent and workflow reads as missing resources; see Remaining work.

Workflow usages distinguish agent IDs from node instance IDs. `Open in Graph` uses `/org?workflowId=<id>&focusNode=<nodeId>`; the editor resolves that navigation after loading its saved workflow. Each repeated agent node is listed separately.

## Execution inspection

The execution server exposes `GET /runs?agentId=<id>` and `GET /runs/<runId>/history?agentId=<id>`. History includes the agent's normalized events plus un-attributed events on its related nodes, excluding events attributed to another agent. The run and agent pages share `ExecutionTimeline` and its selectable event detail panel.

Executor payloads are sanitized at the run store boundary before both history and subscriber delivery. Credential-like legacy configuration fields are removed before agent data enters query/form state. Shared credential validation rejects new secret-bearing values at editor, persistence, and execution-request boundaries.

**Test Agent** posts the saved agent and a JSON input object to `POST /runs/agent-test`. The server invokes AgentRuntime directly, records normalized events and output in RunStore, and supports cancellation. The panel polls only during its active test and offers retry after transport errors. Tests also appear in normal agent execution history. No graph construction is required.

## Studio persistence

The browser's `workflowService` reads and writes agents, tools and workflows through `/api/execution/studio`. The server uses an authenticated `StudioStore`: Postgres when a Studio or memory database URL is configured, otherwise an in-memory store for local development and tests. Production rejects the in-memory mode. The active workflow ID remains in browser `localStorage` under `agent-studio.active-workflow.v1`.

On first access, the browser imports a legacy `agent-studio.workspace.v3` or older workflow/agent keys through the Studio workspace import endpoint. It marks the import complete and removes the legacy keys only after the server import succeeds. Invalid or credential-bearing legacy data leaves the source keys in place for recovery.

The editor's workflow selector opens saved workflows by ID and creates new ones. All workflows reference the same independent agent registry. Detail-page deletion blocks referenced agents; palette deletion explicitly cascades through every saved workflow, removing only matching agent nodes and incident edges. The server performs cascading registry and graph changes in one `StudioStore` transaction; the Postgres implementation uses a database transaction. Graph undo history is cleared for entity deletion to prevent dangling references.

## Existing platform limits

- Agents, tools and workflows are server-backed and scoped to the authenticated principal. Clients using the same durable server can retrieve the same saved entities; active workflow selection remains browser-local. Concurrent edits have no version or conflict-resolution mechanism, and open tabs do not receive live entity updates. In local in-memory mode, a server restart clears Studio entities.
- Runs/events are retained in the execution server memory store for local/test composition and in the Postgres run store when Studio persistence is enabled; durable hydration restores completed history and approval pause context. A restart without durable persistence clears history.
- Backend diagnostics are checked server-side at `/agents/<id>/diagnostics`: API credentials are represented only as configured/missing, CLI readiness is reported with authentication remaining Unknown, and local services are checked only against the server origin allowlist. Agent status is labeled as last observed event status and is separate from backend health.
- Persistent CLI sessions remain outside this capability. CLI invocations are intentionally one-shot and non-interactive; persistent agent memory and the Memory Explorer are documented separately in [Memory backend](phase-6-memory.md) and [Memory Explorer](phase-8-memory-explorer.md).
- Tool assignment now resolves against the Phase 6 Tool registry (`/org/tools`) rather than saved workflow tool nodes — see [Tool registry](phase-6-tools.md).
- CLI execution requires server-owned executable/workspace allowlists in addition to the agent policy. Local model origins also use a server allowlist. These controls do not replace OS/container sandboxing.
- Recorded provider/model values are shown only when present in events. Complete backend/version snapshots are not persisted and are never inferred from current configuration.

## Verification

`tests/agentDetail.test.ts` covers configuration constraints, legacy credential filtering, history and sanitization. `tests/agentRegistry.test.ts` exercises migration, duplication, multi-workflow identity, credential rejection, deletion and transaction rollback through an isolated in-memory Studio router. `tests/phase5Runtime.test.ts` and `tests/phase4Phase5Completion.test.ts` cover lifecycle enforcement, model forwarding, bounded memory, compiled-workflow reuse, server-side diagnostics, normalized node/edge events, parallel fan-out/fan-in, condition-driven loops, cancellation, run retry, the standalone endpoint and terminal SSE replay. `apps/web/e2e/studio-lifecycle.spec.ts` covers basic agent create/edit/duplicate/delete in an authenticated browser. These checks do not establish the complete detail-page journey or a live Postgres failure/restart journey.

Server builds emit into `apps/server/dist/apps/server/src`, including their shared runtime dependencies. Run `pnpm --filter server build` then `pnpm --filter server start`; generated JavaScript no longer sits beside runtime TypeScript sources.

Development CORS allows Studio on localhost ports 3060 and 3061. Set `WEB_ORIGIN` to a comma-separated list of exact origins to override it; production defaults to localhost:3060.

## Remaining work to complete this page

1. Distinguish missing resources from read failures in `workflowService.getAgent` and `getWorkflow`. Only return `null` for an actual 404; surface transport, authentication and server failures with a retry path. Verify that a failed load never appears as an absent agent or workflow.
2. Extend authenticated browser coverage for the detail page: unsaved draft and failed Save, backend-switch confirmation, repeated workflow usages and `Open in Graph`, referenced-agent deletion guard, execution history and event details, and standalone Test Agent cancellation/retry. Use a deterministic local executor for run journeys; record any real-provider run separately.
3. Exercise legacy workspace import and cascading deletion against Postgres, including invalid legacy data, an interrupted import, a failed graph write and a restart. Verify that failed operations preserve recoverable legacy keys or roll back all entity changes, and that successful data is visible after restart to the same principal.
4. Run the web and server builds and focused tests after the above changes, then inspect the rendered agent detail page and correct any remaining copy that still describes server-backed data as browser-local.
