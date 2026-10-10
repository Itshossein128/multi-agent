---
description: "Phase 0.5 baseline repair — TDD task list"
---

# Tasks: Phase 0.5 — Baseline Repair

**Input**: [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/organization-operations.md](./contracts/organization-operations.md), [quickstart.md](./quickstart.md);
program spec [../spec.md](../spec.md) (FR-111) and [../test-baseline.md](../test-baseline.md) §5.

**Tests**: **TDD requested.** Every behavior change starts with a test that is run and observed to fail for the
documented reason before the implementation task. A test counts only if it executed (PG suites must not skip).

**Assumed review-point outcomes** (plan "Review points"; change tasks if the reviewer decides otherwise):
R-5 goal project wins for delegation; R-4/R-6 status codes 404/409; R-10 delete `tsconfig.jestfullcheck.json`
and switch ts-jest; R-12 CI change optional (T040).

**Optional task disposition**: T040 (CI alignment) is deferred; no reviewer approval was provided. It is excluded from the required completion count.

**Tested source commit**: `5bb28b41af0357a726845f5d110473a996ab56f2`. Phase artifacts, task tracking, documentation and evidence are saved in the subsequent docs commit. The Graphify post-commit hook was skipped per invocation to preserve pre-existing graph edits.

**Execution notes**: the installed prerequisite script requires unavailable PowerShell; paths were validated directly, selecting this nested plan and tasks rather than the program directory. T016 was observed first as missing-module failures, then rerun after the UoW/router types existed so the PostgreSQL failure cases executed red (`/tmp/phase0.5/us2-pg-red.log`). Assignment-event errors were discovered to be swallowed: `persistNew` requires event delivery by default, while `create` retains its previous best-effort event behavior. Ignore-file security patterns were verified and repaired as required by speckit-implement setup.

**Baseline execution**: the first complete clean-SHA run failed the existing memory benchmark Git-provenance assertion. Its output is retained separately; a freshly recreated checkout passed in one complete run. Counts were not combined. Formal convergence is prerequisite-blocked because the active parent has no tasks.md and the nested phase has no spec.md. See ../baseline-phase-0.5.md.

**Scope guard**: no files under `infrastructure/**/migrations`, no data reset, no organization schema change,
no Phase 1 work.

## Phase 0.5 user stories (derived from plan scope; not in program `spec.md`)

| ID | Priority | Story | Plan scope |
|----|----------|-------|-----------|
| US1 | P1 | Repaired fixtures: `taskBoardView` and `eventRoutinesIntegration` pass | 1 |
| US2 | P1 | Strategy requires an explicit, authorized project and writes goal + task atomically, proven on real PostgreSQL | 2, 3, 4 |
| US3 | P2 | Delegation requires an explicit, authorized project; no first-active-project fallback | 2 |
| US4 | P2 | Test files are type-checked by a real `tsc` gate shared with ts-jest | 5 |
| — | final | Fresh full-suite baseline on a clean committed SHA | 6 |

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1…US4; Setup, Foundational and Final phases carry no story label

---

## Phase 1: Setup

**Purpose**: reproducible environment and recorded red state before any change.

- [X] T001 Start PostgreSQL with `pnpm db:dev:up` and export `MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"` (do not rely on `.env`); confirm `pg_isready -h 127.0.0.1 -p 55432`
- [X] T002 Record the red state on HEAD `111f719` by running `pnpm test --runInBand tests/taskBoardView.test.ts tests/eventRoutinesIntegration.test.ts tests/organizationBudgetRoutes.test.ts` and saving the output to `/tmp/phase0.5/red-before.log` (expect R1 TS2322 at `tests/taskBoardView.test.ts:10`, R2 `project_id` NOT NULL violation, R3 `400` instead of `201`)

---

## Phase 2: Foundational (blocks US2 and US3)

**Purpose**: one shared project-validation rule for all organization operations (research R-4, R-6).

**Rule (verbatim, data-model.md)**: "`projectId` present and non-blank … else `400`"; "Project visible through the caller's tenant-scoped store … else `404` (unknown and foreign indistinguishable)"; "Project `status = active` … else `409`"; "All validation completes before the first write".

- [X] T003 [P] Write failing tests in `tests/organizationProjectValidation.test.ts` for `requireActiveProject(studio, projectId, principal)` using `InMemoryStudioStore`: `undefined`/`""`/`"  "` → `ApiError` 400 `projectId is required`; unknown id → 404 `Project not found`; project saved under another tenant (`{ userId: "bob", tenantId: "tenant-b" }`) → 404 with the identical message; project with `status: "retired"` → 409 `Project is retired`; active project in caller's tenant → returns the project. Run and confirm failure (module missing)
- [X] T004 Implement `requireActiveProject` in `apps/server/src/organization/projectValidation.ts` using `studio.getProject(projectId, principal)` (tenant-scoped) and `ApiError` from `apps/server/src/api/shared/http.ts`; make T003 pass
- [X] T005 Write failing tests in `tests/organizationService.test.ts` for `POST /organization/goals` project validation via `OrganizationService.createGoal`: supplied unknown/foreign `projectId` → 404 `Project not found` (today 400); supplied retired project → 409 `Project is retired` (today accepted); omitted `projectId` still creates a goal with `projectId: null`. Run and confirm the 404/409 cases fail
- [X] T006 Replace the inline project check at `apps/server/src/organization/organizationService.ts:68-69` with `requireActiveProject` when `projectId` is supplied; make T005 pass

**Checkpoint**: shared validation in place; no strategy/delegation behavior changed yet.

---

## Phase 3: User Story 1 — Repaired fixtures (Priority: P1) 🎯 MVP

**Goal**: the two fixture regressions (R1, R2) pass without production changes.

**Independent test**: `pnpm test --runInBand tests/taskBoardView.test.ts tests/eventRoutinesIntegration.test.ts` → both suites pass, 0 skipped, with PG running.

**TDD note**: the failing tests already exist (red recorded in T002); these tasks make them green.

- [X] T007 [P] [US1] In `tests/taskBoardView.test.ts:9-25` add `projectId: "project-1"` and `workspaceId: null` to the `task()` fixture defaults (required by `apps/web/src/lib/taskStatus.ts:52-53`); no other change
- [X] T008 [P] [US1] In `tests/eventRoutinesIntegration.test.ts` test "saves, lists, and isolates task comments by tenant" (lines 65-96): before the task INSERT, insert a `studio_projects` row for `tenantA` (id `project-test`, `owner_id` `user-a`, `status` `active`, `name_source` `manual`, `settings` `'{}'::jsonb`) with `ON CONFLICT (id) DO NOTHING`, and add `project_id` = `project-test` to the `studio_tasks` INSERT at lines 67-71
- [X] T009 [US1] Run the independent test above and confirm both suites pass and that `tests/eventRoutinesIntegration.test.ts` reports all its tests executed (none skipped)

**Checkpoint**: R1 and R2 resolved.

---

## Phase 4: User Story 2 — Explicit project and atomic strategy (Priority: P1)

**Goal**: `POST /organization/strategy` requires an explicit, authorized project and commits goal, task and
assignment event in one transaction across both stores; any failure leaves none of them (contract:
[organization-operations.md](./contracts/organization-operations.md) "POST /studio/organization/strategy").

**Independent test**: `pnpm test --runInBand tests/organizationStrategyAtomicity.test.ts tests/organizationUnitOfWork.test.ts tests/organizationService.test.ts tests/organizationBudgetRoutes.test.ts` → all pass; the PG suites report their tests as executed, not skipped.

**Write-set rule (verbatim, data-model.md)**: "`{ goal (status proposed, owner = CEO agent, projectId), task (assigned CEO, projectId, metadata.organizationGoalId, metadata.strategyProposal = true), task_assignment trigger event }` — all committed together or none."

### Tests for User Story 2 (write first; must fail)

- [X] T010 [P] [US2] Add in-memory validation tests to `tests/organizationService.test.ts`: `requestStrategyProposal` with no `projectId` → 400 `projectId is required`; with a project of tenant `tenant-b` → 404 `Project not found`; with a retired project → 409 `Project is retired`; after each assert `organization.goals(alice.tenantId)` length unchanged and `studio.listTasks(alice)` length unchanged (today a `proposed` goal is left behind)
- [X] T011 [P] [US2] Add in-memory atomicity tests to `tests/organizationService.test.ts`: with a valid project, `jest.spyOn(studio, "saveTask").mockRejectedValueOnce(new Error("injected"))` → request rejects, 0 new goals (no `cancelled` goal either), 0 new tasks; same with `jest.spyOn(studio, "enqueueTriggerEvent")` rejecting → 0 new goals, tasks and trigger events (`studio.listTriggerEvents({ tenantId: alice.tenantId })`); and a mixed-store case: `new OrganizationService(customOrganizationStoreObject, new InMemoryStudioStore())` (a plain object implementing `OrganizationStore`, not `InMemoryOrganizationStore`) → `ApiError` 503 `Atomic organization operations are not configured` with no goal saved on the custom store
- [X] T012 [P] [US2] Create `tests/organizationUnitOfWork.test.ts`: in-memory — `InMemoryOrganizationUnitOfWork.run` commits goal + task visibly; throwing inside `run` restores both stores; Postgres (gated `MEMORY_TEST_DATABASE_URL ? describe : describe.skip`, random schema + `runStudioMigrations` as in `tests/eventRoutinesIntegration.test.ts:35-50`) — committed goal + task visible from the pool; throw inside `run` → neither visible; after both, `pool.totalCount - pool.idleCount === 0` (client released)
- [X] T013 [P] [US2] Create `tests/organizationStrategyAtomicity.test.ts` (real PostgreSQL, random schema per test, `PostgresStudioStore` + `PostgresOrganizationStore` + `PostgresOrganizationUnitOfWork` on one pool, requests through `createStudioRouter(..., organizationUnitOfWork)` with a fixed principal; seed an active project, a retired project, a project in another tenant, and a CEO agent with reporting line). Cases, each asserting counts of `studio_organization_goals`, `studio_tasks`, `studio_trigger_events` for the tenant before/after:
  1. test-only `BEFORE INSERT ON studio_tasks` trigger that `RAISE EXCEPTION 'injected-task'` → non-2xx, 0 new rows in all three tables;
  2. test-only `BEFORE INSERT ON studio_trigger_events` trigger raising → non-2xx, 0 new rows;
  3. test-only `CREATE CONSTRAINT TRIGGER … AFTER INSERT ON studio_tasks DEFERRABLE INITIALLY DEFERRED` raising (fails at COMMIT) → non-2xx, 0 new rows;
  4. missing / foreign / retired `projectId` → 400 / 404 / 409, 0 new rows;
  5. success → 201, exactly 1 goal (`status` `proposed`, `projectId` = seeded project), 1 task (`metadata.organizationGoalId` = goal id, `metadata.strategyProposal` = true, `projectId` = seeded project), 1 `task_assignment` event;
  6. after dropping the injection triggers, a further strategy request succeeds and `pool.waitingCount === 0` (no leaked client).
  For storage failures assert `expect(status).toBeGreaterThanOrEqual(400)` (the global mapper currently returns 400, `apps/server/src/api/shared/http.ts:38`, gap G-AZ-8 — not changed in Phase 0.5)
- [X] T014 [P] [US2] Update `tests/organizationBudgetRoutes.test.ts`: save an active project for `company-a` via `studio.saveProject(..., principal)` before the strategy request and send `projectId` in the body (line 15); keep the `201` expectation and the later `goals` length 1 assertion
- [X] T015 [US2] Update the existing happy path in `tests/organizationService.test.ts:43` to pass `projectId: "project-org"` and assert `proposal.goal.projectId === "project-org"` and `proposal.task.projectId === "project-org"`
- [X] T016 [US2] Run the US2 independent test command and save output to `/tmp/phase0.5/us2-red.log`; confirm failures are for the documented reasons (missing modules `organizationUnitOfWork`, orphan/cancelled goals, fallback project, 400 instead of 404/409/503) and that PG suites executed

### Implementation for User Story 2

- [X] T017 [P] [US2] Add `snapshot()` and `restore(snapshot)` to `InMemoryOrganizationStore` in `apps/server/src/organization/organizationStore.ts` (deep-copy `goalRows` and `lineRows`)
- [X] T018 [P] [US2] Change `PostgresOrganizationStore` in `apps/server/src/organization/organizationStore.ts:64-112` to `constructor(pool: PgPool, client?: PgClient)`; route `goals`, `saveGoal`, `reportingLines` through `client ?? pool`; make `saveReportingLine` throw `Error("Reporting-line updates are not supported inside an organization unit of work")` when client-bound (it keeps its own advisory-lock transaction otherwise)
- [X] T019 [US2] Create `apps/server/src/organization/organizationUnitOfWork.ts` with interface `OrganizationUnitOfWork { run<T>(op: (stores: { studio: StudioStore; organization: OrganizationStore }) => Promise<T>): Promise<T> }` and implementations: `PostgresOrganizationUnitOfWork(pool)` (one `pool.connect()` client, `BEGIN`, `new PostgresStudioStore(pool, client)` + `new PostgresOrganizationStore(pool, client)`, `COMMIT`; `ROLLBACK` on error preserving the original error; always `release()`), `InMemoryOrganizationUnitOfWork(studio, organization)` (`studio.transaction` + organization `snapshot/restore`), `UnavailableOrganizationUnitOfWork` (throws `ApiError(503, "Atomic organization operations are not configured")`), and `defaultOrganizationUnitOfWork(studio, organization)` returning in-memory only when both are `InMemoryStudioStore`/`InMemoryOrganizationStore` instances, else unavailable; make T012 pass
- [X] T020 [US2] Split `TaskService.create` in `apps/server/src/api/studio/taskService.ts:167-258` into `prepareCreate(body, principal): Promise<StudioTask>` (all validation and reads from lines 173-249, no writes; throw `ApiError(400)` if `body.createProject` is supplied when an option `{ forbidInlineProject: true }` is set) and `persistNew(task, principal, store): Promise<StudioTask>` (`store.saveTask` + `this.enqueueAssignmentTrigger(saved, principal, undefined, store)`); keep `create()` = `prepareCreate` → `this.store.transaction(tx => this.persistNew(task, principal, tx))` → `derivePlaceholderNames`; expose a public `derivePlaceholderNamesBestEffort(task, principal)` wrapper; existing task suites must stay green
- [X] T021 [US2] Split goal creation in `apps/server/src/organization/organizationService.ts:62-79` into `prepareGoal(input, principal)` (validation incl. T006 project rule, returns the `OrganizationGoal` object) and the existing `createGoal` = `prepareGoal` + `organization.saveGoal`
- [X] T022 [US2] Rewrite `requestStrategyProposal` in `apps/server/src/organization/organizationService.ts:130-151`: validate `title`/`brief`, CEO line and agent, `requireActiveProject(input.projectId)`; `prepareGoal` (status `proposed`, owner/proposer = CEO, `projectId`); `TaskService.prepareCreate({ title: "Strategy proposal: …", description: …, assignedAgent: ceo, projectId, workspaceId: null, metadata: { organizationGoalId, strategyProposal: true } }, principal, { forbidInlineProject: true })`; then `this.unitOfWork.run(({ studio, organization }) => organization.saveGoal(goal) then taskService.persistNew(task, principal, studio))`; after commit call `derivePlaceholderNamesBestEffort` catching errors and logging `log.warn("organization.strategy.placeholder_failed", { goalId, taskId })` via `log` from `apps/server/src/logging.ts`; delete the cancel-on-failure branch and the `ensureTenantProjectWorkspaceDefaults` call at line 138; return `{ goal, task }`
- [X] T023 [US2] Add optional 4th constructor parameter `unitOfWork?: OrganizationUnitOfWork` to `OrganizationService` (`organizationService.ts:18`) defaulting to `defaultOrganizationUnitOfWork(studio, organization)`; add optional parameter `organizationUnitOfWork?: OrganizationUnitOfWork` to `createStudioRouter` in `apps/server/src/api/studio.ts:33-39` and pass it at line 64; in `apps/server/src/index.ts:129-130` pass `new PostgresOrganizationUnitOfWork(studio.pool)` when `studio.pool` exists
- [X] T024 [P] [US2] In `apps/web/src/app/(authenticated)/organization/page.tsx:60-66`: when "CEO strategy proposal" is checked, require a project (remove the "No project" choice for this mode, disable submit until selected, show a link to `/projects` when no projects exist) and send `projectId` (never `null`) to `/strategy`
- [X] T025 [US2] Run the US2 independent test command plus `pnpm test --runInBand tests/taskBoardPhase2.test.ts tests/studioProjectsWorkspaces.test.ts tests/organizationProjectValidation.test.ts`; all pass, PG suites executed; `pnpm --filter web build` passes

**Checkpoint**: R3 resolved; strategy atomic on both adapters; real-PG proof in place.

---

## Phase 5: User Story 3 — Explicit project for delegation (Priority: P2)

**Goal**: `POST /organization/goals/:id/delegate` uses an explicit, authorized project (contract section
"POST /studio/organization/goals/:id/delegate").

**Independent test**: `pnpm test --runInBand tests/organizationService.test.ts` delegation cases pass and `rg ensureTenantProjectWorkspaceDefaults apps/server/src/organization` returns nothing.

**Rule (verbatim, data-model.md)**: "Effective project = goal's project, else request `projectId`; request value must equal goal's when both exist … else `400`".

### Tests for User Story 3 (write first; must fail)

- [X] T026 [P] [US3] Add delegation tests to `tests/organizationService.test.ts`: active goal without project + no body `projectId` → 400 `projectId is required`; goal with project `project-org` + body `projectId: "other"` → 400 `projectId must match the goal's project`; goal without project + foreign project → 404; + retired project → 409; each leaves `studio.listTasks(alice)` unchanged; goal with project + no body → task `projectId` = goal's project; goal without project + valid body project → task `projectId` = body project. Run and confirm the 400/404/409 cases fail (today: fallback to first active project)
- [X] T027 [US3] Update the existing delegation at `tests/organizationService.test.ts:38` (goal created without project) to pass `projectId: "project-org"`

### Implementation for User Story 3

- [X] T028 [US3] Rewrite project resolution in `delegate` at `apps/server/src/organization/organizationService.ts:121-127`: compute the effective project per the rule above, validate with `requireActiveProject`, remove the `ensureTenantProjectWorkspaceDefaults` call and its import (line 7), construct `new TaskService(this.studio, this.executor)` (fixes OC-6); make T026 pass
- [X] T029 [P] [US3] In `apps/web/src/app/(authenticated)/organization/page.tsx:75`: when the goal has `projectId === null`, render a project select next to the agent select and send `projectId`; otherwise send only `agentId`
- [X] T030 [US3] Run the US3 independent test; `pnpm --filter web build` passes

**Checkpoint**: no organization operation falls back to the first active project.

---

## Phase 6: User Story 4 — Real test typecheck gate (Priority: P2)

**Goal**: test files are type-checked by `tsc` with the same configuration ts-jest uses (research R-10).

**Independent test**: `pnpm typecheck:tests` exits 0; temporarily removing `projectId` from the T007 fixture makes it exit non-zero.

**Depends on**: T007 (R1 is currently the only error, measured out-of-tree).

### Test for User Story 4 (write first; must fail)

- [X] T031 [US4] Create `tsconfig.test.json` at the repository root with exactly: `target ES2022`, `module CommonJS`, `moduleResolution node`, `strict true`, `esModuleInterop true`, `skipLibCheck true`, `noEmit true`, `jsx react-jsx`, `lib ["es2022","dom","dom.iterable"]`, `types ["jest","node"]`, `rootDir "."`, `baseUrl "."`, `paths { "@/*": ["apps/web/src/*"], "@multi-agent/types": ["packages/types/src/index.ts"], "next-auth": ["apps/web/node_modules/next-auth"], "next-auth/*": ["apps/web/node_modules/next-auth/*"] }` (mirrors `jest.config.js:13-19`), `include ["tests/**/*.ts","src/**/*.test.ts"]`, no `exclude` of `*.test.ts`; add script `"typecheck:tests": "tsc -p tsconfig.test.json"` to `package.json`; with T007 temporarily reverted locally, run `pnpm typecheck:tests` and confirm it fails with TS2322 at `tests/taskBoardView.test.ts:10` (do not commit the revert)

### Implementation for User Story 4

- [X] T032 [US4] Point ts-jest at the shared config in `jest.config.js:11` (`["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }]`) and delete `tsconfig.jestfullcheck.json`
- [X] T033 [US4] Run `pnpm typecheck:tests` (exit 0) and the full `pnpm test --runInBand` once with PG to confirm the stricter ts-jest config introduces no new failures; fix only test-file typing issues if any appear, never production behavior

**Checkpoint**: tests are gated by `tsc`; Jest and `tsc` agree.

---

## Phase 7: Final — Polish, scope check, fresh baseline

**Purpose**: documentation, scope verification, and the reproducible baseline (plan scope 6, gate G6).

- [X] T034 [P] Update `docs/organization-and-cost-budgets.md` "Organization" section: strategy proposals and delegations of project-less goals require an explicit active project; failures create nothing
- [X] T035 [P] Verify scope guard: `git diff --stat 111f719 -- infrastructure` is empty; no new files under `infrastructure/**/migrations`; no Phase 1 artifacts; `rg "ensureTenantProjectWorkspaceDefaults" apps/server/src/organization` empty
- [X] T036 Run the pre-commit gate locally: `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p apps/server/tsconfig.json`, `npx tsc --noEmit -p apps/web/tsconfig.json`, `pnpm typecheck:tests`, `pnpm --filter server build`, `pnpm --filter web build`, `git diff --check`; all exit 0
- [X] T037 Commit the Phase 0.5 changes on `develop` (only files listed in [plan.md](./plan.md) "Source code"; exclude `graphify-out/**`); record the resulting full SHA
- [X] T038 Run the full baseline procedure in [quickstart.md](./quickstart.md) §3 in `git worktree add --detach /tmp/ma-baseline-<sha> <sha>` with explicit `MEMORY_TEST_DATABASE_URL`; exactly one full `pnpm test --runInBand --json --outputFile=…/jest.json` run; tracked status empty before and after; copy `jest.json`, `jest.log` and the command transcript to `specs/007-organization-tenancy-audit/evidence/phase-0.5/`
- [X] T039 Write `specs/007-organization-tenancy-audit/baseline-phase-0.5.md` with every field listed in [quickstart.md](./quickstart.md) §3 "Record in" (SHA, tree status before/after, Node/pnpm/lockfile SHA-256, PostgreSQL/pgvector versions, migration lists, redacted env, discovered/executed/skipped counts from `jest.json`, suites added since the historical baseline, exit code of every command, non-gating web lint result, log locations); add one link to it from `specs/007-organization-tenancy-audit/test-baseline.md` without editing the historical sections
- [ ] T040 [P] OPTIONAL (only if review point R-12 is approved): in `.github/workflows/ci.yml` add a `pgvector/pgvector:pg16` service on port 55432 with `POSTGRES_DB/USER/PASSWORD` `studio_memory`/`studio_memory`/`studio_memory_local`, job env `MEMORY_TEST_DATABASE_URL`, and a `pnpm typecheck:tests` step before `pnpm test`
- [X] T041 Commit the evidence and baseline document in a separate docs commit that names the tested SHA; `git worktree remove /tmp/ma-baseline-<sha>`

---

## Dependencies & execution order

```text
Setup (T001–T002)
   └─► Foundational (T003–T006)
          ├─► US2 (T010–T025)  ──┐
          └─► US3 (T026–T030)  ──┤   US3 shares organizationService.ts / page.tsx with US2 → run after US2 or merge carefully
US1 (T007–T009) — needs only Setup; independent of Foundational
US4 (T031–T033) — needs T007
Final (T034–T041) — needs US1–US4 complete; T038 needs T037; T039 needs T038; T041 needs T039
```

Within each story: tests (red, observed) → implementation → story run (green).

## Parallel opportunities

- T003 ∥ T007 ∥ T008 (different files).
- US2 tests T010 ∥ T011 are the same file (`tests/organizationService.test.ts`) — write together, not in parallel by different agents; T012 ∥ T013 ∥ T014 are separate files.
- US2 implementation T017 ∥ T018 (same file but independent classes — sequential if one editor), T024 (web) ∥ T019–T023 (server).
- US3 T029 (web) ∥ T028 (server).
- Final T034 ∥ T035 ∥ T040.

### Parallel example — User Story 2 tests

```text
Agent A: T012 tests/organizationUnitOfWork.test.ts
Agent B: T013 tests/organizationStrategyAtomicity.test.ts
Agent C: T014 tests/organizationBudgetRoutes.test.ts
Then:    T010 + T011 + T015 tests/organizationService.test.ts (one editor)
```

## Implementation strategy

1. **MVP = US1** (T001–T009): two of three regressions fixed with test-only edits; safe to merge alone.
2. **US2** next: closes R3 and the orphan-goal bug with atomic writes and real-PG proof — the core of Phase 0.5.
3. **US3**: removes the remaining fallback path.
4. **US4**: lands the test typecheck gate (after T007 so it starts green).
5. **Final**: commit, then one clean-worktree baseline; evidence committed separately; historical baseline untouched.

## Task summary

| Phase | Tasks | Count |
|-------|-------|-------|
| Setup | T001–T002 | 2 |
| Foundational | T003–T006 | 4 |
| US1 | T007–T009 | 3 |
| US2 | T010–T025 | 16 |
| US3 | T026–T030 | 5 |
| US4 | T031–T033 | 3 |
| Final | T034–T041 | 8 |
| **Total** | | **41** |

## Phase 8: Recheck setup

**Workflow**: tasks → implement → converge → implement, requested 2026-10-10.
The historical T001–T041 ledger and deferred optional T040 are retained. New tasks
revalidate current behavior; a checked audit task does not certify convergence.
The phase-local `spec.md` consolidates the existing plan/contract intent, and
`.specify/feature.json` now resolves this complete artifact set. PowerShell is unavailable;
perform the installed scripts' path/file/template validation directly and record the fallback.

- [X] T042 Validate `specs/007-organization-tenancy-audit/phase-0.5/spec.md`, `plan.md`, `tasks.md`, `.specify/feature.json`, the task template, inherited read-only checklist status, and absent extension hooks; record context in `specs/007-organization-tenancy-audit/phase-0.5/recheck.md`.

## Phase 9: Recheck foundation

- [X] T043 Verify `.gitignore`/`.dockerignore`, PostgreSQL availability, `apps/server/src/organization/projectValidation.ts`, UoW composition, and `phase-0.5/data-model.md` write boundaries; record source evidence in `phase-0.5/recheck.md` without expanding Phase 0.5 scope.

## Phase 10: Recheck US1 — Fixtures (P1)

**Independent test**: both fixture suites pass with PostgreSQL and zero skipped tests.

- [X] T044 [US1] Execute `tests/taskBoardView.test.ts` and `tests/eventRoutinesIntegration.test.ts` with explicit PostgreSQL environment and retain `specs/007-organization-tenancy-audit/evidence/phase-0.5-recheck/fixtures.log`; verify fixture fields/project seed per FR-001.

## Phase 11: Recheck US2 — Strategy (P1)

**Independent test**: project/status matrix, in-memory and PostgreSQL atomicity, mixed-store fail-closed wiring, and strategy UI project selection.

- [X] T045 [US2] Execute `tests/organizationProjectValidation.test.ts`, `tests/organizationService.test.ts`, `tests/organizationUnitOfWork.test.ts`, `tests/organizationStrategyAtomicity.test.ts`, and `tests/organizationBudgetRoutes.test.ts`; inspect `organizationService.ts`/`organizationStore.ts`/`organizationUnitOfWork.ts` and `apps/web/src/app/(authenticated)/organization/page.tsx` against US2/AC1–AC8; retain `evidence/phase-0.5-recheck/organization.log` and findings in `phase-0.5/recheck.md`.

## Phase 12: Recheck US3 — Delegation (P2)

**Independent test**: projectless/mismatched/foreign/retired cases, goal project reuse, and project-picker behavior.

- [X] T046 [US3] Inspect executed delegation cases in `tests/organizationService.test.ts` and the delegation path in `apps/server/src/organization/organizationService.ts`/`api/studio/taskService.ts`, including task/event failure and post-commit behavior; record the US3/FR-111 evidence and uncovered paths in `phase-0.5/recheck.md` for convergence.

## Phase 13: Recheck US4 — Typecheck (P2)

**Independent test**: strict test typecheck passes and Jest uses the same config; previous negative fixture proof remains valid if the config is unchanged.

- [X] T047 [US4] Run `pnpm typecheck:tests`, verify `tsconfig.test.json`/`jest.config.js`/`package.json` and absent `tsconfig.jestfullcheck.json`, and validate the retained negative fixture proof; retain `evidence/phase-0.5-recheck/typecheck-tests.log` per FR-007.

## Phase 14: Recheck first-pass evidence

- [X] T048 Write `specs/007-organization-tenancy-audit/phase-0.5/recheck.md` with story/requirement/gate coverage, command exits, scoped findings, hook disposition, and optional T040 deferral; complete the first implement pass before the append-only convergence assessment. If convergence changes source, run G6 again on the new clean committed SHA and save evidence separately.

**Dependencies**: T042 → T043 → T044–T047 → T048 → convergence → appended remediation tasks.
**Parallel opportunities**: fixture inspection and test-config inspection are independent; PostgreSQL gates run sequentially to avoid resource interference. No additional agents are needed.
**MVP**: US1 fixture revalidation, followed by strategy, delegation, typecheck, then convergence.
**Recheck task counts**: setup 1, foundation 1, US1 1, US2 1, US3 1, US4 1, evidence 1 = 7.

## Phase 15: Convergence

**Assessment**: 10 functional requirements, 18 acceptance scenarios, 4 success criteria,
11 research/plan decisions and G1–G7; constitution skipped (unfilled template).
Four partial findings: 2 HIGH, 2 MEDIUM; missing/contradicts/unrequested findings: 0.
Optional R-12/T040 remains deferred. Convergence itself changes only this append.

- [X] T049 [US3] HIGH — Reproduce delegation assignment-event failure in `tests/organizationService.test.ts` and real PostgreSQL task/event/deferred-COMMIT failures in `tests/organizationStrategyAtomicity.test.ts`; repair `apps/server/src/organization/organizationService.ts` to prepare the task, then strictly persist task plus assignment event in one studio transaction without changing normal `TaskService.create`; require non-success and no new task/event on failure, preserve the existing goal, prove retry/client release, and retain red/green logs per FR-111, US3/AC4, data-model: delegation write set (partial; F1).
- [X] T050 [US3] HIGH — Inject an actual placeholder project-name storage failure after delegation commit in `tests/organizationService.test.ts`; repair `apps/server/src/organization/organizationService.ts` to keep the committed delegation successful with best-effort naming and structured ID-only logging; prove the returned task/event exists and no internal diagnostic is logged per FR-111, plan: post-commit failure boundary (partial; F2).
- [X] T051 [US2] MEDIUM — Add a direct post-commit strategy naming-failure assertion to `tests/organizationService.test.ts`, checking success, committed goal/task/event, and ID-only warning; retain proof in `specs/007-organization-tenancy-audit/evidence/phase-0.5-recheck/` per FR-006, US2/AC6, research R-3 (partial; F3).
- [X] T052 MEDIUM — After T049–T051, commit source changes, run the complete `phase-0.5/quickstart.md` clean-SHA baseline with explicit PostgreSQL environment and all named gates, retain each complete run separately, update `phase-0.5/recheck.md` with exact SHA/counts/exits and requirement coverage, commit new evidence separately without changing historical baseline sections, remove the scratch worktree, and push per FR-009, SC-003, G6 (partial; F4).
