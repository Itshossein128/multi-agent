# Research: Agent Thinking Visibility

**Feature Branch**: `023-agent-thinking-visibility`  
**Date**: 2026-11-14  
**Status**: Completed  

---

## Executive Summary

The studio already has a place for thoughts, and it does not show them. `buildNodeExecutionView` appends `payload.thoughts` or `payload.reasoning` into `thoughtsText`, but executors never set those fields. `NodeExecutionInspector` renders that string only inside a closed "Published thoughts" disclosure, and only when the string is non-empty. `ExecutionTimeline` readable mode does not treat `thoughts` as text, so a stored value would land in the metadata block.

The answer path is `agent.completed` `content`. `agentRuntime` copies that content into the node value after removing working-memory updates. CLI parsers keep the final assistant message and drop everything else. API `normalizeContent` joins content parts that have `text` and would fold a reasoning summary into the answer if a part exposed `text`.

`workerRuntime.stream` already emits secret-redacted stdout while `wait` is in flight. The CLI executor uses only `wait`, so reasoning that appears mid-process is invisible until the process exits, and then it is discarded.

Run events are appended through `redact` and `boundJsonValue`. The default payload ceiling is 64 KiB. Oversized payloads become `{ truncated, preview }` and are no longer readable text. The event type set is closed; unknown executor types are stored as `log`.

All design choices below are resolved. Nothing remains as NEEDS CLARIFICATION.

---

## Technical Decisions & Rationale

### Decision 1: Which text counts as thinking

#### Problem
CLI stdout, API message content, and stderr all contain text. Treating all of it as thinking would copy the answer into the Thinking area and could change what operators believe the step returned.

#### Alternatives Considered
1. **Show the whole stdout or model content as thinking** — Duplicates the answer and violates the spec's separation rule.
2. **Ask providers to enable a new thinking mode** — Out of scope. The spec does not require agents to start thinking; it requires showing thinking they already share.
3. **Extract only structured reasoning channels, and leave answer parsers alone** (Selected).

#### Decision
- Codex JSONL: `item.completed` or `item.updated` whose `item.type` is `reasoning` or ends with `_reasoning`. Text is `item.text`, else the joined `summary` strings. `agent_message`, `message`, `assistant_message`, command, and tool items are not thinking.
- Claude stream or message JSON: content blocks whose `type` is `thinking`. The visible text is the `thinking` string. `redacted_thinking` has no shared text and does not count as shared. `text` blocks stay the answer.
- API chat results: the same block types, plus a string `additional_kwargs.reasoning_content` or `additional_kwargs.reasoning`. Those parts are removed before `normalizeContent` runs, so a reasoning part that also has `text` cannot join the answer.
- Agy stream JSON: a string field named `thinking` or `reasoning` on a non-result event. `result.response` stays the answer and is never copied into thinking.
- Plain stdout, stderr, webhook bodies, and local model `content` with no structured channel are not thinking.

#### Rationale
This matches text the agent actually shares as reasoning, and it keeps today's answer strings stable for Codex, Claude, Agy, and API executors.

---

### Decision 2: How thinking is stored

#### Problem
The spec needs live updates, a full readable record after stop or failure, and a way to tell "the agent shared nothing" from "this old run never stored thinking". A new event type or table would widen the public vocabulary and add a second permission story.

#### Alternatives Considered
1. **New `agent.thinking` event type** — The shared `RunEventType` set is closed. `mapAgentExecutionEvent` turns unknown types into `log` anyway.
2. **Put the full thinking string on `agent.completed`** — Completion is held for memory writes, so it shows up late, and a second copy of streamed chunks is easy to double-count. The projection already replaces `thoughtsText` when a completed event carries `thoughts`.
3. **`log` events with a thinking channel, chunked, plus a terminal status** (Selected).

#### Decision
- Payload shape is [agent-thinking.contract.ts](./contracts/agent-thinking.contract.ts). `channel` is `"thinking"`. `thoughts` is one chunk. `thinkingStatus` is `"shared"` or `"none"`. `final: true` marks the last record for that attempt.
- Chunks are at most 8 000 characters. That stays under the default 64 KiB event payload after JSON encoding, so `boundJsonValue` stores the chunk as text instead of a truncation marker.
- There is no separate product cap on total length. If the run hits the existing event-count limit, the Thinking area says the record stopped accepting events. It does not silently drop the tail.
- Executors that share no structured thinking still emit one final log with `thinkingStatus: "none"` and an empty `thoughts` string. They emit it on success, failure, and cancellation when the executor still has control.
- Historical events have no `thinkingStatus`. The projection must not read that absence as "none".

#### Rationale
`log` is already persisted, streamed to the studio, and redacted on append. The terminal marker is what makes the two empty states in the spec testable.

---

### Decision 3: When the text is emitted

#### Problem
The spec asks to read thinking while the agent is working, within a few seconds of it being produced. API calls today return one message. CLI output already streams.

#### Alternatives Considered
1. **Stream every provider token** — New client behavior for models that currently use `invoke`. Not required when the provider only returns thinking with the final message. The spec's assumptions allow end-of-step thinking.
2. **Keep waiting for CLI exit, then emit once** — Hides reasoning for the whole process lifetime. Fails the live story for Codex and Claude.
3. **CLI: emit when a reasoning item completes on `workerRuntime.stream`. API and ReAct: emit when that model round returns, before tool events. Others: terminal marker only** (Selected).

#### Decision
- After `workerRuntime.start`, the CLI executor reads `stream` while `wait` runs. Stdout is buffered to line boundaries. Each completed reasoning item becomes one or more thinking logs before the process exits. The existing `parseCodexOutput`, `parseClaudeOutput`, and `parseAgyStreamOutputWithSession` functions still produce `content` from the finished stdout. They are not given the thinking text to concatenate.
- The API executor emits thinking for that round, then tool events, then the next round. Final `agent.output` / `agent.completed` `content` remains the normalized answer only.
- Local, process, and webhook executors emit `thinkingStatus: "none"` beside the existing completion or failure. They do not scrape the answer.

#### Rationale
Live behavior lands where a stream already exists. Request/response providers stay request/response. The answer path in `agentRuntime` is untouched because it reads only `agent.completed` content.

---

### Decision 4: How the UI groups and labels thinking

#### Problem
One `thoughtsText` string mixes retries, hides an empty state, and cannot show that a tool happened between two thoughts. `node.started` already carries `attempt`.

#### Alternatives Considered
1. **Keep a single concatenated string** — Breaks FR-008 and the thought/tool/thought sequence.
2. **Require executors to know the compiler attempt number** — The executor input does not carry it. Threading it through is extra coupling.
3. **Project attempts from `node.started` / `node.retrying` boundaries, and insert a one-line tool marker between thinking stretches** (Selected).

#### Decision
- A new `node.started` or `node.retrying` opens the next attempt. `payload.attempt` is used when it is a positive integer; otherwise the projection counts starts.
- Thinking chunks append in sequence. A `tool.started` between chunks inserts a marker with the tool name and status. Full arguments and results stay in the existing Tools section.
- Availability for an attempt:
  - Non-whitespace thinking text → `shared`.
  - `thinkingStatus: "none"`, or only whitespace → `none`, once the attempt has ended or the final marker has arrived.
  - No marker and no text on a finished attempt → `unavailable`.
  - Attempt still running, no text yet → `pending`. The copy is "Thinking has not arrived yet." It is not the none message and not the unavailable message.
- Outcome label: run status `cancelled` forces `stopped` for an attempt that has not completed, even if `agent.failed` was also recorded. Otherwise `node.completed` is completed, a terminal `node.failed` or `agent.failed` is failed, and anything else still running is `in_progress`.
- `thoughtsText` remains the latest attempt's thinking text so the current projection test (`"First then"`) stays valid. The inspector stops using that string as the only render path.

#### Rationale
Attempt boundaries already exist on the event list. Tool markers show order without a second copy of tool payloads. Cancel is labeled Stopped, which is the word the spec uses.

---

### Decision 5: Where it is shown

#### Problem
Thinking is easy to miss when it is behind a closed disclosure, and the run page is a raw event list.

#### Alternatives Considered
1. **Open the existing disclosure by default** — Still hidden on the run page, still missing when the string is empty, and still one blob across attempts.
2. **Only the canvas inspector** — Fails the requirement that a later review of the run shows the same thinking.
3. **One transcript component in the inspector and on the run review, plus a Thinking label in the timeline** (Selected).

#### Decision
- Agent steps always show an open Thinking region. Non-agent steps do not, unless they somehow have thinking-channel events.
- The run page lists one transcript per node that has `agent.started` or a thinking-channel log. It uses the same projection as the inspector.
- Timeline readable mode renders `thoughts` under the label Thinking, so agent test history is readable without the raw tab.
- The transcript follows the latest text while the reader is near the bottom (same 48px threshold as the timeline). Scrolling up pins the view. The region scrolls to the start and the end; it is not line-clamped.

#### Rationale
Both surfaces required by the spec share one projection, so availability and attempt grouping cannot drift.

---

## Best practices applied

- **Do not invent observability.** Unavailable and none are different strings. Pending is a third, only while the attempt is running.
- **Keep the control plane's answer authoritative.** Tests that lock Codex, Claude, Agy, and API `content` stay the guard against leaking thinking into the next step.
- **Stay inside existing bounds.** Chunking is how the feature honors "the full text is readable" without raising `RUN_EVENT_MAX_PAYLOAD_BYTES`.
- **Redact once, at append.** Executors do not add a second redactor. They do omit Anthropic-style `signature` fields so those never enter the payload.

## Alternatives rejected summary

| Alternative | Why rejected |
| :--- | :--- |
| New event type or thinking table | Closed event vocabulary; second permission and retention story |
| Token streaming for API models | Providers that return thinking with the final message are already allowed by the spec |
| Treating plain stdout as thinking | That text is the answer |
| Closed-by-default disclosure | The spec requires the area to be visible without a hidden control |
| Editing or injecting thoughts | Explicitly out of scope |
