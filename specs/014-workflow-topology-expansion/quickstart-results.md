# Quickstart Results: Expanded Workflow Topology Support

**Feature**: `014-workflow-topology-expansion`  
**Date**: 2026-11-04  
**Environment**: automated Jest + types build (manual Studio smoke deferred where noted)

## Automated gates

| Gate | Result |
| :--- | :---: |
| `tests/topologyValidation.test.ts` | PASS |
| `tests/workflowCompilerTopology.test.ts` | PASS |
| `tests/runCanvasProjectionTopology.test.ts` | PASS |
| `tests/workflowArchetypeConversion.test.ts` | PASS |
| `@multi-agent/types` build | PASS |

## Success criteria mapping

| Criterion | Evidence | Status |
| :--- | :--- | :---: |
| SC-001 Create/run EO + scatter-gather + nested patterns | Validation + compiler coverage for scaffolds/join/subgraph fail-closed; nested runner wired via `createStudioSubgraphRunner` when `studioStore` present | PASS (auto) / Manual Studio pending |
| SC-002 Invalid configs rejected with specific codes | Topology validation suite covers EO/parallel/subgraph/swarm codes | PASS |
| SC-003 Live iteration/branch/subgraph progress | `topologyHints` projection + inspector loop/subgraph chrome | PASS (auto) |
| SC-004 Legacy linear/hierarchical remain valid | Conversion regression suite + hierarchical hub still required | PASS |
| SC-005 New archetype scaffolds validate | EO/swarm scaffold tests | PASS |
| SC-006 Over-budget fan-out blocked | `PARALLEL_BRANCH_LIMIT_EXCEEDED` tests | PASS |

## Manual Studio smoke (T065)

Run against `pnpm run dev` when available:

1. Create Evaluator-Optimizer → scaffold validates → run fail-then-pass + ceiling  
2. Linear + parallel split/join three specialists → Live branch chrome  
3. Parent with subgraph mapping → nested run (requires studioStore-backed executor)  
4. Autonomous Swarm create → ceilings present; remove bounds → blocked  
5. Open pre-existing linear + hierarchical → validate/run unchanged  

Record operator initials/date here when completed:

- [ ] Manual smoke completed by: ________  Date: ________
