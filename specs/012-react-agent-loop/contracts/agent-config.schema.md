# Contract: Agent / Agent-Node ReAct Configuration

**Feature**: `012-react-agent-loop`  
**Consumers**: `packages/types`, workflow persistence, `NodeForms` / agent properties UI, workflow compiler

## AgentRecord additions

```json
{
  "executionMode": "react",
  "maxToolSteps": 5,
  "tools": ["tool_abc"]
}
```

| Field | Allowed values | Default when omitted |
| :--- | :--- | :--- |
| `executionMode` | `"single_turn"` \| `"react"` | Derived: `react` if `tools.length > 0`, else `single_turn` |
| `maxToolSteps` | integer 1–10 (clamped) | `5` |

## AgentNodeConfig additions

```json
{
  "agentId": "agent_xyz",
  "executionMode": "single_turn",
  "maxToolSteps": 3
}
```

Node fields override agent fields when present.

## UI contract (`AgentForm` / agent node properties)

Must expose:

1. Read-only or editable list of assigned tool IDs (existing textarea acceptable; prefer showing registry names when available).
2. Execution mode control: Single-turn | ReAct (autonomous).
3. Max tool steps control: numeric 1–10.

Saving must persist onto `AgentRecord` and/or `AgentNodeConfig` per which surface the operator edits.

## Compatibility

- Older agents without these fields remain valid.
- Explicit `executionMode: "single_turn"` with non-empty `tools` disables the autonomous loop (tools remain for tool-node authorization only).
)
