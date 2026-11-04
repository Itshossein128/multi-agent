# Tasks: In-Canvas Live Execution & Observability

**Input**: Design documents from `specs/011-canvas-live-observability/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`)  
**Prerequisites**: `plan.md` (required), `spec.md` (user stories P1–P2), `research.md`, `data-model.md`, `contracts/`  
**Approach**: Test-Driven Development (TDD) — all test tasks MUST be written first and fail before implementing the corresponding feature code. User requested TDD via `/speckit-tasks Use TDD`.

**Tests note**: Include failing tests first in each story phase; confirm red, then implement to green.

---

## Phase 1: Setup (Shared Contracts & Scaffold)

**Purpose**: Land shared Live-mode contracts and empty module scaffolds so tests and stories share stable import paths.

- [X] T001 Copy/align UI Live contracts into the web app type surface by exporting shared aliases from `specs/011-canvas-live-observability/contracts/ui-live-canvas.contract.ts` into `apps/web/src/components/workflow/live/liveCanvas.types.ts` (`EditorMode` = `"design" | "live"`; `CanvasNodeLiveStatus` = `"idle" | "running" | "waiting_human" | "completed" | "failed" | "skipped"`; `LiveTrayEventFilter` = `"all" | "node" | "error" | "tool"`; `StudioLiveQuery`, `NodeExecutionView`, `LiveRunTrayModel`)
- [X] T002 [P] Create empty scaffold modules (export stubs that throw or return empty maps) at `apps/web/src/lib/runCanvasProjection.ts`, `apps/web/src/components/workflow/live/useLiveCanvasSession.ts`, `apps/web/src/components/workflow/live/NodeExecutionInspector.tsx`, `apps/web/src/components/workflow/live/LiveRunTray.tsx`, and `apps/web/src/components/workflow/live/LiveApprovalBanner.tsx`
- [X] T003 [P] Verify monorepo typecheck still clean via `npx tsc --noEmit` after scaffolds

---

## Phase 2: Foundational (Projection + Live Session — Blocks All Stories)

**Purpose**: Pure run→canvas projection helpers and Live session orchestration (mode, attach, URL sync, Design freeze). Must be complete before any user-story UI work.

> **CRITICAL**: No user story implementation can begin until this foundational phase is complete.

### Tests for Foundation (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T004 [P] Author unit tests in `tests/runCanvasProjection.test.ts` for `projectRunCanvas` / status mapping covering:
  - Default `idle` when no events for a node
  - `running` from `node.started` | `node.retrying` | `agent.started` | `llm.started` | `tool.started`
  - `waiting_human` from `human_approval.requested` and/or run `status: "waiting_for_human"` with matching `nodeId` / `currentNodeId`
  - `completed` from `node.completed` (and agent/tool completed when decisive)
  - `failed` from `node.failed` | `agent.failed` | `tool.failed` | `llm.failed`
  - `skipped` from `branch.skipped` association
  - `traversedEdgeIds` accumulates `edge.traversed` payload `edgeId` strings
  - `isStatusChangingEvent` returns false for high-frequency stream-only noise that must not force full-graph identity churn (document which types are excluded)
- [X] T005 [P] Author unit tests in `tests/liveCanvasSession.test.ts` for Live session helpers verifying:
  - `runId` present in studio query ⇒ `mode === "live"`; absence ⇒ `"design"`
  - `enterLive(runId)` / `exitLive()` transitions and clearing `runId` from query builders
  - `isDesignMutationAllowed("live") === false` and `isDesignMutationAllowed("design") === true` per `contracts/ui-live-canvas.contract.ts`
  - Retry retarget: new `runId` replaces `attachedRunId`

### Implementation for Foundation

- [X] T006 Implement pure projection API in `apps/web/src/lib/runCanvasProjection.ts`: `projectRunCanvas`, `buildNodeExecutionView` (minimal stub OK until US3), `isStatusChangingEvent`, `filterTrayEvents`, `edgeLiveStyle` matching `RunCanvasProjectionApi` in `specs/011-canvas-live-observability/contracts/ui-live-canvas.contract.ts` and rules in `specs/011-canvas-live-observability/data-model.md` (`CanvasNodeLiveStatus` enum values exact)
- [X] T007 Implement `useLiveCanvasSession` in `apps/web/src/components/workflow/live/useLiveCanvasSession.ts` wiring `useRunStore.load` / `attach` / `clear`, `runService.getRunDefinition` with sessionStorage `run-definition:${runId}` fallback, and studio URL sync for `StudioLiveQuery` (`workflowId`, `runId`, `focusNode`)
- [X] T008 Run foundational suites green: `pnpm test --runInBand -- tests/runCanvasProjection.test.ts tests/liveCanvasSession.test.ts`

**Checkpoint**: Foundation ready — projection + session contracts verified. User story implementation can begin.

---

## Phase 3: User Story 1 — Run Without Leaving the Canvas (Priority: P1) 🎯 MVP

**Goal**: Clicking Run starts a run, enters Live mode on the same React Flow studio canvas (no redirect to `/runs/[runId]`), supports Exit Live → Design, and deep-links via `/org?workflowId=&runId=`. Standalone run page remains usable.

**Independent Test**: Start a run from the editor toolbar; confirm URL stays on `/org` with `runId`; Live mode active; Exit Live restores Design; open `/org?workflowId=&runId=` for an existing run; open `/runs/{runId}` bookmark still works.

### Tests for User Story 1 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T009 [P] [US1] Author tests in `tests/editorToolbarLiveRun.test.tsx` verifying Run calls `runService.startRun`, does **not** navigate to `/runs/{runId}` as primary path, invokes `enterLive(runId)`, and persists `sessionStorage` key `run-definition:${runId}`
- [X] T010 [P] [US1] Author tests in `tests/workflowEditorLiveMode.test.tsx` verifying:
  - `mode === "live"` hides/disables NodePalette drop + PropertiesPanel edit path and sets canvas non-draggable/non-connectable
  - Exit Live control restores Design affordances and clears `runId` from query
  - Mount with `?workflowId=&runId=` calls `attachExistingRun`
- [X] T011 [P] [US1] Author tests in `tests/runPageCanvasLink.test.tsx` verifying standalone `apps/web/src/app/(authenticated)/o/[orgSlug]/runs/[runId]/page.tsx` still renders and exposes an “Open on canvas” link to `/org?workflowId={run.workflowId}&runId={runId}`

### Implementation for User Story 1

- [X] T012 [US1] Update `apps/web/src/components/workflow/EditorToolbar.tsx` to enter Live via `useLiveCanvasSession.enterLive` after `runService.startRun` instead of `router.push(orgUrl(\`/runs/${runId}\`))`; add Exit Live / Back to Editor control when `mode === "live"`
- [X] T013 [US1] Update `apps/web/src/components/workflow/WorkflowEditor.tsx` to read `runId` from search params, call `attachExistingRun` on load, gate Design UI when Live (`isDesignMutationAllowed`), and keep `FlowCanvas` mounted across mode switches
- [X] T014 [US1] Update `apps/web/src/components/workflow/FlowCanvas.tsx` to accept Live flags (`nodesDraggable={!live}`, disable connect/delete mutations when Live) without requiring status chrome yet
- [X] T015 [US1] Add “Open on canvas” link on `apps/web/src/app/(authenticated)/o/[orgSlug]/runs/[runId]/page.tsx` targeting studio deep link; keep existing RuntimeGraph/timeline functional
- [X] T016 [US1] Run US1 suites green: `pnpm test --runInBand -- tests/editorToolbarLiveRun.test.tsx tests/workflowEditorLiveMode.test.tsx tests/runPageCanvasLink.test.tsx`

**Checkpoint**: MVP — operators can run and observe attachment without leaving the studio canvas.

---

## Phase 4: User Story 2 — Live Path & Node Status on the Graph (Priority: P1)

**Goal**: Traversed edges animate/glow; nodes show idle / running / waiting_human / completed / failed / skipped chrome from projection.

**Independent Test**: Run a multi-branch workflow; verify traversed edges emphasize and nodes update through active → completed (and failed/skipped where applicable) without leaving the canvas.

### Tests for User Story 2 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T017 [P] [US2] Extend `tests/runCanvasProjection.test.ts` with fixtures for multi-edge traversal + conditional vs normal `edge.kind` styling via `edgeLiveStyle`
- [X] T018 [P] [US2] Author component tests in `tests/workflowLiveNodeChrome.test.tsx` verifying `WorkflowNodes` / `NodeShell` apply distinct treatments for each `CanvasNodeLiveStatus` value (`idle`, `running`, `waiting_human`, `completed`, `failed`, `skipped` with dimmed opacity for skipped)
- [X] T019 [P] [US2] Author component tests in `tests/workflowLiveEdgeChrome.test.tsx` verifying traversed edges set animated/glow presentation in `apps/web/src/components/workflow/edges/WorkflowEdge.tsx`

### Implementation for User Story 2

- [X] T020 [US2] Merge `projectRunCanvas` output into `rfNodes` / `rfEdges` memos in `apps/web/src/components/workflow/FlowCanvas.tsx`, depending only on status-changing events (not every token)
- [X] T021 [US2] Extend `WorkflowNodeData` in `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx` with `LiveWorkflowNodeDataFields` (`liveStatus`, `liveErrorCode`, `waitingApproval`) and render status rings/badges/spinner/checkmark/alert/skipped chip on `NodeShell`
- [X] T022 [US2] Update `apps/web/src/components/workflow/edges/WorkflowEdge.tsx` to honor `traversed` / `liveAnimated` and branch theme (normal vs conditional)
- [X] T023 [US2] Run US2 suites green: `pnpm test --runInBand -- tests/runCanvasProjection.test.ts tests/workflowLiveNodeChrome.test.tsx tests/workflowLiveEdgeChrome.test.tsx`

**Checkpoint**: Spatial live feedback visible on the design graph.

---

## Phase 5: User Story 3 — In-Place Node Execution Inspector (Priority: P1)

**Goal**: In Live mode, clicking a node opens a slide-over inspector (canvas stays mounted) showing input, timing/attempts, live streams/thoughts, tool calls, result envelope, and errors.

**Independent Test**: During/after a run, click an agent node; verify inspector shows input, timing, streamed content and/or tools, and final result or error while the canvas remains visible.

### Tests for User Story 3 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T024 [P] [US3] Author unit tests in `tests/nodeExecutionView.test.ts` for `buildNodeExecutionView` verifying:
  - `attemptCount` counts `node.started` / `node.retrying`
  - `streamText` / `thoughtsText` append from `llm.*` / `agent.*` payloads without requiring page reload semantics
  - `toolCalls[]` nests arguments/results from `tool.started|completed|failed`
  - `result` maps `NodeResultEnvelope` when present; `error` / contract violation on failure
  - Inspector-only updates: status-changing vs stream event split documented in assertions
- [X] T025 [P] [US3] Author component tests in `tests/nodeExecutionInspector.test.tsx` verifying slide-over renders sections (Input, Timing, Stream, Tools, Result, Error) and closes without unmounting a mocked canvas host

### Implementation for User Story 3

- [X] T026 [US3] Complete `buildNodeExecutionView` in `apps/web/src/lib/runCanvasProjection.ts` per `NodeExecutionView` in `apps/web/src/components/workflow/live/liveCanvas.types.ts` / contract
- [X] T027 [US3] Implement `apps/web/src/components/workflow/live/NodeExecutionInspector.tsx` using `ReadableContent` from `apps/web/src/components/runs/ReadableContent.tsx` where useful; subscribe to filtered events for `selectedInspectNodeId` only
- [X] T028 [US3] Wire Live node click in `apps/web/src/components/workflow/FlowCanvas.tsx` / `WorkflowEditor.tsx` to `selectInspectNode` instead of Design PropertiesPanel; mount inspector slide-over beside canvas
- [X] T029 [US3] Run US3 suites green: `pnpm test --runInBand -- tests/nodeExecutionView.test.ts tests/nodeExecutionInspector.test.tsx`

**Checkpoint**: Per-node evidence inspectable without leaving the graph.

---

## Phase 6: User Story 4 — In-Canvas Human Approval & Clarification (Priority: P2)

**Goal**: On `approval.requested` / waiting human, show in-canvas banner + highlight approval node; authorized reviewers submit Approve / Reject / Clarification with notes via existing APIs without full page reload.

**Independent Test**: Run a gated workflow; from Live mode submit Approve with notes; confirm run resumes and canvas status updates without navigation away.

### Tests for User Story 4 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T030 [P] [US4] Author tests in `tests/liveApprovalBanner.test.tsx` verifying banner appears when any `ApprovalRequest.status === "requested"`, highlights `nodeId`, and hides when resolved
- [X] T031 [P] [US4] Author integration tests in `tests/liveApprovalResolve.test.ts` verifying canvas actions call `runService.resolveApproval(runId, approvalId, decision, response?)` for `approved` | `rejected` | `needs_clarification` and block duplicate submit when status ≠ `requested`

### Implementation for User Story 4

- [X] T032 [US4] Implement `apps/web/src/components/workflow/live/LiveApprovalBanner.tsx` hosting/reusing `apps/web/src/components/runs/ApprovalPanel.tsx` and `apps/web/src/components/workflow/ApprovalGateModal.tsx`
- [X] T033 [US4] Ensure `waitingApproval` / `waiting_human` projection highlights approval nodes in `FlowCanvas` / `WorkflowNodes`; mount banner in `WorkflowEditor.tsx` Live overlays
- [X] T034 [US4] Wire clarification path through existing `runService.getRunClarification` / `submitRunClarification` when decision is `needs_clarification` (no new auth model)
- [X] T035 [US4] Run US4 suites green: `pnpm test --runInBand -- tests/liveApprovalBanner.test.tsx tests/liveApprovalResolve.test.ts`

**Checkpoint**: HITL decisions completable entirely from Live mode.

---

## Phase 7: User Story 5 — Bottom Mini-Timeline & Run Controls (Priority: P2)

**Goal**: Collapsible bottom tray with run status badge, elapsed time, step budget (`step X / max` where max is `definition.archetypeConfig?.maxExecutionSteps` defaulting to `1000`), Cancel, Retry-on-failure, and filterable event feed (`all` | `node` | `error` | `tool`).

**Independent Test**: Enter Live mode; collapse/expand tray; cancel a running workflow; filter feed to Errors; on failed run, Retry attaches new `runId` on canvas.

### Tests for User Story 5 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T036 [P] [US5] Author unit tests in `tests/liveRunTrayModel.test.ts` for tray model builders: status badge uses `RunStatus` enum values (`queued` | `running` | `waiting_for_human` | `completed` | `failed` | `cancelled`); `filterTrayEvents` respects `LiveTrayEventFilter`; `stepMax` defaults to `1000` when unset; `canCancel` / `canRetry` rules
- [X] T037 [P] [US5] Author component tests in `tests/liveRunTray.test.tsx` verifying collapse toggle, Cancel invokes `runService.cancelRun`, Retry invokes `runService.retryRun` and session retargets to new `runId`

### Implementation for User Story 5

- [X] T038 [US5] Implement `filterTrayEvents` + tray view-model helpers in `apps/web/src/lib/runCanvasProjection.ts` (or adjacent `apps/web/src/lib/liveRunTray.ts`) per `LiveRunTrayModel`
- [X] T039 [US5] Implement `apps/web/src/components/workflow/live/LiveRunTray.tsx` (compact feed; reuse labeling patterns from `apps/web/src/components/runs/ExecutionTimeline.tsx` without requiring full timeline layout)
- [X] T040 [US5] Mount tray in `WorkflowEditor.tsx` Live mode; wire Cancel/Retry through `useLiveCanvasSession` + `runService`; show `streamStatus` (`connecting` | `live` | `error` | `closed`)
- [X] T041 [US5] Run US5 suites green: `pnpm test --runInBand -- tests/liveRunTrayModel.test.ts tests/liveRunTray.test.tsx`

**Checkpoint**: Run controls and compact timeline available without leaving the canvas.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Performance, docs, and quickstart validation across stories.

- [X] T042 [P] Add performance-oriented unit assertions or documented coalescing (16–50ms) for status map commits under bursty tool events in `apps/web/src/lib/runCanvasProjection.ts` / session hook; ensure inspector stream subscription stays node-scoped (FR-013 / SC-005)
- [X] T043 [P] Update operator-facing notes in `docs/visual-platform-recommendations.md` (Finding 1 / related) and/or `docs/development.md` describing Design|Live and `runId` deep links
- [X] T044 Run `specs/011-canvas-live-observability/quickstart.md` automated commands: `pnpm test --runInBand -- tests/runCanvasProjection.test.ts tests/runTimeline.test.ts` plus `pnpm --filter web build`
- [X] T045 Manual smoke checklist from `quickstart.md` sections A–G (Run stays on canvas, statuses, inspector, deep link, bookmark, approval, tray) and record results in PR description
- [X] T046 Final regression: `pnpm test --runInBand` for touched suites and `npx tsc --noEmit`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Setup — **BLOCKS** all user stories
- **Phase 3 (US1)**: Depends on Foundational — MVP
- **Phase 4 (US2)**: Depends on Foundational; integrates with US1 Live shell (canvas mounted in Live)
- **Phase 5 (US3)**: Depends on Foundational; best after US1 click routing exists (can stub selection)
- **Phase 6 (US4)**: Depends on Foundational; benefits from US2 waiting_human chrome
- **Phase 7 (US5)**: Depends on Foundational; benefits from US1 session attach
- **Phase 8 (Polish)**: After desired stories complete

### User Story Dependencies

| Story | Priority | Depends on | Independently testable? |
| :--- | :---: | :--- | :---: |
| US1 Run on canvas | P1 | Foundation | Yes — mode/URL/attach without status chrome |
| US2 Live chrome | P1 | Foundation (+ US1 shell preferred) | Yes — projection + node/edge chrome with mocked events |
| US3 Inspector | P1 | Foundation (+ US1 selection preferred) | Yes — view builder + inspector component |
| US4 Approvals | P2 | Foundation (+ US2 highlight preferred) | Yes — banner + resolve API wiring |
| US5 Tray | P2 | Foundation (+ US1 session preferred) | Yes — tray model + Cancel/Retry |

### Within Each User Story

1. Write tests → confirm **FAIL**
2. Implement → confirm **GREEN**
3. Checkpoint before next story

### Parallel Opportunities

- T001–T003 setup can parallelize after contracts path chosen
- T004 ∥ T005 foundation tests
- After Phase 2: US1/US2/US3 test authoring can proceed in parallel on different files
- US4 and US5 can proceed in parallel once Live shell exists (US1)
- T042 ∥ T043 in polish

---

## Parallel Example: User Story 1

```bash
# TDD tests first (parallel):
Task: "tests/editorToolbarLiveRun.test.tsx"
Task: "tests/workflowEditorLiveMode.test.tsx"
Task: "tests/runPageCanvasLink.test.tsx"

# Then implementation (sequential where same files conflict):
Task: "EditorToolbar.tsx enterLive"
Task: "WorkflowEditor.tsx mode + URL"
Task: "FlowCanvas.tsx Live interaction gates"
Task: "runs/[runId]/page.tsx Open on canvas"
```

---

## Parallel Example: User Story 2

```bash
Task: "Extend tests/runCanvasProjection.test.ts edge fixtures"
Task: "tests/workflowLiveNodeChrome.test.tsx"
Task: "tests/workflowLiveEdgeChrome.test.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup  
2. Phase 2 Foundational (projection + session) — TDD  
3. Phase 3 US1 — TDD  
4. **STOP and VALIDATE** per quickstart A + E  
5. Demo: Run stays on canvas  

### Incremental Delivery

1. US1 → stay on canvas  
2. US2 → live path/status  
3. US3 → inspector  
4. US4 → approvals  
5. US5 → tray  
6. Polish + full quickstart  

### Parallel Team Strategy

1. Team completes Setup + Foundational together  
2. Dev A: US1 → US5 tray  
3. Dev B: US2 chrome → US4 approvals  
4. Dev C: US3 inspector + projection view builders  

---

## Notes

- [P] = different files, no incomplete-task dependency
- [USn] required on story-phase tasks only
- Every task includes an exact file path
- Do not redirect Run to `/runs/[runId]` as primary path (FR-002)
- Client remains control plane only — use `runService` / existing BFF (FR-012 / FR-015)
- `CanvasNodeLiveStatus` and `RunStatus` enum values are quoted constraints from `data-model.md` / `@multi-agent/types` — do not invent alternate labels in UI logic
- Commit after each task or logical TDD red/green pair
- Suggested MVP scope: **US1 only** after Foundational

---

## Phase 9: Convergence

**Purpose**: Close remaining gaps between shipped code and spec/plan/edge-case intent after `/speckit-implement`. Appended by `/speckit-converge` on 2026-11-04. Do not renumber prior tasks.

- [X] T047 HIGH: Gate Live canvas topology on a loaded run snapshot in `apps/web/src/components/workflow/FlowCanvas.tsx` and `apps/web/src/components/workflow/live/useLiveCanvasSession.ts` (show loading/empty while `liveDefinition` is null; never silently render the current draft as the observed run graph) per Edge: live uses run snapshot / FR-014 (partial)
- [X] T048 HIGH: Fix duplicate/blocked approval UX so `apps/web/src/components/runs/ApprovalPanel.tsx` and `apps/web/src/components/workflow/live/LiveApprovalBanner.tsx` / `liveApprovalActions.ts` only mark “submitted” after a successful `runService.resolveApproval`, and surface a clear “already resolved / not actionable” message when resolve is rejected per Edge: duplicate approval blocked (contradicts)
- [X] T049 MEDIUM: Enable an explicit new-run-from-Live path in `apps/web/src/components/workflow/EditorToolbar.tsx` that confirms replacing the attached run, calls `runService.startRun`, then retargets via `enterLive` per Edge: Run while already in Live (partial)
- [X] T050 [P] LOW: Rewrite Finding 1 in `docs/visual-platform-recommendations.md` so it no longer documents Run→`/runs/[runId]` canvas abandonment as current architecture; reflect shipped Design\|Live on-canvas behavior per plan:T043 (contradicts)
- [X] T051 [P] LOW: Add a component/unit assertion in `tests/liveRunTray.test.tsx` that when `streamStatus === "error"` the tray shows the recoverable connection/reconnect message without inventing step outcomes per Edge: SSE disconnect recovery UI (partial)
