# Data Model: Independent Agent Configuration Per Workflow Step

**Feature Branch**: `013-agent-step-config`  
**Date**: 2026-11-04  

No new database tables. Step configuration is persisted on workflow node `config` JSON. Base Agent remains the existing `AgentRecord` in the agent registry. Effective configuration is computed at validation/compile/execution time and is not persisted as its own entity.

---

## Entities

### AgentRecord (unchanged ownership)

Shared registry entity. This feature does **not** add required fields. Remains source of:

| Concern | Fields (existing) |
| :--- | :--- |
| Identity | `id`, `name`, `description`, `enabled`, `ownerId`, `tenantId`, `isSystem` |
| Persona | `systemPrompt` |
| Backend / model defaults | `backend` (incl. `settings?: AgentModelSettings` for api/local) |
| Allowed tools | `tools: string[]` |
| Loop defaults | `executionMode?`, `maxToolSteps?` |
| Policy / memory | `executionPolicy?`, `memory?`, `metadata` |
| Timestamps | `createdAt`, `updatedAt` |

**Invariant**: Ordinary node-panel step edits MUST NOT change `AgentRecord` content or `updatedAt`.

---

### AgentNodeConfig (extended)

Persisted on each `WorkflowNode` with `type: "agent"`.

| Field | Type | Persistence | Rules |
| :--- | :--- | :--- | :--- |
| `agentId` | `string \| null` | existing | Base Agent link |
| `mutatesCode` | `boolean?` | existing | Unchanged meaning |
| `role` | `string?` | existing | Unchanged meaning |
| `executionMode` | `"single_turn" \| "react"?` | existing | Node override; omit = inherit/derive |
| `maxToolSteps` | `number?` | existing | Integer 1–10 when set; omit = inherit/default |
| `taskInstruction` | `string?` | **new** | Step task guidance; omit/blank = legacy behavior |
| `modelSettingsOverride` | `Partial<AgentModelSettings>?` | **new** | Only explicitly set keys override; omit object/keys = inherit; clearing a key removes it from stored override |
| `activeTools` | `string[]?` | **new** | `undefined` = inherit agent tools; `[]` = no tools; non-empty = subset of agent allowed∩usable tools |

**Storage invariants**

- Cleared overrides are absent from JSON (preferred) rather than stored as `null`.
- `activeTools: []` MUST round-trip as an empty array (distinct from field absence).
- Legacy nodes without the three new fields remain valid.

---

### AgentModelSettings (existing; used by overrides)

| Field | Type | Notes |
| :--- | :--- | :--- |
| `temperature` | `number?` | `0` is a valid explicit value |
| `topP` | `number?` | |
| `maxTokens` | `number?` | |
| `reasoningEffort` | `"low" \| "medium" \| "high"?` | Provider/model gated |

Override validation uses the same capability matrix as base agent settings (`modelSettingsSchema(backend)` + provider mutual-exclusion rules) applied to the **merged effective** settings.

---

### EffectiveAgentStepConfig (execution-time, not persisted)

Pure resolution result for one node + base agent + registry tools slice.

| Field | Type | Description |
| :--- | :--- | :--- |
| `agentId` | `string` | Resolved base id |
| `taskInstruction` | `string \| undefined` | Non-empty trimmed instruction or undefined |
| `modelSettings` | `AgentModelSettings` | Merged effective settings (may be empty object) |
| `toolIds` | `string[]` | Effective authorized tool ids for this step |
| `tools` | `ToolRecord[]` | Resolved enabled registry records for `toolIds` |
| `executionMode` | `"single_turn" \| "react"` | After node → agent → derived(effective tools) |
| `maxToolSteps` | `number` | Clamped 1–10 |
| `incompatibilities` | `StepConfigIssue[]` | Blocking problems (wrong tools, unsupported keys, missing agent, …) |

**Resolution algorithm (normative)**

```text
1. Load AgentRecord by agentId; if missing/disabled/inaccessible → incompatible
2. taskInstruction := trim(node.taskInstruction); empty → undefined
3. baseSettings := backend.settings if api|local else {}
4. For each key in modelSettingsOverride:
     - if backend cannot support any overrides → incompatible
     - if key not allowed for backend/provider/model → incompatible
   effectiveSettings := { ...baseSettings, ...definedOverrideKeys }
   validate mutual exclusion / ranges on effectiveSettings
5. allowedTools := agent.tools ∩ registry(usable)
   if activeTools === undefined → toolIds := allowedTools
   else if activeTools.length === 0 → toolIds := []
   else if activeTools ⊆ allowedTools → toolIds := activeTools (stable order)
   else → incompatible (do not union/expand)
   if backend cannot enforce activeTools and activeTools !== undefined → incompatible
6. mode/maxToolSteps := resolveEffectiveReactSettings({
     agentTools: toolIds,
     agentMode, agentMaxToolSteps,
     nodeMode, nodeMaxToolSteps
   })
```

**Concurrency invariant**: Resolution allocates new objects only; never assigns into the shared `AgentRecord` reference used by other nodes/runs.

---

### StepConfigIssue (validation)

| Field | Type | Description |
| :--- | :--- | :--- |
| `code` | `string` | Stable machine code (see contracts) |
| `message` | `string` | Actionable operator text |
| `path` | `string?` | e.g. `modelSettingsOverride.temperature`, `activeTools[1]` |

Blocking issues prevent run start / fail validation at error level.

---

### Run Snapshot (existing)

At run start the platform already stores:

- `workflowSnapshot` — includes node configs with step fields  
- `agentsSnapshot` — base AgentRecords as of start  
- `toolsSnapshot` — tool registry slice as of start  

**Invariant**: In-progress execution resolves EffectiveAgentStepConfig from snapshots only. Later draft/registry edits do not rewrite these snapshots.

---

## Relationships

```text
WorkflowDefinition
  └── WorkflowNode (type=agent)
        └── AgentNodeConfig ──agentId──► AgentRecord (registry)
                              ├── modelSettingsOverride (partial → backend.settings)
                              ├── activeTools ⊆ AgentRecord.tools
                              └── taskInstruction (additive at execution)

Run
  └── snapshots(workflow, agents, tools)
        └── EffectiveAgentStepConfig (computed per agent node)
```

---

## State / lifecycle notes

| Event | Effect on step config | Effect on base Agent |
| :--- | :--- | :--- |
| Edit step fields in properties | Updates selected node config; marks workflow dirty | None |
| Clear model override key | Removes key from `modelSettingsOverride` | None |
| Change `agentId` | Keeps `taskInstruction`; may create incompatibilities for overrides/tools | None |
| Edit Agent in Registry | None until operator saves there | Updates shared record + `updatedAt` |
| Start run | Snapshot freezes workflow+agents+tools | Snapshot copy only |
| Edit during run | Draft may change; active run unchanged | Same |

---

## Migration

- **Read path**: Missing `taskInstruction` / `modelSettingsOverride` / `activeTools` ⇒ inherit semantics (legacy).
- **Write path**: Only persist new keys when operators set them.
- **No bulk rewrite** of existing workflows required.
