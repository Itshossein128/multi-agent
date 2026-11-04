# Research: Canvas Routing Usability

**Feature Branch**: `015-canvas-routing-usability`  
**Date**: 2026-11-05  
**Status**: Completed  

---

## Executive Summary

Approval nodes today use `NodeShell`’s single source handle `id="out"`. Condition edges already auto-bind via `sourceHandle` → `branchKey` in `useWorkflowStore.addEdge`, and `FlowCanvas` maps `sourceHandle` only for condition sources. Condition handles use `left: ((index+1)/(n+1))*100%`, which collides as branch count grows. Feature 014 already scaffolds EO and swarm on create; **hierarchical-supervisor** only stamps empty `archetypeConfig` (no hub node), so first open hits `MISSING_SUPERVISOR_HUB` / `MISSING_ROUTING_NODES` / `MISSING_APPROVAL_GATE` when approval is required. There is no Auto-Arrange; Undo/history already covers position batches via `pushHistory` / `moveNodes`.

All Technical Context unknowns are resolved below.

---

## Technical Decisions & Rationale

### Decision 1: Approval outcome handles + generalize addEdge handle binding

#### Problem
Designers must panel-edit edge kind/branchKey to branch on human decisions. Runtime already uses `approved` | `rejected` | `needs_clarification`.

#### Alternatives Considered
1. **Keep single handle; improve panel UX only** — Fails discoverability and SC-001 “without properties panel.”
2. **Two handles only (approved/rejected)** — Spec requires needs_clarification as first-class.
3. **Three outcome source handles; auto-conditional edges** (Selected).

#### Decision
- `ApprovalNodeComponent` renders its own shell (or `showSource={false}` + custom sources) with handles:
  - `id="approved"` (label + distinct color, e.g. success/green)
  - `id="rejected"` (label + distinct color, e.g. danger/red)
  - `id="needs_clarification"` (label + distinct color, e.g. amber)
- Text cues required (aria-label / visible chip text)—not color-only.
- Extend `addEdge`:
  - If source is `approval` and `sourceHandle` is one of the three outcomes → `kind: "conditional"`, `branchKey: sourceHandle`.
  - If source is `condition` → keep current behavior.
  - Else → `kind: "normal"`, empty `branchKey` (unchanged).
- `FlowCanvas` `rfEdges` `sourceHandle`: for approval sources, use `edge.branchKey` when it matches an outcome key; for legacy edges still on generic `out` without a mapped key, omit or use `out` per Decision 2.

#### Rationale
Reuses the proven Condition pattern; produces compiler-expected conditional semantics without new edge schema.

---

### Decision 2: Additive legacy compatibility (no forced migration)

#### Problem
Saved graphs may have edges from `out` with manually set `kind`/`branchKey`, or normal edges awaiting panel edits.

#### Alternatives Considered
1. **Hard migrate on load** (rewrite sourceHandle / drop `out`) — Risk of breaking odd graphs; silent remap danger.
2. **Dual handles forever (`out` + outcomes)** — Confusing; perpetuates the bad gesture.
3. **Additive outcomes + render-map by branchKey; keep load semantics** (Selected).

#### Decision
- On load: do **not** rewrite persisted edge documents unless the designer edits them.
- When projecting to React Flow:
  - If `edge.branchKey` ∈ {`approved`,`rejected`,`needs_clarification`}, attach `sourceHandle` to that id so the edge docks to the new handle.
  - If edge is conditional with some other/empty key from an approval source, keep loading; surface existing validation; do not invent a key.
  - New connections from outcome handles always set correct kind+key.
- Optional later: gentle non-blocking hint that new handles exist—out of MVP unless trivial.
- Fail closed: never clear `branchKey` during open/projection.

#### Rationale
Meets FR-016/017 and SC-005 without a breaking migration wave.

---

### Decision 3: Condition handles aligned to labeled chips (fix percentage stacking)

#### Problem
Percentage `left` stacking causes overlap and ambiguous hit targets; branch chips already exist above the handle row but are not the hit target.

#### Alternatives Considered
1. **Widen node + keep percentage formula with min-gap clamp** — Helps but still fragile for many branches.
2. **Side handles (Right) stacked vertically** — Readable, but changes edge aesthetic vs bottom-flow convention.
3. **Per-branch chip row with one Handle nested in each labeled chip** (Selected).

#### Decision
- Render each branch as a labeled chip containing (or tightly paired with) its `Handle` (`id={branch.key}`).
- Use flex wrap / min-width so chips do not stack on the same pixel; allow node width to grow with branch count (reasonable cap via wrap to second row if needed).
- Keep `addEdge` condition behavior unchanged.
- Edge chip labels already show `branchKey` on conditional edges—retain that readability in Design and Live.

#### Rationale
Makes handle identity = visible label; eliminates pure geometric percentage collision as the primary failure mode.

---

### Decision 4: Auto-Arrange = hierarchical layout + existing Undo

#### Problem
Messy canvases stay messy; Fit View only zooms.

#### Alternatives Considered
1. **Manual-only** — Fails FR-009 / SC-003.
2. **Always auto-layout on every edit** — Surprising; fights designer placement.
3. **On-demand toolbar Auto-Arrange; history-backed** (Selected).

#### Decision
- Add **Auto-Arrange** to `EditorToolbar` (Design mode only; disabled in Live).
- Algorithm: layered hierarchical layout (top→bottom to match current Handle Top/Bottom convention). Implementation choice at task time:
  - **Preferred if dependency acceptable**: `@dagrejs/dagre` (common with React Flow docs), `rankdir: TB`.
  - **Acceptable zero-dep**: simple rank assignment by BFS/longest-path from `input` nodes + column packing.
- Apply via store API that: `pushHistory()` once, then `moveNodes` for all positions (or batch equivalent)—so **Undo restores prior layout**.
- Must not create/delete/rewrite edges or configs.
- After arrange, optional `fitView` for convenience (does not need undo).

#### Rationale
Matches spec “prefer outcomes over prescribing libraries”; Undo satisfies FR-011 without a second recovery UX.

---

### Decision 5: Hierarchical Supervisor create scaffold (parity with EO/swarm)

#### Problem
`stampWorkflowArchetype` for hierarchical only sets config defaults—no nodes—so first canvas is structurally invalid.

#### Alternatives Considered
1. **Client-only scaffold after create** — Drift risk vs server validation; EO/swarm already server-side.
2. **Weaken validation until hub exists** — Hides the teaching pattern; risks shipping empty invalid drafts as “OK.”
3. **Server `scaffoldHierarchicalSupervisor` like EO/swarm** (Selected).

#### Decision
Minimal valid starter (IDs via `createNode` / `createEdge`):

Conceptually: **Input → Supervisor Hub (agent) → Condition Router → Worker Agent → Approval Gate → Output**, with optional feedback branch from condition toward hub/worker as a teachable spoke—**only if** recursion guards are configured when a cycle is introduced. Prefer an **acyclic first scaffold** that still sets:

- `archetype: "hierarchical-supervisor"`
- `archetypeConfig.supervisorHubNodeId` = hub agent id
- At least one `condition` node with branches (e.g. `route_worker`, `done` or similar)
- At least one `approval` node when `humanApprovalGateRequired: true` (default true)
- Wired normal/conditional edges so the pattern is readable
- No unguarded cycles on day-one scaffold (avoids `UNGUARDED_CYCLE` while teaching structure)

**Other archetypes**: EO/swarm already scaffolded (014). Linear empty graph is not the primary `MISSING_SUPERVISOR_HUB` trap—do **not** invent a large linear scaffold unless validation proves an empty-canvas structural error; hierarchical is mandatory for this feature.

#### Rationale
Teaches the pattern, clears create-time structural errors, stays editable, mirrors 014 scaffolding idiom.

---

### Decision 6: Properties panel remains optional power-user surface

#### Problem
Power users may still need to inspect/edit edge kind/branchKey.

#### Decision
Keep `panels.tsx` edge editors. Happy path never requires them for approval/condition handle wiring. No deep panel redesign.

#### Rationale
Matches out-of-scope boundary and FR-004.

---

## Resolved Clarifications

| Topic | Resolution |
| :--- | :--- |
| Layout library | Optional; hierarchical TB layout with Undo; dagre allowed, zero-dep packer allowed |
| Legacy migration | Additive; map by branchKey at render; no forced rewrite |
| Other archetype scaffolds | Hierarchical required; EO/swarm already done; linear only if proven empty-canvas structural trap |
| Approval vocabulary | Reuse `approved` / `rejected` / `needs_clarification` |
| Live mode | Design-time focus; keep branch label readability; no Auto-Arrange in Live |

---

## Implementation Risk Notes

- **Handle id collision**: Condition already uses branch keys as handle ids; Approval must use the fixed outcome set—do not reuse `out` for new happy-path edges.
- **Duplicate edges**: Existing `addEdge` duplicate check includes `branchKey`—preserve so two approved edges to same target are blocked.
- **Scaffold agent unlink**: Hub/worker agents may be unlinked (`agentId` empty)—structural hub/type checks pass; “Run” may still disable until agents are bound—that is acceptable incomplete-draft behavior, not empty-canvas hub absence.
- **Tests**: Prefer unit tests on `addEdge` + scaffold validation over brittle pixel tests; optional Playwright smoke for handle wiring if CI already covers editor.
