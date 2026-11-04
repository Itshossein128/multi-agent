# Tasks: Canvas Routing Usability

**Input**: Design documents from `specs/015-canvas-routing-usability/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`)  
**Prerequisites**: `plan.md` (required), `spec.md` (user stories P1–P3), `research.md`, `data-model.md`, `contracts/`  
**Tests**: Spec/quickstart require automated gates (addEdge semantics, hierarchical scaffold validation, layout/undo, legacy load). Include focused verification tests per story (not full TDD-red-first unless later requested).  
**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and demoed independently.  
**Setup note**: `setup-tasks.ps1` could not run (`pwsh` missing); paths resolved from `.specify/feature.json` (`specs/015-canvas-routing-usability`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`US1`…`US6`)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Contracts Alignment)

**Purpose**: Align feature contracts with implementation touchpoints before canvas/store/server work.

- [X] T001 Confirm feature docs present and linked: `specs/015-canvas-routing-usability/{plan,spec,research,data-model,quickstart}.md`, `contracts/`, `checklists/requirements.md`; keep `.specify/feature.json` pointing at `specs/015-canvas-routing-usability`
- [X] T002 [P] Align handle vocabulary in `specs/015-canvas-routing-usability/contracts/canvas-routing-handles.contract.ts` with `packages/types/src/approval.ts` `ApprovalDecision` (`"approved" | "rejected" | "needs_clarification"`)—document any import/export plan for shared constants (prefer reusing types; no schema bump)
- [X] T003 [P] Confirm Auto-Arrange and scaffold contracts match plan touchpoints: `specs/015-canvas-routing-usability/contracts/auto-arrange.contract.ts` (`actionId: "auto-arrange"`, Design-only, Undo recovery) and `specs/015-canvas-routing-usability/contracts/archetype-scaffold.contract.ts` (`HIERARCHICAL_EMPTY_CANVAS_CODES` = `MISSING_SUPERVISOR_HUB`, `MISSING_ROUTING_NODES`, `MISSING_APPROVAL_GATE`)

---

## Phase 2: Foundational (Shared Helpers — Blocks Story Implementation)

**Purpose**: Shared outcome-handle helpers and projection utilities so US1/US5/US2 share one vocabulary. No full Approval UI or scaffolds yet.

> **CRITICAL**: No user story implementation should begin until this foundational phase is complete.

- [X] T004 Add shared approval outcome handle helpers (export `APPROVAL_OUTCOME_HANDLES` / `isApprovalOutcomeHandle` / `edgeSemanticsFromSourceHandle` behavior) in `apps/web/src/lib/workflow/canvasRoutingHandles.ts` mirroring `specs/015-canvas-routing-usability/contracts/canvas-routing-handles.contract.ts` and reusing `ApprovalDecision` from `@multi-agent/types`
- [X] T005 [P] Add `projectApprovalSourceHandle(branchKey)` (return handle id when `branchKey` ∈ approved/rejected/needs_clarification; otherwise `undefined`; never clear bindings) in `apps/web/src/lib/workflow/canvasRoutingHandles.ts`
- [X] T006 [P] Typecheck after helper module: `pnpm --filter @multi-agent/types build` and root `npx tsc --noEmit` (or project-equivalent) with imports from `apps/web/src/lib/workflow/canvasRoutingHandles.ts` compiling cleanly

**Checkpoint**: Foundation ready — shared handle→edge semantics helpers exist. User story work can begin (prefer US1 MVP first).

---

## Phase 3: User Story 1 — Branch Approval Outcomes From Labeled Handles (Priority: P1) 🎯 MVP

**Goal**: Designers wire `approved` / `rejected` / `needs_clarification` from distinct labeled Approval handles; canvas gestures create correctly typed conditional edges without the edge properties panel.

**Independent Test**: Add an Approval node and downstream targets; connect from each outcome handle; each edge is `kind: "conditional"` with matching `branchKey`; panel was not required.

### Verification tests for User Story 1

- [X] T007 [P] [US1] Add `tests/canvasRoutingAddEdge.test.ts` covering: `addEdge` from approval sourceHandle `approved`/`rejected`/`needs_clarification` → `{ kind: "conditional", branchKey: <handle> }`; non-outcome/`out` from non-condition stays `normal` with empty `branchKey`; duplicate (source, target, kind, branchKey) still rejected
- [X] T008 [P] [US1] Extend or add assertion that `edgeSemanticsFromSourceHandle` in `apps/web/src/lib/workflow/canvasRoutingHandles.ts` matches contract table for approval + condition + other sources (can live in same `tests/canvasRoutingAddEdge.test.ts`)

### Implementation for User Story 1

- [X] T009 [US1] Extend `addEdge` in `apps/web/src/store/useWorkflowStore.ts` so `sourceNode.type === "approval"` + outcome `sourceHandle` sets `kind: "conditional"` and `branchKey: sourceHandle` (reuse helper from T004; keep condition behavior unchanged)
- [X] T010 [US1] Update `ApprovalNodeComponent` in `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx` to expose three source handles `approved`, `rejected`, `needs_clarification` with visible labels (or equivalent text) **and** distinct color/shape cues—not color-only; disable/default single happy-path `out` for new Approval branching (`showSource={false}` or custom shell)
- [X] T011 [US1] Map React Flow `sourceHandle` for approval-sourced edges in `apps/web/src/components/workflow/FlowCanvas.tsx` using `projectApprovalSourceHandle(edge.branchKey)` (in addition to existing condition `branchKey` mapping)
- [X] T012 [P] [US1] Confirm edge properties panel in `apps/web/src/components/workflow/properties/panels.tsx` still shows/edits `kind` and `branchKey` for power users (no requirement to use it for happy path; no deep redesign)
- [X] T013 [US1] Run US1 suite green: `pnpm test --runInBand -- tests/canvasRoutingAddEdge.test.ts`

**Checkpoint**: MVP — Approval outcome handles create compiler-valid conditional edges from canvas gestures.

---

## Phase 4: User Story 5 — Open Existing Workflows Without Breaking Branch Bindings (Priority: P1)

**Goal**: Legacy single-`out` approval wiring and pre-existing conditional `branchKey`s load and remain intact; no forced migration; no silent binding loss.

**Independent Test**: Load a fixture with approval/condition conditional edges from before outcome handles; edges retain kind/branchKey; new outcome-handle edges can be added without rewriting legacy edges.

### Verification tests for User Story 5

- [X] T014 [P] [US5] Add legacy load cases in `tests/canvasRoutingAddEdge.test.ts` (or `tests/canvasRoutingLegacyLoad.test.ts`): definition with approval source edges that already have `branchKey` in {approved,rejected,needs_clarification} round-trips without clearing keys; projection chooses matching handle id; unknown/empty conditional key is preserved (not dropped)
- [X] T015 [P] [US5] Add regression in `tests/canvasRoutingLegacyLoad.test.ts` (or `tests/canvasRoutingAddEdge.test.ts`) that opening/projecting via `apps/web/src/lib/workflow/canvasRoutingHandles.ts` / store load helpers does not rewrite persisted edge documents (compare serialized edges before/after)

### Implementation for User Story 5

- [X] T016 [US5] Harden projection in `apps/web/src/components/workflow/FlowCanvas.tsx` so legacy approval edges dock by `branchKey` when mappable and leave unmappable keys intact (no inventing keys; no clearing `branchKey`)
- [X] T017 [US5] Ensure `addEdge` / save paths never strip existing edge `branchKey`s when designers add new outcome-handle edges alongside legacy ones in `apps/web/src/store/useWorkflowStore.ts`
- [X] T018 [US5] Run US5 suites green: `pnpm test --runInBand --testPathPattern='canvasRouting'`

**Checkpoint**: Backward compatibility proven for representative legacy approval/condition bindings.

---

## Phase 5: User Story 2 — Connect Condition Branches Without Handle Collision (Priority: P1)

**Goal**: Condition (multi-branch) nodes present non-overlapping, labeled handles; branch identity stays visible on-canvas; connect still auto-binds `branchKey`.

**Independent Test**: Condition with ≥3 branches; each handle separately targetable; identity visible via chips and/or edge cues; connect binds correct branch without panel.

### Verification tests for User Story 2

- [X] T019 [P] [US2] Extend `tests/canvasRoutingAddEdge.test.ts` to assert condition `sourceHandle` → conditional `branchKey` still works for ≥3 distinct keys after UI change
- [X] T020 [P] [US2] Add a focused layout/structure assertion (unit or lightweight component test) that Condition branch handles are not all assigned the same colliding percentage stack—document expected chip-aligned structure in `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx` (e.g. one handle per labeled chip; no shared single `left` percentage for all)

### Implementation for User Story 2

- [X] T021 [US2] Refactor `ConditionNodeComponent` in `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx` to place each branch `Handle` (`id={branch.key}`) in/with its labeled chip (flex/wrap, non-overlapping hit targets); remove fragile `((index+1)/(n+1))*100%` stacking as the primary layout
- [X] T022 [P] [US2] Confirm `apps/web/src/components/workflow/edges/WorkflowEdge.tsx` continues to show conditional `branchKey` chips on-canvas (Design); fix only if labels missing after handle refactor
- [X] T023 [US2] Ensure zero configured branches yield no phantom overlapping handles in `ConditionNodeComponent` within `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx`
- [X] T024 [US2] Run US2-related tests green: `pnpm test --runInBand --testPathPattern='canvasRouting'`

**Checkpoint**: Multi-branch condition wiring is discoverable and hit-target safe.

---

## Phase 6: User Story 3 — Land on a Valid Hierarchical Supervisor Starter (Priority: P1)

**Goal**: Creating Hierarchical Supervisor pre-scaffolds a minimal valid starter (Input → Hub → Condition → Worker(s) → Approval → Output); first validation does not emit empty-canvas hub/routing/approval structural errors; graph remains fully editable.

**Independent Test**: Create hierarchical workflow; canvas non-empty; no immediate `MISSING_SUPERVISOR_HUB` / `MISSING_ROUTING_NODES` / `MISSING_APPROVAL_GATE`; delete a scaffold node freely.

### Verification tests for User Story 3

- [X] T025 [P] [US3] Add `tests/hierarchicalSupervisorScaffold.test.ts`: `scaffoldHierarchicalSupervisor(createEmptyDefinition(...))` (or create path) validates without `MISSING_SUPERVISOR_HUB`, `MISSING_ROUTING_NODES`, `MISSING_APPROVAL_GATE`; `supervisorHubNodeId` points at an agent node; ≥1 condition and (when gate required) ≥1 approval; prefer acyclic starter (no `UNGUARDED_CYCLE` on day-one scaffold)
- [X] T026 [P] [US3] Confirm EO/swarm scaffolds from `apps/server/src/api/studio/topologyScaffolds.ts` still pass existing `tests/topologyValidation.test.ts` cases (regression)

### Implementation for User Story 3

- [X] T027 [US3] Implement `scaffoldHierarchicalSupervisor` in `apps/server/src/api/studio/topologyScaffolds.ts` teaching Input → Supervisor Hub (agent) → Condition Router → Worker Agent(s) → Approval Gate → Output; set `archetype`/`archetypeConfig` via `createHierarchicalSupervisorConfig` with `supervisorHubNodeId` = hub id; `humanApprovalGateRequired` default true; **acyclic** starter preferred
- [X] T028 [US3] Wire `stampWorkflowArchetype` in `apps/server/src/api/studio/workflowService.ts` so `"hierarchical-supervisor"` returns `scaffoldHierarchicalSupervisor(definition)` instead of empty config-only stamp
- [X] T029 [P] [US3] Confirm create dialog path in `apps/web/src/components/workflow/CreateWorkflowDialog.tsx` / `apps/web/src/services/workflowService.ts` already passes archetype through create API (no new archetypes); fix only if hierarchical create does not receive scaffolded definition from server
- [X] T030 [US3] Run US3 suites green: `pnpm test --runInBand -- tests/hierarchicalSupervisorScaffold.test.ts tests/topologyValidation.test.ts`

**Checkpoint**: Hierarchical create lands on a teachable, structurally valid starter.

---

## Phase 7: User Story 4 — One-Click Auto-Arrange (Priority: P2)

**Goal**: Design-mode toolbar Auto-Arrange repositions nodes into a readable hierarchical layout without changing semantics; Undo restores prior positions.

**Independent Test**: Messy 8–15 node graph → Auto-Arrange → readable hierarchy; edge kinds/branchKeys unchanged; Undo restores layout; control disabled in Live.

### Verification tests for User Story 4

- [X] T031 [P] [US4] Add `tests/autoArrangeLayout.test.ts`: layout helper returns new positions for all nodes; does not mutate edge list/kind/branchKey; store `autoArrange` (or equivalent) pushes one history frame so `undo` restores prior positions

### Implementation for User Story 4

- [X] T032 [US4] Implement pure hierarchical TB layout helper in `apps/web/src/components/workflow/layout/autoArrange.ts` (zero-dep packer **or** `@dagrejs/dagre` if justified per research)—input nodes+edges, output positions only
- [X] T033 [US4] Add store action (e.g. `autoArrangeNodes`) in `apps/web/src/store/useWorkflowStore.ts` that `pushHistory()` once then applies positions via existing `moveNodes`/batch path; must not rewrite topology/configs/edge semantics
- [X] T034 [US4] Add **Auto-Arrange** control to `apps/web/src/components/workflow/EditorToolbar.tsx`: available in Design, disabled in Live; optional `fitView` after arrange
- [X] T035 [US4] Run US4 suite green: `pnpm test --runInBand -- tests/autoArrangeLayout.test.ts`

**Checkpoint**: One-click layout cleanup with Undo recovery.

---

## Phase 8: User Story 6 — Operators Read Branch Structure On Canvas (Priority: P3)

**Goal**: Approval/condition branch identity remains readable from canvas cues in Design and Live without opening the edge properties panel.

**Independent Test**: Open a graph with approval + condition branches; identify outcomes from handle labels and/or edge chips without selecting edges into the panel; cues remain in Live.

### Verification tests for User Story 6

- [X] T036 [P] [US6] Add/extend a lightweight assertion (unit or projection test) that conditional edges expose `branchKey` (or label) for on-canvas chips in Design and that Live projection does not strip edge label data used by `apps/web/src/components/workflow/edges/WorkflowEdge.tsx`

### Implementation for User Story 6

- [X] T037 [US6] Audit Design + Live path in `apps/web/src/components/workflow/FlowCanvas.tsx` and `apps/web/src/components/workflow/edges/WorkflowEdge.tsx` so approval/condition branch cues (handle labels + edge chips) remain visible; fix regressions only
- [X] T038 [P] [US6] Spot-check accessibility names on Approval outcome handles in `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx` (`aria-label` / title / visible text per `APPROVAL_HANDLE_AFFORDANCES` in `specs/015-canvas-routing-usability/contracts/canvas-routing-handles.contract.ts`)
- [X] T039 [US6] Run related suites green: `pnpm test --runInBand --testPathPattern='canvasRouting|autoArrange|hierarchicalSupervisorScaffold'`

**Checkpoint**: Branch structure readable without panel dependency in Design and Live.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Docs, quickstart validation, and regression sweep across stories.

- [X] T040 [P] Update `docs/visual-platform-recommendations.md` Finding 6 status to reflect shipped/in-progress canvas routing usability (handles, auto-arrange, hierarchical scaffold)—keep factual, no scope creep into Finding 5/7/8
- [X] T041 [P] Add a short note under Studio/canvas authoring in `docs/development.md` (or existing canvas section) pointing to Auto-Arrange + approval outcome handles behavior
- [X] T042 Run quickstart automated gates from `specs/015-canvas-routing-usability/quickstart.md`: `pnpm test --runInBand --testPathPattern='canvasRouting|autoArrange|hierarchicalSupervisorScaffold|createWorkflow|workflowArchetype|clientWorkflowValidation|topologyValidation'`
- [X] T043 [P] Typecheck/build: `pnpm exec tsc --noEmit`, `pnpm --filter @multi-agent/types build`, `pnpm --filter server build`, `pnpm --filter web build`
- [X] T044 Manual smoke checklist from quickstart sections A–E (Approval handles, Condition handles, Auto-Arrange+Undo, Hierarchical create, Legacy load)—record pass/fail in `specs/015-canvas-routing-usability/quickstart-results.md` if desired

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS** all user stories
- **US1 (Phase 3)**: After Foundational — **MVP**
- **US5 (Phase 4)**: After US1 projection/`addEdge` exist (builds on T011/T009)
- **US2 (Phase 5)**: After Foundational; can parallel with US3/US4 once US1 stable if staffed (touches `WorkflowNodes.tsx`—serialize with US1/US6 on that file)
- **US3 (Phase 6)**: After Foundational; largely independent (server scaffolds)—good parallel track
- **US4 (Phase 7)**: After Foundational; independent files (`layout/`, toolbar, store action)—parallel-friendly after US1 store edits settle
- **US6 (Phase 8)**: After US1 + US2 handle/edge cues exist
- **Polish (Phase 9)**: After desired stories complete

### User Story Dependencies

| Story | Priority | Depends on | Notes |
| :--- | :---: | :--- | :--- |
| US1 Approval handles | P1 | Phase 2 | MVP |
| US5 Legacy compatibility | P1 | US1 | Projection + load fixtures |
| US2 Condition handles | P1 | Phase 2 | Avoid concurrent edits to `WorkflowNodes.tsx` with US1 |
| US3 Hierarchical scaffold | P1 | Phase 2 | Server-side; parallel OK |
| US4 Auto-Arrange | P2 | Phase 2 | Parallel after store calm |
| US6 On-canvas readability | P3 | US1 + US2 | Mostly audit/fix |

### Parallel Opportunities

- T002/T003 (Setup) in parallel
- T005/T006 after T004 starts (T005 can parallel once file exists)
- T007/T008 (US1 tests) in parallel before/with implementation
- T014/T015 (US5 tests) in parallel
- T019/T020 (US2 tests) in parallel
- T025/T026 (US3 tests) in parallel; US3 implementation parallel with US4 if different owners
- T031 parallel with late US3 polish
- T040/T041/T043 in Polish parallel

### Within Each Story

- Prefer verification tests early (fail first when practical)
- Store/`addEdge` before relying on UI gestures in demos
- Scaffold server before depending on create-dialog UX
- Layout helper before toolbar wiring

---

## Parallel Example: User Story 1

```bash
# Tests in parallel:
Task: "Add tests/canvasRoutingAddEdge.test.ts for approval handle → conditional edges"
Task: "Assert edgeSemanticsFromSourceHandle contract table"

# Then implementation sequence:
Task: "Extend addEdge in apps/web/src/store/useWorkflowStore.ts"
Task: "Approval outcome handles in apps/web/src/components/workflow/nodes/WorkflowNodes.tsx"
Task: "FlowCanvas sourceHandle mapping for approval"
```

## Parallel Example: After MVP (US3 + US4)

```bash
# Different owners / files:
Task: "scaffoldHierarchicalSupervisor in apps/server/src/api/studio/topologyScaffolds.ts"
Task: "autoArrange helper in apps/web/src/components/workflow/layout/autoArrange.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 Setup + Phase 2 Foundational  
2. Complete Phase 3 US1 (handles + addEdge + FlowCanvas mapping + tests)  
3. **STOP and VALIDATE** with Independent Test / quickstart section A  
4. Demo approval branching without the properties panel  

### Incremental Delivery

1. Setup + Foundational → helpers ready  
2. US1 → MVP demo  
3. US5 → legacy safety net  
4. US2 → condition handle clarity  
5. US3 → hierarchical create scaffold  
6. US4 → Auto-Arrange  
7. US6 → readability audit  
8. Polish → docs + quickstart gates  

### Suggested MVP Scope

**US1 only** (Approval outcome handles + store/canvas wiring + `tests/canvasRoutingAddEdge.test.ts`).  
Next highest value P1 slice: **US3** (hierarchical scaffold) or **US5** (compat) depending on whether create-time pain or load-risk is hotter.

---

## Notes

- [P] = different files, no dependency on incomplete tasks  
- Do not change approval runtime/policy/credentials  
- Do not add new archetypes or node primitives  
- Prefer acyclic hierarchical scaffold to avoid `UNGUARDED_CYCLE`  
- Auto-Arrange: layout only + Undo; Design-only  
- Avoid simultaneous conflicting edits to `WorkflowNodes.tsx` across US1/US2/US6—sequence or single owner  
- Commit after each task or logical group  
- Format validation: all tasks use `- [ ] Txxx ...` with file paths and story labels where required
