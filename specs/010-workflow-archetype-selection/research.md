# Research: Explicit Workflow Archetype Selection and Configuration

**Feature Branch**: `010-workflow-archetype-selection`  
**Date**: 2026-11-03  
**Status**: Completed  

---

## Executive Summary

Feature 009 established the backend foundations for dual-mode orchestration: `@multi-agent/types` definitions, `workflow-archetype.schema.json`, compiler validation, and LangGraph runtime execution with recursion limits and approval gates. However, the Studio user interface currently provides no mechanism to choose an archetype during creation, switch archetypes during editing, select a supervisor hub agent, or configure recursion guards and execution limits.

This research document resolves all architectural and product decisions required to implement first-class archetype authoring, configuration, and conversion in Agent Studio while preserving established contracts, backward compatibility for legacy workflows, and data integrity.

---

## Technical Decisions & Rationale

### Decision 1: Archetype Selection Surface in Agent Studio UI

#### Problem
In `WorkflowSwitcher.tsx`, clicking "New workflow" currently invokes `window.prompt("Workflow name", "Untitled Workflow")`. In `PropertiesPanel.tsx`, the `Overview` panel displays only node and edge count chips and general validation messages, with zero controls for viewing or altering archetype properties.

#### Alternatives Considered
1. **Multi-step Creation Wizard**: A modal wizard with canvas templates, agent pre-selection, and guard setup.
   - *Rejected*: Too heavy and rigid for the lightweight authoring model in Studio. Users frequently build workflows incrementally from an empty canvas or palette.
2. **Global Settings Modal**: A separate settings dialog opened from the editor header.
   - *Rejected*: Separates workflow properties from the visual graph context, requiring multiple dialog dismissals to cross-reference node IDs.
3. **Dedicated `CreateWorkflowDialog` + `Overview` Archetype Controls** (Selected):
   - Workflow creation: A focused modal dialog prompting for workflow name and archetype selection with concise behavioral summaries.
   - Workflow editing: The existing `Overview` panel in `PropertiesPanel.tsx` (which automatically displays whenever no specific node or edge is selected) hosts the active archetype card, archetype selector, supervisor hub picker, recursion guards manager, and execution guardrail settings.

#### Rationale
- The `Overview` panel is the natural locus for workflow-level metadata. It remains visible during graph construction, allowing operators to reference nodes and branches on canvas while configuring hub and guard settings.
- The `CreateWorkflowDialog` replaces the primitive `window.prompt` without introducing heavyweight wizard friction, immediately defaulting to `Linear Pipeline` while allowing an explicit toggle to `Hierarchical Supervisor`.

---

### Decision 2: Non-Destructive Archetype Conversion & Dormant Configuration

#### Problem
When an operator converts a workflow from `Hierarchical Supervisor` to `Linear Pipeline`, the definition contains supervisor-specific configurations (`supervisorHubNodeId`, `recursionGuards`, `humanApprovalGateRequired`). If these settings are permanently deleted on conversion, any accidental switch, exploratory toggle, or linear simplification destroys carefully configured recursion rules.

#### Alternatives Considered
1. **Destructive Truncation with Confirmation Prompt**: Prompt the user that supervisor settings will be erased permanently upon converting to Linear Pipeline.
   - *Rejected*: Violates the requirement that "Conversion must not silently delete nodes, edges, or configuration" and makes Undo/Redo recovery hazardous if persisted.
2. **Separate Dormant Config Container (`dormantSupervisorConfig`)**: Introduce a new field on `archetypeConfig` to store inactive supervisor properties.
   - *Rejected*: Violates the existing `workflow-archetype.schema.json` contract and requires schema version updates across the monorepo.
3. **Dormant Field Retention in `archetypeConfig` with Active Category Flag** (Selected):
   - When converting to `Linear Pipeline`, `definition.archetype` is set to `"linear-pipeline"` and `definition.archetypeConfig.category` is set to `"linear-pipeline"`.
   - Existing fields (`supervisorHubNodeId`, `recursionGuards`, `maxExecutionSteps`, `humanApprovalGateRequired`) are preserved within `archetypeConfig`.
   - The server compiler and client validator evaluate rules strictly based on the active archetype category (`linear-pipeline`), treating supervisor-specific fields as dormant/inactive.
   - The UI displays a clear notice: *"Supervisor settings are preserved in a dormant state while configured as Linear Pipeline."*
   - Switching back to `Hierarchical Supervisor` simply sets `category: "hierarchical-supervisor"`, reactivating the existing hub and guard configuration instantly.

#### Rationale
- Zero schema modifications required; fully valid against `workflow-archetype.schema.json`.
- 100% reversible via Undo (`Ctrl+Z`) or manual re-selection without data loss.
- Non-destructive to existing persisted workflows.

---

### Decision 3: Cycle Handling & Legacy Workflow Promotion

#### Problem
Legacy workflows created prior to dual-mode orchestration (such as `wf-mw08286f-97zear` at `/o/pga/org`) have neither `archetype` nor `archetypeConfig`. Some legacy workflows contain condition nodes or feedback edges. In Feature 009:
- `resolveWorkflowArchetype` defaults undefined to `"linear-pipeline"`.
- `apps/server/src/compiler/validation.ts` explicitly guards:
  ```ts
  if (archetype === "linear-pipeline" && (definition.archetype !== undefined || configuredCategory !== undefined)) {
    if (cycleNodes.size > 0) { ... add error LINEAR_PIPELINE_CYCLE_FORBIDDEN ... }
  }
  ```
If legacy workflows were retroactively subjected to `LINEAR_PIPELINE_CYCLE_FORBIDDEN`, existing production pipelines containing cycles would suddenly fail server validation and be blocked from saving or executing.

#### Resolution
- **Display Semantics**: The UI switcher and editor badge display `Linear Pipeline` (or `Linear Pipeline (Legacy)`) for untyped workflows.
- **Cycle Enforcement**: Untyped workflows continue to bypass `LINEAR_PIPELINE_CYCLE_FORBIDDEN`, retaining the legacy behavior of warning `CYCLE_REQUIRES_GUARDRAIL` bounded by server-level recursion limits.
- **Explicit Promotion**: When an authorized operator explicitly selects an archetype in the UI (either confirming `Linear Pipeline` or switching to `Hierarchical Supervisor`) and saves, the definition is stamped with explicit `archetype` and `archetypeConfig`.
- If an operator explicitly saves a cyclic workflow as `Linear Pipeline`, the strict `LINEAR_PIPELINE_CYCLE_FORBIDDEN` error is enforced, guiding them to either break cycles or configure it as a `Hierarchical Supervisor`.

---

### Decision 4: Client-Side Validation Parity with Server Compiler

#### Problem
`apps/web/src/lib/workflow/validation.ts` performs client-side validation for instant editor feedback, but currently only validates structural integrity (duplicate IDs, edge endpoints, retry parameters) and lacks any archetype validation. All archetype checks (`MISSING_SUPERVISOR_HUB`, `UNGUARDED_CYCLE`, `FALLBACK_NOT_WIRED`, `LINEAR_PIPELINE_CYCLE_FORBIDDEN`, etc.) currently occur only on the server in `apps/server/src/compiler/validation.ts`.

#### Resolution
Port `validateArchetype` into `apps/web/src/lib/workflow/validation.ts` using identical validation logic, issue codes, and error messages:
1. `INVALID_ARCHETYPE`: Detects invalid strings or mismatch between `archetype` and `archetypeConfig.category`.
2. `LINEAR_PIPELINE_CYCLE_FORBIDDEN`: Flags all nodes in cycles when `archetype === "linear-pipeline"` and explicitly declared.
3. `MISSING_SUPERVISOR_HUB`: Flags when `supervisorHubNodeId` is absent in supervisor mode.
4. `INVALID_SUPERVISOR_HUB`: Flags when the hub node does not exist in `nodes` or is not of type `agent`.
5. `MISSING_ROUTING_NODES`: Flags when a supervisor graph lacks condition nodes.
6. `UNGUARDED_CYCLE`: Flags when feedback cycles exist without a matching recursion guard.
7. `INVALID_RECURSION_GUARD`: Validates `routeKey`, `maxIterations` (1–10), and `fallbackBranch`.
8. `FALLBACK_NOT_WIRED`: Validates that `fallbackBranch` matches a condition branch and can reach a terminal exit node.
9. `MISSING_APPROVAL_GATE` & `APPROVAL_GATE_BYPASS`: Validates that approval nodes intercept code mutation routes when `humanApprovalGateRequired` is enabled.

#### Rationale
- Instant visual feedback: Error chips and banners highlight directly on the canvas and in the properties panel without waiting for a save request.
- Run gate parity: The "Run" button in `EditorToolbar.tsx` inspects `issues.some(i => i.severity === "error")`, so client parity immediately disables the Run button for incomplete supervisor drafts or cyclic linear pipelines.

---

### Decision 5: Draft Preservation & Execution Gating

#### Problem
A user configuring a complex Hierarchical Supervisor cannot complete all wiring in a single keystroke. If saving an incomplete draft were blocked entirely, users could not safely save work-in-progress or would lose changes on accidental browser closure. Conversely, running an incomplete supervisor causes runtime crashes.

#### Resolution
- **Execution Gate (Run)**: Strictly gated. The "Run" button is disabled whenever any error-level validation issue exists. Clicking "Validate" focuses the first blocking issue.
- **Draft Persistence (Save)**:
  - If a save request fails due to server policy rejection (such as strict server-side `SAVE_BLOCKING_ISSUE_CODES`), the client store retains the in-memory draft (`isDirty = true`), prevents state reset, and displays a prominent error banner explaining why the server rejected the save.
  - The client provides clear inline guidance showing which required fields must be satisfied to achieve saveable and runnable status.

---

### Decision 6: Supervisor Hub and Recursion Guard Configuration UI

#### Component Specs for `Overview` Panel:
1. **Supervisor Hub Selector**:
   - Single `<select>` dropdown populated dynamically from `definition.nodes.filter(n => n.type === "agent")`.
   - If `supervisorHubNodeId` is set to an ID no longer present or not an agent, render an error border with text: *"Selected hub node [id] is missing from canvas or not an agent"*.
   - If no agents exist on canvas, render a disabled dropdown with placeholder *"No agent nodes on canvas (add one from palette)"*.
2. **Recursion Guards Manager**:
   - Guard List displaying configured guards with `Route`, `Limit (Iterations)`, `Fallback Exit`, and a `Delete` button.
   - `Add Guard` button that inserts a new default guard (`maxIterations: 3`, `fallbackBranch: "loop_limit_exceeded"`).
   - `routeKey` input: Autocomplete/dropdown showing detected cyclical branches on canvas (or free-form route input).
   - `maxIterations` input: Number stepper clamped to `1`–`10`.
   - `fallbackBranch` selector: Dropdown listing branch keys declared on all condition nodes on canvas, highlighting whether they reach exit nodes.
3. **Execution Limits & Approval Gate**:
   - `maxExecutionSteps`: Number input bounded to `1`–`5,000` (default: 1,000).
   - `humanApprovalGateRequired`: Checkbox with helper text explaining that human approval is mandatory before any code mutation.

---

## Reused Contracts from Feature 009

| Contract | Location | Reuse Role |
| :--- | :--- | :--- |
| `WorkflowArchetypeCategory` | `@multi-agent/types/src/archetype.ts` | Type union `"linear-pipeline" \| "hierarchical-supervisor"` |
| `WorkflowArchetypeConfig` | `@multi-agent/types/src/archetype.ts` | Interface for archetype configuration |
| `WorkflowRecursionGuardConfig` | `@multi-agent/types/src/archetype.ts` | Interface for route recursion guard |
| `resolveWorkflowArchetype()` | `@multi-agent/types/src/archetype.ts` | Canonical resolution hierarchy |
| `workflow-archetype.schema.json` | `specs/009-dual-mode-orchestration/contracts/` | JSON Schema for workflow archetype validation |
| `SAVE_BLOCKING_ISSUE_CODES` | `apps/server/src/compiler/validation.ts` | Server validation blocking set |
| Runtime Guardrails Bounds | `@multi-agent/types/src/archetype.ts` | Iterations 1–10, Steps 1–5,000 |
