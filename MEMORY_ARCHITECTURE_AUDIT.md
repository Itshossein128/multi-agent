# Memory Architecture Audit

## Executive Summary

The multi-agent platform has a **surprisingly mature long-term memory system** with PostgreSQL-backed persistence, hybrid retrieval (lexical + semantic vector), idempotent writes, superseding, and tenant isolation. The `studio_memories` table, `MemoryService`, `HybridMemoryRetriever`, and `RuntimeMemory` classes represent a genuine, production-grade long-term memory implementation.

However, the system has significant gaps: **no centralized context assembler** (context is scattered across `AgentRuntime`, `RuntimeMemory`, and `AgentExecutionInput`), **no working memory abstraction** (the in-graph `memory` state is a generic key-value blob, not a structured scratchpad), **no agent-local private memory** (only namespace-scoped grants), **no memory consolidation** (`NoopMemoryConsolidator` returns 0), **no conflict detection** across memories (only version-based optimistic locking), and **no episodic/procedural memory actually retrieved by agents** (the `kind` field exists but retrieval does not distinguish kinds in practice).

The execution state and checkpointing layer is solid and restart-safe with PostgreSQL. Short-term memory is checkpoint-safe via LangGraph's `MemorySaver`/`PostgresSaver`. The long-term memory is fully durable and survives restarts. The critical architectural gap is the absence of a **context assembler** that decides what enters the model context window, and the absence of **cross-run knowledge reuse** beyond the long-term memory store (no episodic or procedural recall).

## Capability Matrix

| Capability | Status | Evidence | Notes |
|---|---|---|---|
| Execution state | **Implemented** | `PostgresRunStore`, `studio_runs`/`studio_run_events`/`studio_approvals` tables, `hydrate()`, `recovery.ts` | Write-through durable store; survives restart; hydration rebuilds in-memory cache from Postgres |
| Working memory | **Partial** | `RuntimeState.memory` (in-graph), `RuntimeState.shortTermHistories` | In-graph `memory` is a generic `Record<string, unknown>` — not a structured scratchpad. Short-term histories are per-agent input/output pairs, not explicit working memory. |
| Agent-local memory | **Missing** | No `agentId`-scoped private store | Namespace-scoped grants exist but are not agent-local private scratchpads. `MemoryNamespace.scope = "agent"` is the closest, but it requires explicit configuration and is shared across the agent's lifetime. |
| Shared workflow memory | **Partial** | `RuntimeState.memory` reducer (merge), `shortTermHistories` merge across nodes | The in-graph `memory` merges across nodes via spread, but it is untyped and not persisted across nodes. Short-term histories are checkpointed and merged. No structured handoff protocol. |
| Long-term memory | **Implemented** | `MemoryService`, `PostgresMemoryStore`, `studio_memories` table, `RuntimeMemory`, full CRUD API | Fully durable, tenant-scoped, with superseding, idempotency, and versioning. Embedded into agent execution via `RuntimeMemory`. |
| Semantic memory | **Implemented** | `MemoryKind = "semantic"`, `HybridMemoryRetriever` with vector + lexical scoring, `pgvector` extension | Semantic kind is the primary memory type. Vector search via `embedding_vector` column with cosine ordering. |
| Episodic memory | **Partial** | `MemoryKind = "episodic"` exists, `Memory.source` has `runId`/`nodeId`/`workflowId` | The type supports episodic memories, but the `DeterministicMemoryExtractor` only extracts from explicit `memoryCandidates` or "remember that" user requests — it does not automatically capture run outcomes as episodes. No episodic-specific retrieval logic. |
| Procedural memory | **Partial** | `MemoryKind = "procedural"`, `procedure`/`trigger` fields on `Memory` | Schema supports it, but no automatic extraction of procedures from execution. No procedural-specific retrieval or application logic. |
| Memory scopes | **Implemented** | `MemoryNamespace { scope: "agent" | "workflow" | "project" | "organization" | "user", id }`, `MemoryAccessContext`, `canAccessMemory()` | Scoping is enforced at every layer: store queries, service operations, retriever, and runtime memory. Private/workflow visibility adds cross-cutting isolation. |
| Provenance | **Implemented** | `Memory.source` (type, runId, nodeId, agentId, workflowId, toolId), `createdAt`, `updatedAt`, `version`, `idempotencyKey` | Source provenance is captured on write and immutable. Version tracking enables optimistic concurrency. |
| Freshness | **Implemented** | `expiresAt`, TTL support (`defaultTtlMs`), `status: "active" | "superseded" | "archived"`, `supersedesMemoryId` | TTL expiration is enforced on read. Superseding creates a chain. No `lastVerifiedAt` or `validUntil` beyond TTL. |
| Conflict detection | **Partial** | Optimistic versioning (`expectedVersion`), `MemoryConflictError`, `MemoryVersionConflictError` | Version-based conflict detection works for concurrent writes. No semantic contradiction detection (e.g., "uses pnpm" vs "uses npm"). Superseding requires explicit `supersedesMemoryId`. |
| Consolidation | **Missing** | `NoopMemoryConsolidator` returns `{ merged: 0 }` | The interface exists, the implementation is a no-op. No deduplication, merging, summarization, or compaction. |
| Retrieval | **Implemented** | `HybridMemoryRetriever`: semantic (cosine), lexical (word overlap), recency (exponential decay), importance, context (subject/title/trigger/lesson). Weighted scoring with configurable weights. | Retrieval is sophisticated: independent lexical/vector/recent pools, deduplication, content-hash dedup, token-budget-aware selection. |
| Context assembler | **Missing** | No centralized `ContextAssembler` | Context is assembled ad-hoc: `RuntimeMemory.read()` returns formatted string, `AgentRuntime` passes it as `memoryContext`, `ApiAgentExecutor` puts it in a user message. No component decides what enters the model context holistically. |
| Context budget management | **Partial** | `DefaultMemoryContextFormatter.select()` (token-bounded), `boundText()`, `maxTokens` in retrieval | Memory context is token-bounded. But no overall context window budget across system prompt + history + memory + artifacts. Short-term history is bounded by `maxTokens` and `maxEntries`. |
| Artifact separation | **Missing** | No artifact storage abstraction | Large outputs are passed as full content in `state.lastValue` and `state.output`. No reference-based artifact system. Node results accumulate in `state.nodeResults`. |
| Vector retrieval | **Implemented** | `pgvector` extension, `embedding_vector` column (STORED GENERATED), cosine ordering, `HttpEmbeddingProvider` with cache | Optional: requires `MEMORY_EMBEDDING_URL` and `MEMORY_VECTOR_ENABLED=true`. Falls back to lexical when unavailable. |
| Memory write policy | **Implemented** | `DefaultMemoryWritePolicy`: explicit-only, rejects secrets/trivial/too-large content | Only explicit candidates (from `memoryCandidates` or "remember that" user input) pass policy. Background writes via `BoundedMemoryBackgroundJobs`. |

## Existing Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        User / API Request                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                        RunExecutor.start()                       │
│  Creates Run, validates workflow, stores workflow/agent snapshot  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  compileWorkflow() → StateGraph                  │
│  Adds nodes: agent, tool, memory, condition, approval, I/O      │
│  State: input, output, memory (Record<string,unknown>),          │
│         shortTermHistories, branch, lastValue, nodeResults       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Node Execution                         │
│                                                                  │
│  1. RuntimeMemory.read() → query long-term memory store          │
│     - Embed query text → vector search + lexical search          │
│     - HybridMemoryRetriever scores candidates                    │
│     - DefaultMemoryContextFormatter budgets tokens                │
│     - Returns formatted "Untrusted memory data" string           │
│                                                                  │
│  2. AgentRuntime.execute()                                       │
│     - Reads short-term history from checkpoint                   │
│     - Passes { history, memoryContext } to executor               │
│     - ApiAgentExecutor: [system, memoryMsg, userMsg]             │
│                                                                  │
│  3. RuntimeMemory.afterSuccess(output)                           │
│     - DeterministicMemoryExtractor: extracts memoryCandidates     │
│       or "remember that" patterns from input                     │
│     - DefaultMemoryWritePolicy: rejects trivial/secrets           │
│     - MemoryService.remember(): idempotent, deduplicating        │
│     - Writes to studio_memories table                             │
│                                                                  │
│  4. Short-term history updated (checkpointed via LangGraph)      │
└─────────────────────────────────────────────────────────────────┘
```

### ASCII Diagram: Memory Layers

```
┌──────────────────────────────────────────────────────────┐
│                     Workflow Runtime                       │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ In-Graph     │  │ Short-Term   │  │ Long-Term      │  │
│  │ Memory       │  │ History      │  │ Memory         │  │
│  │ (state.      │  │ (checkpoint) │  │ (PostgreSQL)   │  │
│  │  memory)     │  │              │  │                │  │
│  │ untyped KV   │  │ input/output │  │ semantic/      │  │
│  │ per-node     │  │ pairs per    │  │ episodic/      │  │
│  │ reducer      │  │ agent,       │  │ procedural     │  │
│  │              │  │ bounded      │  │ kind           │  │
│  │ NOT durable  │  │ DURABLE      │  │ DURABLE        │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Database / Persistence Findings

### Tables

1. **`studio_memories`** (`infrastructure/memory/migrations/001_memories.sql`)
   - Primary key: `(tenant_id, id)`
   - Columns: id, tenant_id, namespace_scope, namespace_id, kind, visibility, content, subject, structured_data, situation, action, result, lesson, success, title, procedure, trigger, importance, confidence, source (JSONB), status, supersedes_memory_id, superseded_by_memory_id, created_at, updated_at, expires_at, embedding (double precision[]), embedding_provider, embedding_model, embedding_dimensions, embedding_version, metadata (JSONB), idempotency_key, content_hash, version, last_accessed_at, access_count, reinforcement_count
   - Indexes: idempotency, scope, content_hash, subject, expiration, metadata (GIN), source_agent, source_workflow

2. **`studio_memories` vector column** (`infrastructure/memory/migrations/002_pgvector.sql`)
   - `embedding_vector vector GENERATED ALWAYS AS (embedding::vector) STORED`
   - Index: `studio_memories_embedding_metadata` on (tenant_id, namespace_scope, namespace_id, embedding_provider, embedding_model, embedding_dimensions, embedding_version)

3. **`studio_runs`** (`infrastructure/studio/migrations/002_runs.sql`)
   - Primary key: `(id)`
   - Columns: id, workflow_id, task_id, status, started_at, completed_at, input, output, error, current_node_id, metadata, memory_owner_principal_id, memory_owner_tenant_id, workflow_snapshot, agents_snapshot, paused_context

4. **`studio_run_events`** (`infrastructure/studio/migrations/002_runs.sql`)
   - Primary key: `(run_id, sequence)`
   - Columns: run_id, sequence, event (JSONB)

5. **`studio_approvals`** (`infrastructure/studio/migrations/002_runs.sql`)
   - Primary key: `(id)`
   - Columns: id, run_id, node_id, status, message, requested_at, resolved_at, context, response, metadata, timeout_seconds

6. **`studio_memory_migrations`** (created by migration runner)
   - Tracks applied memory migrations with checksums

### Stores / Repositories

- `PostgresMemoryStore` — durable long-term memory store with transactional advisory locks
- `InMemoryMemoryStore` — test adapter with identical interface
- `PostgresRunStore` — write-through durable run store (in-memory hot cache + Postgres mutations)
- `InMemoryRunStore` — in-process run store, used as hot cache and in tests
- `PostgresStudioStore` — durable studio entities (workflows, agents, tools, tasks)
- `InMemoryStudioStore` — test adapter for studio entities

### Persistence Services

- `DefaultMemoryService` — orchestrates remember/recall/update/forget with dedup, idempotency, versioning
- `HybridMemoryRetriever` — multi-signal retrieval with scoring and budgeting
- `RuntimeMemory` — agent-scoped memory lifecycle (read before execution, write after success)
- `DeterministicMemoryExtractor` — extracts memory candidates from explicit signals only
- `DefaultMemoryWritePolicy` — gatekeeping for what becomes persistent memory

## Runtime Findings

### Execution Path Trace

1. **Workflow Start**: `RunExecutor.start()` → validates workflow, creates `Run` in store, stores workflow/agent/tool snapshots, starts `executeWorkflow()`

2. **Graph Compilation**: `compileWorkflow()` builds LangGraph `StateGraph` with `RuntimeState` (input, output, memory, shortTermHistories, branch, lastValue, nodeResults). Each agent node calls `runAgentThroughRuntime()`.

3. **Agent Execution**: `AgentRuntime.execute()`:
   - Reads short-term history from checkpoint via `shortTermHistories`
   - Creates `RuntimeMemory`, calls `read()` → `MemoryService.recall()` → `HybridMemoryRetriever.retrieve()` → returns formatted context
   - Passes `{ history, memoryContext }` to the executor (API/CLI)
   - After success, calls `RuntimeMemory.afterSuccess()` → `DeterministicMemoryExtractor.extract()` → `MemoryWritePolicy.shouldRemember()` → `MemoryService.remember()`

4. **State Persistence**: LangGraph checkpointing via `MemorySaver` (in-memory) or `PostgresSaver` (durable) saves `shortTermHistories`, `input`, `output`, `memory`, `branch`, `lastValue`, `nodeResults` per step.

5. **Run Completion**: `GraphRunner.runGraph()` finalizes: stores output, marks status as completed, emits `run.completed` event.

6. **Approval Pause/Resume**: `ApprovalManager.handleApprovalRequested()` records approval, pauses run. `resolveApproval()` recompiles graph with `Command({ resume: decision })` and continues.

## Restart / Resume Findings

### What Survives Restart

- **Run status, events, approvals, snapshots**: via `PostgresRunStore.hydrate()` which reads from `studio_runs`, `studio_run_events`, `studio_approvals`
- **Long-term memory**: via `studio_memories` table (fully durable)
- **Short-term histories**: via LangGraph checkpointing. If `PostgresSaver` is used, checkpoint state survives. With `MemorySaver` (in-memory), short-term history is lost on restart.
- **Paused workflow context**: stored in `paused_context` JSONB column, restored during hydration
- **Workflow/agent/tool snapshots**: stored in `workflow_snapshot`, `agents_snapshot`, `tools_snapshot` JSONB columns

### What Does NOT Survive Restart

- **In-graph `memory` state** (the `Record<string, unknown>`): This is part of LangGraph's checkpointed state, so it does survive if the checkpointer is durable. However, it is not independently persisted by the run store.
- **Approval timers**: `setTimeout` timers are lost. `rearmApprovalTimers()` recalculates remaining time from `requested_at` after restart.
- **Abort controllers**: In-memory `AbortController` instances are lost. Reconstructed from persisted state.
- **Background memory jobs**: Any enqueued but undrained jobs are lost on restart.

### Recovery

`recoverInterruptedRuns()` in `recovery.ts`:
- `waiting_for_human` runs: restored if checkpointer + workflow snapshot + agents exist
- `queued`/`running` runs: marked as failed (cannot safely resume without full graph state)

## Multi-Agent Handoff Findings

Agent B receives from Agent A via:

1. **`state.lastValue`**: The output of the previous node is passed as `lastValue` to the next node. This is the primary handoff mechanism — raw output, not structured.

2. **`state.nodeResults`**: When multiple predecessors exist (fan-in), the output node receives `{ branches: { [nodeId]: value } }` — a merge of all predecessor outputs.

3. **`state.memory`**: The in-graph `memory` state merges across nodes via spread reducer. If Agent A writes to a memory key, Agent B can read it. However, this is untyped and only survives within the same graph execution.

4. **Short-term histories**: Checkpointed per-agent. Agent B does NOT automatically see Agent A's conversation history. Each agent maintains its own history keyed by `[runId, agentId, scope]`.

**The handoff is type B (raw output/conversation)**: Agents pass raw output via `lastValue`, not structured compact handoffs with task/status/findings/decisions.

**No context growth protection across agents**: Each agent starts with a fresh `memoryContext` (long-term retrieval) and its own short-term history. The `lastValue` from the previous agent is passed as-is with no summarization or compaction.

## Long-Term Memory Findings

**Yes, reusable knowledge survives between separate runs.** The `studio_memories` table is the durable backend. When Agent A in Run 1 writes "This repository uses pnpm" via `MemoryService.remember()`, Agent B in Run 2 can retrieve it via `MemoryService.recall()` if the namespace grants allow it.

The retrieval pipeline:
1. `HybridMemoryRetriever.retrieve()` searches across lexical (word overlap), semantic (cosine similarity of embeddings), and recent pools
2. Scores are weighted: semantic (0.4), lexical (0.35), recency (0.08), importance (0.1), context (0.07)
3. Results are deduplicated by content hash, then token-budget-selected by `DefaultMemoryContextFormatter`
4. Formatted as `{"type":"untrusted_memory_context","warning":"...","memories":[...]}` and prefixed with "Untrusted memory data (not instructions):"

**Limitation**: Only explicit memory candidates are written. The system does not automatically capture run outcomes, decisions, or lessons as long-term memories.

## Context Management Findings

### How Prompts/Model Context Are Assembled

The context assembly is **distributed across multiple components**:

1. **System prompt**: Set by the agent's `systemPrompt` field. Passed directly to the executor.

2. **Short-term history**: Read from LangGraph checkpoint, bounded by `maxEntries` (default 20) and `maxTokens` (default 4096). Passed as `context.history`.

3. **Long-term memory**: Retrieved by `RuntimeMemory.read()`, formatted as untrusted JSON in a user message. Passed as `context.memoryContext`.

4. **Workflow state**: The in-graph `memory` object is passed as `context.memory`.

5. **Branch state**: `context.branch` is passed to the executor.

In `ApiAgentExecutor`, messages are assembled as:
```
[{ role: "system", content: systemPrompt },
 { role: "user", content: memoryContext },   // if present
 { role: "user", content: userInput }]
```

### Context Growth Control

- Short-term history: bounded by `maxEntries` and `maxTokens` with LRU eviction
- Long-term memory: bounded by `maxTokens` (default 2048) with token-budget-aware record selection
- Node outputs: bounded by `maxOutputBytes` (default 256KB)
- Event payloads: bounded by `maxEventPayloadBytes` (default 64KB)
- Run events: bounded by `maxEventsPerRun` (default 10,000)

**No overall context window budget**: There is no component that enforces a total limit across system prompt + history + memory + input. Each layer has its own budget but they are not coordinated.

## Security / Isolation Findings

### Tenant Isolation
- All memory operations require `tenantId` in `MemoryAccessContext`
- Store queries always filter by `tenant_id`
- PostgreSQL queries use parameterized queries (no SQL injection)
- Advisory locks are scoped to namespace keys

### Owner Isolation
- `MemoryOwner` (principalId + tenantId) is stored per run
- `RunStore.list()` filters by principal when provided
- Memory grants (`readableNamespaces`/`writableNamespaces`) are server-configured, not user-provided

### Workflow Isolation
- `MemoryAccessContext` includes optional `workflowId`
- Private memories are scoped to the creating agent or workflow
- Workflow-scoped memories cannot be accessed by other workflows

### Agent Isolation
- Agent-scoped memories: `canUseNamespace()` checks that `access.agentId === namespace.id` for agent-scope writes
- `RuntimeMemory.requireAccess()` validates agent and workflow identity match the runtime context
- Candidates from the extractor are validated against the granted namespace

### Memory Leakage Risks
- **Low risk**: The `memory` state in-graph is passed as `context.memory` to executors. CLI agents could theoretically read it, but it only contains in-graph key-value data, not long-term memory content.
- **Low risk**: Long-term memory is rendered as "untrusted" JSON with explicit warnings. The formatter strips embeddings and idempotency metadata.
- **Medium risk**: Short-term histories are checkpointed and could be exposed if the checkpoint store is compromised. They contain raw agent input/output.
- **Low risk**: The `publicMemory()` function strips embeddings and idempotency metadata before returning to API callers.

## Main Gaps

### Critical

1. **No Context Assembler**: There is no centralized component that decides what information enters the model context window. Context assembly is scattered across `RuntimeMemory`, `AgentRuntime`, and executor implementations. This makes it impossible to enforce a holistic context budget, prioritize information, or adapt context strategy across different model backends.

### High

2. **No Working Memory Abstraction**: The in-graph `memory` state (`Record<string, unknown>`) is a generic key-value blob, not a structured scratchpad for agent reasoning. There is no mechanism for an agent to explicitly write "current findings" or "unresolved issues" that are queryable by other nodes in a structured way.

3. **No Memory Consolidation**: `NoopMemoryConsolidator` is a no-op. Repeated or overlapping memories ("Use pnpm" + "Repository uses pnpm" + "Do not use npm") are never merged. The store accumulates duplicates that increase retrieval noise.

4. **Raw Agent Handoff**: Agent B receives Agent A's raw output via `lastValue`, not a structured handoff with task/status/findings/decisions/remaining-work. For complex multi-agent workflows, this means unbounded context growth as raw outputs compound.

### Medium

5. **No Episodic Recall**: The `episodic` memory kind exists in the schema, but the extractor never automatically captures run outcomes. There is no mechanism to retrieve "what happened in previous runs that is relevant to this task."

6. **No Procedural Recall**: The `procedural` memory kind exists with `procedure`/`trigger` fields, but no extraction or application logic. Procedures cannot be automatically learned and applied.

7. **No Semantic Contradiction Detection**: Two memories can coexist that directly contradict each other ("uses JWT" and "uses HMAC principals") with no detection or resolution.

8. **No Artifact Separation**: Large node outputs are passed as full content in `lastValue` and `nodeResults`. No reference-based system. Long-running workflows can exceed the model context window.

### Low

9. **No lastVerifiedAt**: Memory freshness relies solely on TTL and superseding. There is no mechanism to verify or re-validate memories.

10. **No Access Count Reinforcement**: `lastAccessedAt`, `accessCount`, and `reinforcementCount` columns exist in the schema but are never written or read by the application layer.

## Recommended Target Architecture

Based on the existing architecture, the smallest reasonable evolution:

```
┌─────────────────────────────────────────────────────────────┐
│                    Context Assembler (NEW)                    │
│  Decides what enters model context:                          │
│  - System instructions                                       │
│  - Task description                                          │
│  - Relevant long-term memory (via HybridMemoryRetriever)     │
│  - Structured handoff from previous agent (NEW)              │
│  - Relevant node results (refs, not full content)            │
│  - Short-term history (bounded)                               │
│  - Tool results (bounded)                                     │
│  Total budget: configurable, model-aware                      │
└─────────────────────────────────────────────────────────────┘
```

### Evolution Path

1. **Extract Context Assembler** from the scattered logic in `RuntimeMemory`, `AgentRuntime`, and executors into a single `ContextAssembler` class.

2. **Add Working Memory** as a structured, typed abstraction in `RuntimeState` alongside the existing `memory` blob.

3. **Implement Structured Handoff** between agents: a `HandoffDocument` with task, status, findings, decisions, remaining work, and artifact references.

4. **Implement Memory Consolidation** to merge duplicate/overlapping memories.

5. **Add Episodic Extraction** to automatically capture run outcomes as episodic memories.

## Recommended Implementation Order

### Phase 1: Context Assembler
- **Capability**: Centralized context assembly
- **Why**: Everything else depends on knowing what enters the context window. Without this, budget management is impossible.
- **Dependencies**: None
- **Affected files**: New `ContextAssembler` class, `AgentRuntime`, `RuntimeMemory`, `ApiAgentExecutor`, `CliAgentExecutor`
- **Tests required**: Budget enforcement, priority ordering, fallback behavior

### Phase 2: Working Memory
- **Capability**: Structured run-scoped scratchpad
- **Why**: Agents need a way to record and query intermediate findings within a run. This is a prerequisite for structured handoff.
- **Dependencies**: None
- **Affected files**: `RuntimeState`, `workflowCompiler.ts`, `AgentRuntime`, `types.ts`
- **Tests required**: Read/write within run, isolation between runs, checkpoint survival

### Phase 3: Structured Agent Handoff
- **Capability**: Compact structured knowledge transfer between agents
- **Why**: Multi-agent workflows currently pass raw output. This prevents context blowup.
- **Dependencies**: Phase 2 (working memory)
- **Affected files**: `workflowCompiler.ts`, `runAgentThroughRuntime()`, `GraphRunner`, new `HandoffDocument` type
- **Tests required**: Handoff structure validation, context size bounds, backward compatibility

### Phase 4: Memory Consolidation
- **Capability**: Deduplication and merging of overlapping memories
- **Why**: Without consolidation, retrieval quality degrades as duplicate memories accumulate.
- **Dependencies**: None
- **Affected files**: Replace `NoopMemoryConsolidator`, `MemoryService`, new consolidation job
- **Tests required**: Dedup accuracy, merge semantics, idempotency

### Phase 5: Episodic Extraction
- **Capability**: Automatic capture of run outcomes as episodic memories
- **Why**: Agents cannot learn from past experiences without episodic memory.
- **Dependencies**: Phase 4 (consolidation)
- **Affected files**: `DeterministicMemoryExtractor`, `RunExecutor`, new episodic extraction logic
- **Tests required**: Extraction accuracy, dedup with existing memories, retrieval relevance

### Phase 6: Procedural Extraction
- **Capability**: Automatic capture and application of learned procedures
- **Why**: Agents should learn and reuse repository-specific procedures.
- **Dependencies**: Phase 5 (episodic extraction)
- **Affected files**: `DeterministicMemoryExtractor`, `RuntimeMemory`, new procedural application logic
- **Tests required**: Procedure extraction, trigger matching, procedure-to-instruction injection

## Final Verdict

### 1. What memory capabilities are genuinely implemented today?

- **Long-term semantic memory** with PostgreSQL persistence, hybrid retrieval (vector + lexical), idempotent writes, superseding, and versioning
- **Execution state** with durable checkpointing, hydration after restart, and approval recovery
- **Short-term history** with checkpointing, per-agent scoping, and bounded history
- **Memory scopes** with 5-level namespace hierarchy, tenant isolation, and visibility controls
- **Memory provenance** with source tracking (runId, nodeId, agentId, workflowId)
- **Memory freshness** via TTL expiration and superseding
- **Vector/semantic retrieval** via pgvector with configurable embedding provider
- **Memory write policy** with explicit-only gating, secret rejection, and size limits

### 2. Which existing features are being called "memory" but are actually state/history/logging?

- **`RuntimeState.memory`** (the in-graph `Record<string, unknown>`): This is workflow execution state, not memory. It is a generic key-value accumulator merged across nodes.
- **`shortTermHistories`**: This is conversation history/checkpointing, not memory in the cognitive sense. It is input/output pairs bounded by token limits.
- **`RunEvent` stream**: This is execution logging/observability, not memory. Events are never queried by agents as context.
- **`nodeResults`**: This is execution state tracking, not memory.

### 3. Can agents remember information across runs?

**Yes.** The long-term memory system (`MemoryService` + `PostgresMemoryStore` + `studio_memories` table) persists memories across runs. Agent A in Run 1 can write a memory that Agent B in Run 2 retrieves, provided namespace grants allow it. The end-to-end test `memoryEndToEnd.test.ts` explicitly verifies this.

### 4. Can one agent reliably pass compact structured knowledge to another?

**No.** Agents pass raw output via `lastValue`. There is no structured handoff document. The only cross-agent data flow is:
- `lastValue` (raw output of previous node)
- `state.memory` (untyped key-value blob)
- Long-term memory (shared via namespace grants, but requires explicit write)

### 5. Is there semantic retrieval?

**Yes.** `HybridMemoryRetriever` implements multi-signal retrieval with configurable weights for semantic (cosine), lexical (word overlap), recency, importance, and context scores. Vector search uses pgvector with cosine ordering. The system gracefully degrades to lexical-only when embeddings are unavailable.

### 6. Is there a centralized context assembler?

**No.** Context assembly is distributed across:
- `RuntimeMemory.read()` → retrieval + formatting
- `AgentRuntime.execute()` → history + memory context assembly
- `ApiAgentExecutor` → message array construction
- `CliAgentExecutor` → prompt construction

There is no single component that decides what enters the model context holistically.

### 7. Is memory safe across tenants?

**Yes, with strong isolation.** Every memory operation requires a `MemoryAccessContext` with `principalId` and `tenantId`. The store queries always filter by `tenant_id`. Namespace grants are server-configured and cannot be forged. Private and workflow-scoped memories have additional isolation layers. The advisory lock mechanism prevents concurrent cross-tenant interference.

### 8. What are the three highest-impact missing capabilities?

1. **Context Assembler**: Without a centralized context assembly component, there is no holistic control over what enters the model context. This is the single most impactful missing piece — it affects every agent execution and is a prerequisite for context budget management, priority-based information selection, and adaptive context strategies.

2. **Structured Agent Handoff**: Multi-agent workflows currently pass raw output between agents. This leads to unbounded context growth and loss of semantic structure. A compact `HandoffDocument` (task, status, findings, decisions, remaining work) would dramatically improve multi-agent efficiency.

3. **Memory Consolidation**: The `NoopMemoryConsolidator` means duplicate and overlapping memories accumulate indefinitely, degrading retrieval quality over time. Implementing deduplication and merging would improve long-term memory reliability.
