# Implementation Plan: Project & Workspace Lists and Dashboards

**Branch**: `001-project-workspace-dashboards` | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-project-workspace-dashboards/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Introduce first-class **Project** and **Workspace** entities in Studio so users can browse them in dedicated lists, open dashboards (related tasks, cross-linked entities, configuration), and require every task to belong to exactly one workspace and one or more projects. Today tasks are flat tenant-scoped records and “workspace” only means import/export of workflows/agents/tools — this plan adds new persistence, `/studio` APIs (plural routes), and web list/dashboard pages while preserving the existing package import/export endpoints under `/studio/workspace`.

## Technical Context

**Language/Version**: TypeScript 5.7 (Node execution server + Next.js 16 web)

**Primary Dependencies**: Hono (studio API), Next.js 16 / React 19 / TanStack Query (web), `@multi-agent/types`, existing Studio store + auth principal (`userId`/`tenantId`)

**Storage**: PostgreSQL via `infrastructure/studio/migrations` + `PostgresStudioStore` / `InMemoryStudioStore`; new tables `studio_projects`, `studio_workspaces`, `studio_task_projects`; `studio_tasks.workspace_id`

**Testing**: Jest (root / server contract & service tests), Playwright e2e (`apps/web`), typecheck via `tsc`

**Target Platform**: Self-hosted Studio web app + execution server (Windows/Linux Node hosts)

**Project Type**: Monorepo web application (Next.js BFF + Hono execution API + shared Studio contracts)

**Performance Goals**: List and dashboard payloads usable for typical org sizes (hundreds of projects/workspaces, thousands of tasks); list pages load primary data within interactive UI expectations (~2s on local/dev)

**Constraints**: Tenant isolation mandatory; preserve existing `/studio/workspace` import/export API; fail closed on missing task associations after migration backfill; no silent store fallback

**Scale/Scope**: Two list pages, two dashboard pages, task create/edit association fields, CRUD/retire for projects & workspaces, one migration + store/API/UI surface area within existing Studio module

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the Spec Kit placeholder (no project-specific ratified principles). Applying **de facto Studio gates** derived from existing architecture:

| Gate | Status | Notes |
|------|--------|-------|
| Tenant-scoped access for Studio list/get/mutate | PASS | Match tasks pattern (`tenant_id` filtering via `RequestPrincipal`) |
| No silent postgres ↔ in-memory fallback | PASS | Extend `StudioStore` interface; both adapters implement new methods |
| Prefer evolving Studio contracts over parallel models | PASS | Extend `StudioTask` + store; avoid duplicate task DTOs |
| Keep existing import/export workspace package API | PASS | New entity uses `/studio/workspaces` (plural); package stays `/studio/workspace` |
| Testable services + store before UI-only work | PASS | Plan includes store/service/contract tests |
| YAGNI: no explicit project↔workspace link table in v1 | PASS | Derive related entities from task associations (per spec assumptions) |

**Gate result**: PASS (no unjustified violations). Complexity Tracking left empty.

### Post–Phase 1 re-check

Design artifacts keep derived related-entity queries, plural REST routes, soft-retire status, and migration backfill defaults — still PASS under the same gates.

## Project Structure

### Documentation (this feature)

```text
specs/001-project-workspace-dashboards/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   └── studio-projects-workspaces.openapi.yaml
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
infrastructure/studio/migrations/
└── 007_projects_workspaces.sql

src/studio/
├── contracts.ts                    # StudioProject, StudioWorkspace, StudioTask.workspaceId/projectIds
└── infrastructure/
    ├── postgres-studio-store.ts
    ├── in-memory-studio-store.ts
    └── migrate.ts

apps/server/src/api/studio/
├── studio.ts                       # wire new routers
├── projectRoutes.ts
├── projectService.ts
├── workspaceEntityRoutes.ts        # first-class workspaces (avoid clashing with workspaceRoutes)
├── workspaceEntityService.ts
├── workspaceRoutes.ts              # existing package import/export — unchanged paths
└── taskService.ts                  # require workspaceId + projectIds

apps/web/src/app/(authenticated)/
├── projects/
│   ├── page.tsx                    # Projects list
│   └── [projectId]/page.tsx        # Project dashboard
├── workspaces/
│   ├── page.tsx                    # Workspaces list
│   └── [workspaceId]/page.tsx      # Workspace dashboard
└── tasks/                          # surface workspace + projects on board/forms

apps/web/src/app/api/
├── projects/...                    # BFF proxies to execution /studio/projects
└── workspaces/...                  # BFF proxies to execution /studio/workspaces

tests/
└── (new) studioProjectsWorkspaces*.test.ts
```

**Structure Decision**: Extend the existing Studio stack (contracts → store → Hono services/routes → Next BFF → authenticated pages). Do not introduce a separate microservice. Name server files `workspaceEntity*` to distinguish first-class workspace CRUD from the existing package `workspaceRoutes`/`workspaceService`.

## Complexity Tracking

> No constitution violations requiring justification.
