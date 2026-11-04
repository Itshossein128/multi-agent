# Quickstart: Expanded Workflow Topology Support

**Feature**: `014-workflow-topology-expansion`  
**Purpose**: Validate the feature end-to-end after implementation—without embedding full test suites here.

See also: [data-model.md](./data-model.md), [contracts/workflow-topology.schema.json](./contracts/workflow-topology.schema.json), [contracts/topology-validation.codes.md](./contracts/topology-validation.codes.md), [contracts/ui-topology-controls.contract.ts](./contracts/ui-topology-controls.contract.ts).

---

## Prerequisites

- Repo dependencies installed (`pnpm install`)
- Types buildable (`pnpm run build:types` or `pnpm --filter @multi-agent/types build`)
- For manual Studio checks: `pnpm run dev` (web + server), an org/project with ≥2 saved workflows (parent + child subroutine), and API agents usable as generator/evaluator/specialists

---

## 1. Automated gates (primary)

```bash
# Topology validation + compiler behavior (names may match tasks.md once generated)
pnpm test --runInBand tests/topologyValidation.test.ts
pnpm test --runInBand tests/workflowCompilerTopology.test.ts

# Regressions for existing archetypes
pnpm test --runInBand --testPathPattern='validation|archetype|workflowCompiler'
```

**Expect**

- EO: designated feedback loop allowed; unrelated cycles → `EVALUATOR_OPTIMIZER_CYCLE_INVALID`; ceiling exhaustion takes configured outcome; iteration events emitted
- Parallel: 3-lane scatter-gather within budget succeeds; 9-lane (if budget 8) → `PARALLEL_BRANCH_LIMIT_EXCEEDED` at validate; `all_success` fails closed on branch failure; `partial_allowed` returns explicit failed/timedOut maps
- Subgraph: mapped child run succeeds; missing mapping / missing ref / depth overflow rejected with `SUBGRAPH_*` codes; enter/exit events present
- Swarm: missing bounds rejected; hop ceiling terminates; hierarchical fixtures still pass unchanged
- Linear + hierarchical fixtures from prior suites still green

---

## 2. Typecheck / build

```bash
pnpm exec tsc --noEmit
pnpm --filter @multi-agent/types build
pnpm --filter server build
pnpm --filter web build
```

**Expect**: clean compile with extended `WorkflowArchetypeCategory`, node types, and event unions.

---

## 3. Manual Studio smoke

### A. Evaluator-optimizer

1. **New workflow** → select **Evaluator-Optimizer** → confirm scaffold validates (Run not blocked solely by empty structure).
2. Bind/configure generator + evaluator agents; set ceiling to `3`, exhaustion `exit_path`.
3. Run a prompt that fails once then passes → Live shows iteration progress; run succeeds on pass path.
4. Force perpetual fail → after ceiling, exhaustion path (or fail) observed; no further looping.
5. Add an unrelated cycle → Validate shows specific EO error (not only generic cycle forbidden).

### B. Scatter-gather

1. On a linear (or allowed) workflow, add **Parallel Split** → three specialist agents → **Parallel Join** (`all_success`) → aggregator → output.
2. Validate/save; Run → Live shows three branch statuses then join complete.
3. Temporarily add a 9th concurrent lane (or lower test budget) → validation blocks with limit message.
4. Switch join to `partial_allowed`, fail one specialist → aggregator receives explicit partial attribution.

### C. Nested subgraph

1. Save a small valid child workflow (“research subroutine”).
2. In a parent workflow, add **Sub-workflow**, select child, map required inputs/outputs.
3. Run parent → Live shows subgraph enter/exit; parent continues with mapped outputs.
4. Clear a required mapping → Validate blocks with mapping error; clear workflowId → missing ref error.

### D. Autonomous swarm

1. **New workflow** → **Autonomous Swarm** → scaffold validates with ceilings present.
2. Run a short peer handoff that terminates → success with observable termination.
3. Remove ceilings or craft unbounded peer loop → Validate rejects before Run.

### E. Backward compatibility

1. Open a pre-existing **Linear Pipeline** and **Hierarchical Supervisor** workflow.
2. Validate + smoke Run → both succeed without mandatory edits.

---

## 4. Success checklist (maps to SC-001–SC-006)

| Check | Pass? |
| :--- | :---: |
| EO + scatter-gather + nested parent each create/save/run without cycle dead-ends | |
| Invalid loop/nest/peer/over-budget configs blocked before execution with specific codes | |
| Live shows iteration, parallel branches, subgraph enter/exit | |
| Legacy linear + hierarchical still validate/run | |
| New archetype create → scaffold initial validation passes | |
| Over-budget fan-out rejected; at-budget accepted | |

---

## Notes

- Concurrency budget defaults to **8** (`maxConcurrentBranches`); honor whatever the active platform guardrail is in the environment under test.
- Subgraph v1 resolves **latest saved** child definition at validate/run.
- Full implementation task breakdown: `/speckit-tasks` → `tasks.md`.
