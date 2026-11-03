# Feature Specification: Explicit Workflow Archetype Selection and Configuration

**Feature Branch**: `010-workflow-archetype-selection`

**Created**: 2026-11-03

**Status**: Draft

**Input**: User description: "Complete explicit workflow archetype selection and configuration in Agent Studio so users can create and manage both Linear Pipeline and Hierarchical Supervisor workflows through the UI."

---

## Architectural Context & Feature Boundary

### Foundation from Feature 009 (`009-dual-mode-orchestration`)
Feature 009 introduced the fundamental schema, type definitions, compiler validation, and runtime execution engine for dual-mode orchestration:
- **Contracts Reused**:
  - Archetype categories: `linear-pipeline` and `hierarchical-supervisor` defined in `@multi-agent/types`.
  - Archetype configuration structure: `WorkflowArchetypeConfig` including `category`, `supervisorHubNodeId`, `maxExecutionSteps` (range 1–5,000, default 1,000), `recursionGuards` (array of `WorkflowRecursionGuardConfig`), and `humanApprovalGateRequired`.
  - Recursion guard structure: `routeKey`, `maxIterations` (range 1–10, default 3), and `fallbackBranch`.
  - Validation issue codes: `INVALID_ARCHETYPE`, `LINEAR_PIPELINE_CYCLE_FORBIDDEN`, `MISSING_SUPERVISOR_HUB`, `INVALID_SUPERVISOR_HUB`, `MISSING_ROUTING_NODES`, `UNGUARDED_CYCLE`, `INVALID_RECURSION_GUARD`, `FALLBACK_NOT_WIRED`, `MISSING_APPROVAL_GATE`, and `APPROVAL_GATE_BYPASS`.
  - Schema specification: `specs/009-dual-mode-orchestration/contracts/workflow-archetype.schema.json`.

### Scope Boundary of Feature 010 (This Feature)
While Feature 009 implemented backend compilation, execution, and passive display badges, Feature 010 establishes the **interactive authoring, configuration, conversion, and lifecycle governance** within Agent Studio:
1. **Creation Experience**: Replace bare name prompt with an explicit archetype selection modal providing concise behavioral descriptions.
2. **Editor Archetype Controls**: Surface the current effective archetype in the workflow overview properties panel, allowing authorized operators to change archetypes explicitly.
3. **Supervisor Configuration Interface**: Provide dedicated UI controls to select eligible supervisor hub agent nodes, configure recursion guards, set step limits, and enforce approval gates.
4. **Graph-to-Configuration Integrity**: Synchronize UI validation reactively with canvas modifications (e.g., deleting a hub node, un-wiring fallback branches, or introducing cycles).
5. **Safe Archetype Conversion**: Guarantee non-destructive transitions between archetypes with dormant configuration preservation, cycle detection, and full Undo/Redo/Dirty-state integration.
6. **Legacy Workflow Compatibility**: Guarantee that legacy unclassified workflows (such as `wf-mw08286f-97zear` at `/o/pga/org`) continue to display and execute safely without regression.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Explicit Workflow Creation with Archetype Selection (Priority: P1)

An organization administrator or workflow operator creating a new workflow needs to explicitly choose between the two supported archetypes:
1. **Linear Pipeline**: A deterministic, sequential multi-agent pipeline executing an acyclic directed flow with discrete stage handoffs.
2. **Hierarchical Supervisor**: A hub-and-spoke multi-agent coordination architecture featuring dynamic condition routing, feedback remediation loops, and recursion guardrails.

When clicking "New workflow", the user is presented with a creation dialog rather than an unconstrained text prompt. The dialog requires a workflow name and offers archetype selection with concise behavioral descriptions, defaulting to Linear Pipeline. Upon confirmation, the workflow is initialized with the chosen archetype and persisted, displaying the appropriate badge and controls immediately upon opening.

**Why this priority**: Workflow creation is the primary entry point. Ensuring explicit archetype assignment from inception prevents accidental misconfiguration and eliminates ambiguity about execution behavior.

**Independent Test**: Can be tested independently by opening the workflow switcher, clicking "New workflow", selecting "Hierarchical Supervisor", confirming creation, and verifying that the newly opened workflow displays the "Hierarchical Supervisor" badge, contains supervisor-specific overview controls, and persists `archetype: "hierarchical-supervisor"` upon save and reload.

**Acceptance Scenarios**:

1. **Given** an operator clicks "New workflow", **When** the creation modal opens, **Then** both "Linear Pipeline" and "Hierarchical Supervisor" options are displayed with concise explanations of their execution semantics, with "Linear Pipeline" pre-selected by default.
2. **Given** an operator enters a valid name and selects "Linear Pipeline", **When** they confirm creation, **Then** a new workflow is created with `archetype: "linear-pipeline"`, the editor loads, and the switcher displays the "Linear Pipeline" badge.
3. **Given** an operator enters a valid name and selects "Hierarchical Supervisor", **When** they confirm creation, **Then** a new workflow is created with `archetype: "hierarchical-supervisor"`, initial supervisor configuration defaults are populated, and the editor displays the "Hierarchical Supervisor" badge.
4. **Given** a newly created workflow that lacks required structural elements (e.g., missing hub agent), **When** the user inspects the editor, **Then** the workflow is visibly marked as an incomplete draft and the "Run" execution button is disabled with actionable error messages.
5. **Given** an operator reopens a previously created workflow after a page refresh or navigation, **When** the workflow loads, **Then** the persisted archetype matches the selection made at creation time.

---

### User Story 2 - Inspecting and Editing Workflow Archetype in the Editor (Priority: P1)

An authorized operator inspecting an existing workflow in the editor needs to see its current effective archetype and be able to explicitly change it. When nothing on the canvas is selected, the Overview properties panel displays the active archetype, its description, and an archetype switcher selector.

Changing the archetype marks the workflow as unsaved (`isDirty`), updates the reactive validation state, and integrates seamlessly with the editor's Undo (`Ctrl+Z`), Redo (`Ctrl+Shift+Z` / `Ctrl+Y`), and Save (`Ctrl+S`) operations. If the user attempts to switch workflows or navigate away with pending archetype edits, the system triggers unsaved-navigation protection.

**Why this priority**: Operators must have full transparency into the governing execution rules of their workflows and the flexibility to reconfigure them without losing workflow identity or recreating graphs from scratch.

**Independent Test**: Can be tested independently by opening an existing Linear Pipeline workflow, navigating to the Overview panel, selecting "Hierarchical Supervisor", verifying the unsaved dirty indicator pulses, verifying `Undo` restores the Linear Pipeline archetype, verifying `Redo` restores Hierarchical Supervisor, and confirming that saving persists the updated archetype.

**Acceptance Scenarios**:

1. **Given** an existing workflow loaded in the editor with no node or edge selected, **When** inspecting the Overview panel, **Then** the effective archetype is displayed alongside an archetype selection control.
2. **Given** an operator changes the archetype from "Linear Pipeline" to "Hierarchical Supervisor", **When** the change is made, **Then** the workflow dirty state transitions to `Unsaved`, and the archetype badge in the header updates reactively.
3. **Given** an operator performs an archetype change, **When** they trigger `Undo`, **Then** the workflow reverts to its previous archetype and prior configuration state.
4. **Given** an operator has reverted an archetype change via `Undo`, **When** they trigger `Redo`, **Then** the archetype change and its associated configuration are reapplied.
5. **Given** an operator has pending unsaved archetype changes, **When** they attempt to select a different workflow in the switcher or navigate away, **Then** a confirmation prompt warns them of unsaved changes before allowing navigation.
6. **Given** an operator modifies the graph topology (such as adding condition nodes or feedback edges), **When** the canvas updates, **Then** the workflow archetype does NOT automatically change, remaining strictly explicit.
7. **Given** an operator changes the archetype, **When** the change is applied, **Then** existing workflow ID, node coordinates, edge connections, agent records, and tool records are fully preserved.

---

### User Story 3 - Hierarchical Supervisor Hub & Recursion Guard Configuration (Priority: P1)

When a workflow is configured as a Hierarchical Supervisor, the operator must configure the supervisor hub agent and loop safety boundaries. The Overview properties panel presents dedicated configuration sections:
1. **Supervisor Hub Selector**: A dropdown listing only eligible `agent` nodes currently present in the canvas.
2. **Recursion Guards Manager**: A table/list allowing the operator to add, edit, and remove recursion guards. Each guard specifies:
   - `routeKey`: The monitored feedback route (derived from condition nodes and cyclic connections).
   - `maxIterations`: Allowed iteration count before loop termination (bounded between 1 and 10, default: 3).
   - `fallbackBranch`: Target conditional branch key configured to exit the loop to a terminal node (bounded by valid condition branches in the graph).
3. **Execution Limits & Approval Gates**: Configurable `maxExecutionSteps` (bounded 1–5,000, default 1,000) and `humanApprovalGateRequired` toggle (default: true).

The UI validates configuration reactively against the graph. If a selected hub agent is deleted, or a route referenced by a guard is severed, the UI immediately displays actionable, localized errors and blocks execution until resolved.

**Why this priority**: Hierarchical supervisor workflows execute dynamic cycles. Without a designated supervisor hub and wired recursion guards, workflows can execute unbounded loops or fail at runtime.

**Independent Test**: Can be tested independently by switching a workflow to Hierarchical Supervisor, selecting an Agent node as hub, adding a recursion guard for a feedback edge with `maxIterations = 3` and a valid exit fallback branch, verifying that deleting the hub node triggers a localized validation error, and confirming that the "Run" button is disabled until a valid hub is restored.

**Acceptance Scenarios**:

1. **Given** a workflow set to Hierarchical Supervisor with two agent nodes (`planner`, `coder`) on the canvas, **When** opening the supervisor hub selector, **Then** only `planner` and `coder` appear as selectable options.
2. **Given** an operator selects `planner` as the supervisor hub, **When** the selection is made, **Then** `supervisorHubNodeId` is updated in the workflow configuration and the workflow becomes dirty.
3. **Given** an operator selects an agent node as the hub and subsequently deletes that node from the canvas, **When** validation evaluates, **Then** an actionable error (`INVALID_SUPERVISOR_HUB`) is displayed on the hub selector and status bar.
4. **Given** a supervisor workflow containing cyclic condition routes, **When** the operator opens the recursion guards panel, **Then** they can add a guard specifying `routeKey`, `maxIterations` (1–10), and `fallbackBranch`.
5. **Given** a guard configured with a `fallbackBranch`, **When** the fallback branch key does not exist on any condition node or fails to reach an exit node, **Then** a localized error (`FALLBACK_NOT_WIRED`) identifies the exact misconfigured guard.
6. **Given** `humanApprovalGateRequired` is enabled, **When** the graph lacks an approval node or a code-mutating route bypasses approval, **Then** validation flags `MISSING_APPROVAL_GATE` or `APPROVAL_GATE_BYPASS` and blocks execution.
7. **Given** any blocking supervisor validation error is active, **When** the operator views the editor toolbar, **Then** the "Run" button is disabled and clicking "Validate" highlights the first blocking error.

---

### User Story 4 - Safe Archetype Conversion & Conflict Handling (Priority: P2)

Operators frequently need to evolve existing workflows—either converting a simple Linear Pipeline into a Hierarchical Supervisor as requirements expand, or simplifying a Supervisor workflow into a Linear Pipeline.

Conversion must be safe and non-destructive:
- **Linear to Supervisor**: Exposes supervisor configuration fields, initializes sensible defaults, and highlights any missing requirements (such as selecting a hub or defining recursion guards if cycles exist) without modifying existing nodes or edges.
- **Supervisor to Linear**: Checks graph topology for cycles. If cycles exist, conversion displays clear, actionable errors identifying every node participating in cycles that violates linear execution. Supervisor-specific settings (`supervisorHubNodeId`, `recursionGuards`) are retained in a deactivated state in the definition, ensuring no data loss if the user reverts or toggles back.
- **Human Approval & Governance**: Conversion must never bypass approval gate requirements or grant autonomous code mutation privileges without human consent.
- **Conflict Handling**: If a workflow definition declares contradictory settings (e.g., `archetype: "linear-pipeline"` with `archetypeConfig.category: "hierarchical-supervisor"`), the system rejects the definition with a descriptive error.

**Why this priority**: Workflows evolve over their operational lifecycle. Destructive conversions or unhandled structural conflicts frustrate operators and introduce runtime failures.

**Independent Test**: Can be tested independently by creating a Linear Pipeline, converting it to Hierarchical Supervisor, configuring hub and guards, converting it back to Linear Pipeline, verifying that cycles block linear validation, reverting via Undo to restore supervisor configuration intact, and confirming that no nodes, edges, or settings were discarded.

**Acceptance Scenarios**:

1. **Given** a Linear Pipeline with five sequential nodes, **When** the operator converts it to "Hierarchical Supervisor", **Then** all five nodes and their connecting edges remain completely intact, and the supervisor configuration form appears.
2. **Given** a Hierarchical Supervisor workflow containing feedback loops, **When** the operator converts it to "Linear Pipeline", **Then** validation immediately reports `LINEAR_PIPELINE_CYCLE_FORBIDDEN` listing all participating cycle nodes.
3. **Given** an operator converts a Supervisor workflow to Linear Pipeline and saves it, **When** inspecting the definition payload, **Then** `archetype` is `linear-pipeline`, `archetypeConfig.category` is `linear-pipeline`, and prior supervisor hub and guard settings are stored in a dormant state rather than permanently deleted.
4. **Given** a workflow with dormant supervisor settings, **When** the operator switches back to "Hierarchical Supervisor", **Then** the previously configured hub and guards are restored for review.
5. **Given** a definition containing conflicting `archetype` and `archetypeConfig.category` values, **When** validated or loaded, **Then** the system rejects the definition with error code `INVALID_ARCHETYPE`.
6. **Given** an archetype conversion on a workflow requiring human approval before code mutation, **When** the archetype is switched, **Then** human-in-the-loop approval constraints remain strictly enforced.

---

### User Story 5 - Persistence Consistency, Import/Export & Legacy Compatibility (Priority: P2)

All components across Agent Studio—WorkflowSwitcher dropdown, editor badges, overview properties forms, server compilation, and execution runners—must interpret the effective archetype identically following the canonical hierarchy:
1. `definition.archetype` (if explicitly present)
2. `definition.archetypeConfig.category` (if `archetype` is undefined)
3. Default: `linear-pipeline` (legacy fallback).

Legacy workflows without archetype declarations (such as `wf-mw08286f-97zear` in organization `org-building-gap` or `org-pga` at `/o/pga/org`) must continue to display and execute safely. Untyped legacy workflows containing cycles are evaluated under server-level recursion guardrails and are NOT blocked by linear cycle errors unless an operator explicitly saves them with an explicit archetype declaration.

Workflows exported as JSON packages must include the full archetype and configuration properties. Imported packages must be validated against `workflow-archetype.schema.json`, reporting clear errors for invalid payloads.

**Why this priority**: Preserves backward compatibility for existing enterprise workflows while guaranteeing that what the user sees in the UI strictly matches what executes on the server.

**Independent Test**: Can be tested independently by loading an untyped legacy workflow, verifying it displays as "Linear Pipeline (Legacy)", confirming it executes within server limits despite containing condition nodes, exporting the package, verifying JSON fidelity, modifying the JSON to contain an invalid archetype enum, and verifying that import fails with a structured error.

**Acceptance Scenarios**:

1. **Given** a legacy workflow definition with neither `archetype` nor `archetypeConfig`, **When** loaded into the switcher and editor, **Then** it resolves effectively as `linear-pipeline` and displays a legacy indicator.
2. **Given** an untyped legacy workflow containing feedback cycles, **When** executed without editing, **Then** it is not blocked by `LINEAR_PIPELINE_CYCLE_FORBIDDEN` and executes bounded by server recursion limits.
3. **Given** an operator edits an untyped legacy workflow and explicitly selects "Linear Pipeline", **When** saved, **Then** `archetype: "linear-pipeline"` is persisted and linear acyclic enforcement applies.
4. **Given** a workflow definition with only `archetypeConfig.category` specified, **When** loaded, **Then** the switcher badge and editor controls reflect that category without requiring manual migration.
5. **Given** a workspace package export, **When** downloaded, **Then** all workflows in the package include their exact `archetype` and `archetypeConfig` properties.
6. **Given** an imported workspace package containing an unrecognized archetype category, **When** import is processed, **Then** import fails closed with an actionable error identifying the invalid workflow.
7. **Given** a save failure caused by network interruption or server policy rejection, **When** the failure occurs, **Then** the client draft remains dirty with all user edits preserved, and an error banner displays the cause.

---

### User Story 6 - Multi-Tenancy Isolation, Role Authorization & Accessible UX (Priority: P3)

Workflow archetype selection and configuration must enforce organization boundaries and role-based access controls within Agent Studio:
- **Viewer Role**: Read-only access. Viewers can inspect the effective archetype, view hub and recursion guard settings, but all selection inputs, guard forms, and the "Run" trigger are disabled.
- **Member / Admin / Owner Roles**: Full editing permissions. Can create workflows with archetypes, edit archetype settings, convert archetypes, save, and execute.
- **Tenant Isolation**: Workflow definitions, hub bindings, and agent choices are strictly bounded by `tenantId`. An operator cannot select an agent from another organization as a supervisor hub.
- **Cross-Workflow State Hygiene**: When switching active workflows via the switcher dropdown or deep-link URL (`?workflowId=...`), the editor store completely flushes pending drafts, validation issues, and selection state to prevent cross-workflow configuration leakage.
- **Accessibility & Design**: Controls adhere to the Studio dark theme, support keyboard navigation (Tab, Arrow keys, Enter/Escape), and include appropriate ARIA attributes (`aria-label`, `aria-invalid`, `aria-describedby`, `role="alert"`).

**Why this priority**: Enterprise multi-tenancy and role boundaries protect organizations against unauthorized modifications and data leakage across tenants or users.

**Independent Test**: Can be tested independently by logging in as a Viewer, navigating to `/o/pga/org`, verifying that archetype selectors and guard inputs are disabled, switching to an Admin account, verifying controls become interactive, and switching between two workflows to confirm no state or validation errors bleed across workflows.

**Acceptance Scenarios**:

1. **Given** a user with `viewer` role navigating the workflow editor, **When** viewing the Overview panel, **Then** the archetype badge and configuration are visible but all dropdowns, inputs, and the "Save" and "Run" buttons are disabled.
2. **Given** a user with `member`, `admin`, or `owner` role, **When** viewing the Overview panel, **Then** archetype selectors, hub dropdowns, and guard controls are fully interactive.
3. **Given** an organization with registered agents, **When** configuring a supervisor hub, **Then** the hub selector only displays agent nodes defined within the current organization.
4. **Given** an operator switches from Workflow A (which has unsaved supervisor errors) to Workflow B (a valid linear pipeline), **When** Workflow B loads, **Then** no validation errors or form values from Workflow A persist in the editor.
5. **Given** an operator navigating using keyboard only, **When** interacting with archetype selectors and recursion guard inputs, **Then** all controls receive focus in logical tab order and trigger with standard keyboard actions.

---

### Edge Cases

- **Supervisor Hub Agent Deleted from Canvas**: If the agent node referenced by `supervisorHubNodeId` is removed from the canvas, the hub selector displays an empty/error state ("Hub agent missing"), validation flags `INVALID_SUPERVISOR_HUB`, and execution is blocked until a replacement hub is chosen or the deletion is undone.
- **Node Type Mutation**: If the node configured as the supervisor hub has its node type modified to a non-agent type (e.g., condition or tool), validation immediately flags `INVALID_SUPERVISOR_HUB` because supervisor hubs must be agent nodes.
- **Guard References Non-Existent or Disconnected Branch**: If a recursion guard's `fallbackBranch` specifies a branch key that was deleted from condition nodes or whose edge does not reach a terminal output node, validation surfaces `FALLBACK_NOT_WIRED` with links to the guard.
- **Cyclic Graph Converted to Linear Pipeline**: When an operator switches a cyclic workflow to Linear Pipeline, conversion does not delete edges; instead, it renders `LINEAR_PIPELINE_CYCLE_FORBIDDEN` error badges on all participating cycle nodes and disables saving and running.
- **Conflicting Declarations in Persisted/Imported Data**: When a workflow specifies `archetype: "linear-pipeline"` and `archetypeConfig.category: "hierarchical-supervisor"`, validation reports `INVALID_ARCHETYPE: Workflow archetype must match archetypeConfig.category` and rejects the payload fail-closed.
- **Zero Agent Nodes in Supervisor Graph**: When an empty workflow or a workflow without agent nodes is set to Hierarchical Supervisor, the hub selector displays "No agent nodes available in graph" with guidance to add an Agent node from the palette.
- **Save Fails Mid-Session**: If saving fails due to network outage or server 400 validation, the draft remains marked `Unsaved`, user edits are retained in memory, and the error banner displays the failure reason without reloading or discarding work.
- **Rapid Switching Between Workflows with Dirty State**: If a user initiates a switch from Workflow A to Workflow B and cancels the unsaved prompt, the editor remains cleanly on Workflow A with dirty state intact. If confirmed, Workflow A changes are discarded and Workflow B loads cleanly without residual state.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Workflow Creation & Archetype Selection
- **FR-001**: The system MUST provide an archetype selection dialog when creating a new workflow, replacing unconstrained single-field text prompts.
- **FR-002**: The creation dialog MUST offer both `Linear Pipeline` and `Hierarchical Supervisor` archetypes, with `Linear Pipeline` selected by default.
- **FR-003**: The creation dialog MUST display clear, concise descriptions of each archetype's execution model and topology constraints.
- **FR-004**: The system MUST persist the selected archetype in the workflow definition upon creation and re-render the corresponding archetype badge upon reloading.
- **FR-005**: Newly created workflows that lack execution-ready configuration (e.g. supervisor without a hub) MUST be clearly marked as incomplete drafts.
- **FR-006**: The system MUST disable workflow execution ("Run") and display actionable guidance whenever an incomplete draft has blocking validation errors.

#### Workflow Editor & Overview Archetype Controls
- **FR-007**: The Overview properties panel MUST display the effective workflow archetype and provide an explicit selector allowing authorized users to change it.
- **FR-008**: Changing the archetype or its configuration parameters MUST immediately mark the workflow as dirty (`isDirty = true`).
- **FR-009**: Archetype modifications MUST integrate with the editor history stack, fully supporting Undo (`Ctrl+Z`) and Redo (`Ctrl+Shift+Z` / `Ctrl+Y`).
- **FR-010**: The system MUST enforce unsaved-navigation protection, prompting for confirmation before allowing navigation or switching away from pending archetype edits.
- **FR-011**: Changing the archetype MUST preserve workflow identity (`id`, `name`, `tenantId`, `ownerId`), all graph nodes, edges, node configurations, agent records, and tool records.
- **FR-012**: Archetype assignment MUST remain strictly explicit; canvas edits (such as adding condition nodes, loops, or agents) MUST NOT automatically change the workflow archetype.

#### Hierarchical Supervisor Hub & Recursion Guard Configuration
- **FR-013**: When the effective archetype is `hierarchical-supervisor`, the editor MUST display configuration sections for the supervisor hub, recursion guards, execution limits, and approval gates.
- **FR-014**: The supervisor hub selector MUST list only valid `agent` nodes present in the active workflow graph.
- **FR-015**: If the designated supervisor hub node is deleted or mutated to a non-agent type, the system MUST surface a localized, actionable error (`INVALID_SUPERVISOR_HUB`) and block execution.
- **FR-016**: The system MUST allow users to add, edit, and remove recursion guards for cyclic feedback routes in the supervisor graph.
- **FR-017**: Each recursion guard MUST configure:
  - `routeKey`: Monitored route identifier corresponding to a cyclic feedback path.
  - `maxIterations`: Integer loop iteration limit bounded between 1 and 10 (default: 3).
  - `fallbackBranch`: Conditional branch key configured to route execution to a terminal exit node upon exceeding the iteration limit.
- **FR-018**: The system MUST validate that every guard's `fallbackBranch` exists on an active condition node and reaches a terminal exit node, flagging `FALLBACK_NOT_WIRED` if disconnected.
- **FR-019**: The editor MUST expose `maxExecutionSteps` configuration bounded between 1 and 5,000 (default: 1,000).
- **FR-020**: The editor MUST expose a toggle for `humanApprovalGateRequired` (default: true for supervisor). When enabled, validation MUST verify that an approval node exists and intercepts code mutation paths before code alterations can execute.
- **FR-021**: The system MUST disable execution ("Run") whenever required supervisor configuration is missing or invalid.

#### Safe Archetype Conversion, Graph Preservation & Cycle Safety
- **FR-022**: Converting from Linear Pipeline to Hierarchical Supervisor MUST retain all graph nodes and edges intact and expose supervisor configuration fields with highlighted requirements.
- **FR-023**: Converting from Hierarchical Supervisor to Linear Pipeline MUST analyze the graph for cycles and surface `LINEAR_PIPELINE_CYCLE_FORBIDDEN` errors on every participating node if cycles exist.
- **FR-024**: When converting a Hierarchical Supervisor to Linear Pipeline, previous supervisor settings (`supervisorHubNodeId`, `recursionGuards`, limits) MUST be retained in a dormant/deactivated state in the definition to prevent permanent data loss.
- **FR-025**: The UI MUST inform the user via a non-destructive notice that supervisor-specific settings are dormant while the workflow is configured as a Linear Pipeline.
- **FR-026**: Switching back to Hierarchical Supervisor or triggering Undo MUST reactivate and restore previous supervisor settings.
- **FR-027**: Archetype conversion MUST preserve applicable human approval gate requirements and MUST NOT authorize autonomous code modification.
- **FR-028**: If a workflow definition declares conflicting archetype indicators (e.g. `archetype !== archetypeConfig.category`), the system MUST reject the definition with error code `INVALID_ARCHETYPE`.

#### Consistency, Persistence & Legacy Compatibility
- **FR-029**: WorkflowSwitcher dropdown options, editor badges, overview property forms, server validation, and execution runners MUST resolve the effective archetype using identical rules:
  1. `definition.archetype` (if set)
  2. `definition.archetypeConfig.category` (if set and `archetype` is undefined)
  3. Default: `linear-pipeline` (if neither is set).
- **FR-030**: Legacy workflow definitions lacking both `archetype` and `archetypeConfig` MUST display as `Linear Pipeline (Legacy)` and continue to load, save, and execute without regression.
- **FR-031**: Untyped legacy workflows containing cycles MUST NOT be blocked by linear cycle checks during execution or save, retaining compatibility with server-level recursion guardrails.
- **FR-032**: If an authorized user explicitly edits and saves an untyped legacy workflow with an archetype, the workflow MUST be promoted to an explicit archetype contract and subsequent saves enforce that archetype's rules.
- **FR-033**: Workflows specifying only `archetypeConfig.category` MUST display and validate in strict accordance with that declared category.
- **FR-034**: Workspace package export MUST preserve all archetype and `archetypeConfig` fields without truncation or corruption.
- **FR-035**: Workspace package import MUST validate archetype structures against `workflow-archetype.schema.json` and fail closed with clear error reporting on invalid schemas.

#### Multi-Tenancy Isolation, Permissions & UX
- **FR-036**: Workflow archetype creation, editing, and execution MUST operate within the current organization context (`tenantId`) and enforce existing role permissions (`viewer` read-only, `member`/`admin`/`owner` full access).
- **FR-037**: Hub selection options MUST be strictly restricted to agent nodes registered within the current organization.
- **FR-038**: The system MUST prevent state leakage across workflows by fully resetting active store state, validation issues, and selection when switching workflows.
- **FR-039**: If a workflow save fails due to network or server policy rejection, the client draft MUST remain dirty in memory with all user inputs preserved.
- **FR-040**: All archetype selection and supervisor configuration controls MUST support keyboard navigation, maintain minimum contrast ratios in dark mode, and provide appropriate ARIA attributes.

---

### Key Entities *(data involved)*

- **Workflow Archetype Metadata**: Structural category classification (`linear-pipeline` | `hierarchical-supervisor`) governing graph validation and execution behavior. Persisted directly on `WorkflowDefinition.archetype` and mirrored on `WorkflowArchetypeConfig.category`.
- **Workflow Archetype Config**: Container object (`archetypeConfig`) persisting execution parameters for the workflow archetype:
  - `category`: Declared archetype string matching `archetype`.
  - `supervisorHubNodeId`: Node ID of the primary supervisor agent coordinating task dispatch and feedback.
  - `maxExecutionSteps`: Total execution step bound (1–5,000, default 1,000).
  - `recursionGuards`: Array of route-level loop boundaries.
  - `humanApprovalGateRequired`: Governance flag enforcing human sign-off before code mutation.
- **Recursion Guard Definition**: Route-level safeguard specifying `routeKey` (source->target or branch identifier), `maxIterations` (integer 1–10, default 3), and `fallbackBranch` (condition exit branch).
- **Dormant Configuration Container**: State mechanism preserving supervisor configuration when a workflow is converted to Linear Pipeline, preventing accidental data loss while marking the active category linear.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of workflows created through the UI have an explicit archetype (`linear-pipeline` or `hierarchical-supervisor`) persisted in their definition and verified upon reload.
- **SC-002**: 100% of existing nodes, edges, agent bindings, and tool records are preserved without modification during archetype conversion.
- **SC-003**: 100% of incomplete supervisor workflows (missing hub, missing condition routing, or un-wired guards) are blocked from execution with actionable, localized error messages.
- **SC-004**: 100% of cyclic graphs converted to Linear Pipeline trigger localized cycle validation errors (`LINEAR_PIPELINE_CYCLE_FORBIDDEN`) preventing save and execution until resolved.
- **SC-005**: 100% of legacy workflows lacking archetype declarations load, display, and execute without functional regressions or unexpected cycle errors.
- **SC-006**: 100% of imported packages with conflicting or invalid archetype declarations are rejected with explicit, actionable error messages.
- **SC-007**: Operators can complete new workflow creation with archetype selection in under 15 seconds, and configure supervisor hub/guards in under 2 minutes without raw JSON editing.
- **SC-008**: Zero state or validation error leakage between workflows when switching the active workflow in the Studio interface.
- **SC-009**: 100% of client-side archetype validation errors match server-side validation error codes and messages exactly.

---

## Assumptions & Clarifications

### Architectural & Product Decisions
1. **Default Archetype for New Workflows**: New workflows default to `Linear Pipeline` as it represents the simpler, acyclic mental model. Users must explicitly opt into `Hierarchical Supervisor`.
2. **Dormant vs Destructive Configuration on Conversion**: When converting a Hierarchical Supervisor to a Linear Pipeline, supervisor settings are retained as dormant in the definition payload. This guarantees that accidental conversions or exploratory switches do not discard meticulously configured recursion guards and hub bindings. The server compiler ignores dormant supervisor settings when the active archetype is `linear-pipeline`.
3. **Draft Saving vs Run Execution**: To support realistic authoring workflows, an incomplete supervisor draft (e.g., in the middle of being wired) can be saved in progress if the structural integrity of the graph is sound, but execution ("Run") is strictly blocked until all required supervisor configuration is complete.
4. **Legacy Compatibility Contract**: Untyped workflows (neither `archetype` nor `archetypeConfig`) resolve to `linear-pipeline` for UI badge display purposes, but cycle enforcement retains the existing permissive behavior (warning `CYCLE_REQUIRES_GUARDRAIL` and server-level step bound) to prevent breaking legacy production pipelines. Only explicit promotion to `linear-pipeline` activates strict `LINEAR_PIPELINE_CYCLE_FORBIDDEN` enforcement.
5. **Role-Based Access**: Role permissions are inherited from existing Studio organization authorization: `viewer` has read-only access to archetype controls; `member`, `admin`, and `owner` have full creation, editing, and execution privileges.
6. **Local Validation Parity**: Client-side validation in `apps/web/src/lib/workflow/validation.ts` mirrors the server-side checks in `apps/server/src/compiler/validation.ts` so operators receive real-time visual feedback without waiting for server round-trips.

---

## Notes for Clarify Phase (`/speckit-clarify`)
The following items represent potential refinements that may be evaluated during the clarify phase if further specialization is requested:
1. *Dormant Configuration Persistence Location*: Confirm whether dormant supervisor configuration on a Linear Pipeline should persist in `archetypeConfig.dormantSupervisorConfig` or remain in `archetypeConfig` with `category: "linear-pipeline"`.
2. *Supervisor Hub Auto-Suggestion*: When converting a graph with exactly one Agent node to Hierarchical Supervisor, evaluate whether the system should automatically pre-select that agent as the supervisor hub or require explicit manual user selection.
3. *Recursion Guard Route Detection*: Evaluate whether the UI should provide an auto-detection button that scans the canvas for feedback cycles and pre-populates recommended recursion guards with default bounds.
