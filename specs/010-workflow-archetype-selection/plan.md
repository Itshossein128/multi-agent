# Implementation Plan: Explicit Workflow Archetype Selection and Configuration

**Branch**: `010-workflow-archetype-selection` | **Date**: 2026-11-03 | **Spec**: [spec.md](./spec.md)  
**Status**: Ready for Task Breakdown  

---

## Summary

Deliver complete explicit workflow archetype authoring, configuration, and conversion capabilities in Agent Studio, empowering operators to create and manage both **Linear Pipeline** and **Hierarchical Supervisor** workflows through the visual user interface.

Building directly upon the foundational types, schemas, and runtime engine introduced in Feature 009 (`009-dual-mode-orchestration`), this feature delivers:
1. An explicit **Workflow Creation Modal** (`CreateWorkflowDialog`) offering Linear Pipeline (default) and Hierarchical Supervisor with concise behavioral descriptions.
2. An interactive **Overview Properties Panel** exposing the active archetype, switching controls, and dormant configuration management.
3. Dedicated **Hierarchical Supervisor Configuration Controls**:
   - Single-select supervisor hub agent picker (strictly filtered to active agent nodes).
   - Dynamic recursion guards manager (configuring `routeKey`, `maxIterations` [1–10], and `fallbackBranch` exit wiring).
   - Execution ceilings (`maxExecutionSteps` [1–5,000]) and mandatory `humanApprovalGateRequired` toggle.
4. **Reactive Graph-to-Config Validation**: Parity between client-side and server-side validation ensuring instant visual errors upon hub deletion, route severing, or cycle detection on linear pipelines.
5. **Safe Archetype Conversion**: Non-destructive transitions with dormant supervisor configuration retention, cycle detection, and complete integration with the history stack (Undo/Redo) and dirty navigation guards.
6. **Legacy Compatibility Preservation**: Seamless display and backward compatibility for untyped legacy workflows (such as `wf-mw08286f-97zear` at `/o/pga/org`), preventing execution regressions while supporting explicit promotion.

---

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+  
**Primary Dependencies**: Next.js 16 (App Router), React 19, `@xyflow/react` (React Flow), Zustand 5.x, `@tanstack/react-query`, Hono 4.x, Lucide React, Tailwind CSS  
**Storage**: PostgreSQL (`studio_memory`) with `StudioStore` and `RunStore` (in-memory test store fallback)  
**Testing**: Jest (`pnpm test --runInBand`), React Testing Library, Playwright  
**Target Platform**: Modern web browsers (Chrome, Firefox, Safari, Edge) + Node.js execution runtime  
**Project Type**: Monorepo full-stack web application (`packages/types`, `apps/server`, `apps/web`)  
**Performance Goals**:
- Archetype switching and UI reconfiguration in `<50ms` (pure client state transition).
- Client validation evaluation in `<10ms` for graphs up to 100 nodes.
- Zero extra network round-trips for archetype switching prior to explicit save.
- Preserved graph rendering at 60fps on canvas.  
**Constraints**:
- 100% graph and configuration preservation: zero silent node or edge deletions during archetype conversion.
- Strict tenant isolation: hub agent options and workflow mutations restricted to authenticated `tenantId`.
- Legacy compatibility: untyped workflows must not be broken by false-positive cycle errors.
- Schema compliance: persisted payloads must conform strictly to `workflow-archetype.schema.json`.
- Fail-closed execution gate: "Run" trigger strictly disabled whenever blocking errors exist.  
**Scale/Scope**: 1 shared types extension, 4 web UI components/forms, 1 client validation module, 1 store slice, 2 server verification updates, 4 automated test suites.

---

## Constitution Check

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | All workflow and agent queries strictly filter by `tenantId`. Supervisor hub selection restricts options to agents in the current organization. |
| **Non-Destructive Conversion** | PASS | Converting archetypes preserves 100% of nodes, edges, and configurations. Supervisor settings are stored dormant in Linear Pipeline mode without permanent truncation. |
| **Human Governance Gate** | PASS | `humanApprovalGateRequired` toggle enforces that approval nodes must intercept code mutation paths. Archetype conversion cannot authorize autonomous code changes. |
| **Recursion Guardrail Enforcement** | PASS | Recursion guards enforce loop bounds (1–10 iterations) and require valid exit branches, preventing runaway loops in supervisor graphs. |
| **Legacy Compatibility** | PASS | Workflows without archetype declarations resolve cleanly for display while preserving legacy execution and server-wide cycle limits without regressions. |
| **Validation Parity** | PASS | Client-side validation in `apps/web/src/lib/workflow/validation.ts` mirrors server compiler validation rules in `apps/server/src/compiler/validation.ts` exactly. |
| **Simplicity & Monorepo Idioms** | PASS | Leverages existing Zustand store, React Flow hooks, and UI design tokens without adding new external state libraries or heavy wizard dependencies. |

---

## Project Structure

### Documentation (this feature)

```text
specs/010-workflow-archetype-selection/
├── plan.md              # This implementation plan
├── research.md          # Phase 0: Technical decisions, dormant configs, legacy compatibility
├── data-model.md        # Phase 1: Entities, validation invariants, state lifecycles
├── quickstart.md        # Phase 1: Test suites and runnable end-to-end scenarios
├── contracts/           # Phase 1: UI contracts and OpenAPI CRUD specification
│   ├── ui-archetype-controls.contract.ts
│   └── workflow-crud.openapi.yaml
└── checklists/
    └── requirements.md  # Specification quality checklist
```

### Source Code Architecture

```text
packages/types/src/
├── archetype.ts                 # Extended: Archetype descriptors and validation helpers
└── index.ts                     # Barrel export

apps/web/src/
├── components/workflow/
│   ├── CreateWorkflowDialog.tsx # New: Modal for workflow creation with archetype choice & descriptions
│   ├── WorkflowSwitcher.tsx     # Updated: Open CreateWorkflowDialog on "New workflow", legacy label formatting
│   ├── EditorToolbar.tsx        # Updated: Strict execution gate ("Run" disabled on archetype errors)
│   └── properties/
│       ├── panels.tsx           # Updated: Overview panel hosting ArchetypeSection & SupervisorConfigSection
│       └── ArchetypeForms.tsx   # New: SupervisorHubPicker, RecursionGuardsManager, ExecutionBoundsForm
├── lib/workflow/
│   └── validation.ts            # Extended: Port validateArchetype to client (parity with server)
└── store/
    └── useWorkflowStore.ts      # Extended: Archetype actions, dormant config handling, undo/redo history

apps/server/src/
└── compiler/
    └── validation.ts            # Verified: Alignment with client validation codes and legacy cycle policy

tests/
├── workflowArchetypeAuthoring.test.ts # New: UI archetype selection, creation dialog, and store actions
├── clientWorkflowValidation.test.ts   # New: Client-side parity tests for all archetype issue codes
├── workflowSwitcher.test.ts           # Updated: Creation dialog triggers and archetype dropdown labeling
└── dualModeOrchestration.test.ts      # Regression: Compiler, runtime, and seed verification
```

---

## Complexity Tracking

*No constitutional violations identified. Implementation leverages existing Zustand patterns, monorepo types, and Tailwind components.*

---

## Phase 0: Outline & Research Summary

All architectural choices and technical questions have been resolved in [`research.md`](./research.md):
- **Decision 1**: Workflow creation uses a focused `CreateWorkflowDialog` modal dialog; editing occurs in the `Overview` panel in `PropertiesPanel.tsx`.
- **Decision 2**: Archetype conversion to `Linear Pipeline` retains supervisor settings in a dormant state within `archetypeConfig`, avoiding data loss and enabling full Undo/Redo restoration.
- **Decision 3**: Untyped legacy workflows (e.g. `wf-mw08286f-97zear`) display as Linear Pipeline but bypass `LINEAR_PIPELINE_CYCLE_FORBIDDEN` until an authorized user explicitly selects and saves an archetype.
- **Decision 4**: Client-side validation in `apps/web/src/lib/workflow/validation.ts` achieves 1:1 parity with server compiler checks for real-time error localization.
- **Decision 5**: Incomplete drafts are clearly flagged with actionable errors and execution is strictly blocked; save failures preserve dirty drafts in memory.
- **Decision 6**: Recursion guard UI dynamically inspects graph condition branches and suggests detected cyclic routes and valid exit branches.

---

## Phase 1: Design & Contracts Summary

All entities, UI interfaces, and validation contracts have been established:
- **Data Model**: Defined in [`data-model.md`](./data-model.md), detailing `WorkflowDefinition`, `WorkflowArchetypeConfig`, `WorkflowRecursionGuardConfig`, and validation issue codes.
- **Interface Contracts**:
  - [`contracts/ui-archetype-controls.contract.ts`](./contracts/ui-archetype-controls.contract.ts): Contracts for presentation components, store action signatures, and validation state descriptors.
  - [`contracts/workflow-crud.openapi.yaml`](./contracts/workflow-crud.openapi.yaml): OpenAPI 3.1 specification for `/workflows` CRUD operations supporting explicit archetype declarations.
- **Validation & Runnable Scenarios**: Documented in [`quickstart.md`](./quickstart.md), detailing 7 end-to-end user verification scenarios and automated test commands.
