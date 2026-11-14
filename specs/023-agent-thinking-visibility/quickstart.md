# Quickstart: Agent Thinking Visibility

**Feature**: `023-agent-thinking-visibility`  
**Purpose**: Validate the feature end-to-end after implementation—without embedding full test suites here.

See also: [data-model.md](./data-model.md), [contracts/agent-thinking.contract.ts](./contracts/agent-thinking.contract.ts).

---

## Prerequisites

- Repo dependencies installed (`pnpm install`)
- For manual Studio checks: `pnpm run dev` (web + server), an organization with permission to run a workflow that contains an agent step

No new database or environment variable is required. Thinking uses the existing run event list.

---

## 1. Automated gates (primary)

```bash
pnpm test --runInBand --testPathPattern='thinkingText|cliThinkingStream|apiAgentThinking|nodeExecutionView'
```

**Expect**

- Codex JSONL that contains a `reasoning` item and a later `agent_message` yields the reasoning text as thinking chunks and leaves `content` equal to the agent message only. Command and tool items are not thinking.
- Claude content blocks of type `thinking` plus `text` put only the thinking string in the thinking log and only the text block in `content`. A `redacted_thinking` block alone produces `thinkingStatus: "none"`.
- An API result whose reasoning part also has a `text` field does not include that text in `content`.
- Agy `result.response` stays the answer. A separate `thinking` field on a non-result event is the only Agy thinking text.
- Plain stdout, with no structured reasoning channel, completes with `thinkingStatus: "none"` and does not copy stdout into thinking.
- Whitespace-only reasoning is `none`, not `shared`.
- Chunks are at most `THINKING_CHUNK_CHARS` (8 000). Two chunks project back to the full string in `part` order.
- The existing projection case that appends legacy `payload.thoughts` still produces `thoughtsText` `"First then"`.
- A second `node.started` with `attempt: 2` keeps attempt 1 and attempt 2 text apart.
- A finished attempt with no `thinkingStatus` and no thoughts projects as unavailable. A final `thinkingStatus: "none"` projects as none. The two messages differ.
- A `run` status of `cancelled` labels the open attempt stopped and keeps the text already projected.
- A tool event between two thinking chunks appears as a tool marker between those stretches. The answer fixture for that run is unchanged.

---

## 2. Typecheck

```bash
npx tsc --noEmit -p apps/web
npx tsc --noEmit -p apps/server
```

**Expect**: both commands exit 0. The web project typechecks the inspector, the run page, and the projection together.

---

## 3. Manual Studio check

Use an agent whose backend shares structured thinking (Codex or Claude JSON, or an API model that returns thinking blocks). A plain local model is the negative check.

1. Start a run from the workflow editor and open the agent step while it is working.
2. Confirm an open region headed **Thinking**. Do not open a disclosure and do not switch the timeline to raw.
3. If the agent shares thinking before it finishes, confirm new text appears without a reload. Scroll up and confirm further text does not pull the view down. Return to the bottom and confirm the latest text is in view.
4. Confirm the answer region and the Thinking region are separate, and the next step's input matches the answer rather than the thinking text.
5. Stop a second run after some thinking is visible. Reopen that run from the run page. The thinking that had appeared is still there and labeled stopped.
6. Run an agent that shares no thinking. The finished step says **No thinking was shared.**
7. Open a run that was recorded before this feature. The agent step says **Thinking is unavailable for this run.** It does not say that no thinking was shared.

---

## 4. Authorization spot check

Sign in as a person who cannot open the run. Confirm the run page and the canvas live view still refuse the run. There is no new thinking URL.

---

## 5. Failure signals

- Thinking text appears inside the answer or in the next step's input.
- The Thinking region is missing, or it appears only after expanding "Published thoughts".
- An old run and a new run that shared nothing show the same sentence.
- Cancelling the run clears thinking that was already on screen.
- A reasoning item is visible only after the CLI process exits, even though stdout had already produced that item.
