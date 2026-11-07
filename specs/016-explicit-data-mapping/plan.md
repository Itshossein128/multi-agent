# Implementation Plan: Explicit Step Data Mapping

**Branch**: `016-explicit-data-mapping` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)  
**Status**: Ready for Task Breakdown  
**Note**: `setup-plan.ps1 -Json` could not run (`pwsh` / `powershell` are not installed). Paths resolved from `.specify/feature.json` (`specs/016-explicit-data-mapping`). Git HEAD is `develop`.

---

## Summary

Let a designer point a later step at a specific workflow input field or an earlier step’s result, and inspect the value that step actually received. Workflows that never opt in keep today’s `valueForNode` / `state.lastValue` behavior.

Approach (from [research.md](./research.md)):

1. Add a pure reference grammar and resolver in `@multi-agent/types` (`input` and `nodes.<id>.output` paths only). Tokens are stored against stable node ids. The picker shows canvas labels.
2. Interpolate those tokens in authored text (`agent.taskInstruction`, `approval.message`) in one non-recursive pass. An optional `dataMapping.inputBinding` replaces the implicit primary input when the designer selects a whole value.
3. Persist data wires separately from control-flow `edges`, rendered as distinct canvas connections. v1 ports are `prompt`, `context`, `input`, `value`, `text`, and `json` on the node types that already produce or consume a main result. Approval outcome handles stay the only approval source handles.
4. Validate on the server and mirror the same issue codes in the web editor. Missing, non-upstream, dangling, conflicting, and oversized references fail closed with the reference text in the message.
5. Put a bounded preview of the resolved input on `node.started` so the existing Live inspector can show it.

---

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+  
**Primary Dependencies**: Existing workflow compiler and web validation, React Flow (`@xyflow/react`) handles, Zustand `useWorkflowStore`, `@multi-agent/types` workflow JSON  
**Storage**: No new tables. Additive optional fields on the workflow document (`node.dataMapping`, `definition.dataWires`). Schema version stays 2. `serializeWorkflowDefinition` / `deserializeWorkflowDefinition` must round-trip the new fields; today they drop unknown top-level and node fields.  
**Testing**: Jest (`pnpm test --runInBand`); pure resolver tests, compiler tests for implicit compatibility and fail-closed references, server/web validation parity  
**Target Platform**: Execution server + Agent Studio editor (modern browsers)  
**Project Type**: Monorepo (`packages/types`, `apps/server` compiler/validation, `apps/web` canvas/properties/inspector, `tests/`)  
**Performance Goals**:
- Resolver work is bounded by template size and a 256 KiB resolved-value cap (the existing default contract payload bound).
- Picker ancestor walk stays within the existing workflow node cap (default 100).
- Live preview of a resolved input is capped for the event stream (8 000 characters) without changing the value the step executes with.  
**Constraints**:
- No scripting, no network, no credential or cross-tenant reads. Legal roots are only `input` and `nodes`.
- Control-flow edges, approval outcome handles, and subgraph input/output mappings stay as they are.
- Graphs with no references and no data wires keep current incoming-value behavior.
- Server validation is authoritative. The client repeats the same codes before Run.  
**Scale/Scope**: One shared grammar, two authored string fields, one optional primary-input binding, a fixed v1 port catalog, Live input preview. Not a new expression product beyond that grammar.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution file is still a template stub. Gates follow the monorepo security and runtime norms used by features 009–015.

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | References read only the current run’s `input` and `nodeResults`. No credential store, env, or other tenant is in the grammar. |
| **Control-Plane Authority** | PASS | Resolution and the size cap run in the compiler. Client picker and validation are advisory parity. Data wires are not control-flow edges. |
| **Human Governance** | PASS | Approval outcome handles and routing are unchanged. Data ports are not a second approval path. |
| **Observability Without Authority Leak** | PASS | `node.started` carries a bounded preview of data the step already received. No secrets are added to the picker. |
| **Backward Compatibility** | PASS | New fields are optional and omitted when unused. `valueForNode` remains the default. Schema version stays 2. |
| **Simplicity & Monorepo Idioms** | PASS | Pure helpers in `packages/types`; compiler calls them; web imports the same grammar. No new package or service. |
| **Performance / UX Safety** | PASS | Hard size cap, no recursive expansion, fail closed on missing or illegal refs. |

*Post-Phase 1 re-check*: PASS. The data model keeps data wires out of `WorkflowEdge`, binds tokens to node ids, and leaves subgraph mappings and approval handles outside this feature. No gate failed.

---

## Project Structure

### Documentation (this feature)

```text
specs/016-explicit-data-mapping/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── data-mapping.contract.ts
│   └── data-mapping.codes.md
├── checklists/
│   └── requirements.md
└── tasks.md                 # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
packages/types/src/
├── dataMapping.ts             # Grammar, parse, upstream check, port catalog, issue codes
└── index.ts                   # WorkflowNode.dataMapping, WorkflowDefinition.dataWires, serialize/deserialize

apps/server/src/compiler/
├── workflowCompiler.ts        # Resolve binding + interpolate before enforceNodeInput; emit resolved input
└── validation.ts              # Authoritative data-mapping issue codes

apps/web/src/lib/workflow/
├── validation.ts              # Same codes and messages as the server
└── dataMappingPicker.ts       # Upstream catalog, display labels, insert text

apps/web/src/components/workflow/
├── nodes/WorkflowNodes.tsx    # Data handles, distinct from approval/condition handles
├── FlowCanvas.tsx             # Project data wires; do not treat them as control edges
├── properties/NodeForms.tsx   # Picker on task instruction and approval message; input binding
└── live/NodeExecutionInspector.tsx  # Already renders view.input once payload.input is present

apps/web/src/store/
└── useWorkflowStore.ts        # Data-wire connect path; delete wires with their endpoints

tests/
├── dataMapping.test.ts
├── dataMappingValidation.test.ts
└── workflowCompilerDataMapping.test.ts
```

**Structure Decision**: Extend the existing types → compiler → web validation → canvas path. Data wires live beside control edges so the compiler’s edge walk does not gain a second meaning.

---

## Complexity Tracking

*No constitutional violations.* A separate `dataWires` collection is required because putting data connections in `WorkflowEdge` would make them control-flow predecessors in `valueForNode` and topology checks. That simpler shape was rejected because it would change when steps run and could retarget approval routes.

---

## Phase outputs

| Phase | Artifact | Status |
| :--- | :--- | :--- |
| 0 | [research.md](./research.md) | Complete |
| 1 | [data-model.md](./data-model.md) | Complete |
| 1 | [contracts/](./contracts/) | Complete |
| 1 | [quickstart.md](./quickstart.md) | Complete |
| 2 | tasks.md | Next: `/speckit-tasks` |
