# Phase 0.5 Data Model

**Plan**: [plan.md](./plan.md)

**No schema change.** No migration files are added; tables `studio_organization_goals`, `studio_tasks`,
`studio_trigger_events`, and `studio_projects` are used as defined by studio migrations 001–017.
The program-level target model is unchanged: [../data-model.md](../data-model.md).

## Transactional boundary (new, in code only)

| Concept | Definition |
|---------|-----------|
| `OrganizationUnitOfWork` | Runs one operation against a studio store and an organization store that share **one** database transaction (Postgres: one pooled client between `BEGIN` and `COMMIT`/`ROLLBACK`; in-memory: studio snapshot + organization snapshot). Unavailable when the two stores cannot share a transaction → `503` before any write. |
| Strategy proposal write set | `{ goal (status proposed, owner = CEO agent, projectId), task (assigned CEO, projectId, metadata.organizationGoalId, metadata.strategyProposal = true), task_assignment trigger event }` — all committed together or none. |
| Delegation write set | `{ task (projectId = effective project, metadata.organizationGoalId), task_assignment trigger event }` — existing `TaskService` transaction. |

## Validation rules

| Rule | Applies to | Result |
|------|-----------|--------|
| `projectId` present and non-blank | strategy | else `400` |
| Effective project = goal's project, else request `projectId`; request value must equal goal's when both exist | delegation | else `400` |
| Project visible through the caller's tenant-scoped store | strategy, delegation, goal create (when supplied) | else `404` (unknown and foreign indistinguishable) |
| Project `status = active` | same | else `409` |
| All validation completes before the first write | strategy, delegation | — |

## State transitions

Unchanged goal status machine (`proposed → active | cancelled`, `active → completed | cancelled`). The
strategy path no longer produces `cancelled` goals as a failure side effect.
