# Data Model: Project & Workspace Lists and Dashboards

**Feature**: `001-project-workspace-dashboards`  
**Date**: 2026-09-29

## Entities

### StudioProject

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Stable id (uuid or studio id scheme) |
| `tenantId` | string | yes | Organization/tenant boundary |
| `name` | string | yes | Display name; non-empty; trimmed |
| `description` | string | yes | May be empty string |
| `status` | `active` \| `retired` | yes | Default `active` |
| `settings` | object | yes | Opaque JSON; default `{}` |
| `createdAt` | string (ISO) | yes | |
| `updatedAt` | string (ISO) | yes | |
| `ownerId` | string | yes | Creating user |

**Validation**:
- Name length 1–200 after trim
- Cannot assign new tasks to `retired` projects
- Retire is idempotent; rename allowed while `active` (and optionally while `retired` for clarity — prefer rename only when `active`)

**State transitions**:
```text
[created] → active → retired
```
No delete in v1 (retire only) to preserve task history; hard delete out of scope.

### StudioWorkspace (entity)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | |
| `tenantId` | string | yes | |
| `name` | string | yes | |
| `description` | string | yes | |
| `status` | `active` \| `retired` | yes | Default `active` |
| `settings` | object | yes | Default `{}` |
| `createdAt` | string (ISO) | yes | |
| `updatedAt` | string (ISO) | yes | |
| `ownerId` | string | yes | |

**Validation**: Same name rules as project; cannot assign new tasks to `retired` workspaces.

**State transitions**: `active → retired` (idempotent).

**Note**: Distinct from `StudioWorkspaceImport` (package of workflows/agents/tools).

### StudioTask (extensions)

Existing fields unchanged. New required fields after migration:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `workspaceId` | string | yes | FK → `studio_workspaces.id` same tenant |
| `projectIds` | string[] | yes | Min length 1; each FK → `studio_projects.id` same tenant |

**Validation**:
- `workspaceId` must reference an **active** workspace on create/update
- Every `projectIds` entry must reference an **active** project on create/update
- Dedupe `projectIds`
- Reject empty `projectIds` with clear API error

### StudioTaskProject (junction — persistence only)

| Field | Type | Notes |
|-------|------|-------|
| `tenant_id` | string | |
| `task_id` | string | FK tasks |
| `project_id` | string | FK projects |
| Primary key | `(task_id, project_id)` | |

## Relationships

```text
Tenant 1──* Project
Tenant 1──* Workspace
Workspace 1──* Task
Project *──* Task   (via studio_task_projects)
Project dashboard related Workspaces := distinct task.workspaceId for tasks linked to project
Workspace dashboard related Projects := distinct projectIds for tasks in workspace
```

## Persistence (Postgres)

### `studio_projects`

- Columns mirror entity; indexes: `(tenant_id, status, updated_at DESC)`, `(tenant_id, name)`
- Unique optional: none on name in v1 (duplicate names allowed; id disambiguates)

### `studio_workspaces`

- Same shape/indexes as projects

### `studio_tasks`

- Add `workspace_id text NOT NULL` after backfill
- Index: `(tenant_id, workspace_id, updated_at DESC)`

### `studio_task_projects`

- `PRIMARY KEY (task_id, project_id)`
- Indexes: `(tenant_id, project_id)`, `(tenant_id, task_id)`
- FK behavior: ON DELETE CASCADE from task; project retire does not delete junction rows (historical link); UI filters retired

### Migration `007_projects_workspaces.sql`

1. Create projects + workspaces tables  
2. Backfill defaults per tenant  
3. Add `workspace_id`, backfill, set NOT NULL  
4. Create junction + backfill default project  
5. Update migrate.ts column expectations  

## In-memory store

Mirror tables with Maps; enforce same validation in services (single validation path preferred in `projectService` / `workspaceEntityService` / `taskService`).

## Authorization

- List/get/mutate: require principal; filter by `tenantId` (same as tasks)
- Cross-tenant id access → 404 (no existence leak beyond tenant)
