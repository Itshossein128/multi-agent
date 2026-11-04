# Research: Expanded Workflow Topology Support

**Feature Branch**: `014-workflow-topology-expansion`  
**Date**: 2026-11-04  
**Status**: Completed  

---

## Executive Summary

Today only `linear-pipeline` and `hierarchical-supervisor` exist (`packages/types/src/archetype.ts`). Cycles are forbidden on stamped linear graphs (`LINEAR_PIPELINE_CYCLE_FORBIDDEN`); hierarchical requires hub + guarded cycles. The LangGraph compiler already wires **all non-conditional edges** and multi-predecessor nodes already build `{ branches }` in `valueForNode`, while `maxConcurrentBranches` (default **8**) gates node attempts via semaphore—but there are **no** first-class parallel split/join nodes, join policies, subgraph nodes, EO/swarm archetypes, scaffolds, or Live iteration/branch/subgraph chrome.

This feature extends types, validation, compiler, Studio create/scaffold UX, and Live projection along the existing 009–011 path. All Technical Context unknowns are resolved below.

---

## Technical Decisions & Rationale

### Decision 1: Add two archetypes; treat parallel + subgraph as primitives

#### Problem
Spec needs EO and swarm as selectable archetypes, and scatter-gather / nesting as reusable topology tools—not only under one niche category.

#### Alternatives Considered
1. **Four new archetypes** (EO, parallel, nested, swarm) — Parallel and nesting are structural primitives, not mutually exclusive execution models; forces awkward “which archetype?” choices.
2. **Only primitives, no new archetypes** — EO and peer-swarm safety models need first-class category + scaffold + cycle/hop policy; hierarchical is the wrong mental model for EO.
3. **New archetypes EO + swarm; primitives `parallel_split` / `parallel_join` / `subgraph` usable in DAG-capable graphs** (Selected).

#### Decision
- Categories: add `evaluator-optimizer`, `autonomous-swarm`.
- Primitives: add node types `parallel_split`, `parallel_join`, `subgraph`.
- Linear-pipeline remains **acyclic** but **may include** validated parallel split/join (DAG fan-out/fan-in). Cycles remain forbidden on linear.
- Hierarchical-supervisor unchanged; may optionally host parallel/subgraph later if validation allows, but MVP does not require rewriting hub rules—prefer using primitives primarily under linear + EO + swarm unless hierarchical validation already permits multi-edge DAGs outside cycles.

#### Rationale
Matches spec assumptions; maximizes reuse; keeps deny-by-default per archetype.

---

### Decision 2: Evaluator-optimizer = archetype + specialized loop config (reuse guard machinery)

#### Problem
Designers need generator → evaluator → feedback with ceiling and exhaustion outcome without hacking hierarchical hub requirements.

#### Alternatives Considered
1. **Force EO as hierarchical with prefilled hub** — Wrong UX; hub mandatory errors confuse quality-loop authors.
2. **Generic “cycles allowed if any recursionGuards” on linear** — Too loose; recreates free-form graphs.
3. **Dedicated EO archetype with `evaluatorOptimizer` config** (Selected): designate generator/evaluator node ids (or roles), `maxIterations` (1–10, default 3), `passBranch` / `failBranch` / `exhaustionOutcome` (`fail` | `exit_path` with `exhaustionBranch`).

#### Decision
- Validation allows **one** primary feedback cycle (or a small set of designated feedback edges) matching EO routing; other cycles → specific `EVALUATOR_OPTIMIZER_*` errors.
- Runtime: specialize existing loop-iteration tracking / `node.loop_limit_reached` path; on exhaustion take configured outcome.
- Scaffold: Input → Generator(agent) → Evaluator(agent) → Condition(pass/fail) → (fail→Generator, pass→Output) + exhaustion branch; ceiling preconfigured.

#### Rationale
Reuses proven recursion-limit execution while giving designers EO-specific language and scaffolds.

---

### Decision 3: Explicit `parallel_split` / `parallel_join` nodes + join policy

#### Problem
Implicit multi-edge fan-out is under-documented, has no join policy, no design-time concurrency check, and weak Live affordances.

#### Alternatives Considered
1. **Document-only multi-edge scatter-gather** — Fails FR for join semantics and designer-readable structure.
2. **LangGraph `Send` API dynamic map-reduce** — Powerful but heavier; not required for fixed specialist branches.
3. **First-class split/join nodes compiled to multi-edge fan-out + barrier join** (Selected).

#### Decision
- `parallel_split`: single in, N out (edges to specialist roots); config may list expected branch keys/ids.
- `parallel_join`: N in, one out; config:
  - `joinPolicy`: `all_success` (default, fail-closed) | `partial_allowed`
  - `branchTimeoutMs?` (optional; inherit platform defaults if unset)
- Validation: count concurrent specialist lanes under a split ≤ active `maxConcurrentBranches` (default 8); issue `PARALLEL_BRANCH_LIMIT_EXCEEDED`.
- Compiler: split emits parallel successors (LangGraph multi-edge); join waits for required predecessors; `all_success` fails closed if any required branch failed/timed out; `partial_allowed` yields `{ branches, failed, timedOut }` with explicit attribution (extend today’s `{ branches }` shape—never omit failures silently).
- Semaphore already caps runtime concurrency; design-time check prevents authoring over-budget graphs.

#### Rationale
Aligns with recommendations doc and spec; builds on existing `valueForNode` join carrier.

---

### Decision 4: Subgraph = runtime nested workflow invoke (not compile-time flatten)

#### Problem
Reusable nested workflows need identity for Live enter/exit and safe depth limits.

#### Alternatives Considered
1. **Compile-time inline expansion** — Loses nested Live identity; complicates recursion detection across copies.
2. **Runtime nested run** (Selected): `subgraph` node resolves referenced workflow by ID (latest saved definition at validate/run for v1), maps inputs → child input, runs child through existing compile/execute path with `nestingDepth + 1`, maps outputs back.

#### Decision
- Config: `workflowId`, `inputMappings[]` (`parentPath` → `childInputKey`), `outputMappings[]` (`childOutputKey` → `parentPath`), optional `label`.
- Limits: `maxSubgraphDepth` default **3** (platform constant); reject self-reference / cycles in the reference graph without finite depth; reject missing workflow / incomplete required mappings (`SUBGRAPH_*` codes).
- Events: `subgraph.entered` / `subgraph.exited` (and failed) with parent `nodeId` + child `workflowId` + depth.

#### Rationale
Satisfies observability and fail-closed nesting; keeps child definitions reusable.

---

### Decision 5: Autonomous swarm = bounded peer archetype (not free mesh)

#### Problem
Peer handoffs without permanent hub, with hop/depth/active-task ceilings.

#### Alternatives Considered
1. **Full free peer mesh** — Out of scope per spec.
2. **Bounded swarm archetype** (Selected): participants are agent nodes; routing via conditions/handoff edges without requiring `supervisorHubNodeId`; config `maxHops` / `maxDepth` / `maxActivePeerTasks` (finite, small defaults); termination when no pending handoffs or ceiling hit.

#### Decision
- No hub required (unlike hierarchical).
- Validation rejects missing ceilings and detects unbound peer cycles.
- Scaffold: small peer set + condition handoff + termination/output + prefilled ceilings.
- Hierarchical remains available and unchanged.

#### Rationale
Delivers FR-012–FR-013 without unbounded meshes.

---

### Decision 6: Scaffolding at create time (not empty canvas)

#### Problem
Empty graphs immediately fail structural validation (e.g. hierarchical hub missing); new archetypes would repeat that pain.

#### Decision
- Extend `workflowService.stampWorkflowArchetype` / create path to attach **minimal valid node+edge scaffolds** per archetype (EO, swarm; improve hierarchical optionally if cheap—spec requires new archetypes; hierarchical polish is nice-to-have, not blocking).
- Linear may get optional parallel example only when designer adds primitives—not forced on every linear create.
- Palette exposes `parallel_split`, `parallel_join`, `subgraph`.

#### Rationale
SC-005 / FR-015.

---

### Decision 7: Live observability via new RunEventType values + projection

#### Problem
Operators need iteration, parallel branch, and subgraph progress on-canvas (feature 011 path).

#### Decision
Extend `RunEventType` (and projection) with at least:
- `topology.iteration` (or reuse/enhance `node.loop_limit_reached` + a non-terminal `node.loop_iteration` with `{ current, max, phase }`)
- `parallel.branch_started` / `parallel.branch_completed` / `parallel.branch_failed` (payload: splitId, joinId?, branchKey/nodeId)
- `subgraph.entered` / `subgraph.exited` / `subgraph.failed`

Project into existing Live rings/tray/inspector without a separate page.

#### Rationale
FR-016 / SC-003; reuse 011 infrastructure.

---

### Decision 8: Validation issue codes are specific (no generic-only cycle errors)

#### Decision
Add designer-readable codes (see [contracts/topology-validation.codes.md](./contracts/topology-validation.codes.md)), e.g.:
- `EVALUATOR_OPTIMIZER_CYCLE_INVALID`, `EVALUATOR_OPTIMIZER_CEILING_REQUIRED`, `EVALUATOR_OPTIMIZER_EXHAUSTION_UNWIRED`
- `PARALLEL_BRANCH_LIMIT_EXCEEDED`, `PARALLEL_JOIN_POLICY_INVALID`, `PARALLEL_SPLIT_JOIN_MISMATCH`
- `SUBGRAPH_REF_MISSING`, `SUBGRAPH_MAPPING_INVALID`, `SUBGRAPH_NESTING_UNSAFE`, `SUBGRAPH_DEPTH_EXCEEDED`
- `SWARM_BOUNDS_REQUIRED`, `SWARM_UNBOUNDED_PEER_LOOP`
Keep existing linear/hierarchical codes behaviorally stable.

Server `validation.ts` remains authoritative; web `lib/workflow/validation.ts` stays in parity.

---

## Resolved defaults (from spec Assumptions)

| Topic | Default |
| :--- | :--- |
| Join policy | `all_success` (fail-closed); `partial_allowed` opt-in |
| EO exhaustion | Scaffold `exit_path` with wired exhaustion branch; designer may set `fail` |
| EO / recursion-like ceilings | 1–10, default 3 |
| Subgraph resolve | Latest saved definition at validate/run (v1) |
| Max subgraph depth | 3 |
| Concurrent branches | Honor platform guardrail (default 8) |
| Swarm | Bounded hops/depth/active tasks; not free mesh |

---

## Alternatives Rejected Summary

| Idea | Why rejected |
| :--- | :--- |
| Free-form graphs with optional soft warnings | Violates deny-by-default / out of scope |
| Compile-time only subgraph inlining | Breaks nested Live identity and recursion clarity |
| EO via hierarchical-only | Wrong hub UX; confuses archetypes |
| Raise concurrency budget in this feature | Explicitly out of scope |

---

## Open implementation notes (non-blocking for plan)

- Exact LangGraph join barrier edge wiring should follow existing multi-predecessor patterns; add tests proving join does not proceed early under `all_success`.
- Whether hierarchical may host `parallel_*` / `subgraph` in MVP: allow if acyclic side structures do not violate hub rules; otherwise document “use linear/EO for scatter-gather” in quickstart—prefer allowing DAG side-structures when validation stays clear.
- Pin/versioned subgraph refs deferred beyond v1.
