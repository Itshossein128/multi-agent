# Data Model: In-Canvas Live Execution & Observability

**Feature Branch**: `011-canvas-live-observability`  
**Date**: 2026-11-04  
**Status**: Phase 1  

This feature is primarily a **client projection and UX** layer over existing run, event, and approval entities. No new persistence tables are required. Entities below describe studio Live-mode state and derived views.

---

## Existing Persisted Entities (unchanged contracts)

### Run
Source: `@multi-agent/types` `Run`

| Field | Notes for Live mode |
| :--- | :--- |
| `id` | Attached as studio `runId` query / store key |
| `workflowId` | Used to load/align studio workflow |
| `status` | Tray badge: `queued` \| `running` \| `waiting_for_human` \| `completed` \| `failed` \| `cancelled` |
| `startedAt` / `completedAt` | Elapsed timer |
| `currentNodeId` | Highlight active / waiting node when present |
| `result` / `error` / `output` | Inspector + tray terminal summary |
| `metadata` | May carry extras; not authority for outcomes |

### RunEvent
Source: `RunEvent` / `RunEventType`

Authoritative stream for projection. Key types for canvas:

- Path: `edge.traversed` (`payload.edgeId`)
- Node lifecycle: `node.started` \| `node.completed` \| `node.failed` \| `node.retrying` \| `node.loop_limit_reached`
- Nested work: `agent.*`, `llm.*`, `tool.*`
- Human: `human_approval.*`
- Branch: `branch.skipped` \| `branch.cancelled`
- Run: `run.paused` \| `run.resumed` \| `run.completed` \| `run.failed` \| `run.cancelled`

### ApprovalRequest
Source: `ApprovalRequest`

| Field | Live usage |
| :--- | :--- |
| `id`, `runId`, `nodeId` | Banner + node highlight |
| `status` | `requested` drives banner; terminal statuses hide actions |
| `message`, `context`, `metadata` | Gap report / notes surfaces via `ApprovalPanel` / `ApprovalGateModal` |
| Decisions | `approved` \| `rejected` \| `needs_clarification` via existing resolve APIs |

### WorkflowDefinition (execution snapshot)
Loaded for Live topology via `getRunDefinition(runId)` when available so draft edits after start do not rewrite the observed graph.

---

## Client-Only Entities

### EditorMode

```text
EditorMode = "design" | "live"
```

| Transition | Trigger | Effect |
| :--- | :--- | :--- |
| `design → live` | Run success, or URL with `runId` | `useRunStore.load` + `attach`; freeze design mutations; show tray/inspector/approval overlays |
| `live → design` | Exit Live control | Detach/clear or keep run store cleared; remove `runId` from URL; restore palette/properties/drag |
| `live → live` (swap) | New Run while Live, or Retry | Confirm if needed; `clear` + attach new `runId`; update URL |

**Invariant**: `runId` present in studio URL ⇒ Live mode. Absence ⇒ Design (default).

### CanvasNodeLiveStatus

```text
CanvasNodeLiveStatus =
  | "idle"
  | "running"
  | "waiting_human"
  | "completed"
  | "failed"
  | "skipped"
```

**Derivation rules** (display-only; see `research.md` Decision 3):

1. Build chronological event list for each `nodeId`.
2. Apply last decisive status-changing event.
3. If approval requested for node and still `requested`, force `waiting_human`.
4. If branch skip associates to node and no later success/fail, `skipped`.
5. Default `idle`.

**Validation**: Status never invents success without a completing event; disconnect shows stale last-known projection plus stream status banner.

### TraversedConnection

| Field | Type | Notes |
| :--- | :--- | :--- |
| `edgeId` | string | From `edge.traversed` payload |
| `kind` / `branchKey` | from definition edge | Drives normal vs conditional visual theme |
| `animated` | boolean | `true` while Live and edge in traversed set (may remain emphasized after completion) |

### NodeExecutionView

Per-node inspector model derived from filtered events + run:

| Field | Description |
| :--- | :--- |
| `nodeId` | Selected node |
| `liveStatus` | `CanvasNodeLiveStatus` |
| `input` | Best-effort from `node.started` / `state.updated` / run input association when present in payloads |
| `startedAt` / `completedAt` / `durationMs` | From first start + terminal event timestamps |
| `attemptCount` | Count of `node.started` / `node.retrying` for node |
| `stepIndex` | Ordinal among `node.started` in run sequence when computable |
| `streamChunks` | Ordered agent/llm output fragments for live append |
| `toolCalls` | Nested `{ toolId?, arguments?, result?, status, events[] }` |
| `result` | Final `NodeResultEnvelope` if present in completed payload / diagnostics |
| `error` | Terminal error string / contract violation details |
| `approval` | Linked `ApprovalRequest` if any |

**Invariant**: Inspector updates for streams must not require remounting React Flow.

### LiveRunTrayState

| Field | Description |
| :--- | :--- |
| `collapsed` | Operator preference (session-local OK) |
| `runStatus` | From `Run.status` |
| `elapsedMs` | Computed |
| `stepCurrent` / `stepMax` | Projection vs `maxExecutionSteps` (default 1000) |
| `streamStatus` | `connecting` \| `live` \| `error` \| `closed` from run store |
| `eventFilter` | `all` \| `node` \| `error` \| `tool` |
| `actions` | Cancel enabled when non-terminal; Retry when `failed` |

### StudioLiveSession (orchestrator state)

Suggested home: thin slice in editor (local React state or small Zustand store), **not** mutating workflow history:

| Field | Description |
| :--- | :--- |
| `mode` | `EditorMode` |
| `attachedRunId` | Current observation target |
| `selectedInspectNodeId` | Inspector selection |
| `liveDefinition` | Snapshot used for RF topology in Live |
| `tray` | `LiveRunTrayState` |

---

## Relationships

```text
StudioLiveSession 1──attach──▶ Run
Run 1──emits──▶ RunEvent*
Run 1──has──▶ ApprovalRequest*
RunEvent* ──project──▶ CanvasNodeLiveStatus / TraversedConnection
RunEvent* (filtered by nodeId) ──project──▶ NodeExecutionView
ApprovalRequest.nodeId ──highlights──▶ canvas node
WorkflowDefinition (snapshot) ──renders──▶ FlowCanvas topology in Live
```

---

## State Lifecycles

### Observed Run (UI)

```text
detached → loading → live_streaming → terminal_idle
                ↘ error_reconnect ↗
```

- `terminal_idle`: run completed/failed/cancelled; SSE closed; inspector/tray still readable.
- Exit Live ⇒ `detached` (store cleared or retained until next attach—prefer clear on exit to avoid leaking events into Design).

### Approval (UI)

```text
none → banner_visible (requested) → submitting → resolved_hidden | error_retry
```

Duplicate submit blocked when status ≠ `requested`.

---

## Validation / Invariants

1. Client never asserts run terminal status without corresponding run events or `getRun` refresh.
2. Design store (`useWorkflowStore`) history must not record Live-only UI selections.
3. Deep link requires authorized access to both workflow and run within tenant (existing BFF gates).
4. Retry creates a **new** run id; session must retarget attachment and URL.
