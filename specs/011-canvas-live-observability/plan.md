# Implementation Plan: In-Canvas Live Execution & Observability

**Branch**: `011-canvas-live-observability` | **Date**: 2026-11-04 | **Spec**: [spec.md](./spec.md)  
**Status**: Ready for Task Breakdown  

---

## Summary

Transform Agent Studio’s workflow editor into a unified **Design | Live Observability** surface. Clicking **Run** starts an authenticated run, attaches the existing SSE event stream, and keeps the operator on the React Flow canvas with live node/edge chrome, a slide-over Node Execution Inspector, in-canvas human approval, and a collapsible run control tray—instead of redirecting to the non-visual `/runs/[runId]` `RuntimeGraph`.

Approach (from [research.md](./research.md)):

1. Studio URL deep link `/o/{slug}/org?workflowId=&runId=` implies Live mode; Exit Live returns to Design.
2. Pure client projection over `useRunStore.events` for canvas status (decoupled from token streams).
3. Reuse `runService`, `ApprovalPanel` / `ApprovalGateModal`, and timeline patterns; freeze design mutations while Live.
4. Keep standalone run page functional; add optional “Open on canvas”.

---

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+  
**Primary Dependencies**: Next.js 16 (App Router), React 19, `@xyflow/react`, Zustand 5.x, Tailwind CSS, existing `EventSource` SSE client  
**Storage**: No new tables; PostgreSQL / existing `RunStore` via current APIs  
**Testing**: Jest (`pnpm test --runInBand`) for projection helpers; React Testing Library for overlays; Playwright optional smoke  
**Target Platform**: Modern browsers + existing execution server  
**Project Type**: Monorepo web app (`apps/web` primary; `packages/types` types already sufficient)  
**Performance Goals**:
- Canvas remains interactive under streaming (pan/zoom/select; stalls &lt;1s in representative runs — SC-005).
- Status projection updates on lifecycle/status events only; token text scoped to inspector.  
**Constraints**:
- Browser is control plane only (FR-012); all mutations via authenticated BFF.
- Design edits disabled in Live (FR-014).
- Standalone `/runs/[runId]` bookmarks remain valid (FR-005 / SC-006).
- No execution-engine semantic changes.  
**Scale/Scope**: ~1 projection module, 1 live session controller, 3–5 UI overlays/extensions (toolbar, canvas, nodes/edges, inspector, tray, approval host), run page link-back, 1–2 Jest suites.

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | Reuses org-scoped `runService` / BFF; deep links still require authenticated tenant access to workflow + run. |
| **Control-Plane Authority** | PASS | No client-authored run outcomes; Cancel/Retry/Approval call existing server APIs ([run-control.openapi.yaml](./contracts/run-control.openapi.yaml)). |
| **Human Governance** | PASS | Approvals stay on existing resolve + gap-report modal path; Live only relocates UX. |
| **Observability Without Authority Leak** | PASS | Canvas statuses are display projections from signed/served events. |
| **Backward Compatibility** | PASS | Standalone run page retained; editor Run path prefers studio Live. |
| **Simplicity & Monorepo Idioms** | PASS | Extends `WorkflowEditor` / `FlowCanvas` / `useRunStore`; no new state framework or execution service. |
| **Performance / UX Safety** | PASS | Research mandates status/token update split and Live mutation freeze. |

---

## Project Structure

### Documentation (this feature)

```text
specs/011-canvas-live-observability/
├── plan.md                 # This file
├── research.md             # Phase 0 decisions
├── data-model.md           # Phase 1 client entities + invariants
├── quickstart.md           # Phase 1 validation guide
├── contracts/
│   ├── ui-live-canvas.contract.ts
│   └── run-control.openapi.yaml
├── checklists/
│   └── requirements.md
└── tasks.md                # Phase 2 (/speckit-tasks) — not created here
```

### Source Code (repository root)

```text
apps/web/src/
├── app/(authenticated)/o/[orgSlug]/
│   ├── org/page.tsx                    # Unchanged host; query gains runId handling via WorkflowEditor
│   └── runs/[runId]/page.tsx           # Keep usable; add “Open on canvas” link
├── components/workflow/
│   ├── WorkflowEditor.tsx              # Dual mode shell: overlays, URL sync, freeze Design
│   ├── EditorToolbar.tsx               # Run → enterLive; Exit Live control
│   ├── FlowCanvas.tsx                  # Merge live projection into RF nodes/edges; gate interactions
│   ├── nodes/WorkflowNodes.tsx         # Status rings/badges on NodeShell
│   ├── edges/WorkflowEdge.tsx          # Traversed animation / theme glow
│   ├── live/
│   │   ├── NodeExecutionInspector.tsx  # New slide-over (FR-008/009)
│   │   ├── LiveRunTray.tsx             # New bottom tray (FR-011)
│   │   ├── LiveApprovalBanner.tsx      # Thin host around ApprovalPanel (FR-010)
│   │   └── useLiveCanvasSession.ts     # Mode/attach/URL orchestration
│   └── ...
├── components/runs/
│   ├── ApprovalPanel.tsx               # Reuse
│   ├── ExecutionTimeline.tsx           # Patterns reuse for tray filters
│   └── ReadableContent.tsx             # Reuse in inspector
├── lib/
│   ├── runTimeline.ts                  # Existing merge/dedup
│   └── runCanvasProjection.ts          # New pure projection helpers
├── store/
│   └── useRunStore.ts                  # Reuse load/attach/clear
└── services/
    ├── runService.ts                   # Reuse start/cancel/retry/approvals/definition
    └── runEventStream.ts               # Reuse SSE

tests/
├── runCanvasProjection.test.ts         # New: status/edge/inspector fixtures
└── runTimeline.test.ts                 # Regression
```

**Structure Decision**: Feature is almost entirely `apps/web` UX + pure projection helpers. Server/OpenAPI contracts document **reuse** of the existing run control plane; no new persistence schema.

---

## Complexity Tracking

*No constitutional violations. Complexity is bounded by extracting projection from the run page and composing existing approval/timeline pieces into the editor shell.*

---

## Phase 0: Outline & Research Summary

All unknowns resolved in [`research.md`](./research.md):

1. Stay on `/org` with `runId` query (not a new live route).
2. Client event projection with status/token split for FPS.
3. Stable `CanvasNodeLiveStatus` enum mapping from `RunEventType`.
4. Freeze Design mutations in Live; prefer `getRunDefinition` snapshot.
5. Reuse approval stack; wire clarification via existing run APIs.
6. Compact `LiveRunTray` + Cancel/Retry retarget.
7. Keep `/runs/[runId]`; add canvas deep link.
8. Debounce/coalesce status commits under bursty tool events.

---

## Phase 1: Design & Contracts Summary

| Artifact | Purpose |
| :--- | :--- |
| [data-model.md](./data-model.md) | EditorMode, CanvasNodeLiveStatus, NodeExecutionView, tray/session invariants |
| [contracts/ui-live-canvas.contract.ts](./contracts/ui-live-canvas.contract.ts) | UI/controller/projection TypeScript contracts |
| [contracts/run-control.openapi.yaml](./contracts/run-control.openapi.yaml) | Documented reuse of start/stream/cancel/retry/approvals |
| [quickstart.md](./quickstart.md) | Automated + manual validation scenarios |

### Constitution Check (post-design)

All gates remain **PASS**. Design introduces no new authority paths, no schema break, and preserves standalone run bookmarks.

---

## Next

Run `/speckit-tasks` to produce dependency-ordered `tasks.md` for implementation.
