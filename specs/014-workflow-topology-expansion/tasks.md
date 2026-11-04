# Tasks: Expanded Workflow Topology Support

**Input**: Design documents from `specs/014-workflow-topology-expansion/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`)  
**Prerequisites**: `plan.md` (required), `spec.md` (user stories P1–P2), `research.md`, `data-model.md`, `contracts/`  
**Tests**: Spec/quickstart require automated validation and compiler suites as release gates. Include focused verification tests per story (not full TDD-red-first unless later requested).  
**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and demoed independently.  
**Setup note**: `setup-tasks.ps1` could not run (`pwsh` missing); paths resolved from `.specify/feature.json`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`US1`…`US5`)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Contracts Alignment)

**Purpose**: Align shared contracts and confirm feature docs are the source of truth before type/compiler work.

- [X] T001 Copy/confirm topology issue-code catalog from `specs/014-workflow-topology-expansion/contracts/topology-validation.codes.md` into a shared constant module `packages/types/src/topologyIssueCodes.ts` (or adjacent export) listing every new code string exactly as in the contract
- [X] T002 [P] Align UI contract surface notes in `specs/014-workflow-topology-expansion/contracts/ui-topology-controls.contract.ts` with planned exports (no runtime required yet)—ensure `TOPOLOGY_PALETTE_NODE_TYPES` and archetype ids match `data-model.md`
- [X] T003 [P] Verify feature docs present and linked: `specs/014-workflow-topology-expansion/{plan,spec,research,data-model,quickstart}.md` and `contracts/`; update `.specify/feature.json` if path drifts

---

## Phase 2: Foundational (Types & Shared Wiring — Blocks All Stories)

**Purpose**: Widen archetype/node/event types and factories so every user story can compile against stable contracts. No story-specific runtime behavior yet beyond stubs/factories.

> **CRITICAL**: No user story implementation can begin until this foundational phase is complete.

- [X] T004 Extend `WorkflowArchetypeCategory` in `packages/types/src/archetype.ts` to include `"evaluator-optimizer"` and `"autonomous-swarm"`; update `isWorkflowArchetypeValid`, `resolveWorkflowArchetype`, and category helpers
- [X] T005 [P] Extend `WorkflowArchetypeConfig` in `packages/types/src/archetype.ts` per `data-model.md`: add optional `evaluatorOptimizer` (`generatorNodeIds: string[]` min 1, `evaluatorNodeIds: string[]` min 1, `maxIterations` integer **1–10** default **3**, `passBranch`, `failBranch`, `exhaustionOutcome: "fail" | "exit_path"` default `"exit_path"`, `exhaustionBranch?` required when `exit_path`) and optional `swarm` (`maxHops` integer **1–20**, `maxDepth` integer **1–20**, `maxActivePeerTasks` integer **1–8**, `terminationBranch?`)
- [X] T006 [P] Add factories + descriptors in `packages/types/src/archetype.ts`: `createEvaluatorOptimizerConfig`, `createAutonomousSwarmConfig`, and `ARCHETYPE_DESCRIPTORS` entries with labels/descriptions/topologyConstraint for both new categories
- [X] T007 Extend `WorkflowNodeType` in `packages/types/src/index.ts` with `"parallel_split" | "parallel_join" | "subgraph"`; add config type exports `ParallelSplitNodeConfig`, `ParallelJoinNodeConfig` (`joinPolicy: "all_success" | "partial_allowed"` default `"all_success"`, `requiredBranchKeys?`, `branchTimeoutMs?`), `SubgraphNodeConfig` (`workflowId`, `inputMappings[]`, `outputMappings[]` with `{ source, target, required?: boolean }` default required true), `SubgraphFieldMapping`
- [X] T008 [P] Extend `RunEventType` in `packages/types/src/index.ts` with `node.loop_iteration`, `parallel.branch_started`, `parallel.branch_completed`, `parallel.branch_failed`, `subgraph.entered`, `subgraph.exited`, `subgraph.failed` per `contracts/topology-validation.codes.md`
- [X] T009 Export platform topology constants from `packages/types/src/archetype.ts` or `packages/types/src/index.ts`: `DEFAULT_MAX_CONCURRENT_BRANCHES = 8`, `MAX_SUBGRAPH_DEPTH = 3`, reuse existing recursion bounds **1–10** / default **3** for EO `maxIterations`
- [X] T010 Update `apps/web/src/store/useWorkflowStore.ts` `addNode` / node-type unions so new `WorkflowNodeType` values are accepted without runtime behavior (palette wiring comes in story phases)
- [X] T011 [P] Rebuild types and typecheck after edits to `packages/types/src/archetype.ts` and `packages/types/src/index.ts`: `pnpm --filter @multi-agent/types build` and root `npx tsc --noEmit`

**Checkpoint**: Foundation ready — categories, node types, events, and factories exist. User story work can begin (preferably in priority order; US2/US3/US4 can parallelize after US1 MVP if staffed).

---

## Phase 3: User Story 1 — Evaluator-Optimizer Quality Loop (Priority: P1) 🎯 MVP

**Goal**: Designers can create, validate, run, and observe generator → evaluator feedback loops with a hard iteration ceiling and defined exhaustion outcome under the `evaluator-optimizer` archetype.

**Independent Test**: Create an EO workflow from the archetype picker with scaffold; run a fail-then-pass path and a ceiling-exhaustion path; confirm iteration Live chrome; confirm unrelated cycles emit `EVALUATOR_OPTIMIZER_CYCLE_INVALID` (not only generic cycle forbidden).

### Verification tests for User Story 1

- [X] T012 [P] [US1] Add EO validation cases in `tests/topologyValidation.test.ts` covering: valid designated feedback cycle accepted; missing `evaluatorOptimizer` → `EVALUATOR_OPTIMIZER_CONFIG_REQUIRED`; `maxIterations` outside **1–10** → `EVALUATOR_OPTIMIZER_CEILING_REQUIRED`; unrelated cycle → `EVALUATOR_OPTIMIZER_CYCLE_INVALID`; `exhaustionOutcome: "exit_path"` without wired branch → `EVALUATOR_OPTIMIZER_EXHAUSTION_UNWIRED`
- [X] T013 [P] [US1] Add EO runtime cases in `tests/workflowCompilerTopology.test.ts`: loop pass before ceiling succeeds; ceiling triggers configured exhaustion (`fail` vs `exit_path`); emits `node.loop_iteration` with `{ current, max, phase }` and uses/extends `node.loop_limit_reached` on exhaustion

### Implementation for User Story 1

- [X] T014 [US1] Implement EO archetype validation rules in `apps/server/src/compiler/validation.ts` (generator/evaluator role checks, designated feedback only, ceiling bounds **1–10**, pass/fail/exhaustion routing) emitting codes from `contracts/topology-validation.codes.md`
- [X] T015 [P] [US1] Port EO validation parity to `apps/web/src/lib/workflow/validation.ts` with the same issue codes and designer-readable messages
- [X] T016 [US1] Implement EO loop execution + ceiling/exhaustion handling in `apps/server/src/compiler/workflowCompiler.ts` (specialize existing recursion/loop-iteration tracking; do not require `supervisorHubNodeId`)
- [X] T017 [US1] Emit `node.loop_iteration` (and exhaustion via `node.loop_limit_reached` or documented EO path) from compiler/runtime; ensure `apps/server/src/runtime/runExecutor.ts` persists/forwards these events
- [X] T018 [US1] Add `createEvaluatorOptimizerScaffold()` (input → generator agent → evaluator agent → condition pass/fail/exhaustion → output) and wire `stampWorkflowArchetype` / create path in `apps/server/src/api/studio/workflowService.ts` so new EO workflows are not empty-canvas invalid
- [X] T019 [P] [US1] Add Evaluator-Optimizer to `ARCHETYPE_ORDER` and descriptors usage in `apps/web/src/components/workflow/CreateWorkflowDialog.tsx` and overview switcher in `apps/web/src/components/workflow/properties/ArchetypeForms.tsx`
- [X] T020 [US1] Add EO overview controls (ceiling **1–10**, pass/fail/exhaustion outcome, role node selectors) in `apps/web/src/components/workflow/properties/ArchetypeForms.tsx` (or new `EvaluatorOptimizerForm.tsx`) wired through `useWorkflowStore.ts`
- [X] T021 [US1] Project iteration progress in `apps/web/src/lib/runCanvasProjection.ts` and Live chrome (`apps/web/src/components/workflow/live/*`) showing at least current vs max and generate/evaluate phase
- [X] T022 [US1] Run US1 suites green: `pnpm test --runInBand -- tests/topologyValidation.test.ts tests/workflowCompilerTopology.test.ts` (filter EO cases if needed)

**Checkpoint**: MVP — EO archetype is creatable, validatable, runnable, and observable.

---

## Phase 4: User Story 2 — Parallel Specialist Review / Scatter-Gather (Priority: P1)

**Goal**: Designers can fan out one input across independent specialist branches, join with explicit policy (`all_success` default / `partial_allowed`), honor active concurrency budget (default **8**), and observe per-branch Live progress.

**Independent Test**: Build split → 3 specialists → join → aggregator; run and see all three branches + join; over-budget fan-out rejected with `PARALLEL_BRANCH_LIMIT_EXCEEDED`; failed branch under `all_success` fails closed; `partial_allowed` returns explicit failed/timedOut maps.

### Verification tests for User Story 2

- [X] T023 [P] [US2] Extend `tests/topologyValidation.test.ts` for parallel: valid 3-lane graph accepted; width > `DEFAULT_MAX_CONCURRENT_BRANCHES` (**8**) → `PARALLEL_BRANCH_LIMIT_EXCEEDED`; invalid/missing join policy → `PARALLEL_JOIN_POLICY_INVALID`; split/join mismatch → `PARALLEL_SPLIT_JOIN_MISMATCH`
- [X] T024 [P] [US2] Extend `tests/workflowCompilerTopology.test.ts` for join policies: `all_success` fails closed on branch failure/timeout; `partial_allowed` yields carrier with `branches`, `failed`/`timedOut`, `partial: true`; concurrent execution respects semaphore budget

### Implementation for User Story 2

- [X] T025 [US2] Implement parallel split/join validation in `apps/server/src/compiler/validation.ts` (fan-out width ≤ active `maxConcurrentBranches` default **8**; join policy required; requiredBranchKeys ⊆ incoming)
- [X] T026 [P] [US2] Port parallel validation parity to `apps/web/src/lib/workflow/validation.ts`
- [X] T027 [US2] Compile `parallel_split` / `parallel_join` in `apps/server/src/compiler/workflowCompiler.ts` onto LangGraph multi-edge fan-out + barrier join; enforce join policy; extend join carrier beyond silent `{ branches }` per `data-model.md` (never omit failures silently)
- [X] T028 [US2] Emit `parallel.branch_started|completed|failed` from compiler/runtime and forward via `apps/server/src/runtime/runExecutor.ts`
- [X] T029 [P] [US2] Add palette entries for `parallel_split` / `parallel_join` in `apps/web/src/components/workflow/NodePalette.tsx` per `contracts/ui-topology-controls.contract.ts`
- [X] T030 [P] [US2] Add React Flow node visuals for split/join in `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx`
- [X] T031 [US2] Add join-policy property controls (`all_success` | `partial_allowed`, optional timeout/required keys) in `apps/web/src/components/workflow/properties/` and store updates in `apps/web/src/store/useWorkflowStore.ts`
- [X] T032 [US2] Project per-branch Live status in `apps/web/src/lib/runCanvasProjection.ts` + live components so operators see split structure, branch progress, and join completion
- [X] T033 [US2] Confirm linear-pipeline remains acyclic but accepts validated parallel DAG structures (no cycles) in validation + a regression case in `tests/topologyValidation.test.ts`
- [X] T034 [US2] Run US2 suites green: `pnpm test --runInBand -- tests/topologyValidation.test.ts tests/workflowCompilerTopology.test.ts`

**Checkpoint**: Scatter-gather works end-to-end with fail-closed default join and Live branch chrome.

---

## Phase 5: User Story 3 — Nested Reusable Sub-Workflows (Priority: P1)

**Goal**: Designers can embed a saved workflow as a `subgraph` node with explicit parent↔child I/O mappings, safe nesting depth (**MAX_SUBGRAPH_DEPTH = 3**), latest-saved resolve at validate/run, and Live enter/exit.

**Independent Test**: Save child workflow; parent adds subgraph with mappings; run parent successfully; missing mapping / missing ref / unsafe nest rejected; Live shows enter/exit.

### Verification tests for User Story 3

- [X] T035 [P] [US3] Extend `tests/topologyValidation.test.ts` for subgraph: valid mappings pass; missing `workflowId` → `SUBGRAPH_REF_MISSING`; incomplete required mapping → `SUBGRAPH_MAPPING_INVALID`; self-ref / cyclic refs without finite depth → `SUBGRAPH_NESTING_UNSAFE`; depth > **3** → `SUBGRAPH_DEPTH_EXCEEDED`
- [X] T036 [P] [US3] Extend `tests/workflowCompilerTopology.test.ts` for nested invoke: mapped inputs reach child; mapped outputs return to parent; emits `subgraph.entered` / `subgraph.exited` (or `subgraph.failed`); depth ceiling enforced at runtime

### Implementation for User Story 3

- [X] T037 [US3] Implement subgraph validation in `apps/server/src/compiler/validation.ts` (resolve latest saved definition the principal can access; mapping completeness; reference-cycle/depth checks using `MAX_SUBGRAPH_DEPTH = 3`)
- [X] T038 [P] [US3] Port subgraph validation parity to `apps/web/src/lib/workflow/validation.ts` (client may approximate ref existence from loaded catalog)
- [X] T039 [US3] Implement runtime nested workflow invoke in `apps/server/src/compiler/workflowCompiler.ts` (or helper module under `apps/server/src/compiler/`): map inputs → child, compile/execute child with `nestingDepth + 1`, map outputs back; fail closed on mapping/ref errors
- [X] T040 [US3] Emit `subgraph.entered|exited|failed` with `parentNodeId`, `workflowId`, `depth`; forward in `apps/server/src/runtime/runExecutor.ts`
- [X] T041 [P] [US3] Add `subgraph` to `apps/web/src/components/workflow/NodePalette.tsx` and node visual in `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx`
- [X] T042 [US3] Build subgraph properties UI (workflow picker + input/output mapping editors) in `apps/web/src/components/workflow/properties/` wired via `useWorkflowStore.ts` `updateSubgraphConfig` (or equivalent)
- [X] T043 [US3] Project subgraph enter/exit frames in `apps/web/src/lib/runCanvasProjection.ts` + live UI so parent vs nested progress is distinguishable
- [X] T044 [US3] Run US3 suites green: `pnpm test --runInBand -- tests/topologyValidation.test.ts tests/workflowCompilerTopology.test.ts`

**Checkpoint**: Nested reusable sub-workflows work with explicit mappings and depth safety.

---

## Phase 6: User Story 5 — Scaffolding, Designer-Readable Validation & Compatibility (Priority: P1)

**Goal**: Create-workflow lists all archetypes with descriptions; new-archetype scaffolds pass initial validation; invalid topologies fail closed with specific Studio errors; existing linear + hierarchical workflows remain valid/runnable.

**Independent Test**: Create each new archetype → scaffold validates; inject one invalid config per topology class → specific code; open legacy linear + hierarchical → validate + smoke run unchanged.

### Verification tests for User Story 5

- [X] T045 [P] [US5] Add scaffold smoke tests in `tests/topologyValidation.test.ts` (or `tests/workflowScaffoldTopology.test.ts`): EO and swarm factory scaffolds report **0** blocking structural issues; linear/hierarchical fixtures from prior suites still pass
- [X] T046 [P] [US5] Add compatibility regression in `tests/workflowCompilerTopology.test.ts` (or existing archetype compiler tests): sample stamped `linear-pipeline` and `hierarchical-supervisor` definitions still compile/run without requiring graph edits

### Implementation for User Story 5

- [X] T047 [US5] Ensure `apps/web/src/components/workflow/CreateWorkflowDialog.tsx` lists all four archetypes with concise behavioral descriptions from `ARCHETYPE_DESCRIPTORS` (linear default unchanged)
- [X] T048 [US5] Audit/upgrade designer-facing messages in `apps/server/src/compiler/validation.ts` and `apps/web/src/lib/workflow/validation.ts` so EO/parallel/subgraph/swarm errors name the problem class and fix guidance (no generic-only “cycle forbidden” for EO misuse)
- [X] T049 [US5] Confirm Run stays disabled/blocked while blocking topology issues exist in editor toolbar/validation wiring (`apps/web/src/components/workflow/EditorToolbar.tsx` / store validation integration)
- [X] T050 [P] [US5] Optionally improve hierarchical create scaffold in `apps/server/src/api/studio/workflowService.ts` so empty hierarchical canvases are less immediately invalid (nice-to-have; must not change hierarchical runtime semantics)
- [X] T051 [US5] Sync web overview archetype conversion rules in `apps/web/src/store/useWorkflowStore.ts` / `ArchetypeForms.tsx` for dormant config retention when switching among four categories (preserve EO/swarm blobs when switching away where practical, matching feature 010 patterns)
- [X] T052 [US5] Run US5 suites + prior archetype regressions green against `tests/topologyValidation.test.ts`, `tests/workflowCompilerTopology.test.ts`, and existing archetype/validation suites: `pnpm test --runInBand --testPathPattern='topologyValidation|workflowCompiler|archetype|validation'`

**Checkpoint**: Scaffolding and fail-closed actionable validation meet SC-002/SC-004/SC-005; legacy workflows safe.

---

## Phase 7: User Story 4 — Autonomous Swarm / Peer Delegation (Priority: P2)

**Goal**: Peer-style archetype without permanent supervisor hub; required `maxHops` (**1–20**), `maxDepth` (**1–20**), `maxActivePeerTasks` (**1–8**, ≤ concurrency budget); unbounded peer loops rejected; hierarchical unchanged.

**Independent Test**: Create swarm from picker with ceilings; short peer handoff terminates observably; remove ceilings / unbounded loop → `SWARM_BOUNDS_REQUIRED` / `SWARM_UNBOUNDED_PEER_LOOP`; hierarchical fixture still valid.

### Verification tests for User Story 4

- [X] T053 [P] [US4] Extend `tests/topologyValidation.test.ts` for swarm: missing bounds → `SWARM_BOUNDS_REQUIRED`; out-of-range / active tasks > budget → `SWARM_BOUNDS_INVALID`; unbounded peer cycle → `SWARM_UNBOUNDED_PEER_LOOP`; valid bounded graph accepted without requiring hub
- [X] T054 [P] [US4] Extend `tests/workflowCompilerTopology.test.ts` for hop/depth ceiling termination and observable termination reason; assert hierarchical fixtures untouched

### Implementation for User Story 4

- [X] T055 [US4] Implement swarm validation in `apps/server/src/compiler/validation.ts` (require `swarm.maxHops`/`maxDepth`/`maxActivePeerTasks` within bounds; reject unbounded peer loops; do **not** require `supervisorHubNodeId`)
- [X] T056 [P] [US4] Port swarm validation parity to `apps/web/src/lib/workflow/validation.ts`
- [X] T057 [US4] Implement swarm hop/depth/active-task enforcement in `apps/server/src/compiler/workflowCompiler.ts` with clear termination when ceilings hit or natural termination branch taken
- [X] T058 [US4] Add `createAutonomousSwarmScaffold()` and stamp/create wiring in `apps/server/src/api/studio/workflowService.ts` so new swarm workflows pass initial validation with prefilled ceilings
- [X] T059 [P] [US4] Add Autonomous Swarm to create dialog + overview controls in `CreateWorkflowDialog.tsx` / `ArchetypeForms.tsx` with bound editors (`maxHops` **1–20**, `maxDepth` **1–20**, `maxActivePeerTasks` **1–8`)
- [X] T060 [US4] Surface swarm termination/ceiling in Live projection (`runCanvasProjection.ts`) sufficiently for operators to see why a run stopped
- [X] T061 [US4] Run US4 suites green: `pnpm test --runInBand -- tests/topologyValidation.test.ts tests/workflowCompilerTopology.test.ts`

**Checkpoint**: Bounded peer swarm available; hierarchical hub-and-spoke remains intact.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end quickstart validation, docs, and projection hardening across stories.

- [X] T062 [P] Add optional Live projection unit coverage in `tests/runCanvasProjectionTopology.test.ts` for iteration, parallel branch, and subgraph frame mapping from new event types
- [X] T063 [P] Update `docs/visual-platform-recommendations.md` Finding 5 status to reflect shipped/planned topology expansion (keep factual; link `specs/014-workflow-topology-expansion/`)
- [X] T064 Run full quickstart automated gates from `specs/014-workflow-topology-expansion/quickstart.md` (`topologyValidation`, `workflowCompilerTopology`, types build, server/web build)
- [X] T065 Manual smoke checklist from quickstart §3 (EO, scatter-gather, subgraph, swarm, backward compat) and record pass/fail against SC-001–SC-006 in `specs/014-workflow-topology-expansion/checklists/requirements.md` notes (or a short `quickstart-results.md` if preferred)
- [X] T066 [P] Ensure `git diff --check` clean for touched paths under `packages/types/`, `apps/server/`, `apps/web/`, `tests/`, and `specs/014-workflow-topology-expansion/`; confirm fixtures introduce no secret material

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS** all user stories
- **US1 (Phase 3)**: After Foundational — **MVP**
- **US2 (Phase 4)**: After Foundational — independent of US1 runtime (shares types only)
- **US3 (Phase 5)**: After Foundational — independent of US1/US2 (may compose with them later)
- **US5 (Phase 6)**: After US1 scaffolds exist (and ideally US2/US3 codes exist) — polish/compat gate; can start message audits earlier but finish after story codes land
- **US4 (Phase 7)**: After Foundational — recommended after US5 create-dialog patterns; P2
- **Polish (Phase 8)**: After desired stories complete

### User Story Dependencies

| Story | Depends on | Notes |
| :--- | :--- | :--- |
| US1 EO | Foundation | MVP; includes EO create option + scaffold |
| US2 Parallel | Foundation | No dependency on EO |
| US3 Subgraph | Foundation | No dependency on EO/parallel |
| US5 Scaffolding/compat | Foundation + story codes | Completes four-archetype create UX + regressions |
| US4 Swarm | Foundation | P2; reuses create/scaffold patterns from US1/US5 |

### Parallel Opportunities

- T002–T003 (setup docs/contracts notes)
- T005–T006, T008 (foundational type pieces on different concerns)
- Within each story: paired server/web validation ports `[P]`; palette + node visuals `[P]`; verification test files `[P]` before/alongside implementation
- After Foundation: US1, US2, US3 can proceed in parallel by different owners if merge discipline on `validation.ts` / `workflowCompiler.ts` is coordinated (expect merge contention on those two files)

### Parallel Example: User Story 2

```bash
# Verification tests in parallel:
Task: "Extend tests/topologyValidation.test.ts for parallel codes"
Task: "Extend tests/workflowCompilerTopology.test.ts for join policies"

# UI pieces in parallel after compiler types exist:
Task: "NodePalette parallel_split/join entries"
Task: "WorkflowNodes.tsx split/join visuals"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup  
2. Complete Phase 2: Foundational (**critical**)  
3. Complete Phase 3: US1 Evaluator-Optimizer  
4. **STOP and VALIDATE** via US1 independent test + T022  
5. Demo quality-loop archetype

### Incremental Delivery

1. Setup + Foundational → foundation ready  
2. US1 → EO MVP demo  
3. US2 → scatter-gather demo  
4. US3 → nested subgraph demo  
5. US5 → scaffolding/compat release gate (SC-002/004/005)  
6. US4 → bounded swarm  
7. Polish → quickstart + docs

### Suggested MVP Scope

**US1 only** (Evaluator-Optimizer) for first shippable increment. Product “three patterns” claim in SC-001 needs **US1 + US2 + US3** before declaring full topology-expansion success; treat US5 as release gate before calling the feature done; US4 is P2 follow-on.

---

## Notes

- [P] = different files, no dependencies on incomplete tasks  
- [Story] labels map to spec user stories US1–US5  
- Constraints to preserve verbatim: EO `maxIterations` **1–10** default **3**; join default **`all_success`**; concurrency default **8**; subgraph depth **3**; swarm hops/depth **1–20**; `maxActivePeerTasks` **1–8**  
- Do not rework credential broker, RLS, or sandbox isolation  
- Do not remove or redefine hierarchical-supervisor hub semantics  
- Commit after each task or logical group; stop at checkpoints to validate independently  

### Implementation follow-ups

- **T039/T070**: Completed — `createStudioSubgraphRunner` wired from `runExecutor` and `approvalManager` resume path.
- **T065**: Automated SC gates recorded in `quickstart-results.md`; manual Studio smoke checklist left for operator sign-off against live `pnpm run dev`.

---

## Phase 9: Convergence

- [X] T067 Add the 7 new topology `RunEventType` values (`node.loop_iteration`, `parallel.branch_started`, `parallel.branch_completed`, `parallel.branch_failed`, `subgraph.entered`, `subgraph.exited`, `subgraph.failed`) to `SHARED_EVENT_TYPES` in `src/agents/runtime/mapAgentExecutionEvent.ts` and emit specialist branch `nodeId` accurately on `parallel.branch_*` events in `apps/server/src/compiler/workflowCompiler.ts` per FR-016 (contradicts)
- [X] T068 Enforce `evaluatorOptimizer.exhaustionOutcome === "fail"` by throwing a terminal `NodeOutcomeError` when `maxIterations` is reached (routing to `exhaustionBranch` only when `exhaustionOutcome === "exit_path"`) and emit `node.loop_iteration` with `{ current, max, phase }` across both `generate` and `evaluate` phases in `apps/server/src/compiler/workflowCompiler.ts` per FR-003 (contradicts)
- [X] T069 Fix client evaluator-optimizer cycle validation in `apps/web/src/lib/workflow/validation.ts` (`validateExpandedTopologyClient`) so the condition router on the designated fail→generator feedback path is permitted and new EO scaffolds validate cleanly per US1/AC1 (contradicts)
- [X] T070 Implement runtime nested subgraph resolution and execution in `apps/server/src/compiler/workflowCompiler.ts`, `apps/server/src/runtime/runExecutor.ts`, and `apps/server/src/runtime/approvalManager.ts` (resolving latest saved child workflow for the principal, enforcing `MAX_SUBGRAPH_DEPTH = 3` and cycle checks, and applying explicit `inputMappings`/`outputMappings` fail-closed) per FR-009 (missing)
- [X] T071 Enforce `branchTimeoutMs` and per-branch failure/timeout capture for specialist lanes feeding a `parallel_join` in `apps/server/src/compiler/workflowCompiler.ts` so `all_success` fails closed with branch attribution and `partial_allowed` delivers `{ branches, failed, timedOut, partial: true }` without aborting the superstep per FR-007 (partial)
- [X] T072 Extend `validateSubgraphNodes` in `apps/server/src/compiler/topologyValidation.ts` (wired via `WorkflowValidationLimits` / `WorkflowService` / `RunExecutor`) and `apps/web/src/lib/workflow/validation.ts` to check referenced workflow existence (`SUBGRAPH_REF_MISSING`), indirect reference cycles (`SUBGRAPH_NESTING_UNSAFE`), transitive depth > `MAX_SUBGRAPH_DEPTH` (`SUBGRAPH_DEPTH_EXCEEDED`), and required child input/output mapping keys (`SUBGRAPH_MAPPING_INVALID`) per FR-011 (partial)
- [X] T073 Enforce `swarm.maxDepth` and `swarm.maxActivePeerTasks` concurrency clamping with an observable termination reason in `apps/server/src/compiler/workflowCompiler.ts`, and reject peer cycles lacking a reachable termination branch/condition with `SWARM_UNBOUNDED_PEER_LOOP` in `apps/server/src/compiler/topologyValidation.ts` and `apps/web/src/lib/workflow/validation.ts` per FR-012 (partial)
- [X] T074 Project and render `TopologyLiveProjectionHints` (loop iteration `current`/`max`/`phase`, per-branch parallel status, subgraph `workflowId`/`depth` frames, and swarm termination reason) in `apps/web/src/lib/runCanvasProjection.ts`, `apps/web/src/components/workflow/live/liveCanvas.types.ts`, `apps/web/src/components/workflow/nodes/WorkflowNodes.tsx`, and `apps/web/src/components/workflow/live/NodeExecutionInspector.tsx` per FR-016 (partial)
- [X] T075 Wire active `maxConcurrentBranches` from `WorkflowValidationLimits` into `validateParallelTopology`, flag orphan `parallel_split` nodes (`< 2` outgoing branches or unconnected to a join) with `PARALLEL_SPLIT_JOIN_MISMATCH` in `apps/server/src/compiler/topologyValidation.ts`, and bring `apps/web/src/lib/workflow/validation.ts` to full issue-code parity (`EVALUATOR_OPTIMIZER_ROLE_INVALID`, `EVALUATOR_OPTIMIZER_ROUTING_INVALID`, `EVALUATOR_OPTIMIZER_EXHAUSTION_UNWIRED`, `PARALLEL_JOIN_POLICY_INVALID`, `SUBGRAPH_DEPTH_EXCEEDED`) per FR-014 (partial)
- [X] T076 Expand `tests/workflowCompilerTopology.test.ts`, `tests/topologyValidation.test.ts`, and `tests/runCanvasProjectionTopology.test.ts` with end-to-end runtime execution tests (`graph.invoke`) for EO fail-then-pass and exhaustion (`fail` vs `exit_path`), parallel `all_success` vs `partial_allowed` join carriers/timeouts, nested subgraph invocation/depth limits, swarm hop/depth termination, legacy linear/hierarchical smoke runs, and client/server validation parity per SC-002 (partial)
- [X] T077 Replace the broken `JsonField` array editors in `SubgraphForm` (`apps/web/src/components/workflow/properties/NodeForms.tsx`) with a saved-workflow selector and structured `inputMappings`/`outputMappings` row controls (`source`, `target`, `required`) and wire topology config actions in `apps/web/src/store/useWorkflowStore.ts` per US3/AC1 (partial)
- [X] T078 Add the 16 topology issue codes to `FOCUS_TARGETS` and dormant config retention notice for `evaluatorOptimizer`/`swarm` in `apps/web/src/components/workflow/properties/ArchetypeForms.tsx`, and record verification results against SC-001–SC-006 in `specs/014-workflow-topology-expansion/checklists/requirements.md` per US5/AC3 (partial)

