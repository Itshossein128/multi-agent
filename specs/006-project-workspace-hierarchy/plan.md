# Implementation Plan: Organization → Project → Workspace Hierarchy

**Branch**: `006-project-workspace-hierarchy` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-project-workspace-hierarchy/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Replace the peer Project/Workspace model from `001-project-workspace-dashboards` with a true **Organization → Project → (optional) Workspace → Task** hierarchy. Add a first-run organization profile wizard (tenant profile row), make workspaces children of projects, treat the default workspace as implicit until the first explicit workspace materializes `"Default"`, enforce exactly one project per task with optional `workspaceId`, attach repositories with per-workspace membership/branches, inherit project settings via sparse overrides, derive placeholder names from first task titles, and persist durable workspace working copies on the execution server. Evolve existing Studio contracts, stores, Hono routes, Next BFF, and authenticated UI without introducing a new microservice.

## Technical Context

**Language/Version**: TypeScript 5.7 (Node execution server + Next.js 16 web)

**Primary Dependencies**: Hono (studio API), Next.js 16 / React 19 / TanStack Query (web), `@multi-agent/types` / `src/studio/contracts.ts`, existing Studio store + `RequestPrincipal` (`userId`/`tenantId`)

**Storage**: PostgreSQL via `infrastructure/studio/migrations` + `PostgresStudioStore` / `InMemoryStudioStore`; new/altered tables for organizations, hierarchy FKs, repos, repo state; filesystem working copies under `STUDIO_WORKSPACE_STORAGE_ROOT`

**Testing**: Jest (root / server contract & service tests), Playwright e2e (`apps/web`), typecheck via `tsc`

**Target Platform**: Self-hosted Studio web app + execution server (Windows/Linux Node hosts)

**Project Type**: Monorepo web application (Next.js BFF + Hono execution API + shared Studio contracts)

**Performance Goals**: Organization wizard + project/workspace lists interactive on local/dev (~2s); reopen workspace state within 10s (SC-007); support multi-repo projects without product-imposed counts

**Constraints**: Tenant isolation mandatory; preserve `/studio/workspace` package import/export and `/studio/organization` goals API; fail closed on missing project association; no silent store fallback; migration must not force existing tenants through the wizard

**Scale/Scope**: Org wizard + profile API, hierarchy migration from 001, task association rewrite, project-scoped workspaces, repo attachment + durable copies, settings inheritance, name derivation, nested navigation/UI updates

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the Spec Kit placeholder (no project-specific ratified principles). Applying **de facto Studio gates** derived from existing architecture and feature 001:

| Gate | Status | Notes |
|------|--------|-------|
| Tenant-scoped access for Studio list/get/mutate | PASS | Organization profile and all child entities filter by `tenantId` |
| No silent postgres ↔ in-memory fallback | PASS | Extend `StudioStore`; both adapters implement new methods |
| Prefer evolving Studio contracts over parallel models | PASS | Extend `StudioProject` / `StudioWorkspace` / `StudioTask`; supersede 001 association fields |
| Keep existing import/export workspace package API | PASS | Entity routes stay plural / project-nested; package stays `/studio/workspace` |
| Keep agent organization goals API distinct | PASS | Profile under `/studio/organizations`; goals remain `/studio/organization` |
| Testable services + store before UI-only work | PASS | Plan includes migration, store, service, contract tests |
| YAGNI on second tenancy system | PASS | `organization.id = tenant_id` profile row, not a new auth realm |

**Gate result**: PASS (no unjustified violations). Complexity Tracking left empty.

### Post–Phase 1 re-check

Design artifacts keep tenant-scoped org profile, nullable `workspaceId` for default workspace, sparse settings overrides, explicit repo membership tables, filesystem+metadata durable copies, and a single cutover migration from 001 — still PASS under the same gates.

## Project Structure

### Documentation (this feature)

```text
specs/006-project-workspace-hierarchy/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── studio-hierarchy.openapi.yaml
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
infrastructure/studio/migrations/
└── 017_project_workspace_hierarchy.sql

src/studio/
├── contracts.ts                    # OrganizationProfile; projectId; nullable workspaceId;
│                                   # nameSource; settingsOverrides; repositories
└── infrastructure/
    ├── postgres-studio-store.ts
    ├── in-memory-studio-store.ts
    ├── workspace-storage.ts        # path resolution under STUDIO_WORKSPACE_STORAGE_ROOT
    └── migrate.ts                  # column expectations for new/altered tables

apps/server/src/api/studio/
├── studio.ts                       # wire org + hierarchy routers
├── organizationProfileRoutes.ts
├── organizationProfileService.ts
├── projectService.ts               # project-scoped workspaces; repos; Default materialization
├── projectRoutes.ts
├── workspaceEntityService.ts       # inheritance, membership, retire rules
├── workspaceEntityRoutes.ts
├── taskService.ts                  # projectId required; workspace rules; name derivation
└── tenantDefaults.ts               # stop/adjust legacy Default Project/Workspace ensure

apps/web/src/app/(authenticated)/
├── onboarding/organization/        # forced wizard
├── projects/
│   ├── page.tsx                    # empty CTA; create without name
│   └── [projectId]/page.tsx        # workspaces + repos + default indicator
├── workspaces/[workspaceId]/       # deep link dashboard
└── tasks/                          # single project; conditional workspace; inline project

apps/web/src/app/api/
├── organizations/...
├── projects/...                    # + repositories, nested workspaces
└── workspaces/...

tests/
└── studioHierarchy*.test.ts
```

**Structure Decision**: Extend the existing Studio stack (contracts → store → Hono services/routes → Next BFF → authenticated pages). Do not introduce a separate microservice. Keep package `workspaceRoutes` and goals `organizationRoutes` paths unchanged; add `organizationProfile*` for the wizard/profile.

## Complexity Tracking

> No constitution violations requiring justification.
