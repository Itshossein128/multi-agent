# Implementation Plan: Agent Thinking Visibility

**Branch**: `023-agent-thinking-visibility` | **Date**: 2026-11-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-agent-thinking-visibility/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Operators can read the working text an agent shares while a step is running, and again after that step completes, is stopped, or fails. Thinking stays labeled apart from the answer, from tool activity, and from errors. Later steps still receive only the answer.

Approach (from [research.md](./research.md)):

1. Extract thinking only from structured channels the executors already receive (Codex reasoning items, Claude thinking blocks, API content blocks and `reasoning_content`, an Agy thinking field when one exists). Leave answer parsers on `content` unchanged. Plain stdout is never treated as thinking.
2. Publish that text as existing `log` events with `channel: "thinking"`, in chunks that fit the current run-event payload bound. A terminal marker says the attempt shared thinking or shared none. Older events without that marker stay "unavailable".
3. Project those events into per-attempt transcripts. The canvas inspector and the run review both render that projection in an open Thinking area, with follow-the-latest scrolling that does not jump when the reader has moved up.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+

**Primary Dependencies**: Existing agent executors (`src/agents/runtime`), run event stream (`RunEvent` type `log`), `boundJsonValue` / `redact` on append, web projection in `apps/web/src/lib/runCanvasProjection.ts`, `NodeExecutionInspector`, `ExecutionTimeline`

**Storage**: No new tables and no new `RunEvent` type. Thinking is appended as `log` payloads on the run the operator can already read. Chunks stay under the default 64 KiB event payload bound (`RUN_EVENT_MAX_PAYLOAD_BYTES`). Retention matches the rest of that run's events.

**Testing**: Jest (`pnpm test --runInBand`); parser fixtures, projection cases for attempts and availability, executor tests that the answer `content` is unchanged

**Target Platform**: Execution server + Agent Studio (workflow canvas Live inspector and run review) in modern browsers

**Project Type**: Monorepo web application (`src/agents/runtime`, `apps/web`, `tests/`)

**Performance Goals**:

- A thinking chunk is visible on an open step once the run event is appended. CLI reasoning items are emitted when the item completes in the worker stdout stream, not when the process exits.
- API and other request/response executors emit thinking when the model response returns. The spec allows thinking that arrives only at the end of the call.
- Chunk size is 8 000 characters so a normal thinking record is stored whole.

**Constraints**:

- Thinking MUST NOT be copied into `agent.completed` `content`, working memory, handoff, or the value later steps receive.
- No new run permission. Secret redaction stays on the existing append path. Provider signatures are not shown.
- Do not invent thinking. Whitespace-only text is "no thinking was shared".
- Missing `thinkingStatus` on a finished attempt means unavailable, which is a different message from none.
- This feature does not add a pause, an edit box, or a way to send instructions into a running agent.

**Scale/Scope**: One payload contract, one projection, two reading surfaces (canvas inspector and run review). Agent test history uses the same timeline labeling. Not a new streaming protocol and not a new event type.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution file is still a template stub. Gates follow the monorepo security and runtime norms used by features 009–016.

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | Thinking is stored only on the current run's event list. No new store, no cross-run or cross-tenant read. |
| **Control-Plane Authority** | PASS | Executors decide what is thinking versus the answer. The client only projects stored events and never fills in missing text. |
| **Human Governance** | PASS | Stop and existing human decisions are unchanged. Thinking is not a new approval gate. |
| **Observability Without Authority Leak** | PASS | Same people who can read the run can read its thinking. Append still redacts. Thinking signatures and launch secrets are not displayed. |
| **Backward Compatibility** | PASS | `RunEvent` vocabulary is unchanged. Legacy `payload.thoughts` / `payload.reasoning` still project. Runs with no marker say thinking is unavailable. |
| **Simplicity & Monorepo Idioms** | PASS | Reuse `log` events, `buildNodeExecutionView`, and the inspector. No new package or service. |
| **Performance / UX Safety** | PASS | Chunks avoid the payload truncation marker. Follow-scroll yields when the reader has moved up. |

*Post-Phase 1 re-check*: PASS. The data model keeps thinking off `content`, distinguishes shared / none / unavailable / pending, and scopes text to one step and one attempt. No gate failed.

## Project Structure

### Documentation (this feature)

```text
specs/023-agent-thinking-visibility/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── agent-thinking.contract.ts
├── checklists/
│   └── requirements.md
└── tasks.md                 # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
src/agents/runtime/
├── thinkingText.ts            # Split answer vs thinking; chunk; whitespace rule
├── cliAgentExecutor.ts        # Consume worker stdout while waiting; emit thinking logs; keep answer parsers
├── apiAgentExecutor.ts        # Extract thinking blocks per model round; exclude them from content
├── localAgentExecutor.ts      # Terminal thinkingStatus "none" unless a structured channel exists
├── processAgentExecutor.ts    # Same terminal marker
└── webhookAgentExecutor.ts    # Same terminal marker

apps/web/src/lib/runCanvasProjection.ts   # Per-attempt thinking transcript and availability
apps/web/src/components/workflow/live/
├── ThinkingTranscript.tsx     # Open Thinking area, outcome labels, follow-scroll
└── NodeExecutionInspector.tsx # Always show the transcript for an agent step
apps/web/src/components/runs/
├── ExecutionTimeline.tsx      # Label thoughts as Thinking in the readable view
└── RunThinkingSection.tsx     # Run review list, one transcript per agent step
apps/web/src/app/(authenticated)/o/[orgSlug]/runs/[runId]/page.tsx

tests/
├── thinkingText.test.ts
├── cliThinkingStream.test.ts
├── apiAgentThinking.test.ts
└── nodeExecutionView.test.ts  # Extend; keep the existing thoughts append case
```

**Structure Decision**: Capture thinking at the executor boundary and project it in the web app. The run store, event types, and answer path stay as they are.

## Complexity Tracking

*No constitutional violations.* A new `RunEvent` type was rejected because the public event vocabulary is closed and `log` already carries free-form payloads. A separate thinking table was rejected because it would be a second record with its own permission and retention story; the run event list is already what the operator is allowed to see.

## Phase outputs

| Phase | Artifact | Status |
| :--- | :--- | :--- |
| 0 | [research.md](./research.md) | Complete |
| 1 | [data-model.md](./data-model.md) | Complete |
| 1 | [contracts/](./contracts/) | Complete |
| 1 | [quickstart.md](./quickstart.md) | Complete |
| 2 | [tasks.md](./tasks.md) | Complete |
