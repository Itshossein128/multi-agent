# Feature Specification: Canvas Routing Usability

**Feature Branch**: `015-canvas-routing-usability`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Reduce canvas usability friction in the Studio visual workflow builder so designers can route human-approval and conditional branches by direct, obvious interactions—and can start from a readable, valid graph without fighting edge configuration or manual layout."

---

## Architectural Context & Feature Boundary

### Current Gap
Studio’s visual workflow builder still treats approval and multi-branch routing as **properties-panel chores** rather than **canvas gestures**:

1. **Approval nodes** expose a single generic output. To branch on a human decision (approved / rejected / needs clarification), a designer must draw a normal edge, select it, open the right-side properties panel, change the edge kind to conditional, then pick a branch key. That path is hard to discover and easy to misconfigure.
2. **Condition (and similar multi-branch) nodes** place handles with calculated positions that often overlap or collide, making intended targets hard to hit and edges hard to read.
3. There is **no one-click layout** action, so messy graphs stay messy after iterative editing.
4. Creating a **Hierarchical Supervisor** workflow lands on an empty canvas that immediately fails structural validation (for example missing supervisor hub) instead of a minimal valid starter that teaches the required pattern.

### Scope of This Feature
Improve design-time authoring UX so branching and first-run creation feel first-class on the canvas:

1. **Explicit outcome handles on Approval nodes** — distinct, labeled/color-coded outputs for human decision outcomes; connecting from a handle automatically produces a correctly typed conditional edge for that branch key.
2. **Condition-node handle / edge routing clarity** — non-overlapping, readable multi-branch handles with branch identity visible on the canvas.
3. **One-click Auto-Arrange** — toolbar action that repositions the current graph into a readable hierarchical layout without changing workflow semantics.
4. **Interactive archetype scaffolding on create** — Hierarchical Supervisor (and other existing create-time archetypes with known empty-canvas structural traps) start from a minimal valid scaffold that passes initial structural validation and can be edited freely afterward.

### Out of Scope
- New multi-agent archetypes, parallel split/join primitives, or nested subgraph execution (topology expansion).
- New node primitive types (code/transform, RAG, prompt-only, etc.).
- Sidebar / route rename (“Org” → “Workflows”) and templates information architecture.
- Deep redesign of the entire properties panel system beyond what approval/condition edge routing requires.
- Changing approval runtime semantics, policy, or credential/security behavior—only canvas authoring UX and create-time scaffolding.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Branch Approval Outcomes From Labeled Handles (Priority: P1)

A workflow designer adds an Approval node and needs to route work based on the human decision. Distinct output handles for **approved**, **rejected**, and **needs_clarification** appear on the node with clear visual and text cues. Dragging from the approved handle to a downstream path, and from the rejected handle to another path, creates conditional edges already bound to those branch keys—without opening the edge properties panel. The same gesture works for needs_clarification.

**Why this priority**: Approval branching is the highest-friction authoring path called out in the product audit; fixing it delivers immediate, discoverable value and unblocks correct conditional semantics without panel gymnastics.

**Independent Test**: Add an Approval node and two downstream targets; connect from each outcome handle; verify each resulting edge is conditional with the matching branch key and that the properties panel was never required for the wiring.

**Acceptance Scenarios**:

1. **Given** an Approval node is on the canvas, **When** the designer views it, **Then** three distinct output handles are visible for approved, rejected, and needs_clarification, each with a non-color-only cue (label or equivalent text).
2. **Given** the designer starts a connection from the approved handle to a valid target node, **When** the connection completes, **Then** the created edge is a conditional edge bound to branch key `approved` without any properties-panel edit.
3. **Given** the designer starts a connection from the rejected handle to a different valid target, **When** the connection completes, **Then** the created edge is a conditional edge bound to branch key `rejected`.
4. **Given** the designer starts a connection from the needs_clarification handle, **When** the connection completes, **Then** the created edge is a conditional edge bound to branch key `needs_clarification`.
5. **Given** a conditional edge was created from an outcome handle, **When** the designer optionally opens the edge properties panel, **Then** kind and branch key reflect the handle-derived values and remain editable for power users—but were not required for the happy path.
6. **Given** a designer wants to wire approved and rejected paths, **When** they use only canvas handle gestures, **Then** they can complete correct wiring in under about 30 seconds without using the edge properties panel.

---

### User Story 2 - Connect Condition Branches Without Handle Collision (Priority: P1)

A designer opens a Condition node (or similarly structured multi-branch node) with multiple branches. Each branch exposes a distinct, non-overlapping handle. Branch identity remains visible on the canvas via handle labels and/or edge cues so the designer can attach the intended path without guessing positions or relying solely on the side panel.

**Why this priority**: Multi-branch routing is the other primary canvas friction; overlapping handles block correct graphs even when designers understand the intended semantics.

**Independent Test**: Configure a condition node with at least three branches; verify each handle is separately targetable without geometric overlap blocking the intended connection, and that branch identity is visible on-canvas after wiring.

**Acceptance Scenarios**:

1. **Given** a Condition node with multiple configured branches, **When** the designer views the node, **Then** each branch has a distinct output handle that does not overlap another branch handle in a way that blocks the intended connection target.
2. **Given** the designer connects from a specific branch handle to a target node, **When** the connection completes, **Then** the edge is bound to that branch’s identity (correct conditional semantics) without requiring manual branch-key editing for the happy path.
3. **Given** branches are wired, **When** the designer inspects the canvas (without opening the side panel), **Then** branch identity remains visible through handle labels and/or edge cues.
4. **Given** a designer previously struggled with colliding percentage-positioned handles, **When** they reconnect or redraw branches on the improved handles, **Then** they can complete each intended connection without ambiguous hit-targets.

---

### User Story 3 - Land on a Valid Hierarchical Supervisor Starter (Priority: P1)

A new Studio user creates a Hierarchical Supervisor workflow. Instead of an empty invalid canvas, Studio pre-scaffolds a minimal valid starter graph that teaches the required pattern—conceptually Input → Supervisor Hub → Condition Router → Worker Agent(s) → Approval Gate → Output. The first canvas state passes structural validation for the archetype (no immediate missing-hub / empty-graph structural errors). The designer can edit, delete, or rearrange scaffolded elements freely afterward.

**Why this priority**: First-run failure on create trains users that Hierarchical Supervisor is “broken”; a valid scaffold is required for onboarding and for reducing create-time support friction.

**Independent Test**: Create a new Hierarchical Supervisor workflow from the create dialog; on first open, confirm the canvas is non-empty, contains the required hub structure, and structural validation does not report immediate empty-graph / missing-hub failures; then delete a scaffolded node and confirm the designer can edit freely.

**Acceptance Scenarios**:

1. **Given** an authorized user creates a new Hierarchical Supervisor workflow, **When** the editor opens, **Then** the canvas shows a scaffolded starter graph rather than an empty graph.
2. **Given** the scaffolded Hierarchical Supervisor graph is loaded, **When** structural validation runs on that initial state, **Then** it does not report immediate missing-supervisor-hub or empty-graph structural errors for the required hub pattern.
3. **Given** the scaffold is present, **When** the designer inspects the graph, **Then** the conceptual pattern Input → Supervisor Hub → Condition Router → Worker Agent(s) → Approval Gate → Output is recognizable (names/labels may vary; structure teaches the pattern).
4. **Given** the scaffolded workflow is open, **When** the designer edits, removes, or rewires scaffolded nodes, **Then** those edits behave like normal design-time edits (no locked scaffold mode).
5. **Given** another existing create-time archetype already shows a known empty-canvas structural validation trap, **When** that archetype is created, **Then** the same “valid starter scaffold” principle is applied—without inventing new topology archetypes.

---

### User Story 4 - One-Click Auto-Arrange Without Changing Meaning (Priority: P2)

A designer with a messy 8–15 node graph clicks **Auto-Arrange** (or equivalent) in the editor toolbar. Nodes reposition into a readable hierarchical arrangement. Connections, node configs, edge kinds, and branch bindings stay the same. If the designer dislikes the result, they can undo (or use an equivalent recovery path already available for canvas mutations).

**Why this priority**: Layout cleanup is high leverage after iterative editing but secondary to correct branching semantics and valid create scaffolds.

**Independent Test**: Build or open a cluttered graph; note edge kinds and branch keys; run Auto-Arrange; verify positions change into a readable hierarchy while semantics are unchanged; undo and confirm prior layout restores.

**Acceptance Scenarios**:

1. **Given** a workflow is open in Design mode with multiple nodes, **When** the designer clicks Auto-Arrange in the editor toolbar, **Then** nodes reposition into a readable hierarchical arrangement in one action.
2. **Given** Auto-Arrange has run, **When** the designer inspects nodes and edges, **Then** node identities, configs, edge connections, edge kinds, and branch bindings are unchanged—only layout/positions differ.
3. **Given** Auto-Arrange has run, **When** the designer uses Undo (or the documented equivalent recovery path for canvas mutations), **Then** the previous layout is restored.
4. **Given** a typical 8–15 node graph, **When** Auto-Arrange completes, **Then** the designer can visually follow primary flow direction without manually dragging every node.

---

### User Story 5 - Open Existing Workflows Without Breaking Branch Bindings (Priority: P1)

An operator or designer opens a previously saved workflow that used the older single-handle approval wiring or earlier condition-handle layout. The graph loads, branch bindings are preserved, and the workflow remains runnable. Designers are not forced into a breaking migration; they may optionally rewire using the new handles over time.

**Why this priority**: Backward compatibility is a non-negotiable; silent loss of branch bindings would break production graphs.

**Independent Test**: Load a saved workflow that has approval/condition conditional edges created before outcome handles; verify edges retain kind and branch keys, the graph opens without error, and a run (or validation equivalent) still recognizes the branch structure.

**Acceptance Scenarios**:

1. **Given** a saved workflow with older single-output approval wiring and conditional edges that already have branch keys, **When** the workflow is opened, **Then** it loads without error and those branch bindings remain intact.
2. **Given** such a legacy graph is open, **When** the designer does not remigrate edges, **Then** validation/runtime semantics for existing conditional branches continue to work (no forced rewrite).
3. **Given** a legacy approval node is present, **When** the designer later draws new connections from the new outcome handles, **Then** those new edges receive correct conditional bindings while existing edges remain unless the designer edits them.
4. **Given** any load or compatibility path runs, **When** branch keys cannot be mapped safely, **Then** the system does not silently drop bindings; the designer sees a clear indication that review is needed rather than a quiet data loss.

---

### User Story 6 - Operators Read Branch Structure On Canvas (Priority: P3)

An operator reviewing a workflow in Design or Live mode can see which approval/condition branches exist from canvas cues (handle labels and/or edge cues) without opening the edge properties panel to learn branch identity. They do not need to configure edges via hidden panels to understand structure.

**Why this priority**: Readability supports both authoring and live observation, but depends on the P1 handle/edge cues being in place.

**Independent Test**: Open a workflow with approval and condition branches; without selecting edges into the properties panel, confirm branch outcomes are identifiable from on-canvas labels/cues in Design mode and remain readable in Live mode.

**Acceptance Scenarios**:

1. **Given** an Approval node with outcome edges, **When** viewing the canvas in Design mode, **Then** approved / rejected / needs_clarification paths are distinguishable without opening the edge properties panel.
2. **Given** the same graph in Live mode, **When** the operator views branch structure, **Then** branch identity cues remain readable (this feature does not remove Live readability of branches).

---

### Edge Cases

- Designer draws from an outcome handle to an invalid target (self-loop, incompatible node, duplicate exclusive branch): connection is rejected or prevented with clear feedback; no half-applied wrong edge kind is left behind.
- Designer connects two edges from the same outcome handle to different targets: behavior follows existing multi-edge rules for that node type; if only one edge per outcome is allowed, the second connection is blocked with a clear message.
- Designer still creates a generic edge into/out of an Approval node without using an outcome handle (if legacy or alternate gestures remain): the system does not invent a branch key; power users may still set kind/branch via the properties panel, matching prior capability.
- Condition node has zero or one branch configured: handles reflect the actual branch set; empty branch sets do not show phantom overlapping handles.
- Condition branches are renamed or reordered after edges exist: existing edge bindings remain correct or the designer is clearly prompted to fix broken bindings—no silent remapping to the wrong branch.
- Auto-Arrange on an empty canvas or single-node graph: no-op or trivial layout; no error storm.
- Auto-Arrange on graphs with cycles (Hierarchical Supervisor feedback): layout remains readable enough to follow primary hierarchy; semantics still unchanged.
- Create scaffold when organization limits or missing agent/tool prerequisites prevent placing a preferred worker agent: scaffold still produces a structurally valid hub pattern with placeholders or the minimum required nodes so initial structural validation for the hub pattern passes; missing optional bindings surface as normal incomplete-draft guidance, not as empty-canvas hub errors.
- Opening a corrupted or partially migrated definition: fail closed with a visible load/validation error rather than dropping branch keys.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Approval nodes MUST expose distinct output handles for human decision outcomes at minimum: `approved`, `rejected`, and `needs_clarification`.
- **FR-002**: Outcome handles MUST be visually distinct using color and/or shape **and** MUST include labels or equivalent text cues so identity is not color-only (basic accessibility).
- **FR-003**: Completing a connection from an Approval outcome handle MUST create a conditional edge automatically bound to that handle’s branch key; the designer MUST NOT be required to open the edge properties panel to set kind or branch key for this happy path.
- **FR-004**: The edge properties panel MAY continue to display and allow editing of edge kind and branch key for power users, but MUST NOT be required for basic approval branching.
- **FR-005**: Canvas gestures that create conditional edges MUST produce the same validated edge semantics the compiler already expects (correct kind + branch key).
- **FR-006**: Condition nodes (and similarly structured multi-branch decision nodes already in product) MUST present non-overlapping, readable output handles so designers can connect each branch without handle collision blocking the intended target.
- **FR-007**: Branch identity for approval and condition routing MUST remain visible on the canvas via handle labels and/or edge cues, not only in the side panel.
- **FR-008**: Completing a connection from a condition branch handle MUST bind the edge to that branch’s identity for the happy path without mandatory manual branch-key editing in the properties panel.
- **FR-009**: The editor toolbar MUST provide an Auto-Arrange (or equivalent) action that repositions the current graph into a readable hierarchical arrangement.
- **FR-010**: Auto-Arrange MUST NOT change workflow meaning: node set, edge connections, configs, edge kinds, and branch bindings MUST remain the same; only layout/positions change.
- **FR-011**: After Auto-Arrange, designers MUST be able to recover the previous layout via Undo or an equivalent recovery path already used for canvas mutations (document if existing Undo already covers this).
- **FR-012**: Creating a Hierarchical Supervisor workflow MUST pre-scaffold a minimal valid starter graph that teaches the required pattern (conceptually Input → Supervisor Hub → Condition Router → Worker Agent(s) → Approval Gate → Output).
- **FR-013**: The Hierarchical Supervisor create-time scaffold MUST pass initial structural validation for required hub structure (no immediate missing-supervisor-hub / empty-graph structural failures on first open).
- **FR-014**: Scaffolded graphs MUST be fully editable afterward; Studio MUST NOT lock designers into an uneditable template mode.
- **FR-015**: Where other **existing** create-time archetypes already have known empty-canvas structural validation traps, Studio MUST apply the same valid-starter-scaffold principle—without adding new topology archetypes as part of this feature.
- **FR-016**: Existing saved workflows with older approval/condition edge wiring MUST remain loadable; branch bindings MUST NOT be silently dropped.
- **FR-017**: Compatibility behavior for older single-handle approval graphs MUST be defined and user-visible in effect: legacy conditional edges with known branch keys continue to work; new outcome-handle wiring is available going forward without a forced breaking migration.
- **FR-018**: Invalid or unsafe connections from outcome/branch handles MUST fail closed with clear designer feedback (no silent wrong-kind edges).
- **FR-019**: Design-time authoring changes in this feature MUST NOT alter approval runtime decision semantics, policy, or credential/security behavior.

### Key Entities

- **Approval Outcome Handle**: A first-class canvas output on an Approval node representing a human decision outcome (`approved`, `rejected`, `needs_clarification`); connecting from it implies a conditional edge for that branch key.
- **Condition Branch Handle**: A first-class canvas output on a multi-branch Condition (or similar) node representing one configured branch; connecting from it implies the correct conditional binding for that branch.
- **Conditional Edge Binding**: The pairing of edge kind (conditional) and branch key that the compiler/validator already expects; produced automatically by handle gestures in the happy path.
- **Archetype Starter Scaffold**: A minimal, editable starter graph created with a workflow so the first canvas state is structurally valid for the selected archetype and teaches the required pattern.
- **Layout Snapshot**: The set of node positions before/after Auto-Arrange; semantics-free; recoverable via Undo or equivalent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A designer can wire approved, rejected, and needs_clarification paths from an Approval node in under about 30 seconds without using the edge properties panel.
- **SC-002**: First-time Hierarchical Supervisor creation no longer presents an immediately invalid empty canvas for missing hub structure; initial structural validation for the required hub pattern passes on first open.
- **SC-003**: Auto-Arrange produces a readable hierarchical layout on a typical 8–15 node graph in one action without changing run behavior or branch bindings.
- **SC-004**: Designers can complete condition multi-branch connections without handle overlap blocking the intended target.
- **SC-005**: Existing workflows with prior approval/condition conditional edges continue to load with branch bindings preserved; no silent loss of bindings in compatibility testing of representative saved graphs.
- **SC-006**: In moderated usability checks, new Studio users creating a Hierarchical Supervisor workflow can identify the supervisor hub and primary routing path on the scaffolded canvas without reading external docs (teach-the-pattern goal).
- **SC-007**: Outcome and branch handles meet basic accessibility expectations: identity is conveyed with labels or equivalent text cues, not color alone.

## Assumptions

- Approval outcomes `approved`, `rejected`, and `needs_clarification` already exist (or are the intended product vocabulary) in runtime/validation; this feature exposes them as canvas handles rather than inventing new decision semantics.
- Hierarchical Supervisor remains a supported create-time archetype with known structural requirements (supervisor hub, routing, etc.).
- Design | Live canvas modes already exist; this feature focuses on design-time authoring UX and create scaffolding, while keeping branch structure readable in Live mode.
- Topology expansion (evaluator-optimizer, swarm, subgraph nodes, etc.) may land separately; scaffolding here targets empty-canvas friction for **existing** create-time archetypes, not new archetype invention.
- Existing editor Undo/Redo for canvas mutations is sufficient recovery for Auto-Arrange unless product testing shows a dedicated “restore layout” control is required—in which case documenting Undo as the recovery path remains acceptable for v1.
- Legacy single-handle approval graphs remain valid without forced rewrite: old conditional edges keep their branch keys; new handles are additive for future wiring.
- “Similarly structured multi-branch decision nodes” means Condition nodes and any current sibling that already uses percentage-positioned multi-output handles; it does not expand into new node primitive types.
- Linear Pipeline and other existing archetypes receive create-time scaffolds only when they currently fail structural validation on an empty canvas; otherwise Hierarchical Supervisor is the mandatory scaffolded archetype for this feature.
- Visual handle colors (e.g., green/red/amber) are illustrative of distinct outcomes; exact palette follows Studio design language as long as text labels (or equivalent) remain present.
- Prefer designer-facing outcomes over prescribing a specific layout library; product behavior (readable hierarchical arrangement, semantics unchanged) is primary.
