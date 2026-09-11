# Multi-Agent Platform — Complete Implementation Verification Checklist

This checklist is intended to be the final implementation audit for the Multi-Agent Platform.

Mark every item individually:

* [ ] Not verified
* [x] Verified

A phase should not be considered complete merely because its UI exists. Backend behavior, persistence, security boundaries, runtime integration, and failure handling should also be verified.

---

# 0. Core Architecture & Global Boundaries

## Product Architecture

* [ ] The web application acts as the **Control Plane**.
* [ ] LangGraph acts as the **Workflow Execution Engine**.
* [ ] `WorkflowDefinition` is the source of truth for workflow structure.
* [ ] React Flow is only the graph editor/view layer.
* [ ] React Flow internals are not used as the persisted workflow domain model.
* [ ] Workflow execution does not depend on browser state.
* [ ] Backend/runtime remains authoritative for execution.
* [ ] The frontend never directly executes LangGraph.
* [ ] The frontend does not construct provider LLM clients.
* [ ] Domain entities are separated from UI-specific representations.

Target flow:

```text
Studio
  ↓
Backend API
  ↓
WorkflowDefinition
  ↓
Workflow Compiler
  ↓
LangGraph StateGraph
  ↓
AgentRuntime / Tools / Memory
  ↓
Execution
```

## Domain Separation

* [ ] Agent Entity is separate from Agent Node.
* [ ] Tool Entity is separate from Tool Node.
* [ ] Workflow design state is separate from workflow runtime state.
* [ ] Run state does not mutate the saved WorkflowDefinition.
* [ ] Memory is a backend subsystem, not frontend state.
* [ ] RunEvent is an application/domain event model.
* [ ] Langfuse telemetry is not used as the application event model.

---

# 0.1 Agent Execution Backend Abstraction

This architecture is required even though it was introduced between roadmap phases.

## AgentBackend

* [ ] Agents no longer assume direct API-provider execution.
* [ ] Agent configuration supports an execution backend abstraction.
* [ ] API backends are representable.
* [ ] CLI backends are representable.
* [ ] Local-model backends are representable.
* [ ] Backend configuration is expressed through a discriminated/type-safe model.

Conceptually:

```ts
type AgentBackend =
  | { type: "api"; provider: string; model: string }
  | { type: "cli"; provider: string; model?: string }
  | { type: "local"; provider: string; model: string };
```

## AgentExecutor

* [ ] A stable `AgentExecutor` or equivalent abstraction exists.
* [ ] Agent execution does not directly depend on OpenAI/Anthropic/etc. inside the LangGraph compiler.
* [ ] `AgentRuntime` resolves the correct executor.
* [ ] Executor selection is centralized.
* [ ] Unknown backends fail explicitly.
* [ ] Unsupported backends are not silently simulated.
* [ ] Existing API execution works through the executor abstraction.

Target:

```text
LangGraph Node
    ↓
AgentRuntime
    ↓
AgentExecutor
    ↓
API / CLI / Local
```

## Execution Events

* [ ] Executors return normalized execution information.
* [ ] Executor-specific event formats do not leak into the frontend.
* [ ] Executor events can be mapped into `RunEvent`.
* [ ] `RunEvent` remains backend/provider-independent.

## API Backend

* [ ] API provider execution works.
* [ ] API credentials remain server-side.
* [ ] Provider/model configuration is not coupled to graph layout.
* [ ] Provider-specific options are handled through adapters/configuration boundaries.

## CLI Backend Readiness

* [ ] CLI agents are modeled as execution backends rather than ordinary LLM providers.
* [ ] CLI configuration can represent executable/path where appropriate.
* [ ] Workspace can be represented.
* [ ] CLI arguments can be represented safely.
* [ ] Session mode can be represented where supported.
* [ ] CLI credentials are not stored in workflow definitions.
* [ ] CLI implementations cannot execute arbitrary unsafe commands by default.
* [ ] CLI execution respects execution policy.

## Local Backend Readiness

* [ ] Ollama or equivalent local backend can be represented.
* [ ] LM Studio or equivalent local backend can be represented.
* [ ] Local base URL/model can be configured safely.
* [ ] Adding additional local executors does not require redesigning Agent/Workflow models.

---

# 0.2 Agent Execution Policy

* [ ] Agent execution policies exist or have an equivalent runtime mechanism.
* [ ] Filesystem access can be restricted.
* [ ] Shell access can be restricted.
* [ ] Network access can be restricted.
* [ ] Workspace root can be constrained.
* [ ] Allowed commands can be restricted where applicable.
* [ ] Full shell access is never granted implicitly.
* [ ] Read/write filesystem access is never granted implicitly.
* [ ] Policies are enforced server-side/runtime-side.
* [ ] Frontend policy configuration is not considered authorization by itself.

---

# Phase 1 — Dashboard

## Operational Summary

* [ ] Dashboard exists as the main operational overview.
* [ ] Active run count is displayed.
* [ ] Pending task count is displayed.
* [ ] Completed task count is displayed.
* [ ] Failed task count is displayed.
* [ ] Active agent count is displayed.
* [ ] Recent runs are displayed.
* [ ] Recent failures are displayed.
* [ ] Tasks requiring human attention are visible.
* [ ] Relevant sections link to detailed pages.

## Run Statuses

The system consistently understands relevant states such as:

* [ ] `queued`
* [ ] `running`
* [ ] `waiting_for_agent`
* [ ] `waiting_for_tool`
* [ ] `waiting_for_human`
* [ ] `paused`
* [ ] `completed`
* [ ] `failed`
* [ ] `cancelled`

## Architecture

* [ ] Dashboard does not contain core business logic.
* [ ] Dashboard consumes shared services/selectors/APIs.
* [ ] Run status representation is consistent with Task Board.
* [ ] Run status representation is consistent with Execution Timeline.
* [ ] Dashboard handles empty state.
* [ ] Dashboard handles loading state.
* [ ] Dashboard handles backend errors.
* [ ] Failed runs can be inspected directly.

---

# Phase 2 — Task Board

## Task Domain Model

Each task supports:

* [ ] ID
* [ ] Title/name
* [ ] Description
* [ ] Status
* [ ] Priority
* [ ] Assigned agents
* [ ] Workflow reference
* [ ] Creation timestamp
* [ ] Update timestamp
* [ ] Start timestamp
* [ ] Completion timestamp
* [ ] Parent task where applicable
* [ ] Dependencies
* [ ] Run/result reference
* [ ] Metadata

## CRUD / Operations

* [ ] Create task.
* [ ] Edit task.
* [ ] Archive/delete task.
* [ ] Assign one agent.
* [ ] Assign multiple agents where supported.
* [ ] Select workflow.
* [ ] Set priority.
* [ ] Start task.
* [ ] Cancel task.
* [ ] Retry failed task.
* [ ] Pause task where runtime supports it.
* [ ] Resume task where runtime supports it.
* [ ] Open related run.
* [ ] Inspect final result.
* [ ] Inspect last failure.

## Task Dependencies

* [ ] Dependencies can be represented structurally.
* [ ] Dependency references are validated.
* [ ] Downstream task waits for required upstream tasks.
* [ ] Failed dependency behavior is deterministic.
* [ ] Dependency cycles are validated or handled explicitly.
* [ ] Dependency enforcement occurs server-side/runtime-side.

## Statuses

Relevant domain states exist:

* [ ] `backlog`
* [ ] `ready`
* [ ] `queued`
* [ ] `running`
* [ ] `blocked`
* [ ] `waiting_for_human`
* [ ] `completed`
* [ ] `failed`
* [ ] `cancelled`

## Execution Integration

* [ ] Starting a task creates/starts a backend Run.
* [ ] Task execution never happens directly in browser code.
* [ ] Task references the resulting Run.
* [ ] Task status can follow runtime status.
* [ ] Task output can reference actual execution output.

---

# Phase 3 — Visual Graph Editor

## Core Editor

* [ ] React Flow or equivalent graph editor is implemented.
* [ ] Pan works.
* [ ] Zoom works.
* [ ] Fit view works.
* [ ] Node selection works.
* [ ] Edge selection works.
* [ ] Node movement works.
* [ ] Node deletion works.
* [ ] Edge deletion works.
* [ ] Node creation works.
* [ ] Connections can be created interactively.
* [ ] Directional edges are represented correctly.
* [ ] Multi-select works if included in UX.
* [ ] Keyboard shortcuts work where provided.
* [ ] Properties panel exists.
* [ ] Node palette exists.
* [ ] Toolbar exists.
* [ ] Save state/status is visible.
* [ ] Validation state is visible.

## Workflow Definition

* [ ] Workflow can be serialized independently of React Flow.
* [ ] Workflow can be loaded back into the editor.
* [ ] Workflow has a stable ID.
* [ ] Nodes are stored structurally.
* [ ] Edges are stored structurally.
* [ ] Node configuration is domain data.
* [ ] Edge configuration is domain data.
* [ ] Layout metadata is separated from execution semantics.
* [ ] React Flow node positions do not determine execution semantics.

## Agent Node

* [ ] Agent node exists.
* [ ] Agent node references `agentId`.
* [ ] Agent node does not duplicate the Agent Entity unnecessarily.
* [ ] Agent ID is stable.
* [ ] Name can be displayed.
* [ ] Description can be displayed/configured where appropriate.
* [ ] Backend/model information can be inspected where appropriate.
* [ ] Tools can be associated through Agent Entity.
* [ ] Memory configuration can be represented.

## Tool Node

* [ ] Tool node exists.
* [ ] Tool node references Tool Entity.
* [ ] Tool configuration is structural.
* [ ] Tool node can participate in executable workflow.

## Human Approval Node

* [ ] Human approval node exists.
* [ ] Approval message is configurable.
* [ ] Approval type is configurable.
* [ ] Timeout is configurable where supported.
* [ ] Approval metadata is representable.

## Memory Node

* [ ] Memory node exists.
* [ ] Read operation can be represented.
* [ ] Write operation can be represented.
* [ ] Read/write operation can be represented.
* [ ] Search operation can be represented where supported.
* [ ] Memory configuration is structural.

## Condition / Router Node

* [ ] Condition/router node exists.
* [ ] Multiple outgoing branches are supported.
* [ ] Branch keys are stored structurally.
* [ ] Conditional behavior is not represented only by labels.
* [ ] Invalid/duplicate branch semantics are validated.

## Input Node

* [ ] Input node exists.
* [ ] Input schema/configuration can be represented.
* [ ] Workflow entry is identifiable.

## Output Node

* [ ] Output node exists.
* [ ] Workflow output is identifiable.
* [ ] Output mapping/configuration works where applicable.

## Edges

* [ ] Normal edges supported.
* [ ] Conditional edges supported.
* [ ] Multiple incoming edges supported.
* [ ] Multiple outgoing edges supported.
* [ ] Edge labels supported.
* [ ] Edge metadata supported.
* [ ] Edge editing supported.
* [ ] Missing node references are prevented or validated.

## Parallel Branches

* [ ] Parallel execution can be represented structurally.
* [ ] Parallel behavior is not inferred from visual position.
* [ ] Multiple parallel branches can converge correctly.
* [ ] Parallel runtime semantics are supported by compiler/runtime.

## Cycles / Loops

* [ ] Cycles are representable.
* [ ] Graph editor does not automatically reject every cycle.
* [ ] LangGraph-supported loops compile correctly.
* [ ] Loop exit conditions can be represented.
* [ ] Loop protection exists later at runtime guardrail level.

---

# Phase 4 — Real LangGraph Execution & Execution Timeline

## Real Runtime

* [ ] Saved WorkflowDefinition is compiled dynamically.
* [ ] WorkflowDefinition is converted to a real LangGraph `StateGraph`.
* [ ] No fake/simulated executor is used for supported workflows.
* [ ] Backend performs compilation.
* [ ] Frontend never compiles LangGraph.
* [ ] TypeScript source files are not generated/rewritten per graph edit.
* [ ] Unsupported node types fail clearly.

## Workflow Compiler

* [ ] Compiler is separated from UI.
* [ ] Compiler is separated from API route logic.
* [ ] Compiler understands all supported node types.
* [ ] Compiler understands normal edges.
* [ ] Compiler understands conditional edges.
* [ ] Compiler understands parallel branches.
* [ ] Compiler understands loops.
* [ ] Compiler understands Human Approval.
* [ ] Compiler delegates agent execution through `AgentRuntime`.
* [ ] Compiler does not directly instantiate provider-specific models.

## Run Entity

Run includes:

* [ ] `runId`
* [ ] `workflowId`
* [ ] optional `taskId`
* [ ] status
* [ ] start timestamp
* [ ] completion timestamp
* [ ] input
* [ ] output
* [ ] error
* [ ] current node where relevant
* [ ] metadata

## RunEvent

* [ ] RunEvents are append-only.
* [ ] Events are ordered.
* [ ] Events have stable IDs.
* [ ] Events have `runId`.
* [ ] Events have timestamps.
* [ ] Sequence/order is deterministic where required.
* [ ] Events can reference node.
* [ ] Events can reference agent.
* [ ] Events can reference tool.
* [ ] Events can contain safe payload.
* [ ] Parent event relationship exists where useful.

## Event Types

Relevant events exist:

* [ ] `run.created`
* [ ] `run.started`
* [ ] `run.paused`
* [ ] `run.resumed`
* [ ] `run.completed`
* [ ] `run.failed`
* [ ] `run.cancelled`
* [ ] `node.started`
* [ ] `node.completed`
* [ ] `node.failed`
* [ ] `node.retrying`
* [ ] `agent.started`
* [ ] `agent.completed`
* [ ] `agent.failed`
* [ ] `tool.started`
* [ ] `tool.completed`
* [ ] `tool.failed`
* [ ] `human_approval.requested`
* [ ] `human_approval.approved/resolved`
* [ ] `human_approval.rejected`
* [ ] `memory.read`
* [ ] `memory.write`
* [ ] `edge.traversed`
* [ ] relevant logging/state events

## LangGraph Event Adapter

* [ ] Raw LangGraph events are normalized.
* [ ] Frontend does not depend on LangGraph event shapes.
* [ ] LangGraph-specific details are isolated behind an adapter.
* [ ] Event adapter maps runtime events into stable `RunEvent`.

## Live Streaming

* [ ] SSE or equivalent server-to-client streaming exists.
* [ ] Polling is not the primary live-execution mechanism.
* [ ] Stream connection handles disconnect.
* [ ] Stream errors are represented properly.
* [ ] Reconnection behavior exists where appropriate.
* [ ] Historical data can fill gaps after reconnect.
* [ ] Streaming transport is not tightly coupled to timeline components.

## Timeline

* [ ] Timeline displays events chronologically.
* [ ] Timestamp is shown.
* [ ] Node/agent/tool identity is shown.
* [ ] Event type is shown.
* [ ] Status is shown.
* [ ] Duration is shown where available.
* [ ] Error indicator is shown.
* [ ] Event details can be expanded.
* [ ] Input/output summary can be inspected safely.
* [ ] Auto-scroll works.
* [ ] User can manually inspect old events without forced auto-scroll.
* [ ] Timeline works for live runs.
* [ ] Same timeline model works for historical runs.

## Graph Runtime Visualization

* [ ] Active node is highlighted.
* [ ] Completed node is shown as completed.
* [ ] Failed node is shown as failed.
* [ ] Waiting node is shown as waiting.
* [ ] Multiple parallel active nodes can be shown.
* [ ] Traversed edges can be highlighted.
* [ ] Runtime graph state is separate from saved workflow state.

## Run Controls

Where supported:

* [ ] Start.
* [ ] Cancel.
* [ ] Pause.
* [ ] Resume.
* [ ] Retry failed run.
* [ ] Retry failed node only when semantically safe.

---

# Phase 5 — Agent Management & Configuration

## Agent CRUD

* [ ] Agent list exists.
* [ ] Agent detail page exists.
* [ ] Create Agent.
* [ ] Edit Agent.
* [ ] Duplicate Agent.
* [ ] Delete/archive Agent.
* [ ] Enable/disable Agent.
* [ ] Agent IDs remain stable.

## Agent Configuration

* [ ] Name.
* [ ] Description.
* [ ] System prompt.
* [ ] Backend type.
* [ ] Backend provider.
* [ ] Model where applicable.
* [ ] Runtime/model parameters.
* [ ] Tools.
* [ ] Memory configuration.
* [ ] Execution policy.
* [ ] Metadata.

## Backend Configuration

* [ ] API backend form.
* [ ] CLI backend form.
* [ ] Local backend form.
* [ ] Switching backend type is explicit.
* [ ] Incompatible fields are reset/migrated safely.
* [ ] Backend-specific validation exists.

## API Backend

* [ ] Provider selectable.
* [ ] Model selectable/configurable.
* [ ] Secret credential is not stored in Agent Entity.
* [ ] Credential availability/status may be displayed safely.

## CLI Backend

* [ ] CLI provider selectable.
* [ ] Codex CLI can be represented.
* [ ] Claude Code can be represented.
* [ ] agy can be represented.
* [ ] Executable can be configured safely if needed.
* [ ] Workspace can be configured.
* [ ] Arguments can be configured safely where supported.
* [ ] Authentication status is determined server-side.
* [ ] Browser never reads CLI credential files.
* [ ] Browser never receives CLI session tokens.

## Local Backend

* [ ] Local provider can be selected.
* [ ] Model can be configured.
* [ ] Base URL can be configured where needed.
* [ ] Local backend availability can be diagnosed server-side.

## Backend Diagnostics

Possible states handled:

* [ ] Ready.
* [ ] Unavailable.
* [ ] Not authenticated.
* [ ] Misconfigured.
* [ ] Unsupported.
* [ ] Unknown.

## Agent Status

Agent execution status is separate from backend diagnostics:

* [ ] idle
* [ ] running
* [ ] waiting
* [ ] failed

## Tool Assignment

* [ ] Assigned tools are visible.
* [ ] Tools can be assigned.
* [ ] Tools can be removed.
* [ ] Tool identity uses stable IDs.
* [ ] Backend and Tool are not conflated.

Example:

```text
Codex CLI = backend
GitHub = tool
Filesystem = tool
Web Search = tool
```

## Memory Configuration

* [ ] Memory enabled/disabled state.
* [ ] Memory scopes.
* [ ] Memory types/kinds.
* [ ] Read permissions.
* [ ] Write permissions.
* [ ] Retrieval budget where applicable.

## Workflow Usage

* [ ] Agent detail shows workflows using the Agent.
* [ ] Workflow ID/name is visible.
* [ ] Node ID is visible.
* [ ] Agent can be opened/focused in Graph Editor.
* [ ] Node ID is not treated as Agent ID.

## Execution History

* [ ] Agent-related runs can be listed.
* [ ] Status visible.
* [ ] Workflow visible.
* [ ] Duration visible.
* [ ] Errors visible.
* [ ] Backend/model information visible where persisted.
* [ ] Historical run does not incorrectly assume current Agent config.

## Standalone Test

* [ ] Agent can be tested without building a workflow.
* [ ] Test uses real `AgentRuntime`.
* [ ] Test does not create a fake parallel execution implementation.
* [ ] Test errors are normalized.
* [ ] Test result is safe to display.

---

# Phase 6 — Tool Management

## Tool Entity

Each tool supports:

* [ ] ID.
* [ ] Name.
* [ ] Description.
* [ ] Type/category.
* [ ] Input schema.
* [ ] Output schema.
* [ ] Configuration.
* [ ] Enabled state.
* [ ] Permissions/security metadata.
* [ ] Created timestamp.
* [ ] Updated timestamp.

## Tool Categories Architecture

Architecture can represent:

* [ ] Internal function tools.
* [ ] HTTP/API tools.
* [ ] Database tools.
* [ ] Search tools.
* [ ] Filesystem tools.
* [ ] MCP tools.
* [ ] CLI tools.
* [ ] Custom tools.

Not every category must necessarily have a production executor, but adding one should not require redesign.

## Tool Registry

* [ ] Tool list page.
* [ ] Tool details/configuration.
* [ ] Create tool.
* [ ] Edit tool.
* [ ] Enable/disable tool.
* [ ] Delete/archive tool where supported.
* [ ] Tool registry is discoverable from navigation.

## Tool Schemas

* [ ] Structured input schema supported.
* [ ] Structured output schema supported.
* [ ] Schema validation occurs before execution.
* [ ] Invalid tool inputs fail clearly.

## Testing

* [ ] Tool can be tested independently.
* [ ] Tool test uses runtime/service boundary.
* [ ] Failures are normalized.
* [ ] Test does not expose credentials.

## Agent Integration

* [ ] Tools can be assigned to Agents.
* [ ] Agent cannot invoke unassigned/restricted tool where enforcement exists.
* [ ] Tool IDs are stable references.

## Workflow Integration

* [ ] Tool Node references Tool Entity.
* [ ] Workflow runtime resolves Tool by ID.
* [ ] Tool execution emits RunEvents.

## Secret Handling

* [ ] Tool credentials remain server-side.
* [ ] WorkflowDefinition contains no secrets.
* [ ] Tool configuration references credentials indirectly if necessary.
* [ ] Tool test does not return credentials.

## Tool Impact Metadata

Tool can be categorized as:

* [ ] read-only

* [ ] write

* [ ] external side effect

* [ ] high impact

* [ ] Impact classification is available to Phase 11 guardrails.

* [ ] High-impact operations can be restricted or approved.

---

# Phase 7 — Human-in-the-Loop & Approval

## Approval Model

Approval includes:

* [ ] `approvalId`
* [ ] `runId`
* [ ] `nodeId`
* [ ] status
* [ ] message
* [ ] requested timestamp
* [ ] resolved timestamp
* [ ] context/input
* [ ] response
* [ ] metadata

## Approval States

* [ ] requested
* [ ] approved
* [ ] rejected
* [ ] expired
* [ ] cancelled

## LangGraph Integration

* [ ] Uses real LangGraph interrupt/resume semantics.
* [ ] Execution pauses at approval node.
* [ ] State/checkpoint is preserved.
* [ ] `human_approval.requested` is emitted.
* [ ] Run becomes `waiting_for_human`.
* [ ] Approval can resume exact execution point.
* [ ] Rejection can resume into rejection branch.
* [ ] Resume does not restart the workflow from scratch.

## Approval Interaction

* [ ] Approve.
* [ ] Reject.
* [ ] Optional human text/input.
* [ ] Context can be inspected before decision.
* [ ] Approval actions require backend authorization.

## Routing

* [ ] Approved branch works.
* [ ] Rejected branch works.
* [ ] Branch vocabulary is deterministic.
* [ ] Invalid branch mappings fail validation.

## Visibility

Approval requests are accessible from relevant places:

* [ ] Run detail.
* [ ] Execution Timeline.
* [ ] Dashboard or attention surface.
* [ ] Task detail where integrated.
* [ ] Optional approval inbox if implemented.

## Timeout

Where supported:

* [ ] Timeout can be configured.
* [ ] Expired approval is represented.
* [ ] Timeout behavior is explicit.
* [ ] Auto-approve/reject policy, if supported, is explicit and safe.

---

# Phase 8 — Memory System

# 8.1 Short-Term Memory

* [ ] Short-term/run state is separate from long-term semantic memory.
* [ ] LangGraph state/checkpoint is used appropriately.
* [ ] Run/thread/session scoped state does not pollute long-term memory by default.

# 8.2 Long-Term Memory

* [ ] Long-term memory survives individual runs.
* [ ] Long-term memory is persisted durably.
* [ ] Memory does not depend on browser localStorage.

## Memory Kinds

Architecture distinguishes:

* [ ] Semantic memory.
* [ ] Episodic memory.
* [ ] Procedural memory.

## Memory Scopes

Architecture can scope memory to:

* [ ] Agent.

* [ ] User.

* [ ] Organization.

* [ ] Workflow.

* [ ] Project.

* [ ] Global where deliberately allowed.

* [ ] Global unscoped memory is not the default.

* [ ] Shared memory must be explicitly configured.

## Namespace Isolation

* [ ] Namespace model exists.
* [ ] `organizationId` supported where relevant.
* [ ] `userId` supported where relevant.
* [ ] `projectId` supported where relevant.
* [ ] `workflowId` supported.
* [ ] `agentId` supported.
* [ ] Namespace authorization is enforced server-side.
* [ ] Changing namespace values in browser cannot bypass authorization.

## Memory Entry

Memory entries contain appropriate fields:

* [ ] ID.
* [ ] Scope/namespace.
* [ ] Agent reference.
* [ ] Workflow reference.
* [ ] Run/source reference.
* [ ] Content/value.
* [ ] Kind/type.
* [ ] Created timestamp.
* [ ] Updated timestamp.
* [ ] Source/provenance.
* [ ] Metadata.
* [ ] Importance where supported.
* [ ] Status such as active/superseded/archived where supported.

## MemoryService

Backend supports equivalent operations:

* [ ] remember

* [ ] recall

* [ ] get

* [ ] list

* [ ] update where supported

* [ ] forget/delete

* [ ] consolidate where supported

* [ ] Runtime calls MemoryService directly.

* [ ] Runtime does not call its own HTTP API to access memory.

* [ ] Route handlers do not bypass MemoryService unnecessarily.

## MemoryStore

* [ ] Storage is abstracted behind a MemoryStore or equivalent.
* [ ] PostgreSQL is used where applicable.
* [ ] pgvector is integrated where semantic retrieval requires it.
* [ ] Relational metadata remains queryable.
* [ ] Vector storage is not the only source of metadata truth.

## Embeddings

* [ ] Embedding provider is abstracted.
* [ ] Memory architecture is not hard-coded to OpenAI embeddings.
* [ ] Embedding model can be swapped without changing memory domain model.
* [ ] Raw embedding vectors are not exposed to frontend.
* [ ] Raw embeddings are not emitted in RunEvents.

## Retrieval Pipeline

* [ ] Namespace filtering happens before/within retrieval safely.
* [ ] Metadata filtering supported.
* [ ] Memory kind filtering supported.
* [ ] Semantic retrieval supported.
* [ ] Lexical retrieval supported where designed.
* [ ] Hybrid retrieval supported where designed.
* [ ] Candidate selection exists.
* [ ] Scoring exists.
* [ ] Reranking exists where applicable.
* [ ] Deduplication exists.
* [ ] Context-budget selection exists.

## Scoring

Where implemented, ranking can account for:

* [ ] Semantic similarity.

* [ ] Lexical relevance.

* [ ] Recency.

* [ ] Importance.

* [ ] Contextual relevance.

* [ ] Weighting is encapsulated/configurable.

* [ ] Similarity and importance are not treated as the same concept.

* [ ] Browser does not compute authoritative relevance scores.

## Context Budget

* [ ] Maximum number of retrieved memories.
* [ ] Maximum token budget.
* [ ] Retrieved memories cannot grow context without bounds.
* [ ] Low-ranked memories are excluded when budget is exceeded.

## Memory Write Policy

* [ ] Not every RunEvent is automatically stored as memory.
* [ ] Explicit memory-write policy exists.
* [ ] Memory candidate extraction exists where appropriate.
* [ ] Extraction logic is isolated.
* [ ] Long-term writes can happen outside hot path where appropriate.
* [ ] Write failures do not usually fail an otherwise successful Run.

## Deduplication

* [ ] Exact normalized duplicate detection.
* [ ] Semantic duplicate detection where appropriate.
* [ ] System chooses update/merge/insert deliberately.
* [ ] Parallel/retry writes are idempotent where possible.

## Memory Evolution

Where implemented:

* [ ] Insert.
* [ ] Update.
* [ ] Merge.
* [ ] Supersede.
* [ ] Contradict.
* [ ] Archive.

## Forgetting / Retention

* [ ] Explicit delete.
* [ ] Expiration/retention policy supported where designed.
* [ ] Superseded memory can stop influencing retrieval.
* [ ] Deleted memory is actually excluded from retrieval.

## Memory Runtime Integration

Target flow verified:

```text
AgentRuntime
   ↓
MemoryService.recall
   ↓
MemoryContextFormatter
   ↓
AgentExecutor
   ↓
Result
   ↓
Memory candidate extraction/write
```

* [ ] Workflow compiler does not query Postgres directly.
* [ ] AgentRuntime does not concatenate raw DB rows into prompts.
* [ ] Dedicated formatter builds safe memory context.

## Prompt Injection Safety

* [ ] Retrieved memory is treated as untrusted contextual data.
* [ ] Memory cannot automatically override system instructions.
* [ ] Memory content is clearly separated from system-level directives.

## RunEvents

* [ ] `memory.read`
* [ ] `memory.write`
* [ ] optional update/delete events where useful
* [ ] Memory events avoid secret/raw embedding leakage.

## Memory Explorer

* [ ] `/org/memory` or equivalent exists.
* [ ] Memory can be listed.
* [ ] Memory can be filtered by namespace.
* [ ] Memory can be searched.
* [ ] Relevance score comes from backend.
* [ ] Memory record can be expanded/inspected.
* [ ] Content visible where authorized.
* [ ] Kind visible.
* [ ] Source/provenance visible.
* [ ] Metadata visible safely.
* [ ] Delete works.
* [ ] Delete confirmation exists.
* [ ] Empty state exists.
* [ ] Loading state exists.
* [ ] Search failure handled.
* [ ] Delete failure handled.

## Memory Explorer Security

* [ ] Browser does not receive privileged service credentials.
* [ ] Any browser bearer token is user-scoped and appropriate.
* [ ] Long-lived sensitive tokens are not placed in localStorage.
* [ ] Backend performs authorization for list.
* [ ] Backend performs authorization for search.
* [ ] Backend performs authorization for get.
* [ ] Backend performs authorization for delete.
* [ ] IDs/namespaces from frontend are not trusted as authorization evidence.
* [ ] Sensitive metadata is redacted server-side.
* [ ] API keys/tokens/passwords/cookies are never exposed through metadata.

## Entity Deletion

* [ ] Browser does not manually query/delete memories when deleting Agent/Workflow entities.
* [ ] Referential/lifecycle cleanup belongs to backend domain services.
* [ ] Cleanup/archive behavior is documented or implemented.
* [ ] Memory lifecycle cannot depend on browser successfully completing several requests.

## Memory Editing

If editing is implemented:

* [ ] Update goes through backend MemoryService.
* [ ] Content change can trigger re-embedding.
* [ ] Deduplication is reconsidered.
* [ ] Provenance remains correct.
* [ ] Superseding/version semantics are preserved.

If not implemented:

* [ ] Memory editing is explicitly deferred rather than implemented as unsafe direct CRUD.

---

# Phase 9 — Persistence, Runs, History & Recovery

## Durable Entities

Persist durably:

* [ ] Agents.
* [ ] Tools.
* [ ] Workflows.
* [ ] Tasks.
* [ ] Runs.
* [ ] RunEvents.
* [ ] Approval requests.
* [ ] Long-term memory.
* [ ] Relevant memory metadata.
* [ ] Workflow version metadata.

## PostgreSQL

* [ ] PostgreSQL is primary durable store unless deliberately replaced.
* [ ] Important entities do not depend on localStorage.
* [ ] Important entities do not depend solely on process memory.
* [ ] Migrations exist.
* [ ] Constraints exist where appropriate.
* [ ] Foreign keys/indexes are sensible.

## Redis

If Redis is used:

* [ ] Used for transient concerns.
* [ ] Queues may use Redis.
* [ ] Locks may use Redis.
* [ ] Caching may use Redis.
* [ ] Pub/sub may use Redis.
* [ ] Redis is not sole durable source of critical application history.

## Workflow Persistence

Saved workflow preserves:

* [ ] Execution definition.
* [ ] Node configuration.
* [ ] Edge configuration.
* [ ] Layout metadata.
* [ ] Editor metadata.
* [ ] Version metadata.
* [ ] Agent references.
* [ ] Tool references.

## Run History

* [ ] Previous runs can be listed.
* [ ] Filter by workflow.
* [ ] Filter by task.
* [ ] Filter by status.
* [ ] Filter by date/time.
* [ ] Open historical Run.
* [ ] Historical Timeline works.
* [ ] Final result visible.
* [ ] Failure details visible.
* [ ] Historical events preserve correct ordering.

## Recovery

* [ ] Server restart does not lose active recoverable run metadata.
* [ ] LangGraph checkpointing uses durable storage where required.
* [ ] Human approval waits survive process restart.
* [ ] Resume uses persisted checkpoint.
* [ ] Runtime state needed for recovery is durable.
* [ ] Recovery is not dependent on in-memory JavaScript objects.

## Idempotency

* [ ] Retry does not accidentally duplicate already-completed side effects where preventable.
* [ ] Resume requests can be made safely.
* [ ] Duplicate approval submissions are handled.
* [ ] Duplicate Run start requests are handled where appropriate.
* [ ] Event insertion avoids accidental duplicates.
* [ ] Memory writes from retries are idempotent where applicable.

---

# Phase 10 — Deep Observability, Langfuse & Evaluation Foundation

## Responsibility Split

* [ ] Studio remains Control Plane.
* [ ] Langfuse is deep observability/evaluation plane.
* [ ] Langfuse does not replace RunEvent.
* [ ] Langfuse does not replace Execution Timeline.
* [ ] Application still functions when Langfuse is disabled.

## OpenTelemetry

* [ ] Current supported OpenTelemetry-based Langfuse integration used.
* [ ] Deprecated Langfuse patterns are avoided.
* [ ] Instrumentation is initialized server-side.
* [ ] Business/domain code is not littered unnecessarily with vendor-specific calls.
* [ ] Trace context propagates through async operations.

## Workflow Trace Correlation

Every relevant trace can include:

* [ ] `runId`

* [ ] `workflowId`

* [ ] `taskId` where available

* [ ] `agentId` where available

* [ ] `nodeId` where available

* [ ] `toolId` where available

* [ ] project/org identifiers where appropriate

* [ ] One workflow Run can be identified as a coherent logical trace.

* [ ] Parent/child relationships are meaningful.

* [ ] Parallel branches retain correct trace relationships.

* [ ] Concurrent Runs do not leak trace context.

## Agent Tracing

* [ ] AgentRuntime is instrumented.
* [ ] Agent ID captured.
* [ ] Backend type captured.
* [ ] Provider captured.
* [ ] Model captured where relevant.
* [ ] Duration captured.
* [ ] Failure captured safely.
* [ ] Agent spans correlate to Run.

## API Model Tracing

Where provider exposes information:

* [ ] Provider.
* [ ] Model.
* [ ] Input safely captured according to policy.
* [ ] Output safely captured according to policy.
* [ ] Input tokens.
* [ ] Output tokens.
* [ ] Total tokens.
* [ ] Cached tokens where available.
* [ ] Latency.
* [ ] Cost where reliably available.
* [ ] Model parameters where useful.
* [ ] Error.

## CLI Agent Tracing

* [ ] CLI is not falsely represented as a single ordinary LLM call.
* [ ] Provider/executable recorded safely.
* [ ] Duration.
* [ ] Exit status.
* [ ] Workspace metadata where safe.
* [ ] Structured CLI events captured where available.
* [ ] Usage captured only if reliably reported.
* [ ] Unknown token usage remains unknown.
* [ ] Unknown cost remains unknown.
* [ ] No fabricated nested model traces.

## Local Backend Tracing

* [ ] Local model/provider.
* [ ] Latency.
* [ ] Token usage where available.
* [ ] Generation duration where available.
* [ ] API/provider cost distinguished from infrastructure cost.
* [ ] Unknown cost not fabricated.

## Tool Tracing

* [ ] Tool execution traced.
* [ ] Tool ID.
* [ ] Tool type.
* [ ] Agent correlation.
* [ ] Node correlation.
* [ ] Duration.
* [ ] Success/failure.
* [ ] Safe input summary.
* [ ] Safe output summary.

## Memory Tracing

* [ ] Memory retrieval traced.
* [ ] Memory write traced.
* [ ] Embedding generation traced where relevant.
* [ ] Namespace information captured safely.
* [ ] Candidate count.
* [ ] Selected count.
* [ ] Selected memory IDs where safe.
* [ ] Retrieval scores where available.
* [ ] Retrieval latency.
* [ ] Raw embeddings are never sent.

## Human Approval Observability

* [ ] Approval requested trace/span where useful.
* [ ] Approval resolved.
* [ ] Wait duration.
* [ ] Langfuse does not become approval control plane.

## Retry Tracing

* [ ] Individual attempts remain visible.
* [ ] Failed attempt is not overwritten.
* [ ] Retry remains correlated to same logical execution where appropriate.

## Cost

* [ ] Cost captured where provider/Langfuse can calculate reliably.
* [ ] Unknown cost remains null/unknown.
* [ ] No fake precision.
* [ ] Run-level cost can be derived/inspected.
* [ ] Agent-level cost can be derived/inspected where possible.

## Latency

Useful timing available for:

* [ ] Workflow.
* [ ] Agent.
* [ ] LLM.
* [ ] Tool.
* [ ] Memory retrieval.
* [ ] Embedding.
* [ ] Human approval wait.

## Privacy / Redaction

Centralized telemetry sanitization covers:

* [ ] Authorization headers.
* [ ] API keys.
* [ ] `api_key`.
* [ ] Access tokens.
* [ ] Refresh tokens.
* [ ] Passwords.
* [ ] Cookies.
* [ ] `Set-Cookie`.
* [ ] Private keys.
* [ ] Secrets.
* [ ] Environment credentials.

## Capture Policy

* [ ] Full mode supported where intentionally allowed.
* [ ] Redacted mode supported.
* [ ] Metadata-only mode supported or equivalent.
* [ ] Safe/redacted behavior is suitable default for company repositories.
* [ ] Complete source files are not automatically exported.
* [ ] Complete repository contents are not automatically exported.
* [ ] Complete shell output is not automatically exported.
* [ ] Payload truncation exists.

## Configuration

* [ ] Observability can be disabled.
* [ ] Langfuse public key configured server-side.
* [ ] Langfuse secret key server-side only.
* [ ] Langfuse base URL configurable.
* [ ] Self-hosted Langfuse compatible where applicable.
* [ ] Environment separation exists.
* [ ] Development/staging/production traces can be distinguished.
* [ ] Release/version metadata attached where practical.

## Resilience

* [ ] Langfuse outage does not fail workflow.
* [ ] Export failure only affects telemetry.
* [ ] Telemetry errors are logged safely.
* [ ] No synchronous telemetry flush after every LLM call.
* [ ] Proper shutdown flush exists.

## Studio Integration

* [ ] Run can store or resolve Langfuse trace reference.
* [ ] "View Deep Trace" available where appropriate.
* [ ] Langfuse secret never appears in browser.
* [ ] Studio may show high-level duration.
* [ ] Studio may show token total.
* [ ] Studio may show cost.
* [ ] Studio does not replicate full Langfuse UI.

## Evaluation Foundation

* [ ] Run↔Trace correlation makes future evaluation possible.
* [ ] Agent identity retained.
* [ ] Workflow identity retained.
* [ ] Backend/model metadata retained.
* [ ] Outcome retained.
* [ ] Usage retained.
* [ ] Timing retained.
* [ ] Deterministic engineering outcomes can be attached later.

Optional initial signals:

* [ ] Run success.

* [ ] Tests passed.

* [ ] Human approved.

* [ ] Full LLM-as-judge system is not required for Phase 10.

---

# Phase 11 — Validation, Safety & Runtime Guardrails

## Backend-Authoritative Workflow Validation

* [ ] Validation runs on frontend for UX.
* [ ] Validation runs again on backend.
* [ ] Backend validation is authoritative.
* [ ] Invalid workflow cannot bypass validation by direct API call.

## Graph Validation

Validate:

* [ ] Duplicate node IDs.
* [ ] Duplicate edge IDs.
* [ ] Missing source node.
* [ ] Missing target node.
* [ ] Invalid node type.
* [ ] Invalid node config.
* [ ] Missing required Agent.
* [ ] Missing required Tool.
* [ ] Disabled Agent.
* [ ] Disabled Tool.
* [ ] Invalid conditional branch.
* [ ] Duplicate conditional branch.
* [ ] Ambiguous routing.
* [ ] Invalid Input node structure.
* [ ] Invalid Output node structure.
* [ ] Unsupported connection.
* [ ] Invalid memory configuration.
* [ ] Invalid approval configuration.
* [ ] Unsafe/unbounded cycle where detectable.

## Structured Validation Errors

Validation result includes:

* [ ] severity (`error` / `warning`)
* [ ] stable code
* [ ] human-readable message
* [ ] optional node ID
* [ ] optional edge ID
* [ ] optional field/path

## Runtime Limits

* [ ] Maximum recursion/loop iterations.
* [ ] Maximum run duration.
* [ ] Agent timeout.
* [ ] LLM timeout.
* [ ] Tool timeout.
* [ ] Retry limit.
* [ ] Concurrent branch limit.
* [ ] Token limit where measurable.
* [ ] Cost limit where measurable.
* [ ] Cancellation checks.
* [ ] Runtime respects cancellation promptly where possible.

## Loop Safety

* [ ] Cycles can execute.
* [ ] Cycles cannot run infinitely without limits.
* [ ] Recursion/iteration error is explicit.
* [ ] Loop limit can be configured.

## Tool Safety

* [ ] Tool impact metadata exists.
* [ ] Read-only operations distinguished.
* [ ] Write operations distinguished.
* [ ] External side effects distinguished.
* [ ] High-impact operations distinguished.
* [ ] Runtime can deny restricted tools.
* [ ] Runtime can require approval for high-impact actions where configured.

## Agent Execution Safety

* [ ] Filesystem permissions enforced.
* [ ] Shell permissions enforced.
* [ ] Network permissions enforced.
* [ ] Workspace root enforced.
* [ ] Allowed command restrictions enforced.
* [ ] CLI agents cannot escape allowed workspace unintentionally.

## Secret Redaction

* [ ] RunEvents redact secrets.
* [ ] Logs redact secrets.
* [ ] Langfuse traces redact secrets.
* [ ] Tool output redacted.
* [ ] Error output redacted.
* [ ] Memory metadata redacted.
* [ ] Stack traces do not expose credentials.

## Resource Protection

* [ ] Extremely large input rejected/truncated appropriately.
* [ ] Extremely large tool output controlled.
* [ ] Extremely large RunEvent payload controlled.
* [ ] Memory retrieval context bounded.
* [ ] Streaming does not accumulate unlimited browser memory.

---

# Phase 12 — Production Hardening & Developer Experience

## Repository / Monorepo

* [ ] Web application cleanly separated.
* [ ] Server/runtime cleanly separated.
* [ ] Shared packages used where beneficial.
* [ ] Shared domain/types are not duplicated unnecessarily.
* [ ] pnpm workspaces or equivalent lightweight monorepo setup works.
* [ ] No unnecessary Nx/Turborepo complexity unless justified.
* [ ] Agent runtime remains inside server unless separate service is truly required.

## Build

* [ ] Clean install works.
* [ ] Web build works.
* [ ] Server build works.
* [ ] Shared packages build/typecheck.
* [ ] Production start works.

## Type Safety

* [ ] Web typecheck passes.
* [ ] Server typecheck passes.
* [ ] Shared packages typecheck.
* [ ] No widespread `any` introduced to silence errors.
* [ ] API/domain DTOs are type-safe.

## Lint

* [ ] Lint configured.
* [ ] Lint passes.
* [ ] CI runs lint.

## Unit Tests

Coverage exists for critical logic:

* [ ] Workflow validation.
* [ ] Workflow compiler.
* [ ] Conditional routing.
* [ ] Parallel routing.
* [ ] Loop behavior.
* [ ] State transitions.
* [ ] Agent config validation.
* [ ] AgentExecutor resolution.
* [ ] Tool config validation.
* [ ] Memory retrieval/scoring.
* [ ] Authorization.
* [ ] Guardrails.

## Integration Tests

* [ ] Task → Run creation.
* [ ] Workflow → LangGraph execution.
* [ ] Agent execution.
* [ ] Tool invocation.
* [ ] Human approval pause/resume.
* [ ] Persistence.
* [ ] Recovery.
* [ ] Memory read/write.
* [ ] Langfuse-disabled execution.
* [ ] Runtime validation.

## E2E

Critical path works:

```text
Create Agent
→ Register Tool
→ Create Workflow
→ Validate Workflow
→ Create Task
→ Start Run
→ Observe Timeline
→ Resolve Approval
→ Complete Run
→ Inspect Result
→ Reopen Historical Run
```

* [ ] E2E covers this flow or equivalent.
* [ ] Major failure scenario also tested.

## CI

GitHub Actions or equivalent runs:

* [ ] dependency install

* [ ] lint

* [ ] typecheck

* [ ] tests

* [ ] build

* [ ] CI fails correctly on errors.

* [ ] No critical tests are silently skipped.

## Docker / Local Environment

* [ ] Dockerfile(s) exist where useful.
* [ ] Docker Compose exists.
* [ ] Web can run locally.
* [ ] Server can run locally.
* [ ] PostgreSQL can run locally.
* [ ] Redis can run locally if required.
* [ ] Langfuse/self-hosted dependencies documented if used.
* [ ] Environment configuration documented.

## Structured Logging

Logs include useful correlation where applicable:

* [ ] `runId`

* [ ] `workflowId`

* [ ] `taskId`

* [ ] `nodeId`

* [ ] `agentId`

* [ ] Logs are machine-readable/structured.

* [ ] Sensitive fields are redacted.

## Documentation

Current documentation exists for:

* [ ] Architecture.
* [ ] Development setup.
* [ ] Environment variables.
* [ ] WorkflowDefinition schema.
* [ ] Node types.
* [ ] Edge types.
* [ ] Run schema.
* [ ] RunEvent schema.
* [ ] Agent model.
* [ ] AgentBackend model.
* [ ] AgentExecutor architecture.
* [ ] Tool model.
* [ ] Memory architecture.
* [ ] Approval architecture.
* [ ] Persistence/recovery.
* [ ] Observability/Langfuse.
* [ ] Runtime guardrails.
* [ ] Deployment.

## Performance

Basic performance reviewed for:

* [ ] Large React Flow graphs.
* [ ] Large RunEvent streams.
* [ ] Long-running workflows.
* [ ] Database query patterns.
* [ ] Memory vector queries.
* [ ] Parallel execution.
* [ ] SSE connection lifecycle.
* [ ] Memory leaks.
* [ ] Telemetry payload volume.

---

# Cross-Cutting Security Checklist

## Authentication

* [ ] Protected backend endpoints require authentication.
* [ ] Browser does not use privileged internal service credentials.
* [ ] User identity is resolved server-side.
* [ ] Auth tokens are handled according to established application mechanism.
* [ ] Sensitive long-lived tokens are not stored casually in localStorage.

## Authorization

Backend authorization exists for:

* [ ] Agents.
* [ ] Tools.
* [ ] Workflows.
* [ ] Tasks.
* [ ] Runs.
* [ ] RunEvents.
* [ ] Approvals.
* [ ] Memory.
* [ ] Repository/workspace operations where implemented.

## Secrets

Secrets never appear in:

* [ ] WorkflowDefinition.
* [ ] React Flow node data.
* [ ] Agent domain entity as plaintext credentials.
* [ ] Tool domain entity as plaintext credentials.
* [ ] localStorage.
* [ ] RunEvents.
* [ ] logs.
* [ ] Langfuse metadata.
* [ ] memory.
* [ ] browser-visible error messages.

---

# Cross-Cutting Error Handling

* [ ] Domain errors are normalized.
* [ ] Validation errors are distinguishable.
* [ ] Authentication errors are distinguishable.
* [ ] Authorization errors are distinguishable.
* [ ] Not-found errors are distinguishable.
* [ ] Runtime errors are distinguishable.
* [ ] Provider errors are normalized.
* [ ] CLI unavailable error is explicit.
* [ ] CLI authentication missing error is explicit.
* [ ] Local backend unavailable error is explicit.
* [ ] Tool failure is explicit.
* [ ] Memory failure is explicit.
* [ ] LangGraph compilation failure is explicit.
* [ ] Langfuse failure does not become Run failure.
* [ ] Raw stack traces are not exposed to normal frontend users.

---

# Cross-Cutting Concurrency & Parallelism

* [ ] Multiple Runs can execute simultaneously.
* [ ] Run state never leaks between concurrent executions.
* [ ] Trace context never leaks between Runs.
* [ ] Memory namespace context never leaks between Runs.
* [ ] Parallel branches can execute simultaneously.
* [ ] Parallel branches retain correct node identity.
* [ ] Parallel events remain correctly associated with Run.
* [ ] Parallel memory writes are safe/idempotent where necessary.
* [ ] Human approvals from simultaneous Runs cannot be confused.

---

# Cross-Cutting Persistence Migration

* [ ] Existing stored Agents using old provider/model shape can migrate to `AgentBackend`.
* [ ] Existing saved workflows are migrated/versioned safely.
* [ ] Existing Tool Node data references Tool Entities correctly.
* [ ] Existing Agent Node data references Agent Entities correctly.
* [ ] Schema migrations are versioned.
* [ ] Invalid legacy data fails clearly rather than causing silent corruption.

---

# Cross-Cutting API Design

* [ ] API handlers remain thin.
* [ ] Core domain logic is not duplicated in route handlers.
* [ ] Services/runtime own business behavior.
* [ ] Frontend fetch services remain thin.
* [ ] Frontend does not implement backend ranking/authorization/validation logic.
* [ ] DTO/request validation occurs server-side.
* [ ] Responses do not accidentally expose internal domain secrets.

---

# End-to-End Product Verification

The following entire flow works with real backend behavior:

* [ ] User creates a reusable Agent.
* [x] User selects API/CLI/local backend.
* [x] Backend validates Agent configuration.
* [ ] User registers/configures Tools.
* [ ] Tools can be assigned to Agent.
* [ ] User opens Graph Editor.
* [ ] User creates Agent Nodes referencing Agent Entities.
* [ ] User creates Tool Nodes referencing Tool Entities.
* [ ] User can add conditions.
* [ ] User can add parallel branches.
* [ ] User can create loops.
* [ ] User can add memory access.
* [ ] User can add Human Approval.
* [ ] User can define workflow input.
* [ ] User can define workflow output.
* [ ] Workflow saves durably.
* [ ] Workflow reloads correctly.
* [ ] Backend validates workflow.
* [ ] User creates a Task.
* [ ] User associates Task with Workflow.
* [ ] Starting Task creates real Run.
* [ ] Workflow compiles into LangGraph.
* [ ] LangGraph executes real AgentRuntime.
* [ ] AgentRuntime resolves AgentExecutor.
* [ ] Agent executes through selected backend.
* [ ] Tools can execute.
* [ ] Memory can be retrieved.
* [ ] Memory can be written according to policy.
* [ ] Parallel branches execute correctly.
* [ ] Loops execute within guardrails.
* [ ] Human Approval pauses execution.
* [ ] Server restart does not destroy durable approval state.
* [ ] Human approval resumes exact run.
* [ ] RunEvents stream live.
* [ ] Timeline updates live.
* [ ] Graph reflects runtime execution state.
* [ ] Failures are visible.
* [ ] Retry behavior works where supported.
* [ ] Run completes.
* [ ] Final output persists.
* [ ] Historical Run can be reopened.
* [ ] Historical Timeline matches execution.
* [ ] Langfuse trace is correlated.
* [ ] Deep trace can be opened.
* [ ] Sensitive data is redacted.
* [ ] Memory Explorer shows resulting authorized memories.
* [ ] Entire system survives process restart without losing durable state.

---

# Final Architectural Verification

The system should satisfy these statements.

## Visual Programming

* [ ] The graph is the workflow/program, not merely a diagram.

## Execution

* [ ] WorkflowDefinition is dynamically compiled into LangGraph.

## Agents

* [ ] Agents are reusable entities independent from graph nodes.

## Multi-Backend

* [ ] Agent execution is not restricted to API keys.
* [ ] API, CLI, and local backends fit the same runtime architecture.

## Tools

* [ ] Tools are reusable capabilities independent from Agent implementation.

## Memory

* [ ] Memory is a first-class backend subsystem with explicit scope, retrieval, retention, and isolation.

## Human-in-the-Loop

* [ ] Workflows can safely pause and resume around real human decisions.

## Persistence

* [ ] Workflow and execution history survives application restarts.

## Observability

* [ ] Studio provides operational visibility.
* [ ] Langfuse provides deep execution/LLM observability.
* [ ] The two systems are correlated without duplicating each other.

## Safety

* [ ] Frontend validation improves UX.
* [ ] Backend remains authoritative.
* [ ] Runtime guardrails constrain unsafe/runaway execution.

## Provider Independence

* [ ] LangGraph compiler does not depend directly on one model vendor.
* [ ] Agent domain model does not depend on one model vendor.
* [ ] Frontend does not depend on LangGraph internals.
* [ ] Frontend does not depend on provider SDK internals.
* [ ] Domain models do not depend on Langfuse.

---

# Final Regression Gate

Before calling the current platform implementation complete:

* [ ] All unit tests pass.
* [ ] All integration tests pass.
* [ ] All E2E tests pass.
* [ ] Web typecheck passes.
* [ ] Server typecheck passes.
* [ ] Shared-package typechecks pass.
* [ ] Lint passes.
* [ ] Production build passes.
* [ ] Fresh database migration succeeds.
* [ ] Existing database migration succeeds.
* [ ] Fresh local setup from README works.
* [ ] Docker/local infrastructure starts correctly.
* [ ] Real API-backed workflow succeeds.
* [ ] Real Tool execution succeeds.
* [ ] Real Memory workflow succeeds.
* [ ] Real Human Approval workflow succeeds.
* [ ] Parallel workflow succeeds.
* [ ] Loop workflow stops correctly.
* [ ] Failed workflow produces correct history.
* [ ] Restart/recovery scenario succeeds.
* [ ] Langfuse-disabled workflow succeeds.
* [ ] Langfuse-enabled workflow succeeds.
* [ ] Concurrent Runs succeed without state leakage.
* [ ] Security tests for cross-scope Memory access pass.
* [ ] Secret-redaction tests pass.
* [ ] No critical TODO/FIXME remains in runtime/security/persistence paths.

---

# Completion Criteria

The platform can be considered functionally complete for the current roadmap only when a user can:

```text
Create reusable Agents
        ↓
Configure API / CLI / Local execution
        ↓
Register reusable Tools
        ↓
Build an executable workflow visually
        ↓
Validate it
        ↓
Create a Task
        ↓
Start a real LangGraph Run
        ↓
Execute Agents / Tools / Memory
        ↓
Run branches, conditions and loops
        ↓
Pause for Human Approval
        ↓
Observe execution live
        ↓
Recover after restart
        ↓
Inspect historical execution
        ↓
Inspect deep Langfuse trace
        ↓
Understand exactly what happened
```

without requiring the user to manually operate the multi-agent runtime from the terminal.
