# Implementation Plan: Phase 0.5 — Baseline Repair

**Branch**: `develop` (no feature branch created) | **Date**: 2026-10-10 | **Spec**: [../spec.md](../spec.md) (FR-111) |
**Program plan**: [../plan.md](../plan.md) §2 "Phase 0.5" | **Inspected at**: `111f719`

**Input**: corrected Phase 0 documents in `specs/007-organization-tenancy-audit/` (commit `111f719`).

> Planning only. Nothing in this document has been implemented. No data reset, no organization schema
> change, no Phase 1 work.

## Summary

Repair the three pre-existing regressions recorded in [../test-baseline.md](../test-baseline.md) §5, make
strategy goal + task creation atomic across the organization and studio stores through one database
transaction, require an explicit, authorized project for strategy and delegation (D-6), prove atomicity with
real-PostgreSQL failure injection, make test files type-checked, and record a fresh full-suite baseline on a
clean committed SHA. Design decisions: [research.md](./research.md). Behavioral contract:
[contracts/organization-operations.md](./contracts/organization-operations.md). Validation:
[quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.7, Node 20 (CI) / local Node per baseline record
**Primary Dependencies**: Hono, pg, ts-jest/Jest, Next.js 16 (web page touch only)
**Storage**: PostgreSQL 16 + pgvector (shared pool for studio + organization tables); **no migrations added**
**Testing**: Jest `--runInBand` with `MEMORY_TEST_DATABASE_URL`; new `tsc -p tsconfig.test.json`
**Target Platform**: execution server + web BFF (unchanged topology)
**Project Type**: pnpm monorepo
**Performance Goals**: strategy request holds one pooled client for the duration of three inserts (ms-scale)
**Constraints**: no schema change; no behavior change outside strategy/delegation/goal-project validation;
fail closed when atomic writes are unavailable
**Scale/Scope**: ~10 source files, 4 test files changed/added, 2 config files, 1 web page

## Constitution Check

`.specify/memory/constitution.md` is an unratified template → no constitutional gates. Substitute gates
(from the program plan §3): negative tests before implementation; a test counts only if executed; evidence
recorded with exact commands. **Pre-design: PASS. Post-design: PASS** (no schema change, no new service,
fail-closed default).

## Project Structure

### Documentation (this phase)

```text
specs/007-organization-tenancy-audit/phase-0.5/
├── plan.md                              # this file
├── research.md                          # decisions R-1 … R-12
├── data-model.md                        # transactional boundary; no schema change
├── quickstart.md                        # validation and baseline procedure
└── contracts/organization-operations.md # strategy / delegation / goal project contract
specs/007-organization-tenancy-audit/evidence/phase-0.5/   # created at baseline time (separate commit)
specs/007-organization-tenancy-audit/baseline-phase-0.5.md # created at baseline time
```

### Source code (expected touch points)

```text
apps/server/src/organization/
├── organizationService.ts        # explicit project, prepare→UoW→post-commit flow, no fallback
├── organizationStore.ts          # optional client binding (Postgres); snapshot/restore (in-memory)
└── organizationUnitOfWork.ts     # NEW: port + Postgres / in-memory / unavailable implementations
apps/server/src/api/studio/
├── taskService.ts                # split create → prepareCreate + persistNew (create() behavior unchanged)
└── (project validation helper, e.g. organization-local requireActiveProject)
apps/server/src/api/studio.ts     # optional organizationUnitOfWork parameter + fail-closed default
apps/server/src/index.ts          # wire PostgresOrganizationUnitOfWork(studio.pool)
apps/web/src/app/(authenticated)/organization/page.tsx  # project required for strategy; project picker for delegation when goal has none
tsconfig.test.json                # NEW (strict test typecheck)
tsconfig.jestfullcheck.json       # DELETE (broken, excludes tests)
jest.config.js                    # ts-jest → tsconfig.test.json
package.json                      # script typecheck:tests
.github/workflows/ci.yml          # OPTIONAL (R-12): PG service + typecheck:tests
tests/
├── taskBoardView.test.ts               # R1 fixture
├── eventRoutinesIntegration.test.ts    # R2 fixture
├── organizationBudgetRoutes.test.ts    # R3: create project, send projectId
├── organizationService.test.ts         # explicit projects; in-memory atomicity + validation cases
└── organizationStrategyAtomicity.test.ts  # NEW: real-PG failure injection
```

**Structure Decision**: keep the organization unit of work inside `apps/server/src/organization/` (only
consumer); no change to `src/studio/contracts.ts` interfaces beyond what `TaskService` needs (none expected —
`PostgresStudioStore` already supports client binding).

## Work breakdown (test-first order)

Each step lists its exit check. Steps 1–2 are independent of 3–7.

1. **Fixtures (scope 1)**
   - `tests/taskBoardView.test.ts`: add `projectId: "project-1"`, `workspaceId: null` to the `task()` defaults.
   - `tests/eventRoutinesIntegration.test.ts`: insert a `studio_projects` row for `tenantA` and include
     `project_id` in the raw `studio_tasks` INSERT (lines 67-71).
   - Exit: both suites pass with PG; no production code touched.

2. **Test TypeScript configuration (scope 5)** — research R-10
   - Add `tsconfig.test.json`; delete `tsconfig.jestfullcheck.json`; add `typecheck:tests`; point ts-jest to it.
   - Exit: `pnpm typecheck:tests` exits 0 after step 1 (measured: R1 is the only current error); a deliberately
     broken test fixture (local check, not committed) makes it fail.

3. **Contract tests first (scopes 2–4)** — write failing tests before code
   - In-memory (`tests/organizationService.test.ts`): strategy without `projectId` → 400; foreign tenant's
     project → 404; retired → 409; each leaves **no goal and no task**; delegation with goal-without-project and
     no body project → 400; mismatched body project → 400; injected `saveTask`/`enqueueTriggerEvent` failure →
     no goal, no task, no event; mixed stores → 503 with no writes. Update the existing happy path to pass
     explicit projects (`:38`, `:43`).
   - Real PG (`tests/organizationStrategyAtomicity.test.ts`): research R-8 cases 1–3 + validation cases +
     success path + no leaked client.
   - `tests/organizationBudgetRoutes.test.ts`: create a project; send `projectId`; expect 201.
   - Exit: new tests fail for the documented reasons (orphan goal, fallback project, 400 vs 404/409).

4. **Unit of work (scope 3)** — research R-1, R-7
   - `OrganizationUnitOfWork` port; `PostgresOrganizationUnitOfWork(pool)`; `InMemoryOrganizationUnitOfWork(studio, organization)`;
     `UnavailableOrganizationUnitOfWork` (503).
   - `PostgresOrganizationStore(pool, client?)`: queries go through the client when bound;
     `saveReportingLine` rejects when client-bound (not used in a UoW; keeps its own advisory-lock transaction).
   - `InMemoryOrganizationStore`: `snapshot()` / `restore()`.
   - Exit: UoW unit tests (commit visible / rollback invisible) pass on both adapters.

5. **Task creation split** — research R-2
   - `TaskService.prepareCreate` (no writes; rejects `createProject` when called from strategy) and
     `persistNew(task, principal, tx)`; `create()` composes them exactly as today.
   - Exit: all existing task suites unchanged and green (`taskBoardPhase2`, `studioProjectsWorkspaces`, …).

6. **OrganizationService changes (scopes 2–3)** — research R-3 … R-6
   - `requireActiveProject` helper (400/404/409); strategy: validate title/brief/CEO/project and
     `prepareCreate` → `uow.run({ saveGoal; persistNew })` → best-effort placeholder naming → 201.
   - Remove the cancel-on-failure branch and both `ensureTenantProjectWorkspaceDefaults` calls.
   - Delegate: effective project rule (R-5); task through `TaskService.create` with executor passed (fixes OC-6).
   - `createGoal`: shared project validation when `projectId` provided (R-6).
   - Router + `index.ts` wiring (R-7).
   - Exit: step-3 tests pass on both adapters.

7. **Web page** (consequence of scope 2)
   - Strategy: project select required when "CEO strategy proposal" is checked (no "No project" option;
     link to create a project if none).
   - Delegate: when the goal has no project, show a project select; send `projectId`.
   - Exit: `pnpm --filter web build` passes; manual check per quickstart; `apps/web/e2e/organization-budgets.spec.ts`
     does not exercise strategy (verified), so no e2e change is required.

8. **Optional CI alignment** — research R-12 (requires reviewer approval).

9. **Fresh baseline (scope 6)** — research R-11
   - Commit steps 1–8 (one or more commits). Run the full procedure in [quickstart.md](./quickstart.md) §3 in a
     clean worktree of the final SHA. Commit evidence + `baseline-phase-0.5.md` separately; add a link from
     `../test-baseline.md` without editing its historical sections.

## Acceptance gates (Definition of Done)

| Gate | Evidence |
|------|----------|
| G1 Fixtures | `taskBoardView` and `eventRoutinesIntegration` pass in the full run |
| G2 Explicit project | strategy and delegation reject missing (400), unknown/foreign (404), retired (409), mismatched (400) projects; no fallback code path remains (`ensureTenantProjectWorkspaceDefaults` not referenced by `organizationService.ts`) |
| G3 Atomicity | real PG: failure before task insert, after task insert, and at COMMIT each leave 0 new goals, tasks, and trigger events; validation failures leave 0 rows; in-memory parity tests pass; mixed stores → 503 with no writes |
| G4 No regressions | all previously passing suites pass; task creation behavior unchanged |
| G5 Test typecheck | `pnpm typecheck:tests` exit 0; ts-jest uses the same config |
| G6 Baseline | one full Jest run on a clean committed SHA with PG executed; discovered/executed/skipped counts recorded; 0 failed suites; all gate commands (root/server/web tsc, `typecheck:tests`, server/web builds, `git diff --check`) recorded with exit codes; historical baseline preserved |
| G7 Scope | no new migration files; no data reset; no change under `infrastructure/**/migrations`; no Phase 1 artifacts |

Known non-gating items carried forward unchanged: `pnpm --filter web lint` failures (30 errors), global
error mapping (G-AZ-8), other fallback callers (research "Out of scope").

## Rollback

Code-only change with no schema or data impact: revert the Phase 0.5 commits. The fail-closed UoW default
means a mis-wired deployment returns 503 for strategy instead of writing non-atomically.

## Review points for approval

1. Delegation rule R-5: goal project wins; body project must match (vs. allowing another project).
2. Status codes R-4/R-6: 404 for unknown/foreign project, 409 for retired, including `POST /organization/goals`.
3. R-10: delete `tsconfig.jestfullcheck.json` and switch ts-jest to the strict test config.
4. R-12: include the CI PostgreSQL service + test typecheck in Phase 0.5, or defer.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|-----------|--------------------------------------|
| New unit-of-work port | atomic writes across two stores | compensation is not atomic and is explicitly disallowed by the corrected plan |
| `TaskService` split | reuse validation inside an outer transaction | re-entrant transactions would weaken a global safety guard |
