# Contract: Agent Step Configuration Schema

**Feature**: `013-agent-step-config`  
**Consumers**: `packages/types`, workflow persistence, `NodeForms`, web `validateWorkflow`, server `nodeValidators`, workflow compiler, agent runtime

---

## AgentNodeConfig (persisted)

```json
{
  "agentId": "agent_developer",
  "taskInstruction": "Generate code from the specification in the input.",
  "modelSettingsOverride": {
    "temperature": 0,
    "maxTokens": 2048
  },
  "activeTools": ["tool_search", "tool_lint"],
  "executionMode": "react",
  "maxToolSteps": 5,
  "mutatesCode": false
}
```

| Field | Allowed values | Default when omitted |
| :--- | :--- | :--- |
| `agentId` | string id or `null` | existing |
| `taskInstruction` | string | No step instruction (legacy) |
| `modelSettingsOverride` | object with subset of `AgentModelSettings` keys | Inherit all base settings |
| `modelSettingsOverride.<key>` absent after clear | key not present | Inherit that key |
| `activeTools` omitted | — | Inherit base Agent allowed∩usable tools |
| `activeTools: []` | empty array | **No** callable tools for step |
| `activeTools: [id, …]` | nonempty strings ⊆ base allowed∩usable | Restrict to listed ids |
| `executionMode` | `"single_turn"` \| `"react"` | Inherit / derive from **effective** tools |
| `maxToolSteps` | integer 1–10 | Inherit / default `5` |

### Omit vs empty (tools)

| Stored JSON | Meaning |
| :--- | :--- |
| no `activeTools` key | Inherit |
| `"activeTools": []` | Explicit zero tools |
| `"activeTools": ["a"]` | Subset |

### Zero values (model)

`"temperature": 0` is an explicit override, not inherit.

---

## Backend support matrix (must match UI + validation + runtime)

| Setting | `api` | `local` | `cli` | `process` | `webhook` |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `taskInstruction` | Apply additive | Apply additive | Apply additive | Apply additive | Apply additive |
| `modelSettingsOverride` | If key in schema | If key in schema | **Reject if present** | **Reject if present** | **Reject if present** |
| `activeTools` | Enforce bind+execute | Enforce **only if** local participates in ToolRuntime tool loop; else reject if present | **Reject if present** | **Reject if present** | **Reject if present** |
| `executionMode` / `maxToolSteps` | Existing | Existing | Existing (loop N/A) | Existing | Existing |

“Reject if present” means validation error when the field is set (including empty `activeTools` array). Omitted fields remain valid.

---

## UI contract (`AgentForm` / agent node properties)

Must expose:

1. **Base Agent** selector (`agentId` only).
2. **Read-only summary** of base Agent (name, backend/model label, short persona/tools summary).
3. **Step Instructions** textarea bound to `taskInstruction` via `updateNodeConfig` only.
4. **Model settings** per schema field: show inherited value, allow override, allow clear-to-inherit; distinguish default / override / effective.
5. **Active tools** checklist/multi-select limited to base Agent’s allowed tools; support inherit (no field) vs explicit empty vs subset.
6. Existing **node** execution mode + max tool steps overrides.
7. **Edit Agent in Registry** explicit action with shared-impact warning; navigates to existing agent detail route; view/open must not PATCH agent.

Must **not** expose editable registry fields (name, backend type/provider/model, system prompt, agent-level tools assignment, execution policy, credentials) in the ordinary node panel.

Saving step fields must call node-config update only — **zero** `updateAgent` / `updateAgentRecord` from this panel.

---

## Validation issue codes (stable)

| Code | When |
| :--- | :--- |
| `INVALID_AGENT_NODE_TASK_INSTRUCTION` | Non-string instruction |
| `INVALID_AGENT_NODE_MODEL_OVERRIDE` | Bad type/range/unknown key for backend |
| `UNSUPPORTED_STEP_MODEL_OVERRIDE` | Override present on backend that cannot apply settings |
| `INVALID_AGENT_NODE_ACTIVE_TOOLS` | Not an array of nonempty strings, or not ⊆ allowed∩usable |
| `UNSUPPORTED_STEP_ACTIVE_TOOLS` | Explicit `activeTools` on backend that cannot enforce |
| `INCOMPATIBLE_STEP_CONFIG_FOR_AGENT` | After agent switch / backend change, stored overrides incompatible |
| `MISSING_AGENT_CONFIG` / `AGENT_DISABLED` | Existing missing/disabled base agent codes remain |

---

## Runtime injection contract (`AgentExecutionInput` additions)

Trusted server composition only (compiler → runtime):

| Field | Meaning |
| :--- | :--- |
| `taskInstruction?: string` | Non-empty step instruction to deliver additively |
| `modelSettingsOverride?: Partial<AgentModelSettings>` **or** premerged effective settings field | Applied ephemerally at model build |
| `resolvedTools?: ToolRecord[]` | Already filtered to **effective** step tools |
| `nodeExecutionMode` / `nodeMaxToolSteps` | Existing |

Executors MUST NOT write back to registry agents. Authorization MUST use effective tool ids.

---

## Compatibility

- Older workflows without new keys remain valid and behave as before.
- Explicit node `executionMode` / `maxToolSteps` keep prior precedence.
- Run snapshots that include node configs automatically cover new fields once saved on the definition used at start.
