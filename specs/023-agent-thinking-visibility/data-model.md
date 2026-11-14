# Data Model: Agent Thinking Visibility

**Feature Branch**: `023-agent-thinking-visibility`  
**Date**: 2026-11-14  
**Status**: Draft  

No new stored document and no new `RunEvent` type. Thinking is a `log` payload on the existing run event list. The web projection turns those events into the view below. Field rules live in [agent-thinking.contract.ts](./contracts/agent-thinking.contract.ts).

---

## 1. Thinking log payload

Stored on `RunEvent.payload` when `type` is `log`.

| Field | Required | Rule |
| :--- | :---: | :--- |
| `channel` | yes | Always `"thinking"`. Other logs are ignored by this projection. |
| `thoughts` | yes | String chunk. May be empty only when `thinkingStatus` is `"none"`. |
| `thinkingStatus` | yes | `"shared"` if this attempt has shared or is sharing text. `"none"` only on the final marker when no non-whitespace text was shared. |
| `final` | yes | `true` on the last thinking log for that attempt. Earlier chunks are `false`. |
| `part` | yes | 0-based index of this chunk within the attempt. |

`thoughts` does not include provider signatures, tool arguments, or the answer.

A chunk longer than 8 000 characters is split before append. The store's existing redaction and payload bound still apply. A chunk that arrives already collapsed to `{ truncated: true, preview }` is shown as that preview plus a visible note that the run record shortened it. Executors must not emit chunks that large.

Legacy events may instead carry `thoughts` or `reasoning` without `channel`. The projection still reads them (see §3). They do not gain a `thinkingStatus`.

---

## 2. Terminal answer event

`agent.completed` and `agent.output` keep `content` as the answer only.

| Field | Rule |
| :--- | :--- |
| `content` | Unchanged answer. Thinking text is not concatenated, prepended, or substituted here. |
| `thinkingStatus` | Optional copy of the attempt's final status (`"shared"` or `"none"`). Absent on events written before this feature. Not a substitute for the chunk text. |

`agent.failed` may carry the same optional `thinkingStatus`. It does not carry the answer.

Working memory, handoff, and the node value continue to be derived from `content` only.

---

## 3. ThinkingAttempt (projected)

Built per node, in event sequence order. Not stored.

| Field | Rule |
| :--- | :--- |
| `attempt` | `node.started` `payload.attempt` when it is an integer ≥ 1. Otherwise 1 plus the number of earlier `node.started` / `node.retrying` events for that node. |
| `outcome` | `in_progress`, `completed`, `stopped`, or `failed`. See transitions. |
| `availability` | `pending`, `shared`, `none`, or `unavailable`. |
| `text` | Concatenation of thinking chunks and legacy `thoughts` / `reasoning` for this attempt, in order. Whitespace-only results are treated as empty. |
| `segments` | Ordered `thinking` stretches and `tool` markers. A tool marker records display name and status only. Arguments and results stay on the existing tool view. |
| `recordIncomplete` | `true` when a thinking payload was replaced by the store truncation marker, or when a later `log` on the run has `eventLimitReached`. |

`NodeExecutionView.thoughtsText` is the `text` of the latest attempt. It stays for existing callers. The Thinking area reads `thinkingAttempts`, not `thoughtsText` alone.

### Availability

| Condition | Availability | Operator copy |
| :--- | :--- | :--- |
| Attempt in progress and `text` empty and no final none marker | `pending` | Thinking has not arrived yet. |
| `text` has non-whitespace content | `shared` | The text, under the heading Thinking. |
| Final `thinkingStatus` is `none`, or the only text is whitespace | `none` | No thinking was shared. |
| Attempt finished, no `thinkingStatus` anywhere on it, and `text` empty | `unavailable` | Thinking is unavailable for this run. |

`shared` wins over a contradictory `none` if any non-whitespace text was recorded.

### Outcome transitions

```text
node.started / node.retrying
        │
        ▼
   in_progress ── node.completed ──────────────► completed
        │
        ├── run status cancelled ──────────────► stopped
        │     (even if agent.failed was also stored)
        │
        └── terminal node.failed or agent.failed
              while the run is not cancelled ──► failed
```

A non-terminal `node.failed` followed by `node.retrying` closes the current attempt as `failed` and opens the next attempt. Both attempts remain in the list. Text already recorded on a stopped or failed attempt stays.

`pending` is not used after the attempt has an outcome other than `in_progress`.

---

## 4. Thinking view on a node

| Field | Rule |
| :--- | :--- |
| `thinkingAttempts` | One entry per attempt that started. Order is attempt order. |
| Shown in the inspector | When the workflow node type is `agent`, or any event for that node is `agent.started` or a thinking-channel log. |
| Shown on the run review | One transcript per `nodeId` that has `agent.started` or a thinking-channel log. |

Nodes that are not agent steps and have no thinking-channel events do not grow a Thinking area.

---

## 5. Relationships

```text
Run
 └── RunEvent (log, channel thinking)*     one attempt, many chunks
 └── RunEvent (agent.completed content)    the answer, unchanged
 └── RunEvent (node.started attempt)       opens a ThinkingAttempt

ThinkingAttempt
 └── segments[]  thinking text | tool marker
 └── belongs to one nodeId and one attempt
```

An attempt never includes events whose `nodeId` is a different step.

---

## 6. Validation rules

- Executors reject the urge to copy thinking into `content`. Tests lock the previous answer fixtures.
- Empty and whitespace-only extraction emits `thinkingStatus: "none"`, not `"shared"`.
- `part` increases by 1 within an attempt. The projection sorts by `sequence`, then `part`.
- A thinking log without a string `thoughts` field is ignored rather than rendered as `[object Object]`.
- Client code does not infer thinking from the answer, from tool output, or from another node.

---

## 7. What is intentionally absent

- No editable thinking field.
- No instruction channel back to the running agent.
- No separate retention timestamp. Deleting or expiring the run deletes its thinking with its other events.
- No audience other than principals who can already read the run.
