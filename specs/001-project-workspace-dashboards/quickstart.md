# Quickstart: Project & Workspace Lists and Dashboards

**Feature**: `001-project-workspace-dashboards`  
**Date**: 2026-09-29

Validation guide for proving the feature end-to-end after implementation. See [data-model.md](./data-model.md) and [contracts/studio-projects-workspaces.openapi.yaml](./contracts/studio-projects-workspaces.openapi.yaml) for shapes.

## Prerequisites

- Repo dependencies installed (`pnpm install`)
- Studio Postgres available and migrated (`pnpm db:migrate` or project-equivalent studio migrate)
- Execution server + web running (`pnpm dev:all` or `dev:server` + `dev:web`)
- A registered Studio user (session via web login)

## Setup

1. Apply migrations including `007_projects_workspaces` (ensures default project/workspace backfill for existing tenants).
2. Sign in at the web app (default web port `3060`).
3. Confirm header navigation includes **Projects** and **Workspaces**.

## Scenario A — Lists (P1)

1. Open `/projects` → empty or default project visible; empty state copy if none.
2. Create a project named `Alpha`.
3. Open `/workspaces` → create workspace `Lab`.
4. Confirm both appear only for the signed-in tenant (second user/tenant must not see them).

**Expected**: List rows show name; clicking opens `/projects/{id}` or `/workspaces/{id}`.

## Scenario B — Task associations (P1)

1. On `/tasks`, create a task with workspace `Lab` and projects including `Alpha`.
2. Attempt save without workspace or without projects → blocked with clear validation message.
3. Save valid task → task shows workspace and project chips/labels on the board.

**Expected**: API/store reject invalid payloads; valid task has `workspaceId` + `projectIds`.

## Scenario C — Project dashboard (P2)

1. Open project `Alpha` dashboard.
2. Related tasks section includes the task from Scenario B.
3. Related workspaces includes `Lab`.
4. Configuration shows name/description; edit description and save → persists after reload.

**Expected**: No unrelated tasks; empty sections show empty states when applicable.

## Scenario D — Workspace dashboard (P2)

1. Open workspace `Lab` dashboard.
2. Related tasks includes the same task; related projects includes `Alpha`.
3. Edit workspace configuration → persists.

## Scenario E — Retire (P3)

1. Retire project `Alpha` from list or dashboard action.
2. Default active Projects list hides `Alpha`.
3. Creating a new task cannot select `Alpha`; must pick an active project.
4. Repeat for a disposable workspace (use a second workspace so existing tasks remain assignable).

**Expected**: Retire idempotent; new assignments blocked; historical dashboard may still open or redirect per implementation (not-found vs read-only retired view — prefer readable retired dashboard with banner).

## Automated checks (when implemented)

```bash
# Unit/contract coverage for store + services
pnpm test --runInBand --testPathPattern=studioProjectsWorkspaces

# Typecheck
npx tsc --noEmit

# Optional web e2e (Playwright) if specs added under apps/web/e2e
pnpm --filter web test:e2e
```

## Cross-tenant check

With two users (distinct tenants): create project/workspace as user A; as user B, GET by id and list endpoints must not return A’s entities (404 / empty list).

## Package API regression

Confirm existing package flows still work:

- `GET /studio/workspace` export
- `POST /studio/workspace/import`

These remain separate from `/studio/workspaces` entity routes.
