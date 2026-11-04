# Feature Specification: Expanded Workflow Topology Support

**Feature Branch**: `014-workflow-topology-expansion`

**Created**: 2026-11-04

**Status**: Draft

**Input**: User description: "Expand workflow topology support beyond the current two archetypes (linear-pipeline and hierarchical-supervisor) so Studio users can design, validate, and run the multi-agent patterns that real agentic systems need: quality feedback loops, parallel specialist review with aggregation, nested reusable sub-workflows, and peer-style collaboration."

---

## Architectural Context & Feature Boundary

### Current Gap
Studio today supports only two workflow archetypes: **linear-pipeline** (acyclic sequential flow) and **hierarchical-supervisor** (hub-and-spoke with guarded recursion). Designers cannot cleanly express standard multi-agent patterns—especially evaluator–optimizer quality loops, scatter–gather specialist review, nested reusable sub-workflows, and peer-style collaboration. Cycles outside hierarchical supervisors are rejected generically; parallel fan-out/join and subgraph composition are missing as first-class design concepts. The canvas therefore feels like a static pipeline diagrammer rather than a multi-agent studio.

### Scope of This Feature
Make it possible—in the visual workflow builder and at validate/run time—to create, validate, execute, and observe workflows that use these topologies **safely**, with clear iteration ceilings and concurrency limits, **without breaking** existing linear-pipeline and hierarchical-supervisor workflows:

1. **Evaluator-Optimizer archetype**: First-class generator → evaluator → feedback loop with hard iteration ceiling and defined exhaustion outcome.
2. **Parallel fan-out / fan-in (scatter-gather)**: Split one input across independent specialist branches and join structured results into an aggregator, respecting the platform concurrency budget.
3. **Nested sub-workflows**: Place a reusable subgraph node that references another saved workflow, with explicit parent↔subgraph input/output mapping and safe nesting limits.
4. **Autonomous swarm / peer delegation archetype**: Peer-style handoffs without requiring a permanent supervisor hub for every hop, with enforceable hop/depth/active-task ceilings and clear termination.
5. **Validation, scaffolding, and observability parity**: Archetype-aware, designer-readable errors; create-workflow scaffolds that pass initial validation; live Studio visualization of loop iterations, branch progress, and subgraph enter/exit.

### Out of Scope
- Reworking credential broker, tenancy/RLS, or worker sandbox isolation.
- Replacing or removing linear-pipeline or hierarchical-supervisor archetypes.
- Full free-form arbitrary graphs with no archetype or safety bounds.
- Canvas UX polish unrelated to topology (approval handle colors, auto-layout, general edge friction) unless required to make the new topologies usable.
- Implicit data-passing / typed port remapping as a separate data-flow feature (except the minimum explicit parent↔subgraph input/output mapping required for nested workflows).
- Raising the platform concurrency budget beyond the active limit (feature must honor the current budget; known default max concurrent branches = 8).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Evaluator-Optimizer Quality Loop (Priority: P1)

A workflow designer creates an evaluator-optimizer workflow: a generator produces an artifact, an evaluator scores it against a rubric, and on fail the feedback returns to the generator. The loop continues until quality passes or a hard iteration ceiling is reached. An operator runs the workflow and sees the current iteration count and the final pass or exhaustion outcome without leaving the canvas.

**Why this priority**: Quality feedback loops are the highest-demand missing Anthropic-style pattern and are currently blocked by generic cycle rejection; unlocking them is the core product value of topology expansion.

**Independent Test**: Create a new evaluator-optimizer workflow from the archetype picker, wire generator and evaluator with pass/fail routing and a ceiling of N, run with a prompt that fails then passes (or hits the ceiling), and confirm iteration progress and final outcome are visible in Live mode.

**Acceptance Scenarios**:

1. **Given** a designer chooses the Evaluator-Optimizer archetype when creating a workflow, **When** the workflow opens, **Then** the canvas is scaffolded with a minimal valid generator → evaluator → pass/fail structure and an iteration ceiling so initial validation succeeds.
2. **Given** a valid evaluator-optimizer graph with iteration ceiling N, **When** the evaluator returns fail and feedback routes to the generator fewer than N times then returns pass, **Then** the run completes successfully on the pass path and the operator can observe how many iterations occurred.
3. **Given** a valid evaluator-optimizer graph with iteration ceiling N, **When** the evaluator continues to fail through N iterations, **Then** the run takes the defined ceiling-exhaustion outcome (configured fail or exhaustion exit path), does not loop further, and that outcome is observable in Live mode.
4. **Given** a designer introduces a cycle outside the allowed evaluator-optimizer feedback structure (or under an archetype that forbids that cycle), **When** validation runs, **Then** the platform rejects the topology with a specific, designer-readable error—not a generic “cycle forbidden” message alone.
5. **Given** an operator is watching a live evaluator-optimizer run, **When** each loop iteration starts or ends, **Then** the canvas/live chrome clearly indicates iteration progress (at least current iteration vs ceiling and which phase—generate vs evaluate—is active).

---

### User Story 2 - Parallel Specialist Review (Scatter-Gather) (Priority: P1)

A designer creates a scatter-gather review: one brief fans out to multiple independent specialist agents (for example Security, Performance, and UI), then joins their structured results into a summary/aggregator step. An operator runs the workflow and sees all branches progress concurrently and the join complete.

**Why this priority**: Parallel specialist review is a standard production pattern that cannot be expressed today without sequential workarounds; it is independently valuable even without quality loops or nesting.

**Independent Test**: Author a workflow with one split to three specialist branches and one join into an aggregator; run it; confirm all three branches show live progress and the aggregator receives joined results when join conditions are met.

**Acceptance Scenarios**:

1. **Given** a designer places split and join structure for parallel specialists within a topology that allows fan-out, **When** they save and validate, **Then** the graph is accepted if branch count is within the active concurrency budget and join semantics are configured.
2. **Given** a valid scatter-gather graph with K specialist branches where K is within the platform concurrency limit, **When** the run reaches the split, **Then** the platform executes those branches concurrently (subject to the active max concurrent branches limit) and the operator sees each branch’s status live.
3. **Given** join semantics are set to fail-closed (default), **When** any required branch fails or times out, **Then** the join does not silently succeed with missing data; the run follows the defined failure outcome and the operator can see which branch failed.
4. **Given** join semantics allow partial results (when explicitly configured), **When** a subset of branches succeeds and others fail or time out, **Then** the aggregator receives an explicit partial-results payload identifying successes and failures—no silent omission of failed branches.
5. **Given** a designer configures more concurrent branches than the active platform concurrency budget, **When** validation runs, **Then** the design is rejected before run with an actionable message stating the limit and the offending structure.
6. **Given** an operator watches a live scatter-gather run, **When** branches are in flight, **Then** Studio visually distinguishes split structure, per-branch progress, and join completion clearly enough to debug without leaving the canvas.

---

### User Story 3 - Nested Reusable Sub-Workflows (Priority: P1)

A designer embeds a saved “research subroutine” workflow as a single subgraph node inside a larger parent workflow, maps parent inputs to subgraph inputs and subgraph outputs back to parent state, then runs the parent successfully. Nested composition is reusable: the same saved workflow can appear as a block in multiple parents.

**Why this priority**: Composition is how real agent systems scale design complexity; without nesting, designers must duplicate graphs or flatten everything onto one canvas.

**Independent Test**: Save a small valid child workflow; in a parent workflow add a subgraph node referencing it; map required inputs/outputs; run the parent and confirm the child executes and mapped outputs appear in the parent continuation.

**Acceptance Scenarios**:

1. **Given** a designer adds a subgraph/reusable-workflow node, **When** they select another saved workflow definition they are allowed to use, **Then** the node represents that workflow as a single canvas block with explicit input and output mapping controls.
2. **Given** required parent→subgraph input mappings and subgraph→parent output mappings are complete and types/required fields are satisfied, **When** the parent is validated, **Then** validation succeeds for the nesting boundary (no silent drop of required mapped fields).
3. **Given** a required mapping is missing or references a non-existent field, **When** validation runs, **Then** Studio shows an actionable error identifying the subgraph node and the missing/invalid mapping—run remains blocked.
4. **Given** a subgraph reference would create unbounded recursion (direct or indirect self-reference without an enforceable nesting/depth ceiling), **When** validation runs, **Then** the configuration is rejected with a clear nesting/recursion error before execution.
5. **Given** an operator runs a parent that enters a subgraph, **When** the child workflow starts and later completes, **Then** Live visualization shows subgraph enter and exit clearly enough to distinguish parent vs nested progress.
6. **Given** a child workflow already used as a subgraph is updated and saved, **When** a parent that references it is next validated or run under the product’s reference rules, **Then** behavior is consistent with the documented reference semantics (pinned vs latest—see Assumptions) and does not silently lose mapped fields without validation feedback.

---

### User Story 4 - Autonomous Swarm / Peer Delegation (Priority: P2)

A designer chooses an autonomous-swarm style workflow for peer handoffs: agents may delegate work to peers without a single permanent supervisor hub for every hop. Safety bounds (max hops / depth / active peer tasks) and termination conditions are first-class. Invalid unbounded peer loops are rejected before run. Existing hierarchical-supervisor workflows remain available and unchanged for hub-and-spoke control.

**Why this priority**: Peer delegation unlocks collaboration patterns beyond hub-and-spoke, but is secondary to evaluator-optimizer, scatter-gather, and nesting because it is narrower than a full free mesh and depends on the same safety/validation foundations.

**Independent Test**: Create an autonomous-swarm workflow from the archetype picker with explicit hop/depth limits; run a short peer-handoff scenario that terminates cleanly; attempt an unbounded peer cycle configuration and confirm validation rejects it before run.

**Acceptance Scenarios**:

1. **Given** a designer selects the Autonomous Swarm archetype at creation, **When** the workflow opens, **Then** a minimal scaffold with peer participants and required safety ceilings is present and passes initial validation.
2. **Given** a valid swarm workflow with max hops/depth/active peer tasks configured within allowed bounds, **When** agents hand off within those bounds and a termination condition is met, **Then** the run completes with an observable termination reason.
3. **Given** a swarm configuration lacks required ceilings or would allow unbounded peer looping, **When** validation runs, **Then** the design is rejected with specific errors naming the missing or unsafe bound—execution does not start.
4. **Given** existing hierarchical-supervisor workflows, **When** this feature ships, **Then** those workflows continue to validate and run unchanged; designers who need hub-and-spoke control are not forced onto swarm.

---

### User Story 5 - Archetype Scaffolding and Designer-Readable Validation (Priority: P1)

A new designer picks any newly supported archetype (or uses new topology primitives) and gets a scaffolded canvas that passes initial validation. Invalid loop, nest, parallel, or peer configurations fail closed with actionable Studio errors before execution. Existing linear-pipeline and hierarchical-supervisor workflows continue to validate and run without migration pain.

**Why this priority**: Without scaffolding and clear errors, new topologies remain unusable in practice even if the runtime supports them; backward compatibility is a non-negotiable release gate.

**Independent Test**: For each new archetype, create a workflow and confirm the empty/scaffolded canvas validates; introduce one known-invalid configuration per topology class and confirm a specific error appears; open an existing linear and an existing hierarchical workflow and confirm they still validate and run.

**Acceptance Scenarios**:

1. **Given** create-workflow archetype selection, **When** the designer chooses Evaluator-Optimizer or Autonomous Swarm, **Then** those options appear with concise behavioral descriptions alongside existing Linear Pipeline and Hierarchical Supervisor options.
2. **Given** a newly created workflow for a new archetype, **When** the editor loads the scaffold, **Then** initial validation passes (or only shows non-blocking guidance)—the designer is not immediately stuck on empty-canvas structural errors.
3. **Given** invalid topology (unguarded loop, over-budget fan-out, unsafe nest, unbounded peer hops), **When** the designer validates or attempts Run, **Then** Studio shows specific, actionable errors and blocks execution (fail closed).
4. **Given** a saved linear-pipeline or hierarchical-supervisor workflow that was valid before this feature, **When** it is opened and run after this feature, **Then** it remains valid and runnable without requiring the designer to change archetype or rewrite the graph.

---

### Edge Cases

- Evaluator never returns a clear pass/fail signal: run must not loop forever; treat as non-pass toward ceiling and eventual exhaustion outcome, with an observable reason.
- Iteration ceiling set to the minimum allowed value (1): at most one generate→evaluate cycle (or the product’s defined “single attempt”) then exhaustion or pass—never unbounded.
- All parallel branches succeed but aggregator mapping is incomplete: validation or join fails closed with an actionable mapping/join error—no silent empty aggregate.
- One parallel branch hangs until timeout: join follows configured timeout/failure semantics; operator sees the timed-out branch.
- Subgraph references a workflow the designer cannot access or that was deleted: validation/run fails with a clear missing-reference error; no partial silent skip of the subgraph.
- Nested depth at the maximum allowed level: one more nest attempt is rejected at validate time.
- Circular subgraph references (A→B→A) without a finite depth guard: rejected before run.
- Swarm peer hands off to a peer that immediately hands back in a tight cycle: hop/depth counters must terminate the cycle; missing counters invalid at design time.
- Switching archetype from a new topology back to linear-pipeline while cycles or swarm-only structure remain: conversion fails with topology-specific errors listing offending structure; prior config is not silently destroyed (dormant retention consistent with existing archetype-conversion behavior where applicable).
- Concurrent branch count equals the platform limit exactly: allowed; one above: rejected.
- Live run for a nested + parallel combination: observability must still attribute status to the correct branch and nesting level without mixing parent/child progress.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST offer Evaluator-Optimizer as a first-class workflow archetype selectable at workflow creation and visible as the effective archetype in Studio.
- **FR-002**: Evaluator-Optimizer workflows MUST allow designers to define generator step(s), evaluator/rubric step(s), pass/fail routing, and a hard iteration ceiling within a documented allowed range.
- **FR-003**: Evaluator-Optimizer execution MUST continue the feedback loop until the evaluator indicates pass or the iteration ceiling is reached; upon ceiling exhaustion the system MUST take a designer-defined observable outcome (fail the run or follow an exhaustion exit path).
- **FR-004**: System MUST allow the cycles required for a valid evaluator-optimizer feedback structure under that archetype, and MUST reject misuse of cycles under archetypes or structures that do not permit them, with specific designer-readable errors.
- **FR-005**: System MUST support parallel fan-out and fan-in so one input can be split across multiple independent specialist branches and joined into an aggregator with explicit join semantics.
- **FR-006**: Concurrent parallel branches MUST NOT exceed the platform’s active max concurrent branches budget (currently 8 unless product raises it); validation MUST reject over-budget designs before execution.
- **FR-007**: Join semantics MUST be explicit and enforced for at least: all-required success (fail-closed default), branch failure, branch timeout, and—when enabled—partial results with explicit success/failure attribution.
- **FR-008**: Studio MUST visually represent split/join structure in Design mode and live per-branch progress plus join completion in Live mode.
- **FR-009**: System MUST support a subgraph / reusable workflow node that references another saved workflow definition the designer is authorized to use.
- **FR-010**: Parent↔subgraph data movement MUST use explicit input and output mappings that are validated; required mappings MUST NOT be silently dropped at subgraph boundaries.
- **FR-011**: Validation MUST prevent unsafe nesting (including unbounded recursion / self-reference without enforceable limits) and surface actionable Studio errors.
- **FR-012**: System MUST offer Autonomous Swarm (peer-style delegation) as a first-class archetype with required safety ceilings: max hops and/or depth, max active peer tasks, and clear termination conditions.
- **FR-013**: Autonomous Swarm MUST NOT require a single permanent supervisor hub for every peer hop; Hierarchical Supervisor MUST remain available and behaviorally unchanged for hub-and-spoke designs.
- **FR-014**: Compiler/validation MUST recognize the new archetypes and topology primitives and produce specific, designer-readable issue codes/messages for invalid loops, joins, nesting, concurrency, and peer bounds.
- **FR-015**: Create-workflow / archetype selection MUST scaffold a minimal valid starter graph for each new archetype so empty canvases do not immediately fail structural validation.
- **FR-016**: Live Studio run visualization MUST show loop iteration progress, parallel branch status, and subgraph enter/exit clearly enough for operators to debug without leaving the canvas.
- **FR-017**: Existing linear-pipeline and hierarchical-supervisor workflows that were valid before this feature MUST remain valid and runnable without mandatory migration.
- **FR-018**: System MUST fail closed on invalid topology: Run remains blocked while blocking validation errors are present.
- **FR-019**: Deny-by-default safety MUST apply: loops, parallelism, nesting, and peer hops are only allowed when the active archetype/primitives permit them and enforceable ceilings are present and within bounds.
- **FR-020**: Designers MUST be able to save and later reopen workflows that use the new topologies with archetype, ceilings, join semantics, mappings, and graph structure preserved.

### Key Entities

- **Workflow Archetype**: Execution/governing category of a workflow; expanded set includes at least `linear-pipeline`, `hierarchical-supervisor`, `evaluator-optimizer`, and `autonomous-swarm`.
- **Evaluator-Optimizer Configuration**: Generator/evaluator roles or designated steps, pass/fail routing, iteration ceiling, and ceiling-exhaustion outcome (fail vs exit path).
- **Parallel Split / Join Structure**: Design-time fan-out and fan-in grouping of specialist branches, including join policy and timeout/failure handling, constrained by the platform concurrency budget.
- **Subgraph Node**: Canvas node referencing another saved workflow definition, with explicit input mappings (parent → child) and output mappings (child → parent), plus nesting/depth constraints.
- **Swarm Safety Bounds**: Max hops/depth, max active peer tasks, and termination conditions for peer-style delegation.
- **Topology Validation Issue**: Designer-facing, specific error describing what is wrong and how it relates to the active archetype or primitive (loop, join, nest, concurrency, peer bound).
- **Live Topology Progress**: Operator-visible run state for iteration count/ceiling, per-branch status, and subgraph enter/exit nested within existing Live observability.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Designers can create, save, and successfully run at least one evaluator-optimizer workflow, one scatter-gather (parallel specialist) workflow, and one parent workflow embedding a nested sub-workflow—without workarounds or forbidden-cycle dead ends—on first guided attempt in a usability check with ≥ 4 of 5 designers succeeding per pattern.
- **SC-002**: 100% of tested invalid configurations in the release checklist (unguarded/disallowed loop, over-budget fan-out, unsafe nest/self-reference, unbounded peer hops) are rejected before execution with messages that name the problem class; zero executions proceed past validation for those cases.
- **SC-003**: During live runs of the three primary patterns, operators can correctly identify iteration count (evaluator-optimizer), each parallel branch’s status (scatter-gather), and subgraph enter/exit (nesting) from the canvas alone in ≥ 90% of observed debug tasks in an internal operator walkthrough.
- **SC-004**: 100% of a sampled set of previously valid linear-pipeline and hierarchical-supervisor workflows still validate and complete a smoke run after the feature ships (no required graph edits).
- **SC-005**: A new designer selecting each new archetype receives a scaffolded canvas that passes initial validation within the create→open path (no immediate blocking empty-canvas structural failure) for 100% of new archetypes in the release checklist.
- **SC-006**: Parallel fan-out designs that exceed the active concurrency budget are blocked at validate time in 100% of over-budget test cases; designs at or under the budget are not falsely rejected for concurrency alone.

## Assumptions

- This feature builds on the existing visual Studio canvas, workflow definitions, compiler validation, Live run observability, and archetype selection UX already in the product (including prior dual-mode orchestration and archetype-selection work).
- Anthropic-style evaluator-optimizer, parallel specialists, and nested composition are the primary target patterns; autonomous-swarm is included as a bounded peer-delegation archetype, not a free-form unbounded mesh.
- The active platform concurrency budget governs fan-out (known current limit: max concurrent branches = 8); this feature honors the active limit rather than hard-coding a permanent product maximum in designer-facing copy only.
- Parallel split/join are first-class topology primitives usable in archetypes that allow acyclic multi-branch structure (including extending linear-pipeline to accept validated fan-out/fan-in without introducing cycles). They are not a separate “parallel-only” archetype unless product later chooses to market one.
- Default join policy is fail-closed (all required branches must succeed); partial-results join is opt-in and must label missing/failed branches explicitly.
- Default evaluator-optimizer ceiling exhaustion outcome is a dedicated exhaustion exit path when scaffolded; designers may instead configure hard fail. Ceiling range defaults align with existing recursion-guard scale (small finite bound, e.g. on the order of 1–10) unless product standards dictate otherwise—exact numeric bounds are planning details as long as a hard ceiling is mandatory.
- Subgraph references resolve to a saved workflow the designer can access; v1 uses “latest saved definition at validate/run” unless a pin/version control already exists—mapping validation always runs against the resolved definition.
- Nested workflows require only explicit I/O mapping at the boundary; full typed port remapping / expression engines remain a separate future data-flow feature.
- Existing hierarchical-supervisor recursion guards and approval-gate rules remain the authority for that archetype; this feature does not redefine hub-and-spoke semantics.
- Credential, tenancy, and worker isolation posture remain unchanged; topology expansion must not weaken deny-by-default safety.
- Prefer product behavior and designer/operator outcomes over prescribing specific runtime libraries or graph engines.
