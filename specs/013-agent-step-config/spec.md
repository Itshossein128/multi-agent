# Feature Specification: Independent Agent Configuration Per Workflow Step

**Feature Branch**: `013-agent-step-config`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "ویژگی «تنظیم مستقل Agent در هر مرحلهٔ Workflow» بر اساس Finding 4 — جداسازی Agent پایه در Registry از تنظیمات مرحله (taskInstruction، modelSettingsOverride، activeTools، executionMode، maxToolSteps) تا یک Agent مشترک در چند نود/Workflow بدون اثر جانبی قابل استفاده باشد و تنظیمات هر مرحله واقعاً در اجرا اعمال شود."

---

## Architectural Context & Feature Boundary

### Verified Current Gap (Finding 4 vs codebase)

Finding 4 is confirmed against current code, not taken solely from the audit report:

- The Workflow Editor agent properties form still edits the shared Agent registry entity for name, backend, provider, model, description, system prompt, assigned tools, and agent-level execution settings. Those edits persist to the shared agent store and bump the agent’s update timestamp, so they affect every other node and workflow that references the same agent.
- Per-node agent configuration today already supports selecting a base agent plus independent `executionMode` and `maxToolSteps`, with documented precedence **node override → agent setting → derived default** (tools present ⇒ ReAct, otherwise single-turn; max tool steps default 5, range 1–10). Those node fields must be preserved and aligned with the new step settings.
- There is **no** persisted step-level task instruction, model-settings override, or step-level tool subset. At run time, instructions come from the shared agent system prompt, model settings come from the shared agent backend, and usable tools are resolved from the shared agent’s assigned tool list only.
- Runs already capture immutable snapshots of workflow definition, agents, and tools at start. Mid-run edits must continue to leave an in-progress run on its snapshot; this feature must not invent a separate versioning/publish system.

### Scope of This Feature

Enable operators to reuse one base Agent across many workflow steps while giving each step independent task instructions, supported model setting overrides, and a restricted tool set—without mutating the base Agent or other steps.

1. **Separate ownership**: Registry owns identity, persona/base system instructions, backend/provider/model defaults, allowed tools, execution/security policy, and credential references. The workflow node owns step-only configuration.
2. **Step-local authoring UX**: The properties panel edits only the selected node for ordinary step fields; shared-agent edits require an explicit “Edit Agent in Registry” path with shared-impact warning.
3. **Effective configuration rules**: Clear inherit / override / clear-override semantics, including zero values, empty vs omitted tool lists, and incompatible base-agent changes that block ambiguous runs.
4. **Real execution fidelity**: Step settings are stored, validated, compiled, and applied on every supported execution path so UI acceptance cannot silently diverge from runtime.
5. **Security boundaries preserved**: Step overrides may only further restrict tools and tweak supported model settings; they must not expand permissions, bypass approval/`mutatesCode`, credential controls, or shell/filesystem/network policy.

### Out of Scope

- Other findings from the visual platform recommendations (live polish, data-port mapping, archetypes, approval handles, navigation rename, etc.).
- A new template/interpolation engine or visual mapping between node outputs.
- New archetypes, node primitives, or nested sub-workflows.
- Single-node playground.
- Comprehensive Agent Registry redesign.
- Workflow draft/publish versioning beyond reusing the existing run snapshot lifecycle.
- ReAct engine rewrite or credential-broker infrastructure rewrite.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Same Base Agent, Independent Step Instructions (Priority: P1)

An operator places two agent nodes that both select the same base Agent (for example “Developer Agent”). Node A’s step instructions say “generate code from the specification”; Node B’s say “fix bugs reported by QA.” Editing A’s instructions, model overrides, or step tools must not change B, must not change the base Agent in the registry, and must not change another workflow that also uses that Agent. When both nodes run, each receives its own step configuration.

**Why this priority**: This is the core product failure Finding 4 describes; without isolation, every other step-config capability is unsafe.

**Independent Test**: Build one workflow with two nodes on the same base agent, set distinct step instructions, edit A, save/reload, run, and verify B and the registry agent remain unchanged while each node’s run uses its own instruction.

**Acceptance Scenarios**:

1. **Given** two agent nodes in one workflow share the same base Agent with different step instructions, **When** the operator changes Node A’s step instructions, model overrides, or active tools, **Then** Node B’s stored step settings and the base Agent’s registry content remain unchanged.
2. **Given** Workflow W1 and Workflow W2 both reference the same base Agent, **When** the operator changes step settings on a node in W1, **Then** W2’s nodes and the base Agent remain unchanged.
3. **Given** Nodes A and B share a base Agent with distinct step instructions, **When** the workflow runs, **Then** each node’s execution receives that node’s own step instruction together with the shared persona/base system instructions—not the other node’s instruction.
4. **Given** an operator edits ordinary step fields in the properties panel, **When** those edits are applied, **Then** only the selected node’s configuration changes; the shared Agent is not written.

---

### User Story 2 - Author Step Settings Without Mutating the Registry (Priority: P1)

An operator opens an agent node’s properties and clearly sees: Base Agent selector, a read-only summary of the base Agent, Step Instructions, model settings with inherit/override/clear-override, tools limited to the base Agent’s allowed set, existing execution mode and max tool steps controls, and an explicit “Edit Agent in Registry” action. Defaults vs overrides vs effective values are distinguishable. Clearing an override restores inheritance. Opening the registry edit path warns that changes are shared and does not save unintended registry mutations merely by viewing it.

**Why this priority**: Authoring is where the anti-pattern happens today; the panel must stop being a shared-agent editor by default.

**Independent Test**: Open node properties, change every step field, confirm registry agent content and `updatedAt` are unchanged; use clear-override; use “Edit Agent in Registry” and confirm shared-impact messaging and existing registry permissions.

**Acceptance Scenarios**:

1. **Given** an agent node linked to a base Agent, **When** the properties panel opens, **Then** the operator sees Base Agent selection, a read-only base summary, Step Instructions, inheritable/overridable model settings, step tool selection from the base Agent’s allowed tools, execution mode / max tool steps, and “Edit Agent in Registry.”
2. **Given** a model setting is inheriting from the base Agent, **When** the operator sets an override and later clears that override, **Then** the stored node no longer carries that override and the effective value again matches the base Agent.
3. **Given** the operator chooses “Edit Agent in Registry,” **When** the registry path opens, **Then** the UI makes the shared impact of registry edits explicit, existing registry permissions are enforced, and merely opening/viewing that path does not persist a registry change.
4. **Given** fields that define agent identity, credentials, security policy, backend, provider, or base model, **When** the operator works in the ordinary node properties panel, **Then** those fields are not editable there; changing them requires the explicit registry path.

---

### User Story 3 - Step Configuration Survives Persistence and Applies at Runtime (Priority: P1)

An operator sets step instructions, partial model overrides (including a supported zero value such as temperature `0`), and an active tool subset, saves the workflow, reloads or reopens it, and optionally uses existing duplicate/import/export paths. All step settings retain meaning. On run, validation/compile/execution apply those settings for that node without mutating the shared Agent or other nodes—even when two concurrent runs use the same base Agent.

**Why this priority**: Fields that only exist in the form are not a product fix; persistence and execution fidelity are mandatory.

**Independent Test**: Round-trip save/reload/duplicate; run two concurrent workflows with different step settings on the same base Agent; assert no cross-leak and that effective model/tools/instructions match each node.

**Acceptance Scenarios**:

1. **Given** a node has step instructions, model overrides, and active tools set, **When** the workflow is saved and later reopened (and when duplicated/imported/exported via existing operations), **Then** those step settings are present with the same meaning.
2. **Given** a partial model override including a valid zero (for example temperature `0`), **When** effective settings are computed and the node runs, **Then** zero is treated as an explicit value, not as “unset / inherit.”
3. **Given** two concurrent runs use the same base Agent with different step settings, **When** both execute, **Then** each run receives only its own effective step configuration; neither temporarily mutates the shared Agent nor the other run’s settings.
4. **Given** a backend/provider/model that does not support a chosen override, **When** the operator saves or runs, **Then** the platform rejects the unsupported setting with an actionable error and does not silently ignore it at execution time.

---

### User Story 4 - Restrict Tools Per Step Without Expanding Access (Priority: P1)

An operator narrows the tools available for one step to a subset of the base Agent’s allowed tools. Omitted `activeTools` means inherit the base Agent’s allowed tools (subject to current policy). An explicit empty list means no callable tools for that step. At execution, only the effective tool set is offered to the model and accepted for real invocation. Tampered tool ids, unknown/disabled/foreign-tenant tools, or tools outside the effective set are refused. Approval, `mutatesCode`, credential-broker, and shell/filesystem/network controls still apply.

**Why this priority**: Tool restriction is both a usability and a security boundary; silent expansion is unacceptable.

**Independent Test**: Configure subset vs omit vs empty; attempt unauthorized tool calls including manipulated requests; confirm refusal. Verify approval/`mutatesCode`/credential/policy controls still gate sensitive actions after overrides.

**Acceptance Scenarios**:

1. **Given** a node has no `activeTools` field, **When** the step runs, **Then** effective tools are the base Agent’s currently allowed and usable tools under existing policy.
2. **Given** a node has `activeTools` set to an empty list, **When** the step runs, **Then** no tools are offered or executable for that step.
3. **Given** a node has a non-empty `activeTools` list, **When** validated, **Then** every entry must be a subset of the base Agent’s allowed and usable tools; otherwise the platform blocks with a clear error and does not silently grant extras.
4. **Given** a model or caller requests a tool outside the effective set (including manipulated payloads), **When** execution handles the request, **Then** the tool is not executed.
5. **Given** step overrides are applied, **When** a sensitive action would require approval, violate `mutatesCode` rules, credential policy, or shell/filesystem/network policy, **Then** those controls still enforce as they do today.

---

### User Story 5 - Base Agent Changes, Legacy Workflows, and In-Flight Runs (Priority: P2)

An operator switches a node to a different base Agent: step instructions are kept; incompatible model overrides or tools that are no longer allowed are surfaced and block execution until resolved—never silently expanding access. Legacy workflows without the new fields keep prior behavior. Explicit registry changes to base defaults affect later runs for non-overridden fields while preserving node overrides. Edits after a run has started do not alter that active run’s settings. Missing, disabled, or inaccessible base Agents produce actionable errors.

**Why this priority**: Safe migration and change management prevent regressions and privilege surprises after the decoupling ships.

**Independent Test**: Change base agent with stale overrides; open a pre-feature workflow; change registry defaults with and without overrides; edit mid-run; link deleted/disabled agents.

**Acceptance Scenarios**:

1. **Given** a node has step settings and the operator selects a different base Agent, **When** the selection is applied, **Then** `taskInstruction` is preserved, incompatible overrides/tools are clearly marked, and execution is blocked until the ambiguity is resolved (no silent privilege expansion).
2. **Given** a workflow saved before this feature (no new step fields), **When** it is opened and run without reconfiguration, **Then** behavior matches the previous baseline (shared agent prompt/settings/tools; existing node `executionMode` / `maxToolSteps` rules unchanged).
3. **Given** the operator explicitly changes a base Agent default in the registry, **When** a later run starts for a node that does not override that field, **Then** the new default is used; explicit node overrides remain as set.
4. **Given** a run has already started under the existing snapshot lifecycle, **When** the operator later edits the node or the registry Agent, **Then** the in-progress run continues with the settings captured for that run.
5. **Given** the linked base Agent is missing, disabled, or inaccessible to the operator/tenant, **When** the operator validates or runs, **Then** they receive an actionable error rather than silent fallback to another agent.

---

### Edge Cases

- Clearing a model override must remove it from stored node configuration (not store `null` that is later treated as an explicit value), restoring inheritance.
- Partial model overrides merge field-by-field onto base settings; unspecified fields inherit.
- Valid numeric zero (for example temperature `0`) is an explicit override.
- `activeTools` omitted/undefined ≠ `activeTools: []`.
- Switching base Agent while step tools reference ids absent from the new agent’s allowed set → incompatible; block run until fixed.
- Model override keys unsupported for the current backend/provider/model → rejected with actionable message in validation and at execution (no silent drop).
- Anthropic-style mutual exclusion (temperature vs topP) applies to the **effective** merged settings, not only to raw base settings.
- `executionMode` / `maxToolSteps` precedence remains **node → agent → derived default**; derived default for mode uses the **effective** tool set for that step (after `activeTools` resolution), not merely the raw base Agent tool list, so an empty step tool list does not still imply ReAct solely because the base Agent has tools.
- ReAct with an empty effective tool set behaves as a non-tool-calling step consistent with existing single-turn / no-tools behavior; max tool steps remains configured but unused until tools are effective.
- For backends that cannot natively honor step tool restriction or model overrides, the product must either apply an enforceable platform-side restriction, or refuse configuration/execution with a clear unsupported capability message—never claim a restriction it cannot enforce.
- Concurrent editors on the same workflow follow existing save conflict behavior; this feature does not add new collaboration semantics.
- Step instruction empty or omitted → prior behavior (base system prompt / persona only, plus existing workflow input/context).
- Step instruction is additive to base persona/system prompt and must not replace security controls or base system instructions.
- Existing fields `mutatesCode` and `role` remain valid and unaffected in meaning.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Separation of base Agent vs step configuration

- **FR-001**: The system MUST treat the Agent registry record as the owner of agent identity (id, name, description), persona/base system instructions, backend/provider/base model and default model settings, allowed tools, execution/security policies, and credential references.
- **FR-002**: Each agent workflow node MUST be able to store independent step configuration including: base agent selection (`agentId`), optional `taskInstruction`, optional `modelSettingsOverride` for supported model settings, optional `activeTools`, and the existing `executionMode` and `maxToolSteps` overrides.
- **FR-003**: Existing node fields `mutatesCode` and `role` MUST remain supported with their current meanings.
- **FR-004**: Ordinary node-properties editing MUST NOT grant the ability to change agent identity, credentials, security policy, backend type, provider, or base model; those changes MUST require the explicit registry editing path.
- **FR-005**: Editing step configuration MUST NOT modify the shared Agent registry record’s content or update timestamp.

#### Authoring experience

- **FR-006**: The agent node properties panel MUST present: Base Agent selector; read-only summary of the selected base Agent; Step Instructions input; model settings with distinguishable default / override / effective values and the ability to clear an override back to inheritance; tool selection limited to the base Agent’s allowed tools; existing execution mode and max tool steps controls; and an explicit “Edit Agent in Registry” action.
- **FR-007**: All ordinary property-panel edits for step fields MUST update only the selected node’s configuration.
- **FR-008**: “Edit Agent in Registry” MUST be an explicit operator action that communicates shared impact of registry changes, respects existing registry permissions, and MUST NOT persist registry mutations merely because the operator opened or viewed that path.
- **FR-009**: If the product already supports prompt/variable syntax for step text, UI guidance MUST mention only that existing supported syntax and variables; this feature MUST NOT introduce a new interpolation or cross-node mapping engine.

#### Inheritance and effective values

- **FR-010**: Absence of an override for a given field MUST mean inheritance from the base Agent (or derived default where applicable).
- **FR-011**: A partial `modelSettingsOverride` MUST override only the fields explicitly set; other model setting fields MUST inherit from the base Agent.
- **FR-012**: A valid zero numeric override MUST be treated as an explicit value, not as absence.
- **FR-013**: Clearing an override MUST remove that override from stored step configuration so inheritance resumes.
- **FR-014**: Absence of `activeTools` MUST mean use the base Agent’s allowed tools subject to current usability and policy checks.
- **FR-015**: `activeTools` equal to an empty list MUST mean no callable tools for that step.
- **FR-016**: A non-empty `activeTools` list MUST be validated as a subset of the base Agent’s allowed and currently usable tools; violations MUST block with a clear error and MUST NOT silently add tools.
- **FR-017**: Effective `executionMode` and `maxToolSteps` MUST keep existing precedence: node override, else agent setting, else derived default. Derived mode MUST consider the step’s **effective** tool set after `activeTools` resolution (non-empty effective tools ⇒ default ReAct; empty ⇒ default single-turn), unless explicitly overridden.
- **FR-018**: When the selected base Agent changes, the system MUST preserve `taskInstruction`, surface incompatible model overrides and disallowed tools, and block execution until incompatibilities are resolved; the system MUST NOT silently expand tool or setting privileges.

#### Step instructions in real execution

- **FR-019**: When present and non-empty, `taskInstruction` MUST be delivered to the agent for that node’s execution along with existing workflow input/context.
- **FR-020**: `taskInstruction` MUST complement—not replace—the base Agent persona/system instructions and MUST NOT override security controls.
- **FR-021**: Empty or omitted `taskInstruction` MUST preserve prior behavior for that node.
- **FR-022**: The conceptual order of guidance MUST be testable as: base persona/system instructions, then step task instruction (when present), then workflow input/context data already supplied to the agent step.

#### End-to-end application

- **FR-023**: Step configuration MUST be preserved and applied through storage, load, validation, compilation, and actual execution—not only in the editor form.
- **FR-024**: Building effective settings for a node MUST NOT mutate the shared Agent record or any other node’s configuration, even temporarily.
- **FR-025**: For each existing agent backend the product already runs, the system MUST document and enforce which step settings are supported: supported settings MUST be applied; unsupported combinations MUST fail with an actionable error; no setting accepted in the UI may be silently ignored at execution.
- **FR-026**: This feature MUST NOT implicitly invent new capabilities for backends that lack them.
- **FR-027**: Once a run has started, that run’s effective agent/step settings MUST remain those captured by the existing run snapshot lifecycle; later node or registry edits MUST NOT alter the in-progress run. This feature MUST NOT introduce a separate workflow publish/versioning system.

#### Tools and security boundaries

- **FR-028**: Effective tool restrictions MUST apply both when tools are presented to the model and when tool calls are actually executed.
- **FR-029**: Presence of a tool identifier in a model request or in node configuration MUST NOT by itself authorize execution; unknown, disabled, deleted, cross-tenant, or otherwise disallowed tools MUST be rejected under existing policy.
- **FR-030**: Step configuration MUST NOT bypass approval gates, `mutatesCode` restrictions, credential-broker controls, or shell/filesystem/network execution policies.
- **FR-031**: For backends with independent native tool control that the platform cannot fully constrain, the product MUST state the enforceable guarantee explicitly and MUST NOT promise a restriction it cannot apply; unenforceable restrictions MUST be rejected or clearly unsupported rather than falsely advertised.

#### Compatibility

- **FR-032**: Workflows lacking the new step fields MUST continue to behave as before without mandatory reconfiguration.
- **FR-033**: New step field values MUST round-trip through save, reopen, reload, and existing duplicate/import/export operations without loss or semantic change.
- **FR-034**: Explicit registry changes to base defaults MUST affect subsequent runs for fields the node does not override, while leaving explicit node overrides intact.
- **FR-035**: Missing, disabled, or inaccessible base Agents MUST produce actionable validation/runtime errors.

### Key Entities

- **Base Agent (Registry Agent)**: Shared reusable agent definition owning identity, persona/base system instructions, backend/provider/model defaults, allowed tools, policies, and credential references.
- **Agent Step Configuration (node config)**: Per-node settings selecting a base Agent and optionally supplying `taskInstruction`, `modelSettingsOverride`, `activeTools`, `executionMode`, `maxToolSteps`, plus existing `mutatesCode` / `role`.
- **Model Settings Override**: Partial map of supported model settings (such as temperature, topP, maxTokens, reasoningEffort where applicable) applied field-by-field over base defaults.
- **Effective Step Configuration**: The resolved instruction set, model settings, tool set, and execution mode/limits actually used for one node execution after inheritance rules.
- **Effective Tool Set**: The tools a step may present and execute after intersecting step `activeTools` (if set), base Agent allowed tools, registry usability, and security policy.
- **Run Snapshot**: Existing immutable capture of workflow definition, agents, and tools at run start that freezes in-progress execution settings.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (Independence)**: In structured acceptance tests with two nodes (and separately two workflows) sharing one base Agent, 100% of step-field edits on one side leave the other side’s step settings and the base Agent record unchanged.
- **SC-002 (Runtime fidelity)**: For each supported backend in the test matrix, when step instruction, supported model overrides, and tool restrictions are configured, 100% of successful-path runs observe those effective values in that node’s execution (no silent ignore).
- **SC-003 (Persistence)**: After save → reopen and after existing duplicate/import/export paths, 100% of configured step fields retain identical meaning in automated round-trip checks.
- **SC-004 (No privilege expansion)**: Unauthorized / out-of-effective-set / manipulated tool invocations are blocked in 100% of security tests; empty `activeTools` yields zero executable tools; omitted `activeTools` never grants tools beyond the base Agent’s allowed set.
- **SC-005 (Legacy compatibility)**: 100% of sampled pre-feature workflows without new fields open and run with prior baseline behavior without mandatory reconfiguration.
- **SC-006 (Override semantics)**: Automated cases for partial merge, explicit zero, clear-to-inherit, omit-vs-empty tools, and base-agent switch incompatibilities pass with the behaviors defined in this spec.
- **SC-007 (Concurrent isolation)**: Two concurrent runs of the same base Agent with different step settings show 0 cross-run setting leaks in concurrency tests.
- **SC-008 (In-flight stability)**: After run start, subsequent node/registry edits change 0 settings of the already-started run under the existing snapshot lifecycle.
- **SC-009 (Authoring safety)**: Ordinary properties-panel interactions for step fields produce 0 unintended registry writes (including no spurious agent `updatedAt` changes) in automated editor tests; registry edits occur only via the explicit registry path under existing permissions.
- **SC-010 (Control integrity)**: After step overrides are applied, approval, `mutatesCode`, credential, and execution-policy controls still block disallowed actions in 100% of regression security scenarios covering those controls.

---

## Assumptions

- The existing Agent Registry detail experience (agent pages under the org agents area) is the destination for “Edit Agent in Registry”; this feature adds a clear entry point and shared-impact warning rather than redesigning registry IA.
- Supported model override keys are exactly those the platform already considers valid for the selected backend/provider/model (the same capability matrix already used for base agent model settings), including provider-specific exclusions and mutual-exclusion rules on **effective** values.
- “Usable” tools means tools that exist in the tenant-visible registry, are enabled, and pass the same policy checks already applied when resolving an agent’s assigned tools for execution.
- API-backed agents can receive complementary step instructions in-band with existing message construction; CLI/local/process/webhook agents receive step instructions through their existing instruction/input channels in an additive way appropriate to that backend, or reject unsupported delivery with an actionable error rather than silently dropping the instruction when the operator set one.
- Platform-enforced tool allowlists already used for API ReAct execution remain the primary enforcement point for `activeTools` on API agents; worker/CLI native tool ecosystems are only promised insofar as the platform can enforce them—otherwise unsupported.
- Empty step instruction and absent new fields intentionally preserve today’s behavior so migration is opt-in per node.
- Existing run snapshots of workflow + agents + tools are sufficient to freeze in-flight settings; no new versioning product is required for this feature.
- No new prompt-variable engine ships here; until a separate feature adds interpolation, Step Instructions are plain text (plus any syntax already truly supported elsewhere—if none, the UI must not advertise placeholders).
- Constitution placeholders in `.specify/memory/constitution.md` are not treated as ratified project principles for this specification.
- Tool-node registry mutation patterns are out of scope; only agent-node decoupling is in scope for this feature.

## Dependencies

- Existing Agent Registry persistence and permissions.
- Existing workflow definition persistence, validation, compilation, and run execution paths.
- Existing node-level `executionMode` / `maxToolSteps` resolution behavior (to be preserved and aligned with effective tools).
- Existing run snapshot lifecycle for in-progress immutability.
- Existing secure tool execution, approval, `mutatesCode`, credential-broker, and execution-policy controls.
- Feature `012-react-agent-loop` behaviors for API autonomous tool use remain the baseline into which step-level `activeTools` restrictions feed.
