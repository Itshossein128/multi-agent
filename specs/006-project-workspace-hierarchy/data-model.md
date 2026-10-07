# Data Model: Organization → Project → Workspace Hierarchy

**Feature**: `006-project-workspace-hierarchy`  
**Date**: 2026-10-07

## Entities

### OrganizationProfile

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | Equals `tenant_id` |
| `name` | string | yes | 1–120 chars after trim |
| `description` | string | yes | May be empty |
| `config` | object | yes | Wizard/basic prefs; default `{}` |
| `ownerId` | string | yes | Creating user |
| `createdAt` | string (ISO) | yes | |
| `updatedAt` | string (ISO) | yes | |

**Validation**: Name required; wizard blocked until valid. Existing tenants backfilled during migration so they skip the wizard.

**State**: Created once per tenant in v1 (additional orgs out of scope).

### StudioProject (extended)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | |
| `tenantId` | string | yes | = organization id |
| `name` | string | yes | Placeholder, derived, or manual |
| `nameSource` | `placeholder` \| `derived` \| `manual` | yes | Controls auto-rename |
| `description` | string | yes | |
| `status` | `active` \| `retired` | yes | |
| `settings` | object | yes | Canonical inherited settings |
| `createdAt` / `updatedAt` | string | yes | |
| `ownerId` | string | yes | |

**Validation**: Name length ≤ 120; retired projects reject new tasks; duplicate display names allowed but derived names get suffixes within the organization.

**State transitions**: `active → retired` (idempotent).

### StudioWorkspace (extended — explicit only)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | |
| `tenantId` | string | yes | |
| `projectId` | string | yes | Parent project (same tenant) |
| `name` | string | yes | |
| `nameSource` | `placeholder` \| `derived` \| `manual` | yes | |
| `description` | string | yes | |
| `status` | `active` \| `retired` | yes | |
| `settingsOverrides` | object | yes | Sparse overrides only; default `{}` |
| `createdAt` / `updatedAt` | string | yes | |
| `ownerId` | string | yes | |

**Not stored**: The project’s **default workspace** (implicit). Represented by absence of active explicit workspaces + `task.workspaceId = null`.

**Validation**: Belongs to one project; retiring last active workspace blocked while active tasks reference it (FR-027); at least one repo in membership when explicit (FR-015).

**State transitions**: `active → retired`. On first explicit create in a project that was default-only, system also inserts `"Default"` (see lifecycle below).

### ProjectRepository

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | yes | |
| `tenantId` | string | yes | |
| `projectId` | string | yes | |
| `name` | string | yes | Display name |
| `source` | string | yes | Locator (URL or integration id) |
| `defaultBranch` | string | yes | e.g. `main` |
| `status` | `active` \| `unavailable` \| `removed` | yes | |
| `createdAt` / `updatedAt` | string | yes | |

No product-imposed count limit (FR-021a).

### WorkspaceRepositoryMembership

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `workspaceId` | string | yes | Explicit workspace only |
| `projectRepositoryId` | string | yes | Must belong to same project |
| `branch` | string | yes | Defaults to repo `defaultBranch` if omitted at insert |
| `createdAt` / `updatedAt` | string | yes | |

Default workspace: no rows; effective membership = all active project repositories.

### WorkspaceRepositoryState

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `tenantId` | string | yes | |
| `projectId` | string | yes | |
| `workspaceId` | string \| null | yes | `null` = default workspace key |
| `projectRepositoryId` | string | yes | |
| `branch` | string | yes | Checked-out / intended branch |
| `storagePath` | string | yes | Relative path under storage root |
| `hasUncommittedChanges` | boolean | yes | |
| `availability` | `ready` \| `unavailable` \| `branch_missing` | yes | |
| `updatedAt` | string | yes | |

### StudioTask (association changes)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `projectId` | string | yes | Exactly one project (replaces `projectIds`) |
| `workspaceId` | string \| null | conditional | `null` only when project has no active explicit workspaces |

**Removed**: `projectIds` / `studio_task_projects`.

**Validation**:
- Always require active `projectId` in same tenant.
- If project has active explicit workspaces → require active `workspaceId` under that project.
- If project has none → force `workspaceId = null` (ignore client-sent ids or reject non-null).

## Relationships

```text
OrganizationProfile (id = tenant_id)
  1──* StudioProject
         1──* ProjectRepository
         1──* StudioWorkspace (explicit only)
         1──* StudioTask
                └── optional workspaceId → StudioWorkspace
         StudioWorkspace 1──* WorkspaceRepositoryMembership → ProjectRepository
         (tenant, project, workspaceId|null, repo) → WorkspaceRepositoryState
```

## Lifecycle: default → explicit

```text
[Project, 0 explicit WS]
  tasks.workspace_id = NULL
  files keyed workspaceId=null
        │
        │ first POST workspace
        ▼
[Transaction]
  create Workspace name="Default", overrides={}, all project repos
  UPDATE tasks SET workspace_id = Default.id WHERE project_id=? AND workspace_id IS NULL
  rekey storage null → Default.id
  create requested Workspace (+ membership)
```

## Name derivation

```text
create without name → name_source=placeholder
first task (conditional UPDATE name_source=placeholder)
  → trim/truncate title → dedupe suffix in parent → name_source=derived
manual rename / named create → name_source=manual (never auto again)
```

## Persistence (Postgres)

Suggested migration: `infrastructure/studio/migrations/017_project_workspace_hierarchy.sql`

- `studio_organizations`
- Alter `studio_projects`: `name_source`
- Alter `studio_workspaces`: `project_id`, `name_source`, `settings_overrides` (keep `settings` only if needed for back-compat read; prefer overrides column)
- Alter `studio_tasks`: add `project_id`, nullable `workspace_id`; backfill; drop `studio_task_projects`
- `studio_project_repositories`, `studio_workspace_repositories`, `studio_workspace_repo_states`
- Indexes: `(tenant_id, project_id)` on workspaces/tasks/repos; unique `(workspace_id, project_repository_id)`

## In-memory store

Mirror all tables/maps; same service validation path as Postgres.

## Authorization

- All reads/writes filtered by `principal.tenantId`
- Cross-tenant ids → 404
- Wizard: only when no `studio_organizations` row for tenant
