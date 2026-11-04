# Implementation Plan: Expanded Workflow Topology Support

**Branch**: `014-workflow-topology-expansion` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)  
**Status**: Ready for Task Breakdown  
**Note**: `setup-plan.ps1` could not run (`pwsh` missing); plan paths resolved from `.specify/feature.json` (`specs/014-workflow-topology-expansion`) on branch `develop`.

---

## Summary

Extend Studio beyond `linear-pipeline` and `hierarchical-supervisor` so designers can author, validate, run, and observe **evaluator-optimizer** quality loops, **scatter-gather** parallel specialists, **nested subgraph** composition, and bounded **autonomous-swarm** peer delegation—without breaking existing archetypes or deny-by-default safety.

Approach (from [research.md](./research.md)):

1. Widen `WorkflowArchetypeCategory` + `WorkflowArchetypeConfig` for `evaluator-optimizer` and `autonomous-swarm`; add factories, descriptors, and create-workflow scaffolds that pass initial validation.
2. Add canvas primitives `parallel_split`, `parallel_join`, and `subgraph` with join policy, I/O mappings, and nesting ceilings; keep linear as acyclic DAG that may include validated fan-out/fan-in.
3. Extend compiler validation (server + web parity) with topology-specific issue codes; reuse / specialize recursion-guard mechanics for EO loops; enforce `maxConcurrentBranches` (default 8) at design time for fan-out width.
4. Compile parallel split/join onto LangGraph multi-edge fan-out + barrier join (already partially implied by multi-predecessor `valueForNode`); enforce join policy at the join node; execute subgraphs as nested runs with mapped I/O and depth limits.
5. Emit Live events for iteration progress, parallel branch status, and subgraph enter/exit; project them in existing canvas Live chrome.

---

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+  
**Primary Dependencies**: `@langchain/langgraph` (`StateGraph`, multi-edge fan-out/join), existing Hono compiler/validation, Next.js Studio canvas (React Flow), Zustand workflow store, `@multi-agent/types`  
**Storage**: No new DB tables required for MVP; workflow JSON already persists `archetype` / `archetypeConfig` / nodes / edges. Subgraph references are workflow IDs already stored in the studio catalog.  
**Testing**: Jest (`pnpm test --runInBand`); primary suites for validation, compiler parallel/EO/subgraph/swarm, plus web validation parity; optional Live projection unit tests  
**Target Platform**: Execution server + Agent Studio editor (modern browsers)  
**Project Type**: Monorepo (`packages/types`, `apps/server` compiler/runtime, `apps/web` canvas/store, `tests/`)  
**Performance Goals**:
- Fan-out width ≤ active `maxConcurrentBranches` (default 8); over-budget rejected at validate.
- EO / swarm iteration/hop ceilings small finite bounds (align with recursion guard scale 1–10 unless product raises).
- Nested subgraph depth hard-capped (proposed default max depth 3; see research).  
**Constraints**:
- Deny-by-default: disallowed cycles, unbounded nests/peers, over-budget fan-out fail closed before run.
- Backward compatible: existing linear + hierarchical definitions remain valid/runnable.
- No credential-broker / RLS / sandbox rework; no free-form unbounded graphs.
- Minimum explicit subgraph I/O mapping only (no full typed port remapping feature).  
**Scale/Scope**: Two new archetypes, three node primitives, validation + compiler + scaffold UX + Live event projection; contracts extend 009/010 archetype schemas.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution file is still a template stub; gates follow established monorepo security/runtime norms used by prior features (009–013).

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | Subgraph resolve/run uses existing studio workflow access + tenant-scoped run executor; no cross-tenant reference bypass. |
| **Control-Plane Authority** | PASS | Topology validation and concurrency ceilings enforced server-side; client validation is advisory parity only. |
| **Human Governance** | PASS | Hierarchical approval-gate rules unchanged; EO/swarm do not auto-grant mutating privileges. |
| **Observability Without Authority Leak** | PASS | New Live events are progress telemetry; reuse redaction adapters; no secret payloads. |
| **Backward Compatibility** | PASS | Existing categories + configs preserved; new node types optional; legacy untyped workflows unchanged. |
| **Simplicity & Monorepo Idioms** | PASS | Extend `archetype.ts`, `validation.ts`, `workflowCompiler.ts`, CreateWorkflowDialog/scaffolds, Live projection—no new package. |
| **Performance / UX Safety** | PASS | Hard ceilings on loops, hops, nesting, and concurrent branches; fail closed. |

*Post-Phase 1 re-check*: PASS — data-model and contracts keep authority on the server, fail-closed join/nest defaults, and do not introduce client-side execution grants.

---

## Project Structure

### Documentation (this feature)

```text
specs/014-workflow-topology-expansion/
├── plan.md                 # This file
├── research.md             # Phase 0 decisions
├── data-model.md           # Phase 1 entities + invariants
├── quickstart.md           # Phase 1 validation guide
├── contracts/
│   ├── workflow-topology.schema.json
│   ├── topology-validation.codes.md
│   └── ui-topology-controls.contract.ts
├── checklists/
│   └── requirements.md
└── tasks.md                # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
packages/types/src/
├── archetype.ts                 # New categories, EO/swarm config fields, descriptors, factories
└── index.ts                     # WorkflowNodeType + RunEventType extensions; node config shapes

apps/server/src/compiler/
├── validation.ts                # EO / parallel / subgraph / swarm rules + issue codes
└── workflowCompiler.ts          # Parallel join policy, EO ceiling, nested subgraph invoke, swarm hop limits

apps/server/src/api/studio/
└── workflowService.ts           # stampWorkflowArchetype + scaffold graphs for new archetypes

apps/server/src/runtime/
└── runExecutor.ts               # Persist/forward new topology Live events

apps/web/src/lib/workflow/
└── validation.ts                # Client parity with server topology codes

apps/web/src/components/workflow/
├── CreateWorkflowDialog.tsx     # New archetype options
├── NodePalette.tsx              # parallel_split / parallel_join / subgraph
├── nodes/WorkflowNodes.tsx      # Visual nodes for new primitives
└── properties/                  # EO/swarm overview; join policy; subgraph mapping forms

apps/web/src/store/
└── useWorkflowStore.ts          # addNode types; archetype set for new categories

apps/web/src/lib/
└── runCanvasProjection.ts       # Iteration / parallel / subgraph Live projection

tests/
├── topologyValidation.test.ts           # NEW (or extend existing validation suites)
├── workflowCompilerTopology.test.ts     # NEW: EO loop, parallel join, subgraph, swarm bounds
└── (optional) runCanvasProjectionTopology.test.ts
```

**Structure Decision**: Keep changes in the existing types → compiler/validation → studio API → web editor → Live projection path established by features 009–011. No new top-level package.

---

## Complexity Tracking

*No constitutional violations.* Parallel and nesting add surface area, but simpler alternatives (documenting undocumented multi-edge fan-out only; compile-time subgraph inlining without Live identity) were rejected because they fail designer-readable scaffolding, join-policy clarity, and nested observability requirements in the spec.

---

## Phase outputs

| Phase | Artifact | Status |
| :--- | :--- | :--- |
| 0 | [research.md](./research.md) | Complete |
| 1 | [data-model.md](./data-model.md) | Complete |
| 1 | [contracts/](./contracts/) | Complete |
| 1 | [quickstart.md](./quickstart.md) | Complete |
| 2 | tasks.md | Next: `/speckit-tasks` |
