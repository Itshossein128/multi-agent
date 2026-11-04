# Implementation Plan: Canvas Routing Usability

**Branch**: `015-canvas-routing-usability` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)  
**Status**: Ready for Task Breakdown  
**Note**: `setup-plan.ps1` could not run (`pwsh` missing); plan paths resolved from `.specify/feature.json` (`specs/015-canvas-routing-usability`) on branch `develop`. Feature branch name is documentary; create/switch when implementing if desired.

---

## Summary

Reduce Studio canvas friction for approval/condition branching, graph layout, and Hierarchical Supervisor create-time validity.

Approach (from [research.md](./research.md)):

1. **Approval outcome handles** — Replace the single `out` source on Approval nodes with labeled/color-coded handles `approved` / `rejected` / `needs_clarification`. Extend `addEdge` (and React Flow `sourceHandle` mapping) so connections from those handles create `kind: "conditional"` edges with the matching `branchKey`—same pattern Condition already uses.
2. **Legacy compatibility** — Keep loading graphs that used the old `out` handle; map existing conditional edges onto outcome handles by `branchKey` when rendering; never silently drop bindings.
3. **Condition handle clarity** — Stop overlapping percentage `left` positioning; align handles with labeled branch chips (or equivalent non-overlapping layout) so hit targets stay distinct.
4. **Auto-Arrange** — Toolbar action that applies a hierarchical layout to current node positions only, pushed through existing history so Undo restores prior layout; no semantic mutation.
5. **Hierarchical Supervisor scaffold** — Mirror feature 014’s EO/swarm scaffolds: on create, stamp a minimal Input → Hub → Condition → Worker(s) → Approval → Output graph with `supervisorHubNodeId` set so initial structural validation does not emit empty-canvas hub/routing/approval errors.

---

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+  
**Primary Dependencies**: Next.js Studio (`@xyflow/react` 12.x), Zustand `useWorkflowStore`, `@multi-agent/types` edge/node factories, existing server `topologyScaffolds` / `stampWorkflowArchetype`, optional layout helper (see research—prefer small pure layout util or `@dagrejs/dagre` if justified)  
**Storage**: No new tables; workflow JSON already persists nodes/edges/`archetypeConfig`  
**Testing**: Jest (`pnpm test --runInBand`); store/addEdge unit tests, scaffold validation tests, optional web component tests; Playwright only if already used for editor smoke  
**Target Platform**: Agent Studio editor (modern browsers) + studio create API  
**Project Type**: Monorepo (`apps/web` canvas/store, `apps/server` studio create/scaffold, `packages/types` shared edge semantics, `tests/`)  
**Performance Goals**:
- Auto-Arrange completes comfortably under ~1s for typical 8–15 node graphs on a designer workstation
- Handle hit targets remain usable at default zoom without requiring pixel-perfect aiming  
**Constraints**:
- Canvas gestures MUST produce compiler-valid conditional semantics (`kind` + `branchKey`)
- Accessibility: outcome/branch identity not color-only (labels or equivalent text)
- Auto-Arrange: layout-only; Undo-recoverable
- Backward compatible: legacy single-`out` approval wiring remains loadable/runnable
- No approval runtime/policy/credential changes; no new archetypes or node primitives  
**Scale/Scope**: Four UX capabilities (approval handles, condition handle layout, auto-arrange, hierarchical scaffold); primarily web editor + create-path scaffold; thin server change for hierarchical stamp parity with EO/swarm

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution file is still a template stub; gates follow established monorepo security/runtime norms used by prior features (009–014).

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | No new cross-tenant data paths; create/scaffold remains org-scoped studio API. |
| **Control-Plane Authority** | PASS | Edge kind/branchKey still validated server-side at compile; client only improves authoring affordances. |
| **Human Governance** | PASS | Approval *runtime* decisions unchanged; only design-time handle UX and scaffolding. |
| **Observability Without Authority Leak** | PASS | No new secret-bearing surfaces; Live branch cues reuse existing edge labels. |
| **Backward Compatibility** | PASS | Legacy edges/load paths preserved; additive handles + optional remapping by branchKey. |
| **Simplicity & Monorepo Idioms** | PASS | Extend existing NodeShell/Approval/Condition, store `addEdge`, EditorToolbar, `topologyScaffolds` / `stampWorkflowArchetype`—no new package required. |
| **Performance / UX Safety** | PASS | Layout is client-side, undoable; scaffolds fail closed to structural validity for required hub pattern. |

*Post-Phase 1 re-check*: PASS — data-model and contracts keep authority on validated edge semantics, define additive compatibility, and do not grant client-side execution bypasses.

---

## Project Structure

### Documentation (this feature)

```text
specs/015-canvas-routing-usability/
├── plan.md                 # This file
├── research.md             # Phase 0 decisions
├── data-model.md           # Phase 1 entities + invariants
├── quickstart.md           # Phase 1 validation guide
├── contracts/
│   ├── canvas-routing-handles.contract.ts
│   ├── auto-arrange.contract.ts
│   └── archetype-scaffold.contract.ts
├── checklists/
│   └── requirements.md
└── tasks.md                # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
apps/web/src/components/workflow/
├── nodes/WorkflowNodes.tsx          # Approval outcome handles; Condition non-overlapping handles + labels
├── FlowCanvas.tsx                   # sourceHandle mapping for approval (and keep condition)
├── EditorToolbar.tsx                # Auto-Arrange action
├── edges/WorkflowEdge.tsx           # Ensure branch cues remain visible (minor if needed)
└── (optional) layout/autoArrange.ts # Pure layout helper used by toolbar/store

apps/web/src/store/
└── useWorkflowStore.ts              # addEdge: approval sourceHandle → conditional+branchKey;
                                     # autoArrangeNodes (or applyPositions) with history push

apps/server/src/api/studio/
├── topologyScaffolds.ts             # scaffoldHierarchicalSupervisor (mirror EO/swarm)
└── workflowService.ts               # stampWorkflowArchetype: hierarchical uses scaffold

packages/types/src/                  # Only if shared constants for approval outcome keys needed;
                                     # prefer reusing existing approval decision vocabulary

tests/
├── canvasRoutingAddEdge.test.ts     # NEW (or extend store tests): approval/condition handle → edge
├── hierarchicalSupervisorScaffold.test.ts  # NEW: create scaffold passes structural codes
└── (optional) autoArrangeLayout.test.ts
```

**Structure Decision**: Stay on the established Studio path (web canvas/store + studio create scaffolds). No new top-level package. Layout helper stays under `apps/web` unless a shared pure function is needed for tests only.

---

## Complexity Tracking

*No constitutional violations.* Introducing a layout dependency (if chosen) adds a small surface; a hand-rolled hierarchical packer was considered and remains acceptable if it meets SC-003 without a new package—see research.

---

## Phase outputs

| Phase | Artifact | Status |
| :--- | :--- | :--- |
| 0 | [research.md](./research.md) | Complete |
| 1 | [data-model.md](./data-model.md) | Complete |
| 1 | [contracts/](./contracts/) | Complete |
| 1 | [quickstart.md](./quickstart.md) | Complete |
| 2 | [tasks.md](./tasks.md) | Complete (`/speckit-tasks`) |
