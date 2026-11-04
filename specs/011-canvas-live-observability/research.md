# Research: In-Canvas Live Execution & Observability

**Feature Branch**: `011-canvas-live-observability`  
**Date**: 2026-11-04  
**Status**: Completed  

---

## Executive Summary

The studio already has authenticated run control (`runService`), SSE attachment (`useRunStore.attach` / `createRunEventStream`), timeline merge (`runTimeline`), and reusable approval/timeline UI (`ApprovalPanel`, `ApprovalGateModal`, `ExecutionTimeline`). The gap is navigation and visualization: **Run redirects to `/runs/[runId]`**, where topology is a non–React Flow `RuntimeGraph`. This feature keeps operators on `/org` React Flow canvas in a dual **Design | Live** mode, injecting observed status into existing node/edge shells and docking inspector + tray overlays—without changing execution authority.

All Technical Context unknowns are resolved below.

---

## Technical Decisions & Rationale

### Decision 1: Stay on `/org` with `runId` query (no new route)

#### Problem
`EditorToolbar` calls `runService.startRun` then `router.push(orgUrl(\`/runs/${runId}\`))`, abandoning `FlowCanvas`.

#### Alternatives Considered
1. **Replace RuntimeGraph with React Flow on `/runs/[runId]`** — Improves the run page but still breaks authoring context and dual Design|Live editing.
2. **New `/studio/live/[runId]` route** — Extra surface to maintain; splits definition editing from observation.
3. **Remain on `/o/{slug}/org?workflowId=&runId=` + local mode** (Selected) — Enter Live after start; sync `runId` (and optional `mode=live`) into the studio URL; Exit Live clears `runId` / mode and restores Design.

#### Rationale
- Matches FR-002/FR-004 and existing studio query pattern (`workflowId`, `focusNode`).
- Reuses `WorkflowEditor` composition; standalone `/runs/[runId]` stays for bookmarks (FR-005) with an optional “Open on canvas” link.

---

### Decision 2: Derive canvas live state from `useRunStore.events` (client projection)

#### Problem
React Flow nodes/edges today carry only design data (`node`, `agent`, `tool`, issues). Spec needs idle/running/waiting/completed/failed/skipped + traversed edges.

#### Alternatives Considered
1. **Server pushes precomputed canvas patches** — New API surface; unnecessary given existing event stream.
2. **Per-token Zustand updates mutating every RF node** — Risks full-graph re-renders and FPS loss (FR-013).
3. **Pure projection helpers + narrow subscriptions** (Selected) — Extract shared reducers (from run page heuristics) into `lib/runCanvasProjection.ts`:
   - `deriveNodeLiveStatus(events) → Map<nodeId, CanvasNodeLiveStatus>`
   - `deriveTraversedEdgeIds(events) → Set<edgeId>`
   - `buildNodeExecutionView(nodeId, events, run) → NodeExecutionView`
   - Canvas memo merges projection into `rfNodes`/`rfEdges` `data`; token/stream text lives only in inspector context subscribed to filtered events for the selected node.

#### Rationale
- Preserves browser-as-control-plane (FR-012): projection is display-only.
- Matches current run page last-event-per-nodeId + `edge.traversed` pattern, upgraded to a stable status enum for shells.
- Localizes high-frequency `llm.*` / agent output updates away from graph memo deps.

---

### Decision 3: Canvas node status enum mapping

#### Mapping (last decisive event wins per `nodeId`; skipped via branch/edge association)

| Canvas status | Primary event signals |
| :--- | :--- |
| `idle` | No events for node |
| `running` | `node.started`, `node.retrying`, `agent.started`, `llm.started`, `tool.started` (and non-terminal while run active) |
| `waiting_human` | `human_approval.requested`, or run `waiting_for_human` / `run.paused` with `currentNodeId` / approval `nodeId` |
| `completed` | `node.completed`, `agent.completed`, `tool.completed` (terminal success for that node) |
| `failed` | `node.failed`, `agent.failed`, `tool.failed`, `llm.failed` |
| `skipped` | `branch.skipped` targeting the node/branch, or explicit skip payload association |

Event type strings remain the source of truth in `RunEventType` (`packages/types`); the enum is UI-only.

---

### Decision 4: Freeze Design mutations in Live mode

#### Problem
FR-014: operators must not believe Live edits change the in-flight run.

#### Decision
While `mode === "live"`:
- Disable palette drop, connect, delete, node drag, and PropertiesPanel edits.
- Node click opens **Node Execution Inspector** instead of design properties.
- Exit Live restores Design interactions on the **current draft** in `useWorkflowStore`.
- Live topology prefers `runService.getRunDefinition(runId)` (execution snapshot) when available; fall back to sessionStorage `run-definition:${runId}` then current draft—matching run page behavior.

---

### Decision 5: Reuse approval stack; extend clarification on canvas

#### Problem
Spec requires Approve / Reject / Clarification from canvas. Run page uses `ApprovalPanel` → `ApprovalGateModal` for gap-report gates; clarification paths exist on `runService` but are unevenly wired vs task UI.

#### Decision
- Mount `ApprovalPanel` (or thin Live banner wrapper) in `WorkflowEditor` Live overlays.
- Keep `resolveApproval` / `ApprovalGateModal` as the authority path.
- Wire run clarification submit through existing `runService.getRunClarification` / `submitRunClarification` when decision is Needs Clarification—no new authorization model.

---

### Decision 6: Bottom tray vs full ExecutionTimeline

#### Problem
FR-011 wants a collapsible compact feed (Node / Error / Tool), not necessarily the full run-page timeline layout.

#### Decision
- New `LiveRunTray` docks under the canvas in Live mode.
- Reuse filtering/label patterns from `ExecutionTimeline` / `ReadableContent` where practical; keep tray compact (horizontal/collapse).
- Cancel → `runService.cancelRun`; Retry → `runService.retryRun` then re-attach to new `runId` and update URL (same as run page).
- Elapsed time from `run.startedAt` vs now/`completedAt`.
- Step budget: count decisive `node.started` (or documented step events) vs `definition.archetypeConfig?.maxExecutionSteps ?? 1000` (or run metadata if present)—display-only.

---

### Decision 7: Standalone run page compatibility

#### Decision
- Keep `/runs/[runId]` functional (FR-005 / SC-006).
- Add “Open on canvas” → `/org?workflowId={run.workflowId}&runId={runId}` (and Live mode).
- Do **not** hard-redirect bookmarks away from the run page in v1 (avoids surprising existing operators); studio becomes the preferred path from **Run** in the editor only.

---

### Decision 8: Performance strategy for FR-013 / SC-005

1. Graph status projection updates on **status-changing** event types (node/edge/approval/run lifecycle), not every token.
2. Selected-node inspector subscribes to a filtered event slice / local buffer for streams.
3. Optional short debounce (e.g. 16–50ms coalescing) for status map commits under bursty tool events.
4. React Flow: `nodesDraggable={false}`, avoid replacing node identity arrays unnecessarily; keep `id` stable and patch `data.liveStatus` / `animated`.

---

## Resolved Technical Context

| Item | Resolution |
| :--- | :--- |
| Language | TypeScript 5.7 / Node 20+ |
| UI stack | Next.js 16 App Router, React 19, `@xyflow/react`, Zustand, Tailwind |
| Live transport | Existing SSE `EventSource` via `createRunEventStream` + BFF `/api/execution` |
| Storage | No new tables; reuse `RunStore` / existing APIs |
| Testing | Jest root tests for projection helpers; component tests; Playwright optional for e2e smoke |
| Performance | Status projection decoupled from token stream; canvas remains interactive |
| Scope | Primarily `apps/web` + shared projection tests; minimal/no server schema change |

---

## Open Implementation Notes (non-blocking)

- Exact skip association for `branch.skipped` → node set should follow server payload conventions already emitted; document in projection tests with fixtures from existing run events.
- Whether `mode=live` is redundant when `runId` is present: prefer **`runId` implies Live**; Exit Live removes `runId` from the query.
