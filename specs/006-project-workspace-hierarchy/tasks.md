---
description: "Task list for Organization -> Project -> Workspace Hierarchy"
---

# Tasks: Organization -> Project -> Workspace Hierarchy

**Input**: Design documents from `/specs/006-project-workspace-hierarchy/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not requested in the feature specification - no TDD/contract-test tasks included. Add focused `tests/studioHierarchy*.test.ts` coverage later if desired. Polish phase includes quickstart validation and typecheck.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Studio contracts/store: `src/studio/`
- Migrations: `infrastructure/studio/migrations/`
- Server API: `apps/server/src/api/studio/`
- Web UI/BFF: `apps/web/src/app/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align docs, env, and extension points before schema work

- [x] T001 Confirm feature docs are complete under `specs/006-project-workspace-hierarchy/` (plan.md, spec.md, research.md, data-model.md, contracts/studio-hierarchy.openapi.yaml, quickstart.md) and note target branch name `006-project-workspace-hierarchy`
- [x] T002 [P] Inventory hierarchy touchpoints in `apps/server/src/api/studio.ts`, `src/studio/contracts.ts`, `apps/server/src/api/studio/taskService.ts`, `apps/server/src/api/studio/tenantDefaults.ts`, `apps/server/src/api/studio/projectService.ts`, `apps/server/src/api/studio/workspaceEntityRoutes.ts`, `apps/web/src/app/register/actions.ts`, and task UI under `apps/web/src/app/(authenticated)/tasks/`
- [x] T003 [P] Document `STUDIO_WORKSPACE_STORAGE_ROOT` in `.env.example` (writable server path for durable workspace working copies)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, contracts, and store APIs that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Add migration `infrastructure/studio/migrations/017_project_workspace_hierarchy.sql` creating `studio_organizations` (`id` = tenant_id, `name` 1-120 after trim, `description`, `config` jsonb default `{}`, `owner_id`, `created_at`, `updated_at`) and backfill a minimal profile for every distinct existing `tenant_id` with users/projects/tasks so migrated tenants skip the wizard
- [x] T005 Extend migration `017_project_workspace_hierarchy.sql` to: add `studio_workspaces.project_id` (NOT NULL after backfill) with index `(tenant_id, project_id)`; backfill workspace->project via majority/first task project link (fallback first active project or create `Migrated` project); add `name_source` (`placeholder|derived|manual`) on projects and workspaces; add `settings_overrides` jsonb default `{}` on workspaces; add `studio_tasks.project_id` from first `studio_task_projects` row then drop `studio_task_projects`; make `studio_tasks.workspace_id` nullable; for projects that only used seeded Default Workspace, set tasks to `workspace_id NULL` and retire/re-home orphaned default rows per research R9
- [x] T006 Extend migration `017_project_workspace_hierarchy.sql` to create `studio_project_repositories` (`id`, `tenant_id`, `project_id`, `name`, `source`, `default_branch`, `status` `active|unavailable|removed`, timestamps), `studio_workspace_repositories` (`workspace_id`, `project_repository_id`, `branch`, timestamps; unique `(workspace_id, project_repository_id)`), and `studio_workspace_repo_states` (`tenant_id`, `project_id`, nullable `workspace_id`, `project_repository_id`, `branch`, `storage_path`, `has_uncommitted_changes`, `availability` `ready|unavailable|branch_missing`, `updated_at`)
- [x] T007 Update `src/studio/infrastructure/migrate.ts` column expectations for `studio_organizations`, altered projects/workspaces/tasks, and the three repository/state tables
- [x] T008 [P] Update `src/studio/contracts.ts`: add `OrganizationProfile`; extend `StudioProject` with `nameSource` and optional `usesDefaultWorkspace`; extend `StudioWorkspace` with `projectId`, `nameSource`, `settingsOverrides`, `effectiveSettings`, `overriddenKeys`; change `StudioTask` to required `projectId: string` and nullable `workspaceId?: string | null` (remove `projectIds`); add `ProjectRepository`, membership, and repo-state types; keep `StudioWorkspaceImport` and package types unchanged
- [x] T009 Extend `StudioStore` in `src/studio/contracts.ts` with org profile get/create, project-scoped workspace list/create, repository CRUD/membership, repo-state read/write/rekey, and task helpers using `projectId` + nullable `workspaceId`
- [x] T010 Implement new/altered persistence in `src/studio/infrastructure/postgres-studio-store.ts` (tenant-scoped; nullable `workspace_id`; single `project_id`; org profile; repos; states)
- [x] T011 [P] Mirror the same store behavior in `src/studio/infrastructure/in-memory-studio-store.ts`
- [x] T012 [P] Add `src/studio/infrastructure/workspace-storage.ts` resolving paths under `STUDIO_WORKSPACE_STORAGE_ROOT` as `{tenantId}/{projectId}/{workspaceId|default}/{repoId}/` with ensure-dir helpers
- [x] T013 Stop or gate legacy tenant-wide Default Project/Workspace ensure in `apps/server/src/api/studio/tenantDefaults.ts` so new hierarchy flows do not reintroduce peer default entities; update any callers in `apps/server/src/api/studio/taskService.ts` and `apps/server/src/api/dashboard/dashboardService.ts` that still pass `projectIds`

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 - First-run organization setup wizard (Priority: P1) - MVP

**Goal**: New users with no organization profile are forced through a wizard that creates the org (name required 1-120, optional description/config); existing org members never see it

**Independent Test**: Register a brand-new user -> wizard opens and blocks other areas -> submit valid org -> land in org with empty Projects CTA; user with backfilled org skips wizard

### Implementation for User Story 1

- [x] T014 [P] [US1] Implement `OrganizationProfileService` get-current / create (409 if exists; name 1-120 after trim; description may be empty; config default `{}`; set `ownerId` to principal) in `apps/server/src/api/studio/organizationProfileService.ts`
- [x] T015 [US1] Register `GET /organizations/current` and `POST /organizations` in `apps/server/src/api/studio/organizationProfileRoutes.ts` and wire into `apps/server/src/api/studio.ts` without changing goals routes at `/organization`
- [x] T016 [P] [US1] Add Next BFF proxies under `apps/web/src/app/api/organizations/` for current + create
- [x] T017 [US1] Build forced wizard UI in `apps/web/src/app/(authenticated)/onboarding/organization/page.tsx` (required name, optional description/config; block continue on empty/overlong name with inline errors; keep in-session progress)
- [x] T018 [US1] Gate authenticated layout (e.g. `apps/web/src/app/(authenticated)/layout.tsx` or equivalent guard) so users without an org profile are redirected to the wizard and cannot reach other product areas until create succeeds; users with a profile never see the wizard
- [x] T019 [US1] After wizard success, navigate into the organization Projects empty state with clear CTA to create a project or create a task (`apps/web/src/app/(authenticated)/projects/page.tsx` empty copy)

**Checkpoint**: US1 independently testable - wizard + gate + org profile API work

---

## Phase 4: User Story 2 - Create a project directly or from the task form (Priority: P1)

**Goal**: Projects can be created from the list or inline in the task form; unnamed projects get placeholder then derive name from first task title; tasks require exactly one project and use the implicit default workspace when no explicit workspaces exist

**Independent Test**: In an org with no projects, create a task with inline unnamed project -> project named from task title, task linked, `workspaceId` null, Workspaces list empty for that project

### Implementation for User Story 2

- [x] T020 [US2] Update project create/patch in `apps/server/src/api/studio/projectService.ts` + `projectRoutes.ts`: omit/empty name -> placeholder `"Untitled project"` with `nameSource=placeholder`; non-empty create/rename -> `nameSource=manual`; name max length 120; expose `usesDefaultWorkspace` on get/list/dashboard
- [x] T021 [US2] Rewrite association rules in `apps/server/src/api/studio/taskService.ts`: require active same-tenant `projectId`; reject missing project with clear 400; when project has zero active explicit workspaces force `workspaceId=null`; when project has active workspaces require active `workspaceId` under that project; support inline `createProject` on task create; on first task in placeholder project, conditional rename from trimmed/truncated title (max 120) with duplicate suffix within organization (` (2)`, ...) and set `nameSource=derived` only if still `placeholder`
- [x] T022 [P] [US2] Update web task types/helpers (`apps/web/src/lib/taskStatus.ts`, `apps/web/src/lib/taskBoard.ts`, `apps/web/src/hooks/useTasksQuery.ts`, related components) from `projectIds[]` to single `projectId` and nullable `workspaceId`
- [x] T023 [US2] Update task create/edit UI under `apps/web/src/app/(authenticated)/tasks/` (e.g. `CreateTaskModal.tsx`, `TaskFields.tsx`): required project selector; inline create project (optional name); block save without project; hide workspace selector when selected project uses default workspace
- [x] T024 [US2] Update Projects list create flow in `apps/web/src/app/(authenticated)/projects/page.tsx` to allow creating without a name (shows Untitled placeholder) and keep empty-state CTAs from US1
- [x] T025 [P] [US2] Add/adjust BFF under `apps/web/src/app/api/projects/` and task APIs so payloads use `projectId` / nullable `workspaceId` per `specs/006-project-workspace-hierarchy/contracts/studio-hierarchy.openapi.yaml`

**Checkpoint**: US2 independently testable - project create + task association + name derivation work with default workspace

---

## Phase 5: User Story 3 - Multiple workspaces for parallel branches (Priority: P2)

**Goal**: Explicit workspaces belong to a project; first create materializes `"Default"`; settings inherit with sparse overrides; new tasks must pick an active workspace once any exist

**Independent Test**: On a project with default-workspace tasks, create two workspaces on different branches; confirm Default kept prior tasks; isolation between workspaces; task form requires workspace choice

### Implementation for User Story 3

- [x] T026 [US3] Implement project-scoped workspace list/create in `apps/server/src/api/studio/projectService.ts` / `workspaceEntityService.ts` + routes: `GET/POST /projects/:projectId/workspaces`; on first explicit create, transactionally materialize workspace named `"Default"` with empty `settingsOverrides`, membership of all current project repos, reassign `workspace_id IS NULL` tasks, rekey default storage to Default id, then create the requested workspace (return `materializedDefault` when applicable)
- [x] T027 [US3] Implement workspace get/patch/retire/dashboard in `apps/server/src/api/studio/workspaceEntityService.ts` + `workspaceEntityRoutes.ts`: compute `effectiveSettings` = project settings <- `settingsOverrides`; support `clearOverrideKeys`; omit/empty name -> `"Untitled workspace"` + `nameSource=placeholder`; first-task derivation same as projects within parent project; retire last active workspace blocked with 409 while tasks assigned (FR-027); keep package `/workspace` routes untouched
- [x] T028 [US3] Extend task create/patch validation in `apps/server/src/api/studio/taskService.ts` so once a project has >=1 active explicit workspace, `workspaceId` is required and must be active under that project; derive workspace name from first task when `nameSource=placeholder`
- [x] T029 [P] [US3] Add BFF routes for nested workspaces and workspace patch/retire/dashboard under `apps/web/src/app/api/projects/` and `apps/web/src/app/api/workspaces/`
- [x] T030 [US3] Update project dashboard UI in `apps/web/src/app/(authenticated)/projects/[projectId]/page.tsx` to list owned workspaces (or "using default workspace"), create workspace with optional name and per-repo branch choices, and show inherited vs overridden settings
- [x] T031 [US3] Update workspace dashboard UI in `apps/web/src/app/(authenticated)/workspaces/[workspaceId]/page.tsx` for config overrides, clear-override, and branch display; update task form to require workspace when project has explicit workspaces
- [x] T032 [P] [US3] Adjust global workspaces list in `apps/web/src/app/(authenticated)/workspaces/page.tsx` to be project-grouped or clearly scoped (deep links to `/workspaces/[id]` remain)

**Checkpoint**: US3 independently testable - explicit workspaces, Default materialization, inheritance, task gating

---

## Phase 6: User Story 4 - Multi-repository projects with durable workspaces (Priority: P2)

**Goal**: Attach multiple repos to a project; configure per-workspace membership/branches; persist working copies across disconnects; warn on remove when dirty

**Independent Test**: Attach three repos; one workspace with one repo and one with all three; interrupt session and reopen - uncommitted changes still present; add repo to project does not auto-add to existing workspaces

### Implementation for User Story 4

- [x] T033 [US4] Implement project repository list/attach/remove in `apps/server/src/api/studio/projectService.ts` + `projectRoutes.ts` (`GET/POST /projects/:id/repositories`, `DELETE .../repositories/:repoId`); on attach, default workspace (no explicit WSs) sees repo immediately; existing explicit workspaces unchanged; delete returns 409 unless `confirmDiscardChanges: true` when any workspace/repo state has `hasUncommittedChanges`
- [x] T034 [US4] Implement `PUT /workspaces/:id/repositories` membership replace (min one repo, all must belong to parent project; omitted branch -> repo `defaultBranch`) in `apps/server/src/api/studio/workspaceEntityService.ts` + routes
- [x] T035 [US4] Wire durable clone/checkout and dirty tracking via `src/studio/infrastructure/workspace-storage.ts` + store repo-state methods so task/agent work in a workspace writes under the resolved path and sets `hasUncommittedChanges`; mark `availability` `unavailable` / `branch_missing` without discarding existing files
- [x] T036 [P] [US4] Add BFF proxies for project repositories and workspace repository put under `apps/web/src/app/api/projects/` and `apps/web/src/app/api/workspaces/`
- [x] T037 [US4] Add repository management UI on project dashboard `apps/web/src/app/(authenticated)/projects/[projectId]/page.tsx` (list by name/source, add/remove with confirm when dirty)
- [x] T038 [US4] Add workspace repo membership/branch editor and dirty/unavailable indicators on `apps/web/src/app/(authenticated)/workspaces/[workspaceId]/page.tsx`; ensure reopen shows current repos/branches/changed files

**Checkpoint**: US4 independently testable - multi-repo membership + durability + remove confirmation

---

## Phase 7: User Story 5 - Navigate the hierarchy (Priority: P3)

**Goal**: Users can move Organization -> Project -> Workspace/Task and back; tasks show project and explicit workspace links; switching organization context shows only that org's data (tenant boundary)

**Independent Test**: From a task follow links to workspace (if any) and project; project view shows children; second tenant never sees first tenant's entities

### Implementation for User Story 5

- [x] T039 [US5] Ensure task views/board cards under `apps/web/src/app/(authenticated)/tasks/` show linked `projectId` and optional `workspaceId` as navigable links (FR-025)
- [x] T040 [US5] Ensure project dashboard `apps/web/src/app/(authenticated)/projects/[projectId]/page.tsx` shows workspaces (or default-workspace indicator), repositories, and tasks with working parent/child navigation
- [x] T041 [P] [US5] Verify tenant isolation on org/project/workspace/repo endpoints (cross-tenant id -> 404 / empty lists) in service/route handling under `apps/server/src/api/studio/`; fix any leaks found during hierarchy changes
- [x] T042 [US5] Align authenticated nav/sidebar (`apps/web/src/components/layout/AppSidebar.tsx` or header) so hierarchy entry points (Projects, project-scoped Workspaces) remain discoverable without exposing other tenants' data

**Checkpoint**: US5 independently testable - hierarchy navigation + isolation

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Call-site cleanup, regressions, and validation across stories

- [x] T043 [P] Sweep remaining `projectIds` / multi-project UI assumptions across `apps/web` and `apps/server` (dashboard, organization goals task creation, tests helpers) to single `projectId`
- [x] T044 [P] Confirm package import/export still works via `apps/server/src/api/studio/workspaceRoutes.ts` (`GET /workspace`, `POST /workspace/import`) and goals API via existing organization routes
- [x] T045 Run validation scenarios from `specs/006-project-workspace-hierarchy/quickstart.md` (wizard, inline project, Default materialization, multi-repo, inheritance, disconnect, isolation)
- [x] T046 Run root/server typecheck (`tsc --noEmit`), relevant Jest suites, and `git diff --check`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - start immediately
- **Foundational (Phase 2)**: Depends on Setup - **BLOCKS all user stories**
- **US1 (Phase 3)**: After Foundational - MVP org gate
- **US2 (Phase 4)**: After Foundational; benefits from US1 empty Projects CTA but can use a backfilled org
- **US3 (Phase 5)**: After Foundational; needs US2 project/task association model in practice
- **US4 (Phase 6)**: After US3 workspace create/materialization (repos attach to projects earlier, but membership UX needs workspaces)
- **US5 (Phase 7)**: After US2-US4 surfaces exist to link
- **Polish (Phase 8)**: After desired stories complete

### User Story Dependencies

- **US1 (P1)**: No dependency on other stories - MVP
- **US2 (P1)**: Independent of US1 if org already exists (migration backfill); with US1 completes first-run -> first task path
- **US3 (P2)**: Builds on US2 project + task model
- **US4 (P2)**: Builds on US3 explicit workspaces
- **US5 (P3)**: Cross-cutting navigation over US2-US4 entities

### Within Each User Story

- Services before routes before BFF before UI
- Core validation before optional UX polish
- Story complete before next priority when staffing is sequential

### Parallel Opportunities

- T002/T003 in Setup
- T008/T011/T012 in Foundational (after contracts/store interface shaped)
- T014/T016 in US1; T022/T025 in US2; T029/T032 in US3; T036 in US4; T041 in US5
- T043/T044 in Polish

---

## Parallel Example: User Story 1

```bash
# After Foundational completes:
Task: "Implement OrganizationProfileService in apps/server/src/api/studio/organizationProfileService.ts"
Task: "Add Next BFF proxies under apps/web/src/app/api/organizations/"
# Then sequentially: routes wire -> wizard page -> layout gate -> empty Projects CTA
```

## Parallel Example: User Story 2

```bash
# After taskService association rewrite starts:
Task: "Update web task types from projectIds to projectId in apps/web/src/lib/taskStatus.ts (and related)"
Task: "Add/adjust BFF project/task payloads under apps/web/src/app/api/projects/"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL)
3. Complete Phase 3: User Story 1 (wizard + gate)
4. **STOP and VALIDATE**: New user cannot bypass wizard; existing tenants skip it
5. Demo if ready

### Incremental Delivery

1. Setup + Foundational -> schema/contracts ready
2. US1 -> org onboarding MVP
3. US2 -> projects + tasks on default workspace
4. US3 -> explicit workspaces + Default materialization
5. US4 -> repos + durable copies
6. US5 -> navigation polish
7. Polish -> regressions + quickstart

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Then:
   - Dev A: US1
   - Dev B: US2 (after T008-T013 contracts/store)
   - Dev C: prepare US3 workspace service against store APIs
3. US4 after US3 create/materialization lands; US5 last

---

## Notes

- [P] tasks = different files, no dependencies on incomplete sibling tasks
- [Story] label maps task to US1-US5 for traceability
- Spec supersedes `001` task-association rules; keep package `/studio/workspace` and goals `/studio/organization` unchanged
- Name max length 120; placeholders `"Untitled project"` / `"Untitled workspace"`; Default materialization name exactly `"Default"`
- Commit after each task or logical group; stop at checkpoints to validate independently

---

## Phase 9: Convergence

**Purpose**: Close remaining gaps between `spec.md` / `plan.md` / prior tasks and the current codebase (assessed 2026-10-07).

- [x] T047 CRITICAL Implement durable workspace working copies (clone/checkout into `STUDIO_WORKSPACE_STORAGE_ROOT` paths) and route task/agent file I/O to those isolated directories so changes in one workspace never appear in another per FR-019, FR-020, SC-005, SC-006 (missing)
- [x] T048 CRITICAL Wire `markWorkspaceRepoDirty` (and availability updates) from agent/file-write and sync paths in `apps/server/src/api/studio/workspaceRepoStateService.ts` so `hasUncommittedChanges` and `unavailable`/`branch_missing` reflect real working-copy state per FR-020 (missing)
- [x] T049 Harden `OrganizationGate` in `apps/web/src/components/layout/OrganizationGate.tsx` (and layout/shell if needed) to fail closed: do not render non-onboarding product UI when org profile is missing or the probe errors, per FR-001 and US1/AC3 (partial)
- [x] T050 Change task create UI in `apps/web/src/components/tasks/CreateTaskModal.tsx` and `TaskFields.tsx` to defer inline project creation via task-body `createProject` until task save so canceling the form creates no project per Edge "Inline project creation abandoned" and FR-006 (contradicts)
- [x] T051 Add per-repository branch selection at workspace create time on `apps/web/src/app/(authenticated)/projects/[projectId]/page.tsx` (and create payload `repositories[]`) per FR-015 and US3/AC2 (missing)
- [x] T052 Implement remote/branch probing that sets workspace repo `availability` to `unavailable` or `branch_missing` without discarding stored files per Edge "Repository access lost" / "Branch missing" and FR-020 (missing)
- [x] T053 Make first-task name derivation atomic (conditional update where `name_source = 'placeholder'`) in `apps/server/src/api/studio/projectService.ts` / task create path so concurrent first tasks yield a single winner per Edge "Concurrent first tasks" and FR-029 (partial)
- [x] T054 Update project repository remove UI on `apps/web/src/app/(authenticated)/projects/[projectId]/page.tsx` to honor 409 discard confirmation before sending `confirmDiscardChanges: true` per FR-022 (partial)
- [x] T055 Use task create `createProject` payload for unnamed inline projects so the project is named from the task title at save time per FR-008 (partial)
- [x] T056 Surface changed-file inventory (not only a dirty badge) on `apps/web/src/app/(authenticated)/workspaces/[workspaceId]/page.tsx` when reopening a workspace per US4/AC5 and FR-020 (partial)
- [x] T057 [P] Add optional organization configuration fields to the wizard in `apps/web/src/app/(authenticated)/onboarding/organization/page.tsx` (with sensible defaults) per FR-002 (partial)
