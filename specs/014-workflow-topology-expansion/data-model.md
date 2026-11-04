# Data Model: Expanded Workflow Topology Support

**Feature Branch**: `014-workflow-topology-expansion`  
**Date**: 2026-11-04  
**Status**: Complete  

Related: [spec.md](./spec.md), [research.md](./research.md), [contracts/](./contracts/)

---

## 1. WorkflowArchetypeCategory (extended)

| Value | Topology | Safety |
| :--- | :--- | :--- |
| `linear-pipeline` | Acyclic DAG; may include parallel split/join | No cycles |
| `hierarchical-supervisor` | Hub-and-spoke + guarded cycles | Hub + recursionGuards (+ existing approval rules) |
| `evaluator-optimizer` | Generator ↔ evaluator feedback | Iteration ceiling + exhaustion outcome; designated feedback only |
| `autonomous-swarm` | Peer handoffs without permanent hub | maxHops / maxDepth / maxActivePeerTasks + termination |

**Invariants**
- `definition.archetype` MUST equal `definition.archetypeConfig.category` when both set.
- Unknown category → `INVALID_ARCHETYPE` (existing behavior extended).
- Legacy untyped workflows (neither field set) remain linear-display + soft cycle policy until stamped (unchanged).

---

## 2. WorkflowArchetypeConfig (extended fields)

Existing fields retained: `category`, `supervisorHubNodeId?`, `maxExecutionSteps?`, `recursionGuards?`, `humanApprovalGateRequired?`.

### Evaluator-optimizer (`category: "evaluator-optimizer"`)

| Field | Type | Rules |
| :--- | :--- | :--- |
| `evaluatorOptimizer.generatorNodeIds` | `string[]` | ≥1; must reference existing agent (or allowed step) nodes |
| `evaluatorOptimizer.evaluatorNodeIds` | `string[]` | ≥1; must reference existing nodes |
| `evaluatorOptimizer.maxIterations` | `number` | Integer 1–10; default 3 |
| `evaluatorOptimizer.passBranch` | `string` | Must match a condition branchKey that exits loop toward success/output |
| `evaluatorOptimizer.failBranch` | `string` | Feedback branch back toward generator |
| `evaluatorOptimizer.exhaustionOutcome` | `"fail" \| "exit_path"` | Default `exit_path` on scaffolds |
| `evaluatorOptimizer.exhaustionBranch?` | `string` | Required when outcome is `exit_path`; must be wired to a terminal path |

### Autonomous swarm (`category: "autonomous-swarm"`)

| Field | Type | Rules |
| :--- | :--- | :--- |
| `swarm.maxHops` | `number` | Integer ≥1; required; suggested max 20 (clamp in types) |
| `swarm.maxDepth` | `number` | Integer ≥1; required |
| `swarm.maxActivePeerTasks` | `number` | Integer ≥1; must be ≤ platform concurrency budget |
| `swarm.terminationBranch?` | `string` | Optional explicit exit branch key |

**Invariants**
- Hierarchical fields ignored (dormant) when category ≠ hierarchical (same pattern as today when switching to linear).
- EO/swarm nested objects required when category matches; absent → specific validation errors, not silent defaults that disable safety.

---

## 3. WorkflowNodeType (extended)

Existing: `agent` | `tool` | `approval` | `memory` | `condition` | `input` | `output`

**Added**

| Type | Role |
| :--- | :--- |
| `parallel_split` | Fan-out boundary; one logical input → N specialist lanes |
| `parallel_join` | Fan-in boundary; join policy + aggregated carrier |
| `subgraph` | Nested reusable workflow reference + I/O mappings |

---

## 4. Node configs

### ParallelSplitNodeConfig

| Field | Type | Notes |
| :--- | :--- | :--- |
| `label?` | `string` | Display |
| `branchKeys?` | `string[]` | Optional explicit lane ids; else derived from outgoing edge ids/targets |

### ParallelJoinNodeConfig

| Field | Type | Notes |
| :--- | :--- | :--- |
| `joinPolicy` | `"all_success" \| "partial_allowed"` | Default `all_success` |
| `requiredBranchKeys?` | `string[]` | Defaults to all incoming lanes |
| `branchTimeoutMs?` | `number` | Optional per-join timeout budget |

**Join result carrier (runtime)**
```ts
{
  branches: Record<string, unknown>;      // successful lane outputs keyed by source/lane
  failed?: Record<string, { code: string; message: string }>;
  timedOut?: string[];                    // lane keys
  partial: boolean;                       // true when joinPolicy allowed incomplete success set
}
```

Under `all_success`, presence of any required failure/timeout fails the join (fail closed)—carrier may still be attached to the error/diagnostics for observability.

### SubgraphNodeConfig

| Field | Type | Notes |
| :--- | :--- | :--- |
| `workflowId` | `string` | Referenced saved workflow |
| `label?` | `string` | Canvas label |
| `inputMappings` | `SubgraphFieldMapping[]` | Parent → child input |
| `outputMappings` | `SubgraphFieldMapping[]` | Child output → parent |

```ts
interface SubgraphFieldMapping {
  source: string; // path or key in parent state / child output
  target: string; // child input key / parent destination key
  required?: boolean; // default true for listed mappings
}
```

**Invariants**
- Missing required mapping → `SUBGRAPH_MAPPING_INVALID`.
- Unresolvable `workflowId` → `SUBGRAPH_REF_MISSING`.
- Reference cycles / depth > `MAX_SUBGRAPH_DEPTH` (3) → `SUBGRAPH_NESTING_UNSAFE` / `SUBGRAPH_DEPTH_EXCEEDED`.

---

## 5. Relationships

```text
WorkflowDefinition
  ├── archetype / archetypeConfig
  │     ├── evaluatorOptimizer?  (when EO)
  │     └── swarm?               (when swarm)
  ├── nodes[]
  │     ├── parallel_split ──out──► specialist subgraphs / agents
  │     ├── specialists ──in──► parallel_join
  │     └── subgraph ──references──► WorkflowDefinition (by workflowId)
  └── edges[]  (normal | conditional + branchKey)
```

---

## 6. Runtime / Live progress entities

| Entity | Key fields | Purpose |
| :--- | :--- | :--- |
| Loop iteration progress | `nodeId`, `current`, `max`, `phase` (`generate` \| `evaluate` \| …) | EO Live chrome |
| Parallel branch progress | `splitNodeId`, `branchKey`/`nodeId`, `status` | Scatter-gather Live |
| Subgraph frame | `parentNodeId`, `workflowId`, `depth`, `status` | Nested enter/exit |

These are event payloads projected onto the canvas; they are not separate persisted tables for MVP (run event log already stores events).

---

## 7. State transitions

### Evaluator-optimizer run

`generate` → `evaluate` → (`pass` → success path) | (`fail` & iterations < max → `generate`) | (`fail` & iterations ≥ max → exhaustion outcome)

### Parallel join

`waiting` → (`all required success` → `completed`) | (`required failure/timeout` & `all_success` → `failed`) | (`partial_allowed` & deadline → `completed_partial`)

### Subgraph node

`entered` → child run (`running`) → `exited` | `failed`

### Swarm

`peer_active` → handoff (hop++) → … → `terminated` (natural) | `ceiling_reached`

---

## 8. Validation rules (summary)

| Rule | Applies |
| :--- | :--- |
| No cycles | `linear-pipeline` (unchanged); parallel does not introduce cycles |
| Designated EO feedback only | `evaluator-optimizer` |
| Hub + guards | `hierarchical-supervisor` (unchanged) |
| Fan-out width ≤ concurrency budget | Any graph with `parallel_split` |
| Explicit join policy | Every `parallel_join` |
| Explicit mappings + depth | Every `subgraph` |
| Required swarm ceilings | `autonomous-swarm` |
| Fail closed on blocking issues | All archetypes before Run |

---

## 9. Compatibility

- Saved workflows with only the two original archetypes load unchanged.
- Unknown new node types on old clients: treat as validation/display degradation—server rejects run if node type unsupported by runtime version (fail closed).
- Dormant config retention on archetype switch follows feature 010 patterns (preserve EO/swarm blobs when switching away where practical).
