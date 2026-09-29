# Research: Project & Workspace Lists and Dashboards

**Feature**: `001-project-workspace-dashboards`  
**Date**: 2026-09-29

## R1 — First-class Workspace vs existing `/studio/workspace` package API

**Decision**: Introduce a new tenant-scoped **Workspace entity** with routes under `/studio/workspaces` (plural). Keep `GET /studio/workspace` and `POST /studio/workspace/import` as the **workspace package** (workflows + agents + tools) API without renaming in v1.

**Rationale**: Current “workspace” is an import/export bundle, not an entity with identity, status, or task ownership. Spec requires list + dashboard + task FK. Colliding with the singular package path would break existing web import flows.

**Alternatives considered**:
- Repurpose `/studio/workspace` to mean the entity — rejected (breaking change to package export shape).
- Rename package API to `/studio/package` in the same change — deferred (extra migration of web clients; can be a follow-up).

## R2 — Project entity storage

**Decision**: New `studio_projects` table + `StudioProject` contract; tenant-scoped like tasks; soft-retire via `status: active | retired`.

**Rationale**: No Project entity exists today (memory “project” scope is unrelated). Projects need identity, config fields, and many-to-many task links.

**Alternatives considered**:
- Encode projects only in task `metadata` — rejected (cannot power reliable lists/dashboards or validation).
- Nest projects under workspaces only — rejected (spec allows a task’s projects to span views; projects are peer entities, with related workspaces derived from tasks).

## R3 — Task association model

**Decision**:
- `studio_tasks.workspace_id` — required NOT NULL after backfill (exactly one workspace).
- `studio_task_projects(task_id, project_id, tenant_id)` — junction; at least one row per task enforced in service layer (and DB check/trigger or app validation).
- Expose on `StudioTask` as `workspaceId: string` and `projectIds: string[]`.

**Rationale**: Matches FR-005/FR-006; junction supports multi-project tasks and efficient “tasks for project” queries.

**Alternatives considered**:
- Single `project_id` only — rejected (spec requires one or more projects).
- JSON array column `project_ids` on tasks — workable but weaker referential integrity; junction preferred for Postgres CASCADE/retire checks.
- Explicit `studio_project_workspaces` link table — deferred (YAGNI; derive related sets from tasks per spec assumptions).

## R4 — Migration / backfill for existing tasks

**Decision**: Migration creates, per distinct `tenant_id` that has tasks (and optionally all tenants with users), a default active Workspace (`name: "Default Workspace"`) and default active Project (`name: "Default Project"`), then sets every existing task’s `workspace_id` and inserts one junction row. New tenants get defaults lazily on first project/workspace list access or first task create (service ensures at least one active of each exists before requiring associations).

**Rationale**: Spec requires associations for every task; fail-closed validation without backfill would break existing boards.

**Alternatives considered**:
- Leave columns nullable indefinitely — rejected (violates FR-005/006).
- Hard-fail until operators manually assign — rejected (poor upgrade UX).

## R5 — Related entities on dashboards

**Decision**: Compute related workspaces for a project as distinct `workspace_id` values from tasks linked to that project; compute related projects for a workspace as distinct project ids from tasks in that workspace. Omit retired entities from default related lists (or mark unavailable).

**Rationale**: Spec assumption; avoids maintaining a second source of truth.

**Alternatives considered**: Explicit M:N project–workspace table — deferred until product needs links without tasks.

## R6 — Configuration scope on dashboards

**Decision**: v1 configuration = entity fields: `name`, `description`, optional `settings` JSON for future keys (empty object default). Editable on dashboard by any authenticated tenant member (same authorization bar as task mutate today). No billing/credentials/vault in this feature.

**Rationale**: Spec scopes config to identity/operational settings; Studio today has no richer project/workspace settings model.

**Alternatives considered**: Full settings subsystem — out of scope.

## R7 — Web navigation and pages

**Decision**: Add authenticated routes `/projects`, `/projects/[projectId]`, `/workspaces`, `/workspaces/[workspaceId]`; link from `AppHeader` alongside Tasks. Task board forms gain workspace selector + multi-project selector. BFF routes under `apps/web/src/app/api/projects` and `.../workspaces` proxy to execution `/studio/*` with principal assertion (same pattern as tasks).

**Rationale**: Matches existing Next authenticated app layout and execution BFF pattern.

**Alternatives considered**: Nest under `/org/projects` — possible but Projects/Workspaces are peer to Tasks in the spec (operational surfaces), so top-level authenticated routes are clearer.

## R8 — API & service layering

**Decision**: Mirror `taskService` / `taskRoutes`: `projectService` + `projectRoutes`, `workspaceEntityService` + `workspaceEntityRoutes`; register on studio Hono app. Extend `StudioStore` with list/get/save/retire (or status update) for both entities and helpers to list tasks by project/workspace and list related ids.

**Rationale**: Consistency with existing Studio architecture; both Postgres and in-memory stores stay in lockstep.

**Alternatives considered**: Implement only in web localStorage — rejected (not tenant-durable; contradicts Studio persistence).

## R9 — Naming collision in code

**Decision**: Keep `WorkspaceService` / `workspaceRoutes` for package import/export. Name first-class entity modules `workspaceEntityService` / `workspaceEntityRoutes` (or `studioWorkspace*` if preferred at implement time). Domain type: `StudioWorkspace` for the entity; package type remains `StudioWorkspaceImport`.

**Rationale**: Minimizes risky renames while making intent clear in code review.

## R10 — Pagination

**Decision**: v1 lists return full tenant-scoped collections ordered by `updated_at DESC` with a documented soft cap expectation; add `limit`/`cursor` query params in contracts as optional extension if counts grow. Dashboards page related tasks with the same ordering and optional limit (e.g. 100) plus “view all on task board filtered” later.

**Rationale**: Spec allows “pagination or equivalent”; current task list has no pagination — stay consistent first, extend when needed.

## Resolved clarifications

All Technical Context items resolved from repository inspection; no remaining NEEDS CLARIFICATION blockers for design.
