# Tasks: Autonomous ReAct Agent Loop

**Input**: Design documents from `specs/012-react-agent-loop/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`)  
**Prerequisites**: `plan.md` (required), `spec.md` (user stories P1–P2), `research.md`, `data-model.md`, `contracts/`  
**Approach**: Test-Driven Development (TDD) — all test tasks MUST be written first and fail before implementing the corresponding feature code. User requested TDD via `/speckit-tasks Use TDD`.

**Tests note**: Spec acceptance criteria require `tests/apiAgentExecutorReAct.test.ts`. Include failing tests first in each story phase; confirm red, then implement to green.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`US1`…`US5`)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Contracts & Scaffolds)

**Purpose**: Land shared ReAct contracts, type stubs, and empty module scaffolds so TDD tests share stable import paths.

- [X] T001 Export/align effective-settings helpers from `specs/012-react-agent-loop/contracts/agent-react-loop.contract.ts` into `src/agents/runtime/reactSettings.ts` (`AgentExecutionMode` = `"single_turn" | "react"`; `resolveEffectiveReactSettings` with node → agent → default derivation; `AGENT_TOOL_LIMIT_EXCEEDED` constant; clamp `maxToolSteps` to integer range **1–10**, default **5**)
- [X] T002 [P] Create empty scaffold module `src/agents/runtime/toolBinding.ts` exporting stubs: `buildBoundToolSchemas(tools: ToolRecord[])`, `resolveToolCallName(name: string, tools: ToolRecord[])`, and types for bindable tool defs (stubs may throw `not implemented`)
- [X] T003 [P] Verify monorepo still typechecks after scaffolds: `pnpm --filter @multi-agent/types build` and `npx tsc --noEmit` (or project-equivalent root typecheck)

---

## Phase 2: Foundational (Types + Input Wiring — Blocks All Stories)

**Purpose**: Persistable config fields, trusted `AgentExecutionInput` tool deps, and compiler-ready resolution helpers. Must complete before any user-story loop/UI work.

> **CRITICAL**: No user story implementation can begin until this foundational phase is complete.

### Tests for Foundation (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T004 [P] Author unit tests in `tests/reactSettings.test.ts` covering `resolveEffectiveReactSettings`:
  - no tools + no overrides ⇒ `mode: "single_turn"`, `maxToolSteps: 5`
  - tools present + no overrides ⇒ `mode: "react"`
  - explicit agent `executionMode: "single_turn"` with tools ⇒ `single_turn`
  - node `executionMode` overrides agent
  - node/agent `maxToolSteps` overrides default; values outside **1–10** clamp into range; non-integers coerced/clamped safely
- [X] T005 [P] Author unit tests in `tests/agentRecordReactMigration.test.ts` verifying `migrateAgentRecord` / `createAgentRecord` in `packages/types/src/index.ts` preserve optional `executionMode` (`"single_turn" | "react"`) and `maxToolSteps` (clamp **1–10** when present) and omit them cleanly when absent

### Implementation for Foundation

- [X] T006 Add optional fields to `AgentRecord` and `AgentNodeConfig` in `packages/types/src/index.ts` per `specs/012-react-agent-loop/data-model.md` and `contracts/agent-config.schema.md`: `executionMode?: "single_turn" | "react"`; `maxToolSteps?: number` (document clamp **1–10**); update `migrateAgentRecord` and `createAgentRecord` accordingly
- [X] T007 [P] Extend validation in `packages/types/src/agentConfiguration.ts` (and/or node validators) to reject invalid `executionMode` values and clamp or flag invalid `maxToolSteps` outside **1–10**
- [X] T008 Extend `AgentExecutionInput` in `src/agents/runtime/types.ts` with optional trusted deps: `toolRuntime?: Pick<ToolRuntime,"execute">` and `resolvedTools?: ToolRecord[]` (import types without creating client-side authority)
- [X] T009 Implement `resolveEffectiveReactSettings` (non-stub) in `src/agents/runtime/reactSettings.ts` matching `contracts/agent-react-loop.contract.ts`; re-export from `src/agents/runtime/index.ts` if that barrel is the public surface
- [X] T010 Add compiler helper in `apps/server/src/compiler/workflowCompiler.ts` (or adjacent helper module) to resolve `agent.tools` ∩ compile `options.tools` ∩ `enabled === true` into `resolvedTools`, and pass `toolRuntime` + `resolvedTools` into `runtime.execute(...)` inside `runAgentThroughRuntime`
- [X] T011 Run foundation suites green: `pnpm test --runInBand -- tests/reactSettings.test.ts tests/agentRecordReactMigration.test.ts`

**Checkpoint**: Foundation ready — types, settings resolution, and compiler injection paths exist. User story work can begin.

---

## Phase 3: User Story 1 — Agent Uses Assigned Tools Autonomously (Priority: P1) 🎯 MVP

**Goal**: An API agent in ReAct mode with assigned tools binds those tools, executes authorized model tool requests via `ToolRuntime`, feeds results back, and returns a final answer without a separate canvas tool node.

**Independent Test**: Configure an agent with a lookup tool; prompt a task that requires that lookup; run with mocked LLM emitting one `tool_calls` then final text; verify `ToolRuntime.execute` once for the assigned tool and final output reflects tool result; unassigned tool names never execute.

### Tests for User Story 1 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T012 [P] [US1] Author failing tests in `tests/toolBinding.test.ts` for `buildBoundToolSchemas` / name mapping in `src/agents/runtime/toolBinding.ts`: each `ToolRecord` becomes a bindable schema with unique call name; description and input schema preserved; disabled/empty list handled
- [X] T013 [P] [US1] Author failing tests in `tests/apiAgentExecutorReAct.test.ts` for the single-tool happy path:
  - inject fake `getModel` whose first `invoke` returns `tool_calls`, second returns final text; model exposes `bindTools` spy
  - inject fake `toolRuntime.execute` returning fixture output
  - assert `bindTools` called when `mode=react` and `resolvedTools` non-empty
  - assert `toolRuntime.execute` called once with `authorizedToolIds` / assigned tool, `credentialPrincipal`, `runId`, `agentId`, and `parentSignal`
  - assert event order includes `agent.started`, `tool.started`, `tool.completed`, `agent.output`, `agent.completed` with `nodeId` set
  - assert final `agent.completed` content depends on tool output
- [X] T014 [P] [US1] Author failing tests in `tests/apiAgentExecutorReAct.test.ts` for unauthorized tool calls: model requests a name/id not in `resolvedTools` / `agent.tools` ⇒ `toolRuntime.execute` **never** called; `tool.failed` (or equivalent error observation path) emitted; loop can continue without granting access
- [X] T015 [P] [US1] Author failing regression in `tests/apiAgentExecutorReAct.test.ts` (or extend `tests/agentExecutor.test.ts`): `executionMode: "single_turn"` with tools assigned ⇒ no `bindTools` / no `toolRuntime.execute`; single invoke only

### Implementation for User Story 1

- [X] T016 [US1] Implement `buildBoundToolSchemas` and call-name resolution in `src/agents/runtime/toolBinding.ts` (schema-only bindables; no side effects inside tool funcs)
- [X] T017 [US1] Widen local `ChatModel` typing in `src/agents/runtime/apiAgentExecutor.ts` to support optional `bindTools(tools)`; fail clearly when ReAct expects tools but `bindTools` is missing
- [X] T018 [US1] Implement ReAct single-round path in `src/agents/runtime/apiAgentExecutor.ts`: resolve effective settings; if `react` + resolved tools, `bindTools`, invoke, on `tool_calls` authorize → emit `tool.started` → `ToolRuntime.execute` (no blanket `approvalGranted: true`; honor impact policy per research) → emit `tool.completed`/`tool.failed` → append tool messages → re-invoke until final text; preserve existing single-turn path when mode is `single_turn` or no tools
- [X] T019 [US1] Ensure unassigned tool names produce error `ToolMessage`/observation without execute; map `ToolPolicyError` / input validation to non-fatal observations unless classified fatal
- [X] T020 [US1] Run US1 suites green: `pnpm test --runInBand -- tests/toolBinding.test.ts tests/apiAgentExecutorReAct.test.ts` (and single-turn regression file touched)

**Checkpoint**: MVP — assigned tools are dynamically usable inside one agent node for a single tool round.

---

## Phase 4: User Story 2 — Multi-Step Tool Reasoning Within One Agent Node (Priority: P1)

**Goal**: Within one agent node, the agent can call Tool A, observe the result, call Tool B, then produce a final answer; non-fatal tool errors become observations rather than immediate workflow failure.

**Independent Test**: Scripted LLM returns tool_calls for tool A, then tool B, then final text; both executes occur under the same `nodeId`; final answer depends on both; a mid-loop HTTP-style tool failure yields error observation and continued loop.

### Tests for User Story 2 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T021 [P] [US2] Extend `tests/apiAgentExecutorReAct.test.ts` with multi-round fixture: invoke#1 tool A, invoke#2 tool B, invoke#3 final text; assert two `execute` calls in order, three model invokes, single `agent.completed`
- [X] T022 [P] [US2] Extend `tests/apiAgentExecutorReAct.test.ts` for parallel tool_calls in one model response: multiple calls in one round all execute (stable order) before the next model invoke; `iteration` payload matches the round index
- [X] T023 [P] [US2] Extend `tests/apiAgentExecutorReAct.test.ts` for non-fatal tool failure: `execute` throws timeout/remote error ⇒ `tool.failed` + error observation appended ⇒ model invoked again ⇒ can still `agent.completed` (unless fatal/security)

### Implementation for User Story 2

- [X] T024 [US2] Generalize the ReAct loop in `src/agents/runtime/apiAgentExecutor.ts` to support multiple tool rounds and multiple tool_calls per round while counting **tool-calling model rounds** toward `maxToolSteps` (per research Decision 4)
- [X] T025 [US2] Implement graceful non-fatal error → ToolMessage path and fatal/security fail-closed path in `src/agents/runtime/apiAgentExecutor.ts` (credential hard-fail / abort distinct from recoverable tool errors)
- [X] T026 [US2] Run US2 assertions green: `pnpm test --runInBand -- tests/apiAgentExecutorReAct.test.ts`

**Checkpoint**: Multi-turn reason–act–observe works inside one agent node.

---

## Phase 5: User Story 3 — Operators See Nested Tool Activity Live (Priority: P1)

**Goal**: Nested tool start/complete/fail events under the agent `nodeId` carry inspector-compatible payloads (`toolId`, `name`, sanitized args, `iteration`, `toolCallId`, output/error, `durationMs`) so existing Node Execution Inspector shows them without UI changes.

**Independent Test**: Collect yielded `AgentExecutionEvent`s from a ReAct run; assert payload shapes; confirm `mapAgentExecutionEvent` maps to run `tool.*` types; optional projection test that `buildNodeExecutionView` nests calls for that `nodeId`.

### Tests for User Story 3 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T027 [P] [US3] Extend `tests/apiAgentExecutorReAct.test.ts` asserting `tool.started` payload includes `{ toolId, name, arguments|input, iteration, toolCallId|callId }`, `tool.completed` includes `{ toolId, output|result, durationMs, toolCallId }`, `tool.failed` includes `{ toolId?, error, toolCallId }`, and every event has `nodeId === input.nodeId` and `agentId`
- [X] T028 [P] [US3] Author/extend test in `tests/mapAgentExecutionEvent.test.ts` (or adjacent) verifying ReAct-emitted `tool.*` events map via `src/agents/runtime/mapAgentExecutionEvent.ts` to run event types `tool.started` | `tool.completed` | `tool.failed` with payload preserved
- [X] T029 [P] [US3] Author test in `tests/nodeExecutionView.test.ts` (or new `tests/reactAgentInspectorProjection.test.ts`) feeding synthetic ReAct tool events for an agent `nodeId` into `buildNodeExecutionView` / projection helpers and asserting nested tool calls appear with args/results

### Implementation for User Story 3

- [X] T030 [US3] Align event payload field names in `src/agents/runtime/apiAgentExecutor.ts` with inspector expectations documented in `specs/012-react-agent-loop/data-model.md` and research Decision 8 (`toolCallId` compatibility with existing `parentEventId` / call matching in `apps/web/src/lib/runCanvasProjection.ts`)
- [X] T031 [US3] Ensure tool args/outputs passed into events avoid leasing secrets; rely on existing redact path in run store adapters; add executor-side omission of any credential material if present in raw tool I/O
- [X] T032 [US3] Run US3 suites green: `pnpm test --runInBand -- tests/apiAgentExecutorReAct.test.ts tests/mapAgentExecutionEvent.test.ts tests/nodeExecutionView.test.ts` (adjust to files actually touched)

**Checkpoint**: Live inspector can display nested tool activity under the agent node with no UI rewrite.

---

## Phase 6: User Story 4 — Configure Mode and Step Ceiling (Priority: P2)

**Goal**: Operators can view assigned tools, toggle Single-turn vs ReAct, and set max tool steps (1–10) on agent/node properties; subsequent runs honor effective settings.

**Independent Test**: Open agent properties with/without tools; verify default mode labeling; toggle mode and max steps; persist; executor/settings tests confirm overrides; UI tests cover controls.

### Tests for User Story 4 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T033 [P] [US4] Author component tests in `tests/agentReactNodeForm.test.tsx` for `apps/web/src/components/workflow/properties/NodeForms.tsx` (`AgentForm`):
  - shows assigned tools list/textarea
  - mode control Single-turn | ReAct
  - max tool steps numeric control clamped to **1–10**
  - saving patches `executionMode` / `maxToolSteps` onto agent (and node overrides if exposed on agent node config UI)
- [X] T034 [P] [US4] Extend `tests/reactSettings.test.ts` / `tests/apiAgentExecutorReAct.test.ts` proving UI-persisted agent vs node overrides change runtime behavior (node `single_turn` wins over agent `react`)

### Implementation for User Story 4

- [X] T035 [US4] Update `AgentForm` in `apps/web/src/components/workflow/properties/NodeForms.tsx` to show assigned tools (prefer registry name when `tools` store match exists), execution mode select, and max tool steps input (clamp **1–10**, default display **5**)
- [X] T036 [US4] If agent nodes expose per-node overrides, add `executionMode` / `maxToolSteps` controls on the agent node config path in `apps/web/src/components/workflow/properties/NodeForms.tsx` (or adjacent properties panel) writing `AgentNodeConfig` fields
- [X] T037 [US4] Wire compiler/executor to read node config overrides when invoking `resolveEffectiveReactSettings` from `apps/server/src/compiler/workflowCompiler.ts` + `src/agents/runtime/apiAgentExecutor.ts`
- [X] T038 [US4] Run US4 suites green: `pnpm test --runInBand -- tests/agentReactNodeForm.test.tsx tests/reactSettings.test.ts tests/apiAgentExecutorReAct.test.ts`

**Checkpoint**: Operators can configure autonomy knobs; runs honor them.

---

## Phase 7: User Story 5 — Safety Stops: Step Limit and Cancel (Priority: P1)

**Goal**: Hard ceiling fail-closed with `AGENT_TOOL_LIMIT_EXCEEDED`; cancel aborts in-flight model/tool work; fatal/security tool failures fail the agent node.

**Independent Test**: Force repeated tool_calls beyond `maxToolSteps` ⇒ distinct limit-exceeded failure and no further execute; abort signal mid-loop ⇒ no further execute; security/fatal path fails node.

### Tests for User Story 5 (TDD First)

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T039 [P] [US5] Extend `tests/apiAgentExecutorReAct.test.ts` for step ceiling: `maxToolSteps: 2` with model always returning tool_calls ⇒ at most 2 tool rounds; `agent.failed` payload includes `code: "AGENT_TOOL_LIMIT_EXCEEDED"`; `AgentExecutionFailedError` thrown; no 3rd `execute` batch
- [X] T040 [P] [US5] Extend `tests/apiAgentExecutorReAct.test.ts` for cancellation: abort `AbortSignal` before/during loop ⇒ stops further iterations; in-flight `execute` receives aborted/parent signal; no new tool rounds after abort
- [X] T041 [P] [US5] Extend `tests/apiAgentExecutorReAct.test.ts` for fatal/security failure classification (e.g. hard credential failure or designated security breach) ⇒ node fails closed without treating breach as recoverable observation
- [X] T042 [P] [US5] Author/extend test that `classifyRunFailure` (or run error mapping in `apps/server/src/runtime/runExecutor.ts`) surfaces `AGENT_TOOL_LIMIT_EXCEEDED` distinctly when present on the error/payload

### Implementation for User Story 5

- [X] T043 [US5] Enforce hard stop in `src/agents/runtime/apiAgentExecutor.ts` when a tool-calling round would exceed `maxToolSteps`: emit `agent.failed` with `AGENT_TOOL_LIMIT_EXCEEDED`, stop further tool calls, throw `AgentExecutionFailedError` (fail-closed; no synthetic final answer)
- [X] T044 [US5] Propagate `input.signal` to every `model.invoke` and `toolRuntime.execute`; check abort between iterations in `src/agents/runtime/apiAgentExecutor.ts`
- [X] T045 [US5] Map limit-exceeded into run failure classification in `apps/server/src/runtime/runExecutor.ts` (or shared error helper) so operators see a clear limit-exceeded outcome
- [X] T046 [US5] Run US5 suites green: `pnpm test --runInBand -- tests/apiAgentExecutorReAct.test.ts` plus any `classifyRunFailure` test file touched

**Checkpoint**: Loops cannot run unbounded; cancel and fatal paths are fail-closed and observable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Docs, regression hygiene, quickstart validation, secret-scan mindset.

- [X] T047 [P] Update developer docs mentioning agent execution / tools in `docs/development.md` and/or `docs/architecture.md` with ReAct mode, `maxToolSteps` (1–10, default 5), and ToolRuntime-only execution note
- [X] T048 [P] Add a secret-sanitization assertion in `tests/apiAgentExecutorReAct.test.ts` (or dedicated test) that tool event payloads do not include a planted API key / bearer token string from tool args/output fixtures
- [X] T049 Run full quickstart validation from `specs/012-react-agent-loop/quickstart.md`: `pnpm test --runInBand -- tests/apiAgentExecutorReAct.test.ts` and typecheck; fix any remaining single-turn regressions in `tests/agentExecutor.test.ts`
- [X] T050 Export new runtime symbols from `src/agents/runtime/index.ts` as needed; ensure `git diff --check` clean on touched files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS** all user stories
- **US1 (Phase 3)**: Depends on Foundational — 🎯 MVP
- **US2 (Phase 4)**: Depends on US1 loop skeleton (same `apiAgentExecutor.ts` / shared test file) — extend loop
- **US3 (Phase 5)**: Depends on US1 event emission; can overlap late US2 if payloads already stubbed
- **US4 (Phase 6)**: Depends on Foundational settings fields; runtime honor-path easiest after US1
- **US5 (Phase 7)**: Depends on US1/US2 loop; should land before calling the feature done
- **Polish (Phase 8)**: After desired stories complete

### User Story Dependencies

| Story | Priority | Depends on | Independently testable? |
| :--- | :---: | :--- | :--- |
| US1 Autonomous single-tool | P1 | Foundation | Yes (MVP) |
| US2 Multi-step reasoning | P1 | US1 loop | Yes with multi-round fixtures |
| US3 Live nested tool events | P1 | US1 events | Yes via event/projection tests |
| US4 Mode & step config UI | P2 | Foundation (+ US1 to prove runtime honor) | Yes via form + settings tests |
| US5 Limit & cancel safety | P1 | US1/US2 loop | Yes via ceiling/abort fixtures |

### Within Each User Story

1. Write tests → confirm **FAIL**
2. Implement → confirm **GREEN**
3. Checkpoint before next story when possible

### Parallel Opportunities

- T002/T003 after T001 patterns exist
- T004/T005 in parallel; T007 parallel to T006 after types sketched
- US1: T012, T013, T014, T015 tests in parallel before T016–T019
- US2: T021–T023 tests in parallel
- US3: T027–T029 tests in parallel
- US4: T033/T034 in parallel
- US5: T039–T042 tests in parallel
- Polish T047/T048 in parallel

---

## Parallel Example: User Story 1

```bash
# Launch US1 failing tests together (TDD red):
Task: "tests/toolBinding.test.ts schema conversion"
Task: "tests/apiAgentExecutorReAct.test.ts single-tool happy path"
Task: "tests/apiAgentExecutorReAct.test.ts unauthorized rejection"
Task: "tests/apiAgentExecutorReAct.test.ts single_turn regression"

# Then implement sequentially (same executor file):
Task: "toolBinding.ts implementation"
Task: "apiAgentExecutor bindTools + first ReAct round"
Task: "unauthorized + policy observation paths"
```

---

## Parallel Example: User Story 5

```bash
# Safety tests in parallel:
Task: "maxToolSteps ceiling → AGENT_TOOL_LIMIT_EXCEEDED"
Task: "AbortSignal cancels further tool rounds"
Task: "fatal/security fail-closed"
Task: "classifyRunFailure mapping"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup  
2. Complete Phase 2: Foundational (CRITICAL)  
3. Complete Phase 3: US1 (TDD)  
4. **STOP and VALIDATE** with `tests/apiAgentExecutorReAct.test.ts` single-tool path  
5. Demo: agent calls one assigned tool without a canvas tool node  

### Incremental Delivery

1. Setup + Foundational → types & injection ready  
2. US1 → autonomous single-tool MVP  
3. US2 → multi-round + graceful tool errors  
4. US3 → inspector-grade event payloads / projection proof  
5. US5 → ceiling + cancel (recommended before production)  
6. US4 → operator configuration UI  
7. Polish → docs + quickstart  

### Parallel Team Strategy

1. Team completes Setup + Foundational together  
2. After Foundational:  
   - Dev A: US1 → US2 → US5 (executor core)  
   - Dev B: US3 projection/event contract tests  
   - Dev C: US4 forms/settings (after T006 types land)  

---

## Notes

- [P] = different files / no wait on incomplete sibling tasks  
- [USn] maps to spec user stories for traceability  
- TDD is mandatory for this task list — verify red before green  
- `maxToolSteps` means **tool-calling model rounds** (may include multiple parallel tool_calls)  
- Do **not** set blanket `approvalGranted: true` for autonomous calls  
- Fail-closed on ceiling: `AGENT_TOOL_LIMIT_EXCEEDED` — no synthetic final answer  
- Commit after each task or logical TDD pair  
- Suggested MVP scope: **Phase 1 + 2 + US1 only**

---

## Phase 9: Convergence

**Purpose**: Close remaining gaps between shipped code and `spec.md` / `plan.md` / research decisions after T001–T050. Append-only; do not renumber prior tasks.

- [X] T051 CRITICAL: In `src/agents/runtime/apiAgentExecutor.ts`, set `approvalGranted` from tool policy per plan Decision 5 / FR-005 (`requiresApproval === false` → grant; otherwise `false`; never blanket-true for mutating tools) so write/external tools that opt out of approval can execute through `ToolRuntime` (contradicts)
- [X] T052 [P] Add failing then green coverage in `tests/apiAgentExecutorReAct.test.ts` asserting Decision 5 approval wiring: default `approvalGranted: false` for `requiresApproval: true` / high-impact tools; `requiresApproval: false` non-read-only tool receives `approvalGranted: true` and reaches `execute` (plan: Decision 5) (partial)
- [X] T053 When effective mode is `react` and the agent has assigned tools, fail closed in `src/agents/runtime/apiAgentExecutor.ts` if `toolRuntime` is missing or no usable `resolvedTools` remain—do not silently fall back to single-turn (FR-001, FR-003; spec edge) (partial)
- [X] T054 Validate `AgentNodeConfig.executionMode` (`"single_turn" | "react"`) and clamp/flag `maxToolSteps` (1–10) in `apps/server/src/compiler/nodeValidators.ts`; normalize invalid mode strings in `src/agents/runtime/reactSettings.ts` so garbage node overrides cannot silently disable ReAct (FR-013, FR-014) (missing)
- [X] T055 [P] Strengthen cancel coverage in `tests/apiAgentExecutorReAct.test.ts` so `toolRuntime.execute` is shown to receive the parent `AbortSignal` and no further tool rounds start after abort (FR-010; US5/AC2) (partial)
- [X] T056 [P] Update `docs/visual-platform-recommendations.md` Finding 2 / Phase 2 wording to reflect that the autonomous ReAct loop and `bindTools` path are implemented (docs consistency) (unrequested)
)
