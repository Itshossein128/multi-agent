# Quickstart: Organization → Project → Workspace Hierarchy

**Feature**: `006-project-workspace-hierarchy`  
**Date**: 2026-10-07

Validation guide after implementation. See [data-model.md](./data-model.md) and [contracts/studio-hierarchy.openapi.yaml](./contracts/studio-hierarchy.openapi.yaml).

## Prerequisites

- `pnpm install`
- Studio Postgres migrated (includes hierarchy migration, e.g. `017_project_workspace_hierarchy`)
- `STUDIO_WORKSPACE_STORAGE_ROOT` set to a writable directory (dev default under repo or temp is fine)
- Execution server + web running (`pnpm dev:all` or equivalent)
- Ability to register a **new** user (empty org) and sign in as an **existing** migrated user

## Scenario A — First-run organization wizard (P1)

1. Register a brand-new user.
2. Confirm redirect/gate to the organization setup wizard; other product routes return you to the wizard.
3. Submit name + optional description/config → land in the organization with an empty Projects list CTA.
4. Sign in as a user whose tenant already has an organization profile → wizard must **not** appear.

**Expected**: `GET /studio/organizations/current` is 404 before wizard, 200 after; caller is `ownerId`.

## Scenario B — Inline project from task form (P1)

1. In an org with no projects, open create-task.
2. Create a project inline without a project name; set task title `Ship hierarchy`.
3. Save task.

**Expected**: Project exists, named `Ship hierarchy`, `nameSource=derived`, task `projectId` set, `workspaceId` null, Workspaces list for the project empty (default workspace).

## Scenario C — Placeholder then first task (P1)

1. Create a project from Projects list with no name → see Untitled placeholder.
2. Create first task titled `Alpha work`.

**Expected**: Project name becomes `Alpha work` (or suffixed if duplicate); later rename sticks (`nameSource=manual`).

## Scenario D — First explicit workspaces + Default materialization (P2)

1. On a project that already has default-workspace tasks/files, create workspace `Branch A` (pick branches).
2. Confirm a `"Default"` workspace also appears with prior tasks/files.
3. Create second workspace `Branch B` on another branch.
4. Create tasks in each; confirm isolation of files/branches.
5. Confirm new tasks require choosing an active workspace (default no longer offered).

**Expected**: Matches FR-017/FR-018/FR-019; `materializedDefault` present on first create response.

## Scenario E — Multi-repo membership (P2)

1. Attach three repositories to a project.
2. Configure one workspace with one repo; another with all three.
3. Run/open tasks in each → only membership repos visible.
4. Add a fourth repo to the project → existing workspaces unchanged; default-only projects see it immediately.
5. Attempt remove of a dirty repo without confirm → 409; with `confirmDiscardChanges: true` → succeeds.

## Scenario F — Settings inheritance (P2)

1. Set a project setting key; leave workspace without override → workspace effective value follows.
2. Override the key on the workspace; change project → workspace keeps override.
3. Clear override → workspace follows project again.
4. UI/API shows `overriddenKeys`.

## Scenario G — Disconnect durability (P2)

1. Make uncommitted file changes in a workspace via a task/agent path.
2. Stop the web client / interrupt the session (server storage remains).
3. Reopen the workspace dashboard within ~10s of navigation.

**Expected**: Repos, branches, and dirty files still present (`hasUncommittedChanges`).

## Scenario H — Navigation & tenant isolation (P3)

1. From a task, open linked project and (if any) workspace.
2. With a second tenant user, confirm lists/GETs never return the first tenant’s entities (404 / empty).

## Automated checks (when implemented)

```bash
pnpm test --runInBand --testPathPattern=studioHierarchy
npx tsc --noEmit
pnpm --filter web test:e2e
```

## Regressions to watch

- Package import/export: `GET/POST /studio/workspace` unchanged.
- Agent goals: `/studio/organization` goals/reporting still works.
- Migrated existing users: no wizard; tasks have single `projectId`; workspaces scoped to projects.
