---
description: "Task list for Project & Workspace Lists and Dashboards"
---

# Tasks: Project & Workspace Lists and Dashboards

**Input**: Design documents from `/specs/001-project-workspace-dashboards/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Not requested in the feature specification â€” no TDD/contract-test tasks included. Add later if desired.

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

**Purpose**: Align branch/docs and confirm extension points before schema work

- [x] T001 Confirm feature docs are complete under `specs/001-project-workspace-dashboards/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md) and note target branch name `001-project-workspace-dashboards`
- [x] T002 [P] Inventory existing Studio wiring touchpoints in `apps/server/src/api/studio.ts`, `src/studio/contracts.ts`, `src/studio/infrastructure/postgres-studio-store.ts`, `src/studio/infrastructure/in-memory-studio-store.ts`, and `apps/web` header/nav (`AppHeader` or equivalent) for Projects/Workspaces links

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, contracts, and store APIs that ALL user stories depend on

**âš ï¸ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Add migration `infrastructure/studio/migrations/007_projects_workspaces.sql` creating `studio_projects` and `studio_workspaces` (fields: `id`, `tenant_id`, `name` 1â€“200 chars after trim, `description`, `status` enum `active|retired` default `active`, `settings` jsonb default `{}`, `created_at`, `updated_at`, `owner_id`) with indexes `(tenant_id, status, updated_at DESC)` and `(tenant_id, name)`
- [x] T004 Extend migration `infrastructure/studio/migrations/007_projects_workspaces.sql` to backfill per-tenant default active Workspace named `Default Workspace` and Project named `Default Project`, add `studio_tasks.workspace_id`, backfill existing tasks, set `workspace_id NOT NULL`, create `studio_task_projects` (`PRIMARY KEY (task_id, project_id)`, columns `tenant_id`, `task_id`, `project_id`) with indexes `(tenant_id, project_id)` and `(tenant_id, task_id)`, and backfill one junction row per existing task to the default project
- [x] T005 Update `src/studio/infrastructure/migrate.ts` column expectations for `studio_projects`, `studio_workspaces`, `studio_task_projects`, and `studio_tasks.workspace_id`
- [x] T006 [P] Add `StudioProject` and `StudioWorkspace` types plus `StudioTask.workspaceId: string` and `StudioTask.projectIds: string[]` (min length 1) in `src/studio/contracts.ts`; keep `StudioWorkspaceImport` unchanged for package import/export
- [x] T007 Extend `StudioStore` in `src/studio/contracts.ts` with project/workspace list/get/save/retire (or status update) methods and task association helpers (list tasks by project/workspace; read/write `projectIds` via junction)
- [x] T008 Implement project/workspace/task-association persistence in `src/studio/infrastructure/postgres-studio-store.ts` (tenant-scoped queries; decode/save `workspace_id` + junction `projectIds`)
- [x] T009 [P] Mirror the same store behavior in `src/studio/infrastructure/in-memory-studio-store.ts`
- [x] T010 Add lazy default ensure helper (at least one active project and workspace per tenant) used by list/create-task paths in `apps/server/src/api/studio/` service layer (new shared helper module or inside project/workspace entity services)

**Checkpoint**: Foundation ready â€” user story implementation can now begin

---

## Phase 3: User Story 1 - Browse projects and workspaces in dedicated lists (Priority: P1) ðŸŽ¯ MVP

**Goal**: Signed-in users can open Projects and Workspaces lists, see tenant-scoped entities, and navigate to a detail URL for each item

**Independent Test**: Seed or use backfilled defaults; open `/projects` and `/workspaces`; verify items for the current tenant only; selecting an item navigates to `/projects/{id}` or `/workspaces/{id}` (placeholder page acceptable until US3/US4)

### Implementation for User Story 1

- [x] T011 [P] [US1] Implement `ProjectService.list` / `get` (filter `status=active` by default; support `status=all|retired`) in `apps/server/src/api/studio/projectService.ts`
- [x] T012 [P] [US1] Implement `WorkspaceEntityService.list` / `get` with the same status filter rules in `apps/server/src/api/studio/workspaceEntityService.ts`
- [x] T013 [US1] Register `GET /projects` and `GET /projects/:id` in `apps/server/src/api/studio/projectRoutes.ts` and wire into `apps/server/src/api/studio.ts` (principal-required, tenant 404)
- [x] T014 [US1] Register `GET /workspaces` and `GET /workspaces/:id` in `apps/server/src/api/studio/workspaceEntityRoutes.ts` and wire into `apps/server/src/api/studio.ts` without changing package routes in `workspaceRoutes.ts` (`GET /workspace`, `POST /workspace/import`)
- [x] T015 [P] [US1] Add Next BFF proxies for project list/get under `apps/web/src/app/api/projects/` mirroring tasks/execution principal pattern
- [x] T016 [P] [US1] Add Next BFF proxies for workspace list/get under `apps/web/src/app/api/workspaces/`
- [x] T017 [US1] Build Projects list page with empty state in `apps/web/src/app/(authenticated)/projects/page.tsx` (show at least `name` and stable `id`)
- [x] T018 [P] [US1] Build Workspaces list page with empty state in `apps/web/src/app/(authenticated)/workspaces/page.tsx`
- [x] T019 [US1] Add stub detail routes `apps/web/src/app/(authenticated)/projects/[projectId]/page.tsx` and `apps/web/src/app/(authenticated)/workspaces/[workspaceId]/page.tsx` that load entity identity (full dashboards in US3/US4)
- [x] T020 [US1] Add Projects and Workspaces nav links in the authenticated header component used by Studio (locate `AppHeader` under `apps/web/src/`)

**Checkpoint**: US1 independently testable â€” lists + navigation work with backfilled/seeded data

---

## Phase 4: User Story 2 - Associate each task with one workspace and one or more projects (Priority: P1)

**Goal**: Creating/editing a task requires exactly one workspace and at least one project; associations appear on task views

**Independent Test**: Create/edit tasks with valid and invalid associations; invalid saves blocked with clear messages; valid tasks appear under linked project and workspace when queried

### Implementation for User Story 2

- [x] T021 [US2] Enforce on create/save/patch in `apps/server/src/api/studio/taskService.ts`: required `workspaceId`; `projectIds` array min length 1 (deduped); referenced workspace/projects must be same-tenant and `status=active`; reject with clear 400 messages
- [x] T022 [US2] Persist `workspaceId` and `projectIds` through store save/list/get paths already added in Phase 2; ensure decode always returns `projectIds` (never omit after migration)
- [x] T023 [US2] Update web task types/helpers (e.g. `apps/web/src/lib/taskStatus.ts` and task board API mapping in `apps/web/src/lib/taskBoard.ts` or equivalent) to include `workspaceId` and `projectIds`
- [x] T024 [US2] Add workspace selector + multi-project selector to task create/edit UI under `apps/web/src/app/(authenticated)/tasks/` (and related components), blocking submit when workspace missing or `projectIds` empty
- [x] T025 [US2] Surface workspace and linked project(s) on task board cards/detail views under `apps/web/src/app/(authenticated)/tasks/` (FR-019)

**Checkpoint**: US2 independently testable â€” task association validation and UI complete

---

## Phase 5: User Story 3 - Project dashboard for related work and configuration (Priority: P2)

**Goal**: Project detail shows related tasks, related workspaces (derived from tasks), and editable configuration (`name`, `description`, `settings`)

**Independent Test**: Open a project with known linked tasks/workspaces; verify related sections and config edit persist; empty sections show empty states

### Implementation for User Story 3

- [x] T026 [US3] Implement `GET /projects/:id/dashboard` in `apps/server/src/api/studio/projectService.ts` + `projectRoutes.ts` returning `{ project, tasks, relatedWorkspaces }` per `specs/001-project-workspace-dashboards/contracts/studio-projects-workspaces.openapi.yaml` (related workspaces = distinct active `workspaceId`s from linked tasks; omit retired by default)
- [x] T027 [US3] Implement `PATCH /projects/:id` for `name` (1â€“200), `description`, and `settings` in `apps/server/src/api/studio/projectService.ts` + `projectRoutes.ts`
- [x] T028 [P] [US3] Add BFF routes for project dashboard and patch under `apps/web/src/app/api/projects/`
- [x] T029 [US3] Replace project stub with full dashboard UI in `apps/web/src/app/(authenticated)/projects/[projectId]/page.tsx` (sections: related tasks, related workspaces, configuration; empty/error/retry states)

**Checkpoint**: US3 independently testable â€” project dashboard complete

---

## Phase 6: User Story 4 - Workspace dashboard for related work and configuration (Priority: P2)

**Goal**: Workspace detail shows related tasks, related projects (derived from tasks), and editable configuration

**Independent Test**: Open a workspace with known tasks/projects; verify sections and config edit; empty states when none

### Implementation for User Story 4

- [x] T030 [US4] Implement `GET /workspaces/:id/dashboard` in `apps/server/src/api/studio/workspaceEntityService.ts` + `workspaceEntityRoutes.ts` returning `{ workspace, tasks, relatedProjects }` per OpenAPI contract (related projects derived from task `projectIds`; omit retired by default)
- [x] T031 [US4] Implement `PATCH /workspaces/:id` for `name` (1â€“200), `description`, and `settings` in `apps/server/src/api/studio/workspaceEntityService.ts` + `workspaceEntityRoutes.ts`
- [x] T032 [P] [US4] Add BFF routes for workspace dashboard and patch under `apps/web/src/app/api/workspaces/`
- [x] T033 [US4] Replace workspace stub with full dashboard UI in `apps/web/src/app/(authenticated)/workspaces/[workspaceId]/page.tsx` (related tasks, related projects, configuration; empty/error/retry states)

**Checkpoint**: US4 independently testable â€” workspace dashboard complete

---

## Phase 7: User Story 5 - Create and maintain projects and workspaces (Priority: P3)

**Goal**: Authorized tenant members can create, rename, and retire projects/workspaces; retired entities leave default active lists and cannot receive new task assignments

**Independent Test**: Create â†’ appears in list + has dashboard; rename â†’ reflected in list/dashboard/task views; retire â†’ hidden from default list and blocked on new task assignment

### Implementation for User Story 5

- [x] T034 [P] [US5] Implement `POST /projects` (required `name` 1â€“200; optional `description`, `settings`) and `POST /projects/:id/retire` (idempotent `active â†’ retired`) in `apps/server/src/api/studio/projectService.ts` + `projectRoutes.ts`
- [x] T035 [P] [US5] Implement `POST /workspaces` and `POST /workspaces/:id/retire` (same rules) in `apps/server/src/api/studio/workspaceEntityService.ts` + `workspaceEntityRoutes.ts`
- [x] T036 [US5] Ensure task association validation (T021) rejects retired workspace/project ids on create/update in `apps/server/src/api/studio/taskService.ts`
- [x] T037 [P] [US5] Add BFF proxies for create/retire under `apps/web/src/app/api/projects/` and `apps/web/src/app/api/workspaces/`
- [x] T038 [US5] Add create/rename/retire actions on Projects list and project dashboard in `apps/web/src/app/(authenticated)/projects/` (default list shows `active` only)
- [x] T039 [US5] Add create/rename/retire actions on Workspaces list and workspace dashboard in `apps/web/src/app/(authenticated)/workspaces/`
- [x] T040 [US5] Refresh task selectors so retired entities are excluded from assignable options under `apps/web/src/app/(authenticated)/tasks/`

**Checkpoint**: US5 independently testable â€” lifecycle management complete

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Consistency, regressions, and validation across stories

- [x] T041 [P] Verify package import/export still works via existing `apps/server/src/api/studio/workspaceRoutes.ts` and web import callers (no path change to `/studio/workspace`)
- [x] T042 [P] Update product docs that describe Studio navigation/entities (e.g. `docs/architecture.md` and/or `docs/README.md`) to mention Projects/Workspaces lists and dashboards vs workspace package
- [x] T043 Run end-to-end validation scenarios from `specs/001-project-workspace-dashboards/quickstart.md` against local `pnpm dev:all` (lists, associations, both dashboards, retire, cross-tenant isolation)
- [x] T044 [P] Confirm typecheck clean for touched packages (`npx tsc --noEmit`, `pnpm --filter server build` / `pnpm --filter web build` as applicable)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies â€” start immediately
- **Foundational (Phase 2)**: Depends on Setup â€” **BLOCKS** all user stories
- **US1 (Phase 3)**: After Foundational â€” MVP
- **US2 (Phase 4)**: After Foundational; benefits from US1 nav but independently testable via API
- **US3 (Phase 5)**: After Foundational; needs US2 associations for meaningful related-task data (can show empty sections without US2)
- **US4 (Phase 6)**: After Foundational; same relationship to US2 as US3
- **US5 (Phase 7)**: After Foundational; ideally after US1 lists exist for UI actions
- **Polish (Phase 8)**: After desired stories complete

### User Story Dependencies

- **US1 (P1)**: No dependency on other stories (uses migration backfill/defaults)
- **US2 (P1)**: No hard dependency on US1; integrate with task UI independently
- **US3 (P2)**: Extends project detail from US1 stub; richer with US2 data
- **US4 (P2)**: Extends workspace detail from US1 stub; richer with US2 data
- **US5 (P3)**: Extends US1 lists/dashboards with lifecycle actions; enforces retire rules with US2 validation

### Within Each User Story

- Services before routes
- Routes before BFF
- BFF before UI pages
- Story complete before treating checkpoint as done

### Parallel Opportunities

- T006 âˆ¥ T003â€“T005 (types vs migration files)
- T008 then T009 (Postgres first, in-memory can parallelize after interface settles)
- T011 âˆ¥ T012 (project vs workspace entity list services)
- T015 âˆ¥ T016 (BFF proxies)
- T017 âˆ¥ T018 (list pages)
- T026â€“T029 vs T030â€“T033 (US3 âˆ¥ US4 after Foundational + preferably US2)
- T034 âˆ¥ T035 (create/retire APIs)
- T038 âˆ¥ T039 (lifecycle UI)
- T041 âˆ¥ T042 âˆ¥ T044 (polish)

---

## Parallel Example: User Story 1

```bash
# After Foundational completes, launch list services in parallel:
Task: "Implement ProjectService.list/get in apps/server/src/api/studio/projectService.ts"
Task: "Implement WorkspaceEntityService.list/get in apps/server/src/api/studio/workspaceEntityService.ts"

# Then BFF proxies in parallel:
Task: "Add BFF proxies under apps/web/src/app/api/projects/"
Task: "Add BFF proxies under apps/web/src/app/api/workspaces/"

# Then list pages in parallel:
Task: "Build Projects list in apps/web/src/app/(authenticated)/projects/page.tsx"
Task: "Build Workspaces list in apps/web/src/app/(authenticated)/workspaces/page.tsx"
```

---

## Parallel Example: User Stories 3 & 4

```bash
# Dashboard backends in parallel (different files):
Task: "GET /projects/:id/dashboard in projectService.ts + projectRoutes.ts"
Task: "GET /workspaces/:id/dashboard in workspaceEntityService.ts + workspaceEntityRoutes.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL)
3. Complete Phase 3: User Story 1 (lists + nav + stub detail)
4. **STOP and VALIDATE**: Open `/projects` and `/workspaces`, confirm tenant isolation and navigation
5. Demo MVP

### Incremental Delivery

1. Setup + Foundational â†’ store/schema ready
2. US1 â†’ Lists MVP
3. US2 â†’ Task associations (unlocks meaningful dashboards)
4. US3 â†’ Project dashboard
5. US4 â†’ Workspace dashboard
6. US5 â†’ Create/rename/retire lifecycle
7. Polish â†’ quickstart + docs + package regression

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Then:
   - Developer A: US1 â†’ US5 UI lifecycle
   - Developer B: US2 task associations
   - Developer C: US3 + US4 dashboards
3. Integrate at checkpoints; run quickstart.md

---

## Notes

- [P] = different files, no dependencies on incomplete sibling tasks
- Do not rename or break `/studio/workspace` package import/export
- Name entity modules `workspaceEntity*` to avoid clashing with existing `workspaceService` / `workspaceRoutes`
- Prefer soft-retire over hard delete (v1)
- Related projectâ†”workspace sets are derived from tasks only (no explicit link table)
- Commit after each task or logical group; stop at any checkpoint to validate independently


---

## Phase 9: Convergence

**Purpose**: Close remaining gaps between implemented code and spec/plan/tasks after `/speckit-implement`

- [x] T045 Require `workspaceId` and non-empty `projectIds` on task create in `apps/server/src/api/studio/taskService.ts` (reject with clear 400; do not silently assign tenant defaults) per FR-007, US2/AC2, SC-003 (contradicts)
- [x] T046 Replace raw workspace/project id inputs in `apps/web/src/components/tasks/detail/TaskFields.tsx` with active-only workspace select and multi-project checkboxes matching `CreateTaskModal` per FR-019, T024 (partial)
- [x] T047 Resolve and display workspace and project names (not truncated ids) on task board cards in `apps/web/src/components/tasks/TaskCard.tsx` per FR-019 (partial)
- [x] T048 Gate Projects/Workspaces list empty states on successful load and add Retry in `apps/web/src/app/(authenticated)/projects/page.tsx` and `apps/web/src/app/(authenticated)/workspaces/page.tsx` per FR-018 (partial)
- [x] T049 Add rename actions on Projects and Workspaces list pages in `apps/web/src/app/(authenticated)/projects/page.tsx` and `apps/web/src/app/(authenticated)/workspaces/page.tsx` per US5/AC2, T038 (partial)
- [x] T050 Add dedicated Jest coverage in `tests/studioProjectsWorkspaces.test.ts` for project/workspace CRUD, dashboards, retire blocking task assignment, and tenant isolation per plan: tests touch-point (missing)

---

## Phase 10: Convergence

**Purpose**: Close remaining gaps between implemented code and spec/plan/tasks after Phase 9

- [x] T051 Allow task edit to replace retired project associations: show stuck retired project ids in `TaskFields` (removable) and accept updates that submit at least one active project (strip/replace retired ids) in `taskService` update path per Edge case (all linked projects retired), US2/AC3 (partial)
- [x] T052 Block task edit Save when workspace is cleared or all projects unchecked in `useTaskDraft` / task detail UI (do not omit empty associations so the server silently keeps prior links) per US2/AC2, T024 (partial)
