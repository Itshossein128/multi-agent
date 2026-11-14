# Tasks: Agent Thinking Visibility

**Input**: Design documents from `specs/023-agent-thinking-visibility/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`)

**Prerequisites**: `plan.md` (required), `spec.md` (user stories P1–P2), `research.md`, `data-model.md`, `contracts/agent-thinking.contract.ts`

**Tests**: `quickstart.md` makes the Jest gates the primary check. Include those verification tests in the story that owns them. Write each story's tests before that story's implementation. This is not a separate red-green mandate beyond that order.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`US1`…`US5`)
- Include exact file paths in descriptions

## Path Conventions

- Executors: `src/agents/runtime/`
- Web: `apps/web/src/`
- Tests: `tests/` at the repository root
- No new `RunEvent` type, package, table, or environment variable

---

## Phase 1: Setup (Shared Contracts Alignment)

**Purpose**: Confirm the feature directory and the payload contract before any runtime or UI work.

- [X] T001 Confirm feature docs are present and `.specify/feature.json` `feature_directory` is `specs/023-agent-thinking-visibility`: `specs/023-agent-thinking-visibility/plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/agent-thinking.contract.ts`, `checklists/requirements.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: One helper that chunks thinking, rejects blank text, and splits answer text from structured thinking. Every story calls this helper. No executor or UI work yet.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 Add failing cases in `tests/thinkingText.test.ts` for `src/agents/runtime/thinkingText.ts`: a string longer than 8 000 characters splits so every chunk length is ≤ `THINKING_CHUNK_CHARS` (8 000); joining chunks in `part` order restores the original string; empty and whitespace-only text is blank; a `thinking` or `reasoning` block is thinking and its `signature` is omitted; a `text` block is answer text; a block that is both reasoning and has `text` contributes that `text` only to thinking, not to the answer
- [X] T003 Implement `src/agents/runtime/thinkingText.ts` to pass T002. Export `THINKING_CHUNK_CHARS = 8_000`, `THINKING_COPY` (`pending`: "Thinking has not arrived yet.", `none`: "No thinking was shared.", `unavailable`: "Thinking is unavailable for this run.", `incomplete`: "The run record stopped before the rest of this thinking was saved."), and `THINKING_FOLLOW_THRESHOLD_PX = 48`, matching `specs/023-agent-thinking-visibility/contracts/agent-thinking.contract.ts`. Do not import the spec file. `buildThinkingLogs` returns `log` payloads whose `channel` is always `"thinking"`, `thoughts` is a string (empty only when `thinkingStatus` is `"none"`), `thinkingStatus` is `"shared"` or `"none"`, `final` is boolean, and `part` is the 0-based chunk index. The last payload of an attempt has `final: true`

**Checkpoint**: Foundation ready. User story work can begin. Prefer US1 first.

---

## Phase 3: User Story 1 — Read Thinking While the Agent Works (Priority: P1) 🎯 MVP

**Goal**: While an agent step is working, the open Thinking area on that step shows the structured thinking it shares, in order, including a tool marker between two stretches. Another step's thinking is not included. New chunks appear from the existing run event stream without a reload.

**Independent Test**: Run a workflow whose agent shares thinking before it finishes. Open that step while it is working and confirm the Thinking area shows the text in order and updates without a reload.

### Tests for User Story 1

- [X] T004 [P] [US1] Add `tests/cliThinkingStream.test.ts`. A Codex JSONL fixture with a `reasoning` item (or `item.type` ending in `_reasoning`) and a later `agent_message` yields thinking logs from the reasoning text only, in stream order, before process exit is required for the assertion. `agent_message`, command, and tool items are not thinking. Plain stdout produces no thinking chunk
- [X] T005 [P] [US1] Extend `tests/nodeExecutionView.test.ts`. Thinking-channel chunks for one node append in `sequence` then `part` order. A `tool.started` between two chunks becomes a segment `{ kind: "tool", label, status }` between two `{ kind: "thinking", text }` segments. A second node's events are excluded. The existing case still expects `thoughtsText` `"First then"`

### Implementation for User Story 1

- [X] T006 [P] [US1] In `src/agents/runtime/cliAgentExecutor.ts`, after `workerRuntime.start`, read `workerRuntime.stream` while `wait` runs. Buffer stdout to newlines. Emit thinking `log` events through `buildThinkingLogs` when a Codex, Claude, or Agy structured thinking field completes (research Decision 1). Do not change the `content` returned by `parseCodexOutput`, `parseClaudeOutput`, or `parseAgyStreamOutputWithSession`. Do not treat plain stdout or stderr as thinking
- [X] T007 [P] [US1] In `src/agents/runtime/apiAgentExecutor.ts`, emit that round's thinking `log` events when `invoke` returns and before any `tool.started` for that round. The `AIMessage` kept for the provider transcript may still carry the original blocks. `agent.output` and `agent.completed` `content` stay the answer text only
- [X] T008 [P] [US1] In `apps/web/src/lib/runCanvasProjection.ts`, project `channel: "thinking"` chunks and legacy `payload.thoughts` / `payload.reasoning` into `thinkingAttempts` segments for the selected node only. `NodeExecutionView.thoughtsText` remains the latest attempt's joined thinking text. Ignore a thinking log whose `thoughts` is not a string
- [X] T009 [US1] Add `apps/web/src/components/workflow/live/ThinkingTranscript.tsx` with a visible heading "Thinking" that renders `thinkingAttempts` segments in order. Tool markers are one line (name and status). Arguments and results stay in the existing Tools section of `apps/web/src/components/workflow/live/NodeExecutionInspector.tsx`
- [X] T010 [US1] Replace the closed "Published thoughts" disclosure in `apps/web/src/components/workflow/live/NodeExecutionInspector.tsx` with `ThinkingTranscript` for a node whose type is `agent`, or whose events include `agent.started` or a thinking-channel log. The region is visible without opening a disclosure or a raw payload view
- [X] T011 [US1] Run the US1 suites green: `pnpm test --runInBand --testPathPattern='cliThinkingStream|nodeExecutionView|thinkingText'`

**Checkpoint**: MVP. An operator watching an agent step can read shared thinking in order while the step is working.

---

## Phase 4: User Story 2 — Keep Thinking Separate from the Answer (Priority: P1)

**Goal**: Thinking and the answer are labeled apart. Later steps still receive the answer. Showing thinking does not change which tools are called or whether the run succeeds.

**Independent Test**: Complete an agent step that shares both thinking and an answer. Confirm the two are labeled separately, and confirm the next step still receives the same answer it would have received before this feature.

### Tests for User Story 2

- [X] T012 [P] [US2] Add `tests/apiAgentThinking.test.ts`. Claude or API blocks of type `thinking` plus `text` put only the `thinking` string in the thinking log and only the `text` block in `content`. A reasoning part that also has `text` does not include that `text` in `content`. `redacted_thinking` alone produces `thinkingStatus: "none"` and no invented text. Agy `result.response` stays `content`; only a `thinking` or `reasoning` string on a non-result event is thinking
- [X] T013 [P] [US2] Extend `tests/cliThinkingStream.test.ts` so the Codex fixture's `content` equals the `agent_message` text only, and the Claude fixture's `content` equals the `text` block only

### Implementation for User Story 2

- [X] T014 [US2] In `src/agents/runtime/apiAgentExecutor.ts`, build `agent.output` and `agent.completed` `content` from the answer portion of `thinkingText` only. Do not copy `thoughts` into `content`. Leave `src/agents/runtime/agentRuntime.ts` reading `agent.completed` `content` for the node value, working memory, and handoff
- [X] T015 [US2] In `apps/web/src/components/workflow/live/NodeExecutionInspector.tsx`, keep Stream and Result on the answer and result fields. Do not render `thinkingAttempts` text inside Stream, Result, or Error. The Thinking heading must not read as the step result
- [X] T016 [US2] Run the US2 suites green: `pnpm test --runInBand --testPathPattern='apiAgentThinking|cliThinkingStream'`

**Checkpoint**: Thinking is visible and the answer passed onward is unchanged.

---

## Phase 5: User Story 3 — Review Thinking After the Step Ends (Priority: P1)

**Goal**: Thinking produced before a step completes, is stopped, or fails stays readable on the canvas and on the run review, labeled with that outcome and with the attempt it belongs to.

**Independent Test**: Finish one agent step, stop a second run while the agent is still sharing thinking, and fail a third. Reopen each run and confirm the thinking produced up to that point is still readable and matched to the outcome.

### Tests for User Story 3

- [X] T017 [US3] Extend `tests/nodeExecutionView.test.ts`. A second `node.started` with `payload.attempt` integer ≥ 1 keeps attempt 1 and attempt 2 text apart. `thoughtsText` is only the latest attempt's text. Run status `cancelled` labels the open attempt `stopped` and keeps its text even if `agent.failed` was also stored. `node.completed` labels `completed`. A terminal `node.failed` or `agent.failed` while the run is not cancelled labels `failed`. A non-terminal `node.failed` followed by `node.retrying` closes that attempt as `failed` and opens the next

### Implementation for User Story 3

- [X] T018 [US3] In `apps/web/src/lib/runCanvasProjection.ts`, open a `ThinkingAttempt` on `node.started` or `node.retrying`. Use `payload.attempt` when it is an integer ≥ 1; otherwise use 1 plus the number of earlier starts for that node. Apply the outcome rules from T017. Do not drop text when the attempt ends
- [X] T019 [US3] In `src/agents/runtime/cliAgentExecutor.ts` and `src/agents/runtime/apiAgentExecutor.ts`, emit one final thinking log (`final: true`) on success, failure, and cancellation when the executor still has control. Set `thinkingStatus` to `"shared"` when any non-whitespace chunk was emitted, otherwise `"none"`. Optionally mirror `thinkingStatus` on `agent.completed`, `agent.output`, or `agent.failed` with no thinking text on that payload
- [X] T020 [P] [US3] Add `apps/web/src/components/runs/RunThinkingSection.tsx` and render it from `apps/web/src/app/(authenticated)/o/[orgSlug]/runs/[runId]/page.tsx`. One transcript per `nodeId` that has `agent.started` or a thinking-channel log, using the same projection as the inspector. No raw payload view is required
- [X] T021 [P] [US3] In `apps/web/src/components/runs/ExecutionTimeline.tsx`, treat `thoughts` as readable text and label that section "Thinking" so agent test history is readable without the raw tab
- [X] T022 [US3] Run the US3 suite green: `pnpm test --runInBand --testPathPattern='nodeExecutionView'`

**Checkpoint**: A reopened run still shows each attempt's thinking, labeled completed, stopped, or failed.

---

## Phase 6: User Story 4 — Follow Along Without Losing Your Place (Priority: P2)

**Goal**: The transcript keeps the latest text in view while the reader is following it, and stays put when they have scrolled up. The full text can be reached from start to end.

**Independent Test**: Watch a long thinking passage, scroll up to an earlier paragraph while more text arrives, confirm the view stays on that paragraph, then move to the latest text and confirm it is all still there.

### Tests for User Story 4

- [X] T023 [US4] Extend `tests/thinkingText.test.ts` for `shouldFollowThinkingTail`. Distance from the bottom ≤ `THINKING_FOLLOW_THRESHOLD_PX` (48) follows. Distance greater than 48 does not. A thinking payload stored as `{ truncated: true, preview }` sets `recordIncomplete`

### Implementation for User Story 4

- [X] T024 [US4] In `apps/web/src/components/workflow/live/ThinkingTranscript.tsx`, follow the latest text only when `shouldFollowThinkingTail` is true. Scrolling above the 48px threshold leaves the scroll position where the reader put it. The region scrolls to the start and the end. Do not line-clamp or permanently hide the tail
- [X] T025 [US4] In `apps/web/src/lib/runCanvasProjection.ts` and `ThinkingTranscript.tsx`, set `recordIncomplete` when a thinking payload was replaced by the store truncation marker or a later log on the run has `eventLimitReached: true`. Show `THINKING_COPY.incomplete` ("The run record stopped before the rest of this thinking was saved."). Do not drop the text already projected

**Checkpoint**: A long live transcript can be read without the view jumping, and a shortened record says so.

---

## Phase 7: User Story 5 — Know When Thinking Is Missing (Priority: P2)

**Goal**: A finished attempt that shared nothing says "No thinking was shared." An older attempt with no stored thinking says "Thinking is unavailable for this run." A running attempt with nothing yet says "Thinking has not arrived yet." The product does not invent thinking.

**Independent Test**: Run an agent that shares no thinking and confirm the none message. Open an older run that has no stored thinking and confirm the unavailable message. The two sentences differ.

### Tests for User Story 5

- [X] T026 [US5] Extend `tests/nodeExecutionView.test.ts`. In-progress attempt, empty text, no final none marker → availability `pending` and copy "Thinking has not arrived yet." Final `thinkingStatus: "none"`, or only whitespace, → `none` and copy "No thinking was shared." Finished attempt with no `thinkingStatus` and empty text → `unavailable` and copy "Thinking is unavailable for this run." Non-whitespace text stays `shared` even if a `none` marker is also present

### Implementation for User Story 5

- [X] T027 [US5] Implement the availability table from T026 in `apps/web/src/lib/runCanvasProjection.ts`. Do not infer thinking from the answer, from tool output, or from another node. `pending` is not used once the outcome is `completed`, `stopped`, or `failed`
- [X] T028 [P] [US5] In `src/agents/runtime/localAgentExecutor.ts`, emit one final thinking log with `thinkingStatus: "none"`, `thoughts: ""`, `channel: "thinking"`, and `final: true` when the call returns or fails. Do not scrape `content` into thinking
- [X] T029 [P] [US5] In `src/agents/runtime/processAgentExecutor.ts`, emit the same final none marker beside the existing completion or failure. Do not scrape stdout into thinking
- [X] T030 [P] [US5] In `src/agents/runtime/webhookAgentExecutor.ts`, emit the same final none marker. Do not scrape the webhook body into thinking
- [X] T031 [US5] In `src/agents/runtime/cliAgentExecutor.ts`, when the stream ends with no structured thinking, emit the final none marker from T019 rather than omitting the channel. Cursor and other CLI output with no reasoning field follow this path
- [X] T032 [US5] Render `THINKING_COPY.pending`, `THINKING_COPY.none`, and `THINKING_COPY.unavailable` from `apps/web/src/components/workflow/live/ThinkingTranscript.tsx` using the projected availability. Do not leave the region blank
- [X] T033 [US5] Run the US5 suites green: `pnpm test --runInBand --testPathPattern='nodeExecutionView|thinkingText|cliThinkingStream'`

**Checkpoint**: The three empty states are distinct. New executors record none. Old runs stay unavailable.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Checks that span the stories. No new permission and no change to the answer path.

- [X] T034 [P] Update the live-inspector paragraph in `docs/development.md` so it describes an open Thinking area with the none and unavailable messages, instead of only "published output/thoughts"
- [X] T035 [P] Confirm `src/agents/runtime/mapAgentExecutionEvent.ts` still maps executor `log` events to run `log` events, and that those events still pass through `append` in `apps/server/src/runtime/store/inMemoryRunStore.ts` (`redact`, then `boundJsonValue`). Do not add a route, a `RunEvent` type, or a second redactor
- [X] T036 Run the quickstart typecheck: `npx tsc --noEmit -p apps/web` and `npx tsc --noEmit -p apps/server`
- [X] T037 Run the quickstart test gate from `specs/023-agent-thinking-visibility/quickstart.md`: `pnpm test --runInBand --testPathPattern='thinkingText|cliThinkingStream|apiAgentThinking|nodeExecutionView'`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. Start immediately.
- **Foundational (Phase 2)**: Depends on Setup. Blocks every user story.
- **User Stories (Phases 3–7)**: Depend on Foundational. US2, US3, and US5 also edit files US1 introduces, so the safe order is US1 → US2 → US3 → US4 → US5.
- **Polish (Phase 8)**: Depends on the stories you intend to ship.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational. No dependency on later stories. MVP.
- **User Story 2 (P1)**: Starts after US1. It locks `content` in the executors US1 edits. Independently testable by comparing thinking logs with `content`.
- **User Story 3 (P1)**: Starts after US1. Attempt grouping extends the projection US1 adds. The run page does not require US2's label split, but the canvas review uses the same transcript.
- **User Story 4 (P2)**: Starts after US1's `ThinkingTranscript`. Scroll behavior does not require US2 or US3.
- **User Story 5 (P2)**: Starts after US3's final marker and US1's transcript. Availability copy is independent of scroll behavior.

### Within Each User Story

- Tests for that story are written before its implementation tasks.
- The shared helper from Phase 2 is used instead of a second chunker.
- Executor emission lands before the UI task that displays it.
- A story's test command is the last task in that phase.

### Parallel Opportunities

- T004 and T005 can run together.
- T006, T007, and T008 can run together after T004 and T005.
- T012 and T013 can run together.
- T020 and T021 can run together after T018.
- T028, T029, and T030 can run together after T026.
- T034 and T035 can run together.

---

## Parallel Example: User Story 1

```bash
# Tests together, after Phase 2:
# tests/cliThinkingStream.test.ts
# tests/nodeExecutionView.test.ts

# Then implementation together:
# src/agents/runtime/cliAgentExecutor.ts
# src/agents/runtime/apiAgentExecutor.ts
# apps/web/src/lib/runCanvasProjection.ts
```

## Parallel Example: User Story 5

```bash
# After the availability tests:
# src/agents/runtime/localAgentExecutor.ts
# src/agents/runtime/processAgentExecutor.ts
# src/agents/runtime/webhookAgentExecutor.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Stop and run `pnpm test --runInBand --testPathPattern='cliThinkingStream|nodeExecutionView|thinkingText'`.
4. Demo the open Thinking area on a live agent step.

### Incremental Delivery

1. Setup + Foundational → helper can chunk and split text.
2. US1 → live thinking on the canvas (MVP).
3. US2 → answer stays free of thinking.
4. US3 → the same text survives on the run review, per attempt and outcome.
5. US4 → long text can be read without the view jumping.
6. US5 → none, unavailable, and pending use different sentences.
7. Polish → typecheck and the full quickstart pattern.

### Parallel Team Strategy

After Phase 2, one person can own US1. A second person should not edit `cliAgentExecutor.ts`, `apiAgentExecutor.ts`, or `runCanvasProjection.ts` until US1's tasks on those files are done. US4 can start once `ThinkingTranscript.tsx` exists. T028–T030 can start once the payload helper from Phase 2 exists, because those executors are not on the US1 path.

---

## Notes

- `channel` is always `"thinking"`. `thoughts` is empty only when `thinkingStatus` is `"none"`. `part` is 0-based. `final: true` marks the last log of that attempt.
- Chunks stay at or under 8 000 characters so the default 64 KiB event payload stores the text instead of a truncation marker.
- Do not invent thinking. Do not put thinking into `agent.completed` `content`.
- People who cannot read the run still cannot read its thinking. No new URL.
- Commit after each phase. Stop at any checkpoint to validate that story on its own.
