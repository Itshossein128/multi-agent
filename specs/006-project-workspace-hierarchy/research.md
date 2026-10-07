# Research: Organization → Project → Workspace Hierarchy

**Feature**: `006-project-workspace-hierarchy`  
**Date**: 2026-10-07

## R1 — Organization entity vs today`s tenant UUID

**Decision**: Keep `tenant_id` as the isolation key. Add a first-class **Organization profile** row (`studio_organizations`) with `id = tenant_id`, plus name, description, and config JSON. The post-signup wizard creates that row for the signed-in user`s tenant and records the user as owner. Authenticated product routes redirect to the wizard until the profile exists. Do **not** rename or replace the existing agent goals API at `/studio/organization` (goals/reporting); expose profile under `/studio/organizations`.

**Rationale**: Signup already provisions a private `tenant_id` (`apps/web/src/app/register/actions.ts`). Spec needs name/description/config and a forced first-run gate, not a second tenancy system. Separating profile routes from goals avoids breaking the organization goals UI.

**Alternatives considered**:
- Replace `tenant_id` with a new org id everywhere — rejected (massive cross-cutting migration).
- Store org metadata only on `studio_users` — rejected (org is tenant-scoped, not user-scoped; future multi-member orgs need a tenant-level row).
- Reuse `/studio/organization` for profile CRUD — rejected (collides with goals/reporting payloads and UX).

## R2 — Project owns Workspace (hierarchy)

**Decision**: Add required `project_id` on `studio_workspaces`. List/create workspaces only under a project (`/projects/{projectId}/workspaces` and keep `/workspaces/{id}` for get/patch/retire/dashboard). Project dashboards list owned workspaces directly (not derived from tasks).

**Rationale**: Spec hierarchy is Organization → Project → (optional) Workspace → Task. Feature 001 treated projects and workspaces as tenant peers linked only via tasks; that cannot express default-workspace semantics or per-project workspace isolation.

**Alternatives considered**:
- Keep peers and add `studio_project_workspaces` link table — rejected (spec says each workspace belongs to exactly one project).
- Nest workspace ids under project without FK — rejected (weak integrity).

## R3 — Single project per task; optional explicit workspace

**Decision**:
- Replace `projectIds: string[]` / `studio_task_projects` with required `project_id` on `studio_tasks`.
- Make `workspace_id` **nullable**: `NULL` means the task runs in the project`s **default workspace** (implicit).
- Once a project has ≥1 active explicit workspace, require `workspace_id` on new/updated tasks and validate it belongs to that project and is active.
- Migration: for each task, set `project_id` to the first linked project (stable order by `project_id`); drop junction after backfill. Tasks whose workspace is the tenant-level “Default Workspace” and whose project has no other workspaces yet may be remapped to `workspace_id = NULL` when that default row is retired/removed as part of hierarchy cutover (see R4).

**Rationale**: Matches FR-023/FR-024 and supersedes 001 FR-005–007. Nullable FK is the clean representation of “no explicit workspace row.”

**Alternatives considered**:
- Keep multi-project junction and ignore extras — rejected (spec forbids multi-project tasks).
- Sentinel workspace id `"default"` string — rejected (conflicts with real ids; harder FK integrity).
- Always materialize a Default workspace row — rejected (FR-012: default must not appear as a listed entity).

## R4 — Implicit default workspace and materialization

**Decision**:
- While a project has **zero** active explicit workspaces, do not insert a workspace row. Tasks use `workspace_id = NULL`. Dashboard/UI shows the project as the working area.
- Durable default-workspace files are keyed by `(tenant_id, project_id, workspace_key='default')` in storage metadata (see R7), not by a workspace row id.
- On **first** explicit workspace create in that project: in one transaction, (1) insert an explicit workspace named `"Default"` with no setting overrides and all current project repositories, (2) reassign tasks with `workspace_id IS NULL` for that project to the new Default id, (3) rekey default storage metadata to the new workspace id, (4) insert the user-requested workspace.
- Stop lazily creating tenant-wide “Default Project” / “Default Workspace” via `tenantDefaults` for new flows; migration may retire or re-home legacy default rows.

**Rationale**: Implements FR-011–FR-013 and FR-017 without listing a phantom workspace.

**Alternatives considered**:
- Soft-hidden `is_default` workspace row always present — rejected (still a DB entity; easy to leak into lists).
- Copy-on-write only when files exist — still need materialization of task FKs when first explicit workspace appears; full materialization is simpler and matches SC-008.

## R5 — Settings inheritance and overrides

**Decision**: Project `settings` remains the canonical JSON object. Explicit workspaces store `settings_overrides` (sparse JSON of overridden keys only). Effective settings = deep-merge project settings ← overrides. API responses include `effectiveSettings` and `overriddenKeys[]`. Clearing an override deletes that key from `settings_overrides`. **Repository membership is not** an inherited settings key (see R6).

**Rationale**: Matches FR-015b (follow project until overridden; clear override resumes following). Sparse overrides avoid snapshot drift.

**Alternatives considered**:
- Full settings copy at workspace create — rejected (project later changes would not flow).
- Per-key `{ value, source }` rows — heavier than needed for v1 JSON settings.

## R6 — Project / workspace repositories

**Decision**: New tables:
- `studio_project_repositories` — attached repos (name, source locator, default branch, status).
- `studio_workspace_repositories` — explicit workspace membership (subset of project repos) + chosen branch.

Default workspace has no membership rows; it always exposes all active project repositories (FR-011, FR-021). Adding a repo to a project does **not** insert into existing `studio_workspace_repositories`. Removing a project repo with dirty workspace state requires a confirm flag on the API (`confirmDiscardChanges: true`).

**Rationale**: Spec separates repo membership from other inherited settings; explicit membership table makes “not auto-added to existing workspaces” enforceable.

**Alternatives considered**:
- Encode repos only inside `settings` JSON — weaker integrity and harder dirty-change checks.
- Workspace may reference repos from other projects — rejected (assumption: one project per workspace).

## R7 — Durable workspace working copies

**Decision**: Persist working copies on the execution server filesystem under a configured root (`STUDIO_WORKSPACE_STORAGE_ROOT`), path shape `{tenantId}/{projectId}/{workspaceId|default}/{repoId}/`, plus a `studio_workspace_repo_states` metadata table (branch, last_synced_at, has_uncommitted_changes, availability). Agent/task execution resolves the path for the task`s effective workspace. No automatic push to origin.

**Rationale**: Spec requires survival across client disconnects; self-hosted Studio already runs Node on a durable host. Metadata enables warnings (FR-022, unreachable repo, missing branch) without scanning git every list call.

**Alternatives considered**:
- Object-storage tarballs only — deferred (worse for live agent file IO).
- Per-user browser storage — rejected (not durable across devices; agents run server-side).
- Always-on git worktrees with no metadata table — insufficient for “unavailable” and confirm-discard UX.

## R8 — Name derivation and placeholders

**Decision**: Add `name_source: 'placeholder' | 'derived' | 'manual'` on projects and workspaces. Create allows omitted/empty name → store placeholder (`"Untitled project"` / `"Untitled workspace"`). On first task create in that entity, if `name_source === 'placeholder'`, set name from trimmed/truncated task title (max 120), apply duplicate suffix within parent (` (2)`, ` (3)`, …), set `name_source = 'derived'`. Any explicit rename or non-empty name at create sets `name_source = 'manual'` and never auto-changes. Concurrent first tasks: use a conditional update (`WHERE name_source = 'placeholder'`) so exactly one wins.

**Rationale**: FR-007–009, FR-016, FR-028–029 and edge cases.

**Alternatives considered**:
- Null name until first task — poorer list UX (placeholder is required by assumptions).
- Re-derive when first task title edits — rejected by FR-029.

## R9 — Migration strategy from feature 001

**Decision**: Single new migration (next studio number, e.g. `017_project_workspace_hierarchy.sql`) that:
1. Creates `studio_organizations` and backfills a minimal profile for every distinct `tenant_id` that already has users/projects/tasks (so existing users skip the wizard).
2. Adds `project_id` to workspaces; backfills by majority task project link (fallback: first active project in tenant, or create `"Migrated"` project).
3. Adds `project_id` to tasks from first junction row; then drops `studio_task_projects`.
4. Adds `name_source`, `settings_overrides`, repo/state tables.
5. For projects that only use the legacy tenant Default Workspace and have no other workspaces: set those tasks` `workspace_id` to NULL and retire/delete the orphaned default workspace row when safe; otherwise attach the legacy workspace under the project as an explicit workspace (prefer NULL path when the workspace name is the seeded Default and only one project is involved).

**Rationale**: Spec assumption: multi-project tasks keep first-linked project. Existing tenants must not be forced through the wizard (FR-004).

**Alternatives considered**:
- Big-bang delete of 001 data — rejected.
- Dual-read old and new schemas indefinitely — rejected (YAGNI; one migration cutover).

## R10 — Web UX surfaces

**Decision**:
- Forced wizard route (e.g. `/onboarding/organization`) gated from authenticated layout when `GET /organizations/current` returns 404.
- Projects list empty state + inline project create in task form.
- Nest workspace management under project dashboard; global `/workspaces` list becomes project-grouped or filtered by project (prefer project-scoped primary UX; keep deep links `/workspaces/[id]`).
- Task form: required project; workspace selector only when project has explicit workspaces.

**Rationale**: Matches user stories P1–P3 without abandoning 001 navigation entirely.

## R11 — Authorization

**Decision**: Continue tenant isolation via `RequestPrincipal.tenantId`. Organization owner is the wizard creator (`owner_id`). Reuse existing org-member = same tenant; owners/admins semantics stay “any authenticated tenant member may create projects/workspaces/tasks” unless a later roles feature tightens this (per spec assumptions).

**Rationale**: FR-030; no new RBAC subsystem in this feature.

## Resolved clarifications

All Technical Context items resolved from repository inspection and 001 artifacts. No remaining NEEDS CLARIFICATION blockers for Phase 1 design.
