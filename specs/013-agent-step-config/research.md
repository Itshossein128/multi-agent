# Research: Independent Agent Configuration Per Workflow Step

**Feature Branch**: `013-agent-step-config`  
**Date**: 2026-11-04  
**Status**: Completed  

---

## Executive Summary

Finding 4 is confirmed in code: `AgentForm` calls `updateAgentRecord` → `workflowService.updateAgent`, mutating the shared registry from the canvas. Node-level `executionMode` / `maxToolSteps` already exist and resolve via `resolveEffectiveReactSettings` (node → agent → derived). Missing pieces are step `taskInstruction`, `modelSettingsOverride`, `activeTools`, a step-local properties UX, and end-to-end application that never mutates shared agents.

All Technical Context items are resolved below; no NEEDS CLARIFICATION remain.

---

## Technical Decisions & Rationale

### Decision 1: Persist step fields on `AgentNodeConfig` (workflow JSON only)

#### Problem
Step-specific settings must survive save/reload/duplicate without living on `AgentRecord`.

#### Alternatives Considered
1. **Clone AgentRecord per node** — Multiplies registry entities; breaks “reuse one persona”; high operational cost.
2. **Side table of node overrides** — New persistence surface; unnecessary when node `config` already versions with the workflow definition and run snapshots.
3. **Extend `AgentNodeConfig`** (Selected) — Matches Finding 4 recommendation and existing `executionMode` / `maxToolSteps` pattern.

#### Rationale
FR-002/FR-032/FR-033; zero schema migration beyond JSON shape already stored on workflow nodes.

---

### Decision 2: Pure `resolveEffectiveAgentStepConfig` — never mutate shared agents

#### Problem
Building effective settings by patching `agent.backend.settings` or `agent.tools` in place would leak across concurrent runs (FR-024, SC-007).

#### Decision
Add `packages/types` helpers (name illustrative):

- `resolveEffectiveAgentStepConfig({ agent, nodeConfig, registryTools })` → `{ taskInstruction, modelSettings, toolIds, tools, executionMode, maxToolSteps, incompatibilities[] }`
- `validateAgentNodeStepConfig(...)` → structured issues for web + server validators

Resolution rules:

| Field | Rule |
| :--- | :--- |
| `taskInstruction` | Trimmed string if present/non-empty; else `undefined` (legacy behavior). |
| `modelSettings` | Start from `backend.settings` when api/local; overlay only keys present in `modelSettingsOverride`; treat numeric `0` as set; omit cleared keys. |
| `toolIds` | If `activeTools === undefined` → copy of `agent.tools` filtered to usable registry tools; if `[]` → empty; if non-empty → must be subset of allowed∩usable else incompatibility. |
| `executionMode` / `maxToolSteps` | Existing node → agent → derived; **derived mode uses effective `toolIds.length`**, not raw `agent.tools.length`. |

Executors receive resolved values via `AgentExecutionInput` (or an ephemeral read-only view), never via registry writes.

#### Rationale
Satisfies FR-010–FR-018, FR-024, SC-001, SC-007.

---

### Decision 3: Decouple `AgentForm` from registry writes

#### Problem
Canvas properties currently edit name, backend, prompt, tools, agent-level mode/steps through `patchAgent`.

#### Decision
- **Node panel owns**: `agentId`, `taskInstruction`, `modelSettingsOverride` (inherit/override/clear), `activeTools` (multi-select / checklist from base allowed tools), node `executionMode` / `maxToolSteps`, existing `mutatesCode` / `role` if already surfaced elsewhere.
- **Read-only summary**: base name, backend label, model, truncated system prompt, allowed tool count/names.
- **Explicit CTA**: “Edit Agent in Registry” → confirm shared impact → navigate to existing `/o/{org}/org/agents/{agentId}` (same destination as today’s agent detail). Opening the link does not PATCH the agent.
- Remove `updateAgentRecord` usage from `AgentForm` entirely.

#### Rationale
FR-004–FR-008, SC-009; reuses existing Registry UI (out of scope to redesign).

---

### Decision 4: Deliver `taskInstruction` additively through ContextAssembler / executor channels

#### Problem
Today system text is only `agent.systemPrompt` (`agentRuntime` → ContextAssembler; legacy `systemPromptFor` in API executor; CLI prefixes `SYSTEM INSTRUCTIONS`).

#### Alternatives Considered
1. **Concatenate into `agent.systemPrompt` on a cloned agent** — Easy but risks accidental persistence if clone leaks; conflates persona with step task.
2. **Replace system prompt with step instruction** — Violates FR-020.
3. **Additive context item / channel** (Selected) — Keep base system item unchanged; when non-empty `taskInstruction` is present, insert a dedicated high-priority item after system and before task/input (conceptual order FR-022). Label content so models treat it as step task guidance, not a security policy replacement.
4. **CLI/process/webhook**: Mirror with an additive `STEP INSTRUCTIONS:` section or payload field alongside existing system prompt fields—never omit a user-provided instruction silently.

#### Decision details
- Extend `AgentExecutionInput` with `taskInstruction?: string`.
- Compiler passes node config value through `runAgentThroughRuntime`.
- `DefaultContextAssembler` / `agentRuntime` accept optional step instruction and emit a distinct context item (or equivalent message) without modifying `AgentRecord.systemPrompt`.
- Empty/omitted → no extra item (FR-021).
- No mustache/interpolation engine; UI must not advertise unsupported `{{...}}` syntax (FR-009). Plain text only unless a pre-existing supported syntax is discovered (none in current editor).

#### Rationale
FR-019–FR-022; works across assembled and legacy message paths.

---

### Decision 5: Apply `modelSettingsOverride` ephemerally at model construction

#### Problem
`ApiAgentExecutor` / local path read `agent.backend.settings` when creating the chat model.

#### Decision
- Pass `modelSettingsOverride?: Partial<AgentModelSettings>` (or pre-merged `effectiveModelSettings`) on `AgentExecutionInput`.
- When constructing the model, merge base settings with override **locally** for that invoke.
- Validate overrides with existing `modelSettingsSchema(backend)` + Anthropic temperature/topP mutual exclusion on **effective** merged settings (web + server).
- Backends with empty schema (`cli` / `process` / `webhook`): any non-empty override → validation/runtime error (FR-025/026)—never accept in UI and ignore later.
- OpenAI reasoning models: only schema-allowed keys (e.g. `maxTokens`) may be overridden; others rejected.

#### Rationale
Preserves shared registry defaults for other nodes; zero silent ignore.

---

### Decision 6: Effective tools gate both bind and execute

#### Problem
`resolveAgentToolsForRuntime(agent, tools)` uses only `agent.tools`. ReAct auth checks `agent.tools` again (`resolveAuthorizedTool`).

#### Decision
1. Compiler resolves tools with step-aware helper:  
   `resolveAgentToolsForRuntime(agent, tools, nodeConfig.activeTools)`.
2. Pass `resolvedTools` reflecting the effective set; optionally also pass `effectiveToolIds` for auth clarity.
3. Update authorization to allow only ids in the effective set (not merely `agent.tools`). Assignment to the agent remains the upper bound; `activeTools` may only shrink.
4. `activeTools` omit vs `[]` vs subset semantics as in spec (FR-014–FR-016).
5. Tampered / unknown / disabled / cross-tenant tools continue to fail via registry∩policy (FR-029).

#### Backend support matrix (tools)

| Backend | Platform in-agent tool loop today | `activeTools` support |
| :--- | :--- | :--- |
| `api` | Yes (012 ReAct) | **Supported** — bind + ToolRuntime enforce |
| `local` | Model invoke; tools only if future/local path mirrors API | If local path does not execute tools via ToolRuntime, treat explicit `activeTools` like unsupported (reject non-omit) **or** enforce if/when local gains the same loop—must match implementation reality at task time |
| `cli` / `process` / `webhook` | No in-agent ToolRuntime loop (012 out of scope) | **Unsupported for enforcement** — validation MUST reject explicit `activeTools` (including `[]`) with actionable “not supported for this backend” rather than silently storing a false promise |

*Refinement for local*: At implementation time, inspect whether local executor participates in ReAct tool binding. If not, same reject-as-unsupported rule as CLI. If yes, same as API.

#### Rationale
FR-028–FR-031; honesty over false UI promises.

---

### Decision 7: Align derived `executionMode` with effective tools

#### Problem
`resolveEffectiveReactSettings` currently derives mode from `agentTools.length`. A step with `activeTools: []` on a tool-rich agent would otherwise default to ReAct incorrectly.

#### Decision
Pass **effective** tool id list into `resolveEffectiveReactSettings`. Explicit node/agent mode overrides still win. Preserve clamp 1–10 / default 5 for `maxToolSteps`.

#### Rationale
FR-017 edge case; matches Edge Cases in spec.

---

### Decision 8: Base-agent switch — preserve instruction, block incompatibilities

#### Problem
Changing `agentId` can leave overrides for settings keys unsupported by the new backend or tool ids not in the new agent’s allowlist.

#### Decision
On `agentId` change (client): keep `taskInstruction`; recompute incompatibilities; surface issues on the node; block run/validate. Do **not** auto-delete overrides silently (operator must clear or fix)—except optional UX may offer “Clear incompatible overrides” as an explicit action. Server validators independently reject incompatible configs (fail closed).

Never auto-add tools from the new agent beyond what `activeTools` already allowed (no privilege expansion).

#### Rationale
FR-018, acceptance scenario 7.

---

### Decision 9: In-flight immutability via existing run snapshots

#### Problem
Spec requires mid-run edits not to affect the active run (FR-027).

#### Decision
No new versioning. `runExecutor` / run store already snapshot `workflow`, `agents`, `tools` at start. Ensure step fields live on the workflow snapshot’s node configs so effective resolve during the run reads snapshot data only. Document in quickstart that editing draft after start does not rewrite snapshots.

#### Rationale
FR-027, SC-008; out-of-scope publish/version product avoided.

---

### Decision 10: Validation parity (web + server)

#### Problem
Client `validateWorkflow` and server `nodeValidators` must agree so the editor cannot accept configs the compiler rejects (and vice versa).

#### Decision
Share pure validators from `packages/types` (`validateAgentNodeStepConfig`) consumed by both. Issue codes (illustrative): `INVALID_AGENT_NODE_MODEL_OVERRIDE`, `UNSUPPORTED_STEP_MODEL_OVERRIDE`, `INVALID_AGENT_NODE_ACTIVE_TOOLS`, `UNSUPPORTED_STEP_ACTIVE_TOOLS`, `INCOMPATIBLE_STEP_CONFIG_FOR_AGENT`.

#### Rationale
FR-023, FR-025.

---

## Dependency / Integration Notes

- **012 ReAct**: Effective tools feed existing bind + ToolRuntime path; no loop rewrite.
- **Agent registry pages**: Unchanged functionally; node panel links in.
- **`modelSettingsSchema` / `validateAgent`**: Reuse for override key legality.
- **Credentials / approval / mutatesCode**: Untouched; step config cannot set them.

---

## Rejected Approaches (summary)

| Approach | Why rejected |
| :--- | :--- |
| Per-node agent clone in registry | Breaks shared persona reuse; registry spam |
| Mutate-then-restore AgentRecord around execute | Race-prone; violates FR-024 |
| Silent ignore of unsupported overrides | Violates FR-025 |
| New mustache engine in this feature | Explicitly out of scope |
| New workflow publish/version system | Explicitly out of scope |

---

## Open implementation footnotes (not clarifications)

- Exact ContextAssembler `source` enum value for step instructions (`"system"` vs new `"step"`) is an implementation detail; behavioral contract is additive order base → step → input.
- Whether local backends already support ReAct tool binding must be verified during `/speckit-tasks` against current `localAgentExecutor`; support matrix in Decision 6 applies.
