# Contract: Organization Strategy, Delegation, and Goal Project Validation (Phase 0.5)

Server base path `/studio` (execution server); browser access via `/api/execution/studio/...` (BFF, unchanged).
Authentication: signed internal principal (unchanged). Role permissions are out of scope until Phase 2.

## POST /studio/organization/strategy

Request:

```json
{ "title": "string (1-200)", "brief": "string (1-4000)", "projectId": "string (required)" }
```

| Outcome | Status | Body | Side effects |
|---------|--------|------|--------------|
| Success | 201 | `{ "goal": OrganizationGoal, "task": StudioTask }` | goal + task + assignment event committed atomically |
| Missing/blank title, brief, or `projectId`; non-object body | 400 | `{ "error": string }` | none |
| No CEO agent configured | 409 | `{ "error": "Configure a CEO agent before requesting strategy" }` | none |
| CEO agent not visible | 404 | `{ "error": "CEO agent not found" }` | none |
| Project unknown or not in caller's tenant | 404 | `{ "error": "Project not found" }` | none |
| Project retired | 409 | `{ "error": "Project is retired" }` | none |
| Atomic writes unavailable (mis-wired stores) | 503 | `{ "error": "Atomic organization operations are not configured" }` | none |
| Storage failure during the transaction | non-2xx (currently 400 via global mapping, G-AZ-8) | `{ "error": string }` | **none** — no goal, task, or event persists |

Change vs. today: `projectId` was optional with a first-active-project fallback; failures could leave a
`proposed` goal (400) or a `cancelled` goal (task failure).

## POST /studio/organization/goals/:id/delegate

Request:

```json
{ "agentId": "string (required)", "title": "string (optional)", "parentTaskId": "string|null (optional)", "projectId": "string (optional; required when the goal has no project)" }
```

| Outcome | Status | Notes |
|---------|--------|-------|
| Success | 201 | `StudioTask` with `projectId` = effective project, `metadata.organizationGoalId` |
| Goal has no project and `projectId` absent | 400 | `projectId is required` |
| Goal has a project and `projectId` differs | 400 | `projectId must match the goal's project` |
| Project unknown/foreign | 404 | `Project not found` |
| Project retired | 409 | `Project is retired` |
| Existing errors (goal not found 404, not active 409, agent not found 400, reporting-chain 403) | unchanged | |

Change vs. today: no fallback to the first active project.

## POST /studio/organization/goals

`projectId` remains optional. When supplied: unknown/foreign → **404** (was 400 `Project not found`);
retired → **409** (was accepted). All other behavior unchanged.

## Unchanged

`GET /studio/organization`, `PUT /studio/organization/agents/:id`, `PATCH /studio/organization/goals/:id`,
all budget and organization-profile routes.
