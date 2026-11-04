# Quickstart results: 015-canvas-routing-usability

**Date**: 2026-11-05  
**Status**: Automated gates passed; manual Studio smoke (sections A–E) left for operator verification in a running `pnpm run dev` session.

## Automated

```bash
pnpm test --runInBand -- tests/canvasRoutingAddEdge.test.ts tests/autoArrangeLayout.test.ts tests/hierarchicalSupervisorScaffold.test.ts tests/workflowArchetypeQuickstart.test.ts tests/workflowCreationLifecycle.test.ts
```

**Result**: PASS (18 tests across those suites).

Also: `pnpm --filter @multi-agent/types build` and root/server `tsc --noEmit` clean; web `tsc --noEmit` clean after filling missing `WorkflowNodeType` icons in `graphMappers.tsx` (014 topology types).

## Manual (pending operator)

| Section | Focus | Status |
| :--- | :--- | :--- |
| A | Approval outcome handles without panel | Pending |
| B | Condition chip handles | Pending |
| C | Auto-Arrange + Undo | Pending |
| D | Hierarchical create scaffold | Pending |
| E | Legacy load compatibility | Pending |
