# Data Model: Autonomous ReAct Agent Loop

**Feature Branch**: `012-react-agent-loop`  
**Date**: 2026-11-04  

No new database tables. Changes are in-memory/types configuration and execution-time entities.

---

## Entities

### AgentRecord (extended)

| Field | Type | Rules |
| :--- | :--- | :--- |
| `tools` | `string[]` | Existing. Tool IDs this agent may invoke. |
| `executionMode` | `"single_turn" \| "react"` optional | Explicit override. When absent, derived from `tools.length`. |
| `maxToolSteps` | `number` optional | When set, must be integer 1–10 after clamp; default effective value `5`. |

**Invariants**

- Migration must preserve unknown-safe defaults for older records.
- `tools` empty + no explicit mode ⇒ effective mode `single_turn`.
- `tools` non-empty + no explicit mode ⇒ effective mode `react`.

---

### AgentNodeConfig (extended)

| Field | Type | Rules |
| :--- | :--- | :--- |
| `agentId` | `string \| null` | Existing |
| `mutatesCode` | `boolean` optional | Existing |
| `role` | `string` optional | Existing |
| `executionMode` | `"single_turn" \| "react"` optional | Node-level override of agent default |
| `maxToolSteps` | `number` optional | Node-level override; clamp 1–10 |

**Resolution order**: node field → agent field → derived default.

---

### ResolvedAgentTool (execution-time)

Not persisted. Built at compile/run for one agent node.

| Field | Type | Description |
| :--- | :--- | :--- |
| `tool` | `ToolRecord` | Full registry record |
| `callName` | `string` | Name exposed to the model (unique within the bound set) |

**Invariants**

- Only tools whose `id` is in `agent.tools` and `enabled === true` are included.
- Missing IDs are omitted from binding (validation may already error at design time via `UNKNOWN_AGENT_TOOL`).

---

### AgentToolLoopState (execution-time)

| Field | Type | Description |
| :--- | :--- | :--- |
| `iteration` | `number` | Current tool-round index (0-based) |
| `maxToolSteps` | `number` | Ceiling 1–10 |
| `messages` | `unknown[]` | Growing chat transcript including tool results |
| `callCount` | `number` | Individual tool invocations executed this node |

**Transitions**

```text
[start] → MODEL_INVOKE
MODEL_INVOKE → FINALIZE          (no tool_calls)
MODEL_INVOKE → TOOL_BATCH        (has tool_calls, iteration < max)
MODEL_INVOKE → LIMIT_EXCEEDED    (has tool_calls, iteration would exceed max)
TOOL_BATCH → MODEL_INVOKE        (after all calls in batch observed)
* → ABORTED                      (signal aborted)
TOOL_BATCH → NODE_FAILED         (fatal/security error)
FINALIZE → [end success]
LIMIT_EXCEEDED → [end failed]
ABORTED / NODE_FAILED → [end failed]
```

---

### NestedToolCallObservation (event payload)

Aligned with existing live inspector expectations.

| Field | Event | Required |
| :--- | :--- | :--- |
| `toolId` | started/completed/failed | yes when known |
| `name` | started | yes |
| `arguments` / `input` | started | yes (sanitized downstream) |
| `iteration` | started | yes |
| `toolCallId` / `callId` | all | yes |
| `output` / `result` | completed | yes |
| `durationMs` | completed | yes |
| `error` | failed | yes |
| `code` | failed / agent.failed | optional (`AGENT_TOOL_LIMIT_EXCEEDED`, policy codes) |

Parent identity: `AgentExecutionEvent.nodeId` = agent node id; `agentId` = agent record id.

---

### EffectiveAgentExecutionSettings (derived)

| Field | Derivation |
| :--- | :--- |
| `mode` | node.executionMode ?? agent.executionMode ?? (tools.length ? "react" : "single_turn") |
| `maxToolSteps` | clamp(node.maxToolSteps ?? agent.maxToolSteps ?? 5, 1, 10) |
| `authorizedToolIds` | `agent.tools` (immutable for the run of that node) |

---

## Validation Rules

1. `executionMode` if present ∈ {`single_turn`, `react`}.
2. `maxToolSteps` if present: coerce to integer; clamp to [1, 10] on write or at execute (prefer clamp-at-execute + UI clamp).
3. Design-time: existing `UNKNOWN_AGENT_TOOL` / `DISABLED_AGENT_TOOL` validators remain.
4. Run-time: unassigned model tool names never execute.

---

## Relationships

```text
AgentRecord 1──* toolId ──▶ ToolRecord
AgentNodeConfig ──▶ AgentRecord (agentId)
Agent node execution ──▶ ResolvedAgentTool[] ──▶ ToolRuntime.execute
Agent node execution ──▶ AgentExecutionEvent (tool.*) ──▶ RunStore / Live Inspector
```
)
