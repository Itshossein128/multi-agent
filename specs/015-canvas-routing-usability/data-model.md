# Data Model: Canvas Routing Usability

**Feature Branch**: `015-canvas-routing-usability`  
**Date**: 2026-11-05  
**Status**: Complete  

Related: [spec.md](./spec.md), [research.md](./research.md), [contracts/](./contracts/)

---

## 1. Overview

This feature **does not** introduce new persisted entity types. It constrains how existing `WorkflowDefinition` nodes/edges are authored and projected, and how create-time stamps populate an initial graph for `hierarchical-supervisor`.

Persisted shapes remain those in `@multi-agent/types` (`WorkflowNode`, `WorkflowEdge`, `WorkflowArchetypeConfig`, approval/condition configs).

---

## 2. Approval Outcome Handle (authoring projection)

| Attribute | Type | Rules |
| :--- | :--- | :--- |
| `handleId` | `"approved" \| "rejected" \| "needs_clarification"` | Fixed vocabulary; MUST match runtime/decision branch keys |
| `label` | string | Visible text or accessible name (not color-only) |
| `visualCue` | distinct style | Color and/or shape plus text |

**Invariants**
- Exactly these three outcome source handles exist on Approval nodes in Design mode (MVP).
- Connecting from `handleId` MUST yield edge `{ kind: "conditional", branchKey: handleId }`.
- Approval nodes MUST NOT rely on a single happy-path `out` source for new branching (legacy edges may still reference older projections).

---

## 3. Condition Branch Handle (authoring projection)

| Attribute | Type | Rules |
| :--- | :--- | :--- |
| `handleId` | string | Equals `branch.key` from `ConditionNodeConfig.branches` |
| `label` | string | `branch.label` or `branch.key` shown with the handle |
| `layout` | non-overlapping | Handles MUST NOT share the same hit target; chip-aligned preferred |

**Invariants**
- One source handle per configured branch; zero branches → no phantom overlapping handles.
- Connecting from `handleId` MUST yield `{ kind: "conditional", branchKey: handleId }` (existing behavior retained).
- Renaming a branch key is a designer edit: existing edges keep old `branchKey` until updated (no silent remap)—surface validation if mismatched.

---

## 4. WorkflowEdge (semantics unchanged; authoring rules extended)

Existing fields: `id`, `source`, `target`, `kind` (`"normal" \| "conditional"`), `branchKey`, `label?`, `metadata?`.

### Authoring rules (create via canvas)

| Source node type | `sourceHandle` | Resulting edge |
| :--- | :--- | :--- |
| `approval` | `approved` / `rejected` / `needs_clarification` | `kind=conditional`, `branchKey=sourceHandle` |
| `condition` | `branch.key` | `kind=conditional`, `branchKey=sourceHandle` |
| other / missing handle | n/a or `out` | `kind=normal`, `branchKey=""` (unless later panel-edited) |

### Compatibility rules (load / project)

| Stored edge | Projection behavior |
| :--- | :--- |
| Approval source + `branchKey` in outcome set | Dock React Flow edge to matching outcome handle |
| Approval source + conditional + unknown/empty key | Load as-is; do not clear `branchKey`; validation may flag |
| Pre-feature edges from generic `out` with valid outcome `branchKey` | Load + dock to outcome handle by key; persist unchanged until edit |
| Any edge | Never silently drop `branchKey` on open |

**Invariants**
- Compiler/validator continue to treat conditional routing by `kind` + `branchKey` (no schema version bump required for MVP).
- Duplicate (source, target, kind, branchKey) edges remain rejected at add time.

---

## 5. Layout Snapshot (ephemeral)

| Attribute | Type | Notes |
| :--- | :--- | :--- |
| `positions` | `Map<nodeId, { x, y }>` | Only fields Auto-Arrange mutates |
| `history entry` | store history frame | Single undo step restores prior positions |

**Invariants**
- Auto-Arrange MUST NOT mutate nodes’ `type`/`config`, edge set, or edge fields.
- Live mode MUST NOT apply Auto-Arrange.

---

## 6. Hierarchical Supervisor Starter Scaffold

Created when `stampWorkflowArchetype(..., "hierarchical-supervisor")` runs (create path).

### Required structural contents

| Element | Requirement |
| :--- | :--- |
| `input` node | Present |
| Supervisor hub `agent` node | Present; `archetypeConfig.supervisorHubNodeId` points to it |
| `condition` routing node | ≥1 with ≥1 declared branch keys |
| Worker `agent` node(s) | ≥1 recommended for teachability |
| `approval` node | Required while `humanApprovalGateRequired` defaults true |
| `output` node | Present |
| Edges | Wire the teachable path; prefer **acyclic** starter to avoid `UNGUARDED_CYCLE` |
| `archetype` / `archetypeConfig.category` | `"hierarchical-supervisor"` |

### Validation expectations on first open

MUST NOT emit solely-from-empty-canvas:

- `MISSING_SUPERVISOR_HUB`
- `MISSING_ROUTING_NODES`
- `MISSING_APPROVAL_GATE` (when gate required and scaffold includes approval)

MAY still emit incomplete-draft issues (unlinked agents, unbound tools, etc.)—those are acceptable and distinct from empty-graph hub absence.

### Mutability

Scaffold nodes/edges are normal definition members: freely editable/deletable after create.

---

## 7. State Transitions (authoring)

```text
[Idle canvas]
    │ connect from approval outcome handle
    ▼
[Conditional edge created] --branchKey fixed--> [Optional panel edit]
    │
    │ Auto-Arrange
    ▼
[Positions updated + history pushed] --Undo--> [Prior positions]

[Create hierarchical-supervisor]
    ▼
[Scaffolded valid starter graph] --designer edits--> [Custom graph]
```

---

## 8. Validation Rules Summary

| Rule | Enforced by |
| :--- | :--- |
| Conditional edges from outcome/branch handles have correct kind+key | Web `addEdge` + existing server validation |
| Hierarchical create scaffold sets hub + routing (+ approval when required) | Server `scaffoldHierarchicalSupervisor` + validation tests |
| Auto-Arrange layout-only | Store API contract / tests |
| No silent branchKey loss on load | Projection/load tests |

No new validation **issue codes** are required for MVP unless scaffold tests reveal a useful specific code; prefer fixing scaffolds to satisfy existing codes.
