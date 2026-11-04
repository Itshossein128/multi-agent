# Quickstart: Canvas Routing Usability

**Feature**: `015-canvas-routing-usability`  
**Purpose**: Validate the feature end-to-end after implementation—without embedding full test suites here.

See also: [data-model.md](./data-model.md), [contracts/canvas-routing-handles.contract.ts](./contracts/canvas-routing-handles.contract.ts), [contracts/auto-arrange.contract.ts](./contracts/auto-arrange.contract.ts), [contracts/archetype-scaffold.contract.ts](./contracts/archetype-scaffold.contract.ts).

---

## Prerequisites

- Repo dependencies installed (`pnpm install`)
- Types buildable (`pnpm --filter @multi-agent/types build`)
- For manual Studio checks: `pnpm run dev` (web + server), an org with permission to create workflows

---

## 1. Automated gates (primary)

```bash
# Handle → edge semantics + layout (names may match tasks.md once generated)
pnpm test --runInBand --testPathPattern='canvasRouting|autoArrange|hierarchicalSupervisorScaffold'

# Regressions: archetype create, validation, existing condition edge binding
pnpm test --runInBand --testPathPattern='createWorkflow|workflowArchetype|clientWorkflowValidation|topologyValidation'
```

**Expect**

- Connecting from Approval handles `approved` / `rejected` / `needs_clarification` creates conditional edges with matching `branchKey` without panel edits
- Condition multi-branch connect still auto-binds; handles do not share a single overlapping hit target in unit/layout assertions used by tests
- `scaffoldHierarchicalSupervisor` (or createWorkflow hierarchical) validates without `MISSING_SUPERVISOR_HUB`, `MISSING_ROUTING_NODES`, or `MISSING_APPROVAL_GATE` on the starter
- Auto-Arrange changes positions only; Undo restores prior positions; edge kinds/branchKeys unchanged
- Legacy fixtures with pre-set approval/condition `branchKey`s still load with bindings intact
- EO/swarm scaffolds from 014 remain green

---

## 2. Typecheck / build

```bash
pnpm exec tsc --noEmit
pnpm --filter @multi-agent/types build
pnpm --filter server build
pnpm --filter web build
```

**Expect**: clean compile; no breaking changes to persisted workflow JSON schema required for MVP.

---

## 3. Manual Studio smoke

### A. Approval outcome handles (SC-001)

1. Open any editable workflow in **Design** mode.
2. Add an **Approval** node and two downstream nodes (e.g. agents or outputs).
3. Drag from the **Approved** handle to path A; from **Rejected** to path B; from **Needs clarification** to a third target (or back to a remediation node).
4. **Do not** open the edge properties panel.
5. Select each edge afterward only to verify: kind is conditional and branch keys match the handles.
6. Confirm handle labels (or equivalent text) are visible—not color alone.

### B. Condition handles

1. Add/configure a Condition node with ≥3 branches.
2. Connect each branch handle to a distinct target.
3. Confirm you can hit each intended handle without overlap blocking the target; branch identity visible on-canvas (chip and/or edge label).

### C. Auto-Arrange (SC-003)

1. Scatter 8–15 nodes into a messy layout (keep connections).
2. Note one conditional edge’s `branchKey`.
3. Click **Auto-Arrange** on the toolbar.
4. Confirm a readable top→bottom hierarchy; same nodes/edges/configs/branchKeys.
5. **Undo** → prior positions restore.
6. Switch to Live (if a run available): Auto-Arrange control is unavailable/disabled.

### D. Hierarchical Supervisor create (SC-002)

1. **New workflow** → select **Hierarchical Supervisor** → Create.
2. First canvas is non-empty and shows the teachable hub/router/approval pattern.
3. Validation does **not** immediately report missing hub / missing routing / missing approval solely due to an empty graph.
4. Delete or rewire a scaffolded node → edits work normally (no locked template).

### E. Backward compatibility (SC-005)

1. Open a saved workflow that predates outcome handles (approval edges with branch keys set via panel, or fixtures in tests).
2. Confirm edges load, branch keys remain, and validation/runtime branch structure is intact.
3. Optionally draw a **new** edge from a new outcome handle; legacy edges remain until you edit them.

---

## 4. Success criteria mapping

| Criterion | How to verify |
| :--- | :--- |
| SC-001 (~30s approval wiring without panel) | Manual A |
| SC-002 (no immediate invalid empty hierarchical canvas) | Manual D + scaffold unit test |
| SC-003 (Auto-Arrange readable, semantics intact) | Manual C + layout unit test |
| SC-004 (condition handles usable) | Manual B |
| SC-005 (no silent binding loss) | Manual E + fixture load tests |
| SC-006 (scaffold teaches pattern) | Manual D qualitative |
| SC-007 (not color-only handles) | Manual A accessibility spot-check |

---

## 5. Out of scope during validation

- New archetypes / parallel-split authoring beyond existing 014 behavior
- Approval runtime policy or credential changes
- Deep properties-panel redesign
