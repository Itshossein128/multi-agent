# Topology Validation Issue Codes

**Feature**: `014-workflow-topology-expansion`  
**Authority**: `apps/server/src/compiler/validation.ts` (web parity in `apps/web/src/lib/workflow/validation.ts`)

Existing 009/010 codes remain stable (`LINEAR_PIPELINE_CYCLE_FORBIDDEN`, `MISSING_SUPERVISOR_HUB`, `UNGUARDED_CYCLE`, etc.).

## New codes

| Code | Severity | When |
| :--- | :--- | :--- |
| `EVALUATOR_OPTIMIZER_CONFIG_REQUIRED` | error | Category is EO but `evaluatorOptimizer` block missing/incomplete |
| `EVALUATOR_OPTIMIZER_ROLE_INVALID` | error | Generator/evaluator node ids missing from graph or wrong type |
| `EVALUATOR_OPTIMIZER_CEILING_REQUIRED` | error | `maxIterations` missing or outside 1–10 |
| `EVALUATOR_OPTIMIZER_CYCLE_INVALID` | error | Cycle present that is not the designated fail→generator feedback |
| `EVALUATOR_OPTIMIZER_ROUTING_INVALID` | error | pass/fail branches not wired on the evaluator condition |
| `EVALUATOR_OPTIMIZER_EXHAUSTION_UNWIRED` | error | `exhaustionOutcome=exit_path` but exhaustion branch missing/unwired |
| `PARALLEL_SPLIT_JOIN_MISMATCH` | error | Split/join pairing invalid (orphan split, join without split lanes, etc.) |
| `PARALLEL_BRANCH_LIMIT_EXCEEDED` | error | Fan-out width > active `maxConcurrentBranches` |
| `PARALLEL_JOIN_POLICY_INVALID` | error | Unknown/missing join policy or requiredBranchKeys not subset of incoming |
| `SUBGRAPH_REF_MISSING` | error | Referenced workflow missing or inaccessible |
| `SUBGRAPH_MAPPING_INVALID` | error | Required mapping missing, empty, or target unknown on child/parent |
| `SUBGRAPH_NESTING_UNSAFE` | error | Self-reference or cyclic references without enforceable finite depth |
| `SUBGRAPH_DEPTH_EXCEEDED` | error | Resolved nesting depth > platform max (3) |
| `SWARM_BOUNDS_REQUIRED` | error | Swarm missing maxHops/maxDepth/maxActivePeerTasks |
| `SWARM_BOUNDS_INVALID` | error | Swarm bounds out of allowed range or active tasks > concurrency budget |
| `SWARM_UNBOUNDED_PEER_LOOP` | error | Peer cycle/handoff structure without enforceable hop/depth termination |

## Live / runtime event types (additive)

| Event | Purpose |
| :--- | :--- |
| `node.loop_iteration` | EO (or guarded) iteration progress `{ current, max, phase }` |
| `node.loop_limit_reached` | Existing; also used for EO exhaustion when applicable |
| `parallel.branch_started` | Specialist lane started |
| `parallel.branch_completed` | Specialist lane succeeded |
| `parallel.branch_failed` | Specialist lane failed/timed out |
| `subgraph.entered` | Nested workflow started |
| `subgraph.exited` | Nested workflow completed |
| `subgraph.failed` | Nested workflow failed |

## Designer message guidance

Messages MUST name the archetype/primitive and the fix (e.g. “Evaluator-optimizer feedback cycle must route fail back to generator node X; unrelated cycle involving Y is not allowed”)—not only “cycle forbidden.”
