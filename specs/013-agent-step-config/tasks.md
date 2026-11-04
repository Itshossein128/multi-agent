# Tasks: Independent Agent Configuration Per Workflow Step

**Input**: Design documents from `specs/013-agent-step-config/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`)  
**Prerequisites**: `plan.md` (required), `spec.md` (user stories P1–P2), `research.md`, `data-model.md`, `contracts/`  
**Approach**: Test-Driven Development (TDD) — all test tasks MUST be written first and fail before implementing the corresponding feature code. User requested TDD via `/speckit-tasks Use TDD`.

**Tests note**: Spec success criteria and `quickstart.md` require `tests/agentStepConfig.test.ts` and `tests/agentStepConfigExecution.test.ts`. Include failing tests first in each story phase; confirm red, then implement to green.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`US1`…`US5`)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Contracts & Scaffolds)

**Purpose**: Land shared step-config module scaffolds and type stubs so TDD tests share stable import paths.

- [X] T001 Create scaffold module `packages/types/src/agentStepConfig.ts` exporting stub APIs that throw `not implemented` until foundation: `resolveEffectiveAgentStepConfig`, `validateAgentNodeStepConfig`, and issue-code constants matching `specs/013-agent-step-config/contracts/agent-step-config.contract.ts` (`INVALID_AGENT_NODE_TASK_INSTRUCTION`, `INVALID_AGENT_NODE_MODEL_OVERRIDE`, `UNSUPPORTED_STEP_MODEL_OVERRIDE`, `INVALID_AGENT_NODE_ACTIVE_TOOLS`, `UNSUPPORTED_STEP_ACTIVE_TOOLS`, `INCOMPATIBLE_STEP_CONFIG_FOR_AGENT`)
- [X] T002 [P] Re-export new step-config helpers from `packages/types/src/index.ts` (alongside existing `agentConfiguration` exports) without changing runtime behavior yet
- [X] T003 [P] Verify monorepo still typechecks after scaffolds: `pnpm --filter @multi-agent/types build` and `pnpm exec tsc --noEmit` (or project-equivalent root typecheck)

---

## Phase 2: Foundational (Types + Resolve/Validate — Blocks All Stories)

**Purpose**: Persistable `AgentNodeConfig` fields, pure effective-config resolve/validate, and trusted `AgentExecutionInput` step fields. Must complete before any user-story UI/runtime work.

> **CRITICAL**: No user story implementation can begin until this foundational phase is complete.

### Tests for Foundation (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T004 [P] Author failing unit tests in `tests/agentStepConfig.test.ts` for `resolveEffectiveAgentStepConfig` / `validateAgentNodeStepConfig` in `packages/types/src/agentStepConfig.ts` covering:
  - omitted `taskInstruction` / blank string ⇒ effective instruction `undefined`
  - non-empty `taskInstruction` trimmed and returned
  - partial `modelSettingsOverride` merges field-by-field onto `backend.settings`; unspecified keys inherit
  - explicit `temperature: 0` is preserved (not treated as unset)
  - clearing semantics: override object without a key ⇒ that key inherits (document that stored JSON must omit cleared keys)
  - `activeTools` omitted ⇒ effective tools = `agent.tools` ∩ usable registry tools (`enabled !== false`)
  - `activeTools: []` ⇒ effective `toolIds` empty (distinct from omit)
  - nonempty `activeTools` ⊆ allowed ⇒ effective equals that subset (stable order)
  - `activeTools` containing unknown/disabled/not-allowed id ⇒ incompatibility / validation error (`INVALID_AGENT_NODE_ACTIVE_TOOLS`) — no silent union/expand
  - `executionMode` / `maxToolSteps` precedence node → agent → derived from **effective** `toolIds` (empty effective tools ⇒ default `single_turn` even if base agent has tools); clamp `maxToolSteps` to integer range **1–10**, default **5**
  - resolve MUST NOT mutate the input `AgentRecord` (deep-freeze or pre/post snapshot assert)
- [X] T005 [P] Author failing unit tests in `tests/agentStepConfig.test.ts` for backend support matrix from `specs/013-agent-step-config/contracts/agent-step-config.schema.md`:
  - `api` (and `local` for model settings): valid override keys per `modelSettingsSchema` accepted; illegal keys / Anthropic temperature+topP on **effective** merge rejected (`INVALID_AGENT_NODE_MODEL_OVERRIDE`)
  - `cli` / `process` / `webhook`: any present `modelSettingsOverride` ⇒ `UNSUPPORTED_STEP_MODEL_OVERRIDE`
  - `cli` / `process` / `webhook` (and `local` if it has no ToolRuntime tool loop): any present `activeTools` (including `[]`) ⇒ `UNSUPPORTED_STEP_ACTIVE_TOOLS`; omit remains valid
- [X] T006 [P] Author failing type/migration smoke in `tests/agentNodeConfigStepFields.test.ts` verifying workflow nodes / `AgentNodeConfig` round-trip optional fields `taskInstruction?: string`, `modelSettingsOverride?: Partial<AgentModelSettings>`, `activeTools?: string[]` without requiring them on legacy configs

### Implementation for Foundation

- [X] T007 Extend `AgentNodeConfig` in `packages/types/src/index.ts` per `specs/013-agent-step-config/data-model.md` and `contracts/agent-step-config.schema.md` with optional `taskInstruction?: string`, `modelSettingsOverride?: Partial<AgentModelSettings>`, `activeTools?: string[]` while preserving existing `agentId`, `mutatesCode?`, `role?`, `executionMode?`, `maxToolSteps?` (clamp docs **1–10**)
- [X] T008 Implement non-stub `resolveEffectiveAgentStepConfig` and `validateAgentNodeStepConfig` in `packages/types/src/agentStepConfig.ts` matching Decision 2/6/7/10 in `research.md` (pure; omit-vs-empty; zero overrides; effective-tool-derived mode; issue codes from contract)
- [X] T009 Extend `AgentExecutionInput` in `src/agents/runtime/types.ts` with trusted optional fields: `taskInstruction?: string`, `modelSettingsOverride?: Partial<AgentModelSettings>` (or pre-merged effective settings field), and ensure `resolvedTools` / auth paths can consume **effective** tool sets; do not treat client config as authorization
- [X] T010 Update `resolveEffectiveReactSettings` usage contract in `src/agents/runtime/reactSettings.ts` (docs + any helper) so callers pass **effective** tool ids for derived mode; keep node → agent → default precedence and clamp **1–10** / default **5**
- [X] T011 Extend `resolveAgentToolsForRuntime` in `apps/server/src/compiler/workflowCompiler.ts` to accept optional node `activeTools` and return the effective ∩ enabled registry tools per data-model rules (omit / `[]` / subset); keep backward-compatible call sites when `activeTools` omitted
- [X] T012 Run foundation suites green: `pnpm test --runInBand -- tests/agentStepConfig.test.ts tests/agentNodeConfigStepFields.test.ts`

**Checkpoint**: Foundation ready — types, pure resolve/validate, execution input fields, and compiler tool-resolution signature exist. User story work can begin.

---

## Phase 3: User Story 1 — Same Base Agent, Independent Step Instructions (Priority: P1) 🎯 MVP

**Goal**: Two agent nodes (and separate workflows) can share one base Agent with independent step configuration—especially distinct `taskInstruction`s—without mutating the shared registry; at run time each node receives its own additive step instruction with the base persona intact.

**Independent Test**: Two nodes same `agentId`, distinct `taskInstruction`; edit A; B and registry unchanged; API executor (mocked) sees A’s instruction only for A and does not mutate `AgentRecord.systemPrompt`.

### Tests for User Story 1 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T013 [P] [US1] Author failing tests in `tests/agentStepConfigExecution.test.ts` for additive `taskInstruction` delivery through `src/agents/runtime/apiAgentExecutor.ts` / ContextAssembler path: base `systemPrompt` unchanged as system text; non-empty `taskInstruction` appears as a distinct additive message/item **after** base system and **before** workflow input/task; empty/omitted instruction ⇒ legacy message shape only
- [X] T014 [P] [US1] Author failing tests in `tests/agentStepConfigExecution.test.ts` proving two concurrent `runtime.execute` calls with the same shared `AgentRecord` reference but different `taskInstruction` values never mutate the shared record and each transcript contains only its own instruction
- [X] T015 [P] [US1] Author failing tests in `tests/agentStepConfigCompiler.test.ts` (or extend compiler tests) asserting `apps/server/src/compiler/workflowCompiler.ts` `runAgentThroughRuntime` / agent-node path passes node `taskInstruction` into execution input from `AgentNodeConfig` without writing the agent registry
- [X] T016 [P] [US1] Author failing UI/store tests in `tests/agentNodeFormStepIsolation.test.ts` (or `apps/web` test location used by the repo) showing that setting `taskInstruction` for one node via the properties path updates only that node’s `config` through `updateNodeConfig` and does **not** call `updateAgentRecord` / `workflowService.updateAgent`

### Implementation for User Story 1

- [X] T017 [US1] Wire `taskInstruction` from node config through `apps/server/src/compiler/workflowCompiler.ts` into `AgentExecutionInput.taskInstruction`
- [X] T018 [US1] Extend `src/agents/runtime/contextAssembler.ts` and `src/agents/runtime/agentRuntime.ts` to accept/deliver additive step instruction without modifying `AgentRecord.systemPrompt` (order: base system → step instruction → task/input)
- [X] T019 [US1] Apply additive step-instruction delivery in `src/agents/runtime/apiAgentExecutor.ts` (assembled + legacy `buildMessages` paths) and mirror additive `STEP INSTRUCTIONS` (or equivalent) in `src/agents/runtime/cliAgentExecutor.ts`, `src/agents/runtime/localAgentExecutor.ts`, `src/agents/runtime/processAgentExecutor.ts`, and `src/agents/runtime/webhookAgentExecutor.ts` when instruction present
- [X] T020 [US1] Update `apps/web/src/components/workflow/properties/NodeForms.tsx` `AgentForm` so `taskInstruction` edits use `updateNodeConfig` only; display base `systemPrompt` read-only (do not `patchAgent` for step instruction); keep existing node `executionMode` / `maxToolSteps` node overrides
- [X] T021 [US1] Run US1 suites green: `pnpm test --runInBand -- tests/agentStepConfigExecution.test.ts tests/agentStepConfigCompiler.test.ts tests/agentNodeFormStepIsolation.test.ts` (adjust to files actually added)

**Checkpoint**: MVP — shared base Agent + independent step instructions work end-to-end without registry mutation for that field.

---

## Phase 4: User Story 2 — Author Step Settings Without Mutating the Registry (Priority: P1)

**Goal**: Properties panel is a step-config surface: Base Agent selector, read-only base summary, Step Instructions, model inherit/override/clear, active-tools inherit/empty/subset, node execution controls, and explicit “Edit Agent in Registry” with shared-impact warning—no ordinary registry field edits from the panel.

**Independent Test**: Open agent node properties; change every step control; registry content/`updatedAt` unchanged; clear override restores inherit; registry CTA warns and navigates without accidental PATCH.

### Tests for User Story 2 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T022 [P] [US2] Author failing component/store tests in `tests/agentNodeFormStepIsolation.test.ts` (extend) asserting `AgentForm` in `apps/web/src/components/workflow/properties/NodeForms.tsx` no longer calls `updateAgentRecord` for name, backend, provider, model, description, system prompt, assigned tools, agent-level execution mode/steps, or metadata
- [X] T023 [P] [US2] Author failing UI tests covering presence of: Base Agent select, read-only base summary, Step Instructions, per-field model inherit/override/clear (distinguish default vs override vs effective), active-tools control supporting omit vs `[]` vs subset limited to base `agent.tools`, node execution mode / max tool steps, and “Edit Agent in Registry” control with shared-impact confirm copy
- [X] T024 [P] [US2] Author failing test that clearing a model override removes the key from stored `modelSettingsOverride` (not `null`) via `updateNodeConfig` in `apps/web/src/store/useWorkflowStore.ts` / form handlers

### Implementation for User Story 2

- [X] T025 [US2] Redesign `AgentForm` in `apps/web/src/components/workflow/properties/NodeForms.tsx` per `contracts/agent-step-config.schema.md` UI contract: step-local controls only; read-only base summary from registry agent; remove `patchAgent` usage from this form
- [X] T026 [US2] Implement model-settings inherit/override/clear UX in `NodeForms.tsx` using `modelSettingsSchema` from `packages/types` / `@/lib/workflow/types`, writing only `modelSettingsOverride` onto the node; show inherited vs overridden vs effective values
- [X] T027 [US2] Implement active-tools inherit / explicit empty / subset selector in `NodeForms.tsx` bounded to base Agent allowed tools; persist omit vs `[]` vs ids correctly on `AgentNodeConfig`
- [X] T028 [US2] Add “Edit Agent in Registry” explicit action in `NodeForms.tsx` with shared-impact warning before navigating to existing org agent detail route (`/org/agents/{agentId}` via existing `orgUrl` helpers); ensure open/view does not PATCH agent
- [X] T029 [US2] Run US2 suites green: `pnpm test --runInBand -- tests/agentNodeFormStepIsolation.test.ts` (and any new form test files)

**Checkpoint**: Operators can author step settings without mutating the shared Agent from the canvas panel.

---

## Phase 5: User Story 3 — Step Configuration Survives Persistence and Applies at Runtime (Priority: P1)

**Goal**: Step fields round-trip through save/reload/duplicate paths; partial model overrides (including zero) apply ephemerally at model construction; unsupported overrides fail closed; concurrent runs with one base Agent do not leak settings.

**Independent Test**: Round-trip node config JSON; API/local executor uses merged settings including `temperature: 0`; cli override rejected; two parallel executes with different overrides leave shared agent untouched.

### Tests for User Story 3 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T030 [P] [US3] Author failing persistence tests in `tests/agentStepConfigPersistence.test.ts` (or workflow service test file used by the repo) asserting `taskInstruction`, `modelSettingsOverride` (incl. `temperature: 0`), and `activeTools: []` survive save → load and existing duplicate/import/export helpers without semantic change
- [X] T031 [P] [US3] Extend `tests/agentStepConfigExecution.test.ts` with failing cases: API executor builds model using effective merged settings (spy on factory / backend settings path) including explicit `0`; shared `AgentRecord.backend.settings` remains unchanged after execute
- [X] T032 [P] [US3] Author failing validation tests in `tests/agentStepConfigValidation.test.ts` wiring `validateAgentNodeStepConfig` through `apps/web/src/lib/workflow/validation.ts` and `apps/server/src/compiler/nodeValidators.ts` so unsupported `modelSettingsOverride` on cli/process/webhook surfaces actionable errors (codes from contract) at design-time validate — not silent accept
- [X] T033 [P] [US3] Author failing concurrency test in `tests/agentStepConfigExecution.test.ts`: two parallel executes, same agent object, different `modelSettingsOverride` / `taskInstruction` ⇒ each sees its own effective settings; agent snapshot equal before/after

### Implementation for User Story 3

- [X] T034 [US3] Ensure workflow persistence paths already storing node `config` retain new fields (confirm `apps/web` save + server workflow store); fix any strip/sanitize that drops unknown node config keys
- [X] T035 [US3] Apply ephemeral model settings in `src/agents/runtime/apiAgentExecutor.ts` and `src/agents/runtime/localAgentExecutor.ts` from execution input override/effective merge without writing registry agents; reject unsupported overrides fail-closed if they reach runtime
- [X] T036 [US3] Integrate `validateAgentNodeStepConfig` into `apps/web/src/lib/workflow/validation.ts` and `apps/server/src/compiler/nodeValidators.ts` with stable issue codes/messages from `contracts/agent-step-config.schema.md`
- [X] T037 [US3] Run US3 suites green: `pnpm test --runInBand -- tests/agentStepConfigPersistence.test.ts tests/agentStepConfigExecution.test.ts tests/agentStepConfigValidation.test.ts`

**Checkpoint**: Persistence + real runtime application of step model/instruction settings with concurrency isolation.

---

## Phase 6: User Story 4 — Restrict Tools Per Step Without Expanding Access (Priority: P1)

**Goal**: `activeTools` omit / `[]` / subset semantics are enforced at validation, tool binding, and ToolRuntime authorization; out-of-set calls never execute; approval/`mutatesCode`/credential/execution-policy controls still apply after overrides.

**Independent Test**: ReAct mocked LLM requests a tool outside effective set ⇒ no `execute`; empty activeTools ⇒ no bind/execute; omitted inherits agent tools; mutating tool still subject to ToolRuntime approval policy.

### Tests for User Story 4 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T038 [P] [US4] Extend `tests/apiAgentExecutorReAct.test.ts` (or `tests/agentStepConfigExecution.test.ts`) with failing cases: `activeTools` subset ⇒ `bindTools` only schemas for effective tools; model requests non-effective tool ⇒ `toolRuntime.execute` never called; `activeTools: []` ⇒ no tool loop bind/execute even if `agent.tools` nonempty; omitted `activeTools` ⇒ behavior matches full agent allowlist ∩ registry
- [X] T039 [P] [US4] Author failing compiler/resolve tests asserting `resolveAgentToolsForRuntime(agent, tools, activeTools)` in `apps/server/src/compiler/workflowCompiler.ts` respects omit/`[]`/subset and never returns tools outside agent allowlist
- [X] T040 [P] [US4] Author failing regression asserting step overrides do not bypass ToolRuntime impact/approval or credential principal forwarding (reuse patterns from `tests/apiAgentExecutorReAct.test.ts` — `approvalGranted` not blanket-true; `credentialPrincipal` still forwarded)

### Implementation for User Story 4

- [X] T041 [US4] Compiler: pass effective `resolvedTools` from step-aware `resolveAgentToolsForRuntime` in `apps/server/src/compiler/workflowCompiler.ts` into runtime execute for agent nodes
- [X] T042 [US4] Update authorization in `src/agents/runtime/apiAgentExecutor.ts` to gate tool calls on the **effective** tool set (resolvedTools / effective ids), not merely raw `agent.tools`, while keeping agent allowlist as the upper bound
- [X] T043 [US4] Ensure derived ReAct mode uses effective tools when calling `resolveEffectiveReactSettings` from `apiAgentExecutor.ts` (empty effective tools ⇒ no autonomous tool loop unless explicitly forced by mode override)
- [X] T044 [US4] Run US4 suites green: `pnpm test --runInBand -- tests/apiAgentExecutorReAct.test.ts tests/agentStepConfigExecution.test.ts` (plus compiler test file touched)

**Checkpoint**: Step tool restrictions are real at bind and execute time without privilege expansion.

---

## Phase 7: User Story 5 — Base Agent Changes, Legacy Workflows, and In-Flight Runs (Priority: P2)

**Goal**: Changing base Agent preserves `taskInstruction`, surfaces incompatible overrides/tools, and blocks ambiguous runs; legacy nodes without new fields keep prior behavior; registry default changes affect later non-overridden fields only; in-progress runs stay on snapshots; missing/disabled agents error clearly.

**Independent Test**: Switch `agentId` with stale `activeTools`; legacy fixture runs; override vs inherit after registry edit; snapshot immutability after draft edit mid-run; missing agent validation error.

### Tests for User Story 5 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T045 [P] [US5] Author failing tests in `tests/agentStepConfig.test.ts` for base-agent switch: `taskInstruction` preserved; tools/settings incompatible with new agent produce `INCOMPATIBLE_STEP_CONFIG_FOR_AGENT` (or path-specific codes); no silent drop that expands access
- [X] T046 [P] [US5] Author failing legacy-compat tests: node config with only `agentId` (+ optional pre-feature `executionMode`/`maxToolSteps`) resolves identically to pre-feature baselines (inherit all tools/settings; no required reconfiguration)
- [X] T047 [P] [US5] Author failing tests for registry default change: update base `backend.settings` / `tools` between two resolves with same node overrides ⇒ non-overridden fields pick new defaults; explicit `modelSettingsOverride` / `activeTools` unchanged
- [X] T048 [P] [US5] Author failing snapshot/immutability test (run-store or compiler harness) proving an in-progress run continues using snapshotted workflow node config + agents from `apps/server/src/runtime` stores even if draft node `taskInstruction` changes after start
- [X] T049 [P] [US5] Author failing validation tests for missing / `enabled: false` base Agent producing actionable errors via web + server validators (existing `MISSING_AGENT_CONFIG` / `AGENT_DISABLED` retained or equivalent)

### Implementation for User Story 5

- [X] T050 [US5] On `agentId` change in `NodeForms.tsx`, preserve `taskInstruction`; retain overrides but surface incompatibilities from `validateAgentNodeStepConfig` in the properties/issues UX (optional explicit “Clear incompatible overrides” action only if it is an operator-driven action—never silent auto-expand)
- [X] T051 [US5] Confirm/adjust run start snapshot path in `apps/server/src/runtime` so workflow node step fields are included in `workflowSnapshot` used by execution (no new versioning product)
- [X] T052 [US5] Harden missing/disabled agent messaging in `apps/web/src/lib/workflow/validation.ts` and `apps/server/src/compiler/nodeValidators.ts` for step-configured nodes
- [X] T053 [US5] Run US5 suites green: `pnpm test --runInBand -- tests/agentStepConfig.test.ts` plus persistence/snapshot/validation files touched in this phase

**Checkpoint**: Safe migration, switch handling, and in-flight immutability complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Quickstart validation, regressions, and docs hygiene across stories.

- [X] T054 [P] Run full quickstart primary gate from `specs/013-agent-step-config/quickstart.md`: `pnpm test --runInBand -- tests/agentStepConfig.test.ts tests/agentStepConfigExecution.test.ts` plus related suites touched (`tests/apiAgentExecutorReAct.test.ts`, validation/persistence files)
- [X] T055 [P] Run typecheck/build: `pnpm exec tsc --noEmit` and `pnpm --filter @multi-agent/types build`
- [X] T056 [P] Update `docs/visual-platform-recommendations.md` Finding 4 status note to reference feature `013-agent-step-config` as specified/planned/implemented (accurate to completion state) without rewriting unrelated findings
- [X] T057 Confirm `mutatesCode` / `role` still accepted on `AgentNodeConfig` and unaffected by step overrides; add a short regression assert if not already covered
- [X] T058 Security spot-check from `specs/013-agent-step-config/quickstart.md` §4 (out-of-set tool never executes; node panel cannot change backend/policy) and capture coverage in `tests/agentStepConfigExecution.test.ts` / `tests/agentNodeFormStepIsolation.test.ts` test names

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS** all user stories
- **US1 (Phase 3)**: After Foundational — MVP
- **US2 (Phase 4)**: After Foundational; practically after US1 panel touch points to avoid `NodeForms.tsx` thrash (sequential recommended)
- **US3 (Phase 5)**: After Foundational; benefits from US1 runtime instruction wiring; model-settings apply can proceed once T009 exists
- **US4 (Phase 6)**: After Foundational; should follow US3 compiler validation integration or land carefully against same compiler files
- **US5 (Phase 7)**: After Foundational; ideally after US2/US3/US4 behaviors exist so incompatibilities surface in real UI/runtime
- **Polish (Phase 8)**: After desired stories complete

### User Story Dependencies

- **US1 (P1)**: No dependency on other stories after foundation — MVP
- **US2 (P1)**: Independently testable; shares `NodeForms.tsx` with US1 → prefer sequential after US1
- **US3 (P1)**: Independently testable for persistence/settings; uses execution input from foundation/US1
- **US4 (P1)**: Independently testable for tool gating; shares executor/compiler with US1/US3
- **US5 (P2)**: Independently testable for switch/legacy/snapshot; uses validate/resolve from foundation

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Types/resolve before executor/UI
- Story complete (green tests) before moving to next priority when staffing is serial

### Parallel Opportunities

- Phase 1: T002/T003 after T001 scaffold exists
- Phase 2 tests: T004, T005, T006 in parallel
- US1 tests: T013–T016 in parallel
- US2 tests: T022–T024 in parallel
- US3 tests: T030–T033 in parallel
- US4 tests: T038–T040 in parallel
- US5 tests: T045–T049 in parallel
- Polish: T054–T056 in parallel

---

## Parallel Example: User Story 1

```bash
# Launch US1 failing tests together (TDD red):
Task: "Additive taskInstruction delivery tests in tests/agentStepConfigExecution.test.ts"
Task: "Concurrent shared-AgentRecord isolation tests in tests/agentStepConfigExecution.test.ts"
Task: "Compiler passes taskInstruction in tests/agentStepConfigCompiler.test.ts"
Task: "NodeForm updateNodeConfig-only for taskInstruction in tests/agentNodeFormStepIsolation.test.ts"

# Then implement T017→T020 and re-run green (T021)
```

---

## Parallel Example: User Story 4

```bash
# Launch US4 failing tests together:
Task: "ReAct effective activeTools bind/execute tests"
Task: "Compiler resolveAgentToolsForRuntime activeTools tests"
Task: "Approval/credential non-bypass regression"

# Then implement T041→T043 and re-run green (T044)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup  
2. Complete Phase 2: Foundational (CRITICAL)  
3. Complete Phase 3: User Story 1  
4. **STOP and VALIDATE** US1 independent test  
5. Demo: two nodes, one Agent, distinct step instructions, no registry mutation  

### Incremental Delivery

1. Setup + Foundational → foundation ready  
2. US1 → independent step instructions (MVP)  
3. US2 → step-only authoring UX  
4. US3 → persistence + model override fidelity + concurrency  
5. US4 → tool restriction enforcement  
6. US5 → switch/legacy/snapshot safety  
7. Polish → quickstart + docs  

### Parallel Team Strategy

1. Team completes Setup + Foundational together  
2. After foundation:  
   - Dev A: US1 then US2 (`NodeForms` ownership)  
   - Dev B: US3 persistence/settings runtime  
   - Dev C: US4 tool enforcement (+ coordinate compiler touches with B)  
3. US5 after core paths stable  

---

## Notes

- [P] tasks = different files, no dependencies on incomplete work  
- [Story] labels map to spec user stories US1–US5  
- Verify tests fail before implementing each story’s implementation tasks  
- `local` backend: treat `activeTools` as unsupported unless/until local gains ToolRuntime tool loop (see research Decision 6); model settings remain supported via schema  
- Do not introduce interpolation engines, workflow versioning products, or Registry redesign beyond the deep-link + warning  
- Commit after each task or logical TDD red→green group  
- Avoid: silent ignore of unsupported overrides; mutating shared `AgentRecord` during resolve/execute; collapsing omit vs `[]` for `activeTools`

---

## Phase 9: Convergence

**Purpose**: Close remaining gaps found by `/speckit-converge` against current code vs spec/plan/tasks (2026-11-04). Prior task checkboxes are left unchanged.

- [X] T059 Add failing-then-green coverage proving in-progress runs keep snapshotted step fields (`taskInstruction` / `modelSettingsOverride` / `activeTools`) from `workflowSnapshot` in `apps/server/src/runtime` even when the draft node config changes after start; place in `tests/agentStepConfigSnapshot.test.ts` (or adjacent run-store harness) per FR-027, US5/AC4, SC-008, T048 (`missing`)
- [X] T060 [P] Align stale Phase 2 roadmap bullets in `docs/visual-platform-recommendations.md` (items still claiming AgentNodeConfig step separation / NodeForms registry mutation are “still open”) with Finding 4 **SHIPPED** (`013-agent-step-config`) without rewriting unrelated findings per T056 (`partial`)
