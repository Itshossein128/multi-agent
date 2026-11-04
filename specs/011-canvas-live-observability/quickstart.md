# Quickstart Validation: In-Canvas Live Execution & Observability

**Feature**: `011-canvas-live-observability`  
**Date**: 2026-11-04  

Use this guide to prove Design|Live dual-mode end-to-end after implementation. Prefer projection unit tests first, then a manual studio smoke.

---

## Prerequisites

- Repo root: `e:\hossein\ai_agent\multi-agent`
- Dependencies installed (`pnpm install`)
- Auth session for an org with a runnable workflow (agents/tools provisioned as today)
- Dev stack: `pnpm dev:all` (or `dev:web` + `dev:server`)
- Web: typically `http://localhost:3060`

Contracts reference:

- [ui-live-canvas.contract.ts](./contracts/ui-live-canvas.contract.ts)
- [run-control.openapi.yaml](./contracts/run-control.openapi.yaml)
- [data-model.md](./data-model.md)

---

## Automated checks

### Projection / timeline helpers

```bash
pnpm test --runInBand -- tests/runCanvasProjection.test.ts tests/runTimeline.test.ts
```

Expected:

- Status enum mapping covers idle → running → completed / failed / waiting_human / skipped
- `edge.traversed` accumulates edge ids
- High-frequency llm/token fixtures do not require full-graph identity churn in pure helpers
- Existing `runTimeline` merge/dedup still green

### Typecheck / web build (regression)

```bash
pnpm --filter @multi-agent/types build
npx tsc --noEmit
pnpm --filter web build
```

---

## Manual studio smoke (P1)

### A. Run stays on canvas

1. Open `/o/{orgSlug}/org?workflowId={id}` for a valid workflow.
2. Enter a simple run input; click **Run**.
3. **Expect**: URL remains on `/org` with `runId` set; canvas visible; Live chrome (tray / mode control) present; **no** navigation to `/runs/{runId}` as the primary path.
4. Click **Exit Live / Back to Editor**.
5. **Expect**: Design mode restored (palette, drag, properties); `runId` removed from query.

### B. Live path + node status

1. Run a multi-node workflow with a condition/branch if available.
2. **Expect**: Active node shows running treatment; completed nodes success treatment; traversed edges animate/emphasize; skipped branch dimmed when applicable.
3. Force a failing step (bad tool / deliberate fail fixture) if available → failed ring/alert.

### C. Node inspector

1. In Live mode, click an agent node mid-run or after completion.
2. **Expect**: Slide-over opens; canvas still mounted; input/timing/stream or final result visible; tool calls listed when present; failures show error details.

### D. Deep link

1. Copy `/o/{orgSlug}/org?workflowId={id}&runId={runId}` for a finished or live run.
2. Open in a new tab (same auth).
3. **Expect**: Workflow loads; Live attaches; statuses/inspector match standalone run evidence.

### E. Standalone bookmark (compat)

1. Open `/o/{orgSlug}/runs/{runId}` directly.
2. **Expect**: Page still works; optional “Open on canvas” reaches studio Live with same run.

---

## Manual HITL + tray (P2)

### F. Approval on canvas

1. Run a workflow that hits an approval gate.
2. **Expect**: Banner + highlighted approval node; Approve/Reject/Clarification with notes via existing modal/panel.
3. Submit Approve → run resumes; no full page reload; statuses update.

### G. Tray controls

1. Confirm status badge, elapsed timer, step X / max.
2. Cancel a running run → status `cancelled`.
3. On a failed run, Retry → new `runId` attached on canvas.
4. Filter event feed to Error / Tool / Node and confirm subset.

---

## Performance spot-check (SC-005)

During a chatty agent run with continuous streaming:

1. Pan and zoom the canvas.
2. Select different nodes.
3. **Expect**: No multi-second freezes; stream text updates primarily inside the inspector.

---

## Exit criteria

| Check | Pass? |
| :--- | :---: |
| Run does not redirect away from studio canvas | |
| Live statuses + traversed edges visible | |
| Inspector shows I/O without unmounting canvas | |
| `runId` deep link works | |
| `/runs/[runId]` still usable | |
| Approval + Cancel/Retry via existing APIs | |
| Projection unit tests green | |
