# Test & Verification Baseline (Phase 0)

**Feature**: `007-organization-tenancy-audit` | **Recorded**: 2026-10-10 | **Host**: Linux 6.8, Node via pnpm 10.17

This baseline was captured **before** any organization-migration work. It reflects the
working tree at commit `b6a586d` **plus the user's uncommitted changes** listed in
`git status` at the time (e.g. `apps/web/src/components/workflow/EditorToolbar.tsx`,
`src/agents/runtime/cliResultContent.ts`, `tests/workflowRunInput.test.ts`). No
production code, tests, schemas, or configuration were modified by Phase 0.

Raw logs (outside the repository): `/tmp/phase0/jest-full.log`,
`/tmp/phase0/jest-pg-rerun.log`, `/tmp/phase0/verify.log`,
`/tmp/phase0/tsc-jestfull-rootdir.log`, `/tmp/phase0/mem/{eval,bench}.log`.

## 1. Classification legend

| Class | Meaning |
|-------|---------|
| PASS | Actually executed and passed in this baseline |
| KNOWN-FAIL | Executed and failed for a code/test reason that pre-dates Phase 0 |
| ENV | Result depends on external infrastructure; outcome recorded for both states |
| SKIPPED | Test is gated and did not execute |
| NOT-RUN | Verification exists but was not performed (reason recorded) |

## 2. Jest (unit + integration)

### 2.1 Full run — PostgreSQL unavailable

```bash
pnpm test --runInBand          # jest.config.js loads .env → MEMORY_TEST_DATABASE_URL is set
```

- Result: **17 failed / 84 passed suites (101)**; **102 failed / 1163 passed tests (1265)**; 0 skipped; 228 s; exit 1.
- 15 of 17 failing suites failed **only** with `connect ECONNREFUSED 127.0.0.1:55432`
  (the project pgvector container `studio-memory-studio-memory-postgres-1` had exited 3 days earlier).
- Because `.env` defines `MEMORY_TEST_DATABASE_URL`, the PG-gated suites
  (`databaseUrl ? describe : describe.skip`) **did not skip** — they ran and failed on connect.
  In an environment without that variable they would be SKIPPED, not PASS.

### 2.2 Re-run of the 17 failing suites — PostgreSQL available

```bash
pnpm db:dev:up                 # starts pgvector/pgvector:pg16 on 127.0.0.1:55432 (left running)
MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory" \
  pnpm test --runInBand <17 suites>
```

- Result: **3 failed / 14 passed suites**; **2 failed / 157 passed tests (159)**; exit 1.
- Combined effective baseline (with PostgreSQL): **98/101 suites pass**, 3 KNOWN-FAIL.

### 2.3 Per-suite status of tenancy-relevant suites

| Suite | Status | Notes |
|-------|--------|-------|
| `tests/auth.test.ts` | PASS (ENV: PG) | 16 tests; fails on connect without PG |
| `tests/internalPrincipal.test.ts` | PASS | signed principal assertion |
| `tests/ownershipAuthorization.test.ts` | PASS (ENV: PG for 3 PG tests) | in-memory + Postgres ownership/tenant filters, memory_owner backfill |
| `tests/executionBff.test.ts`, `tests/executionBffRoute.test.ts` | PASS | BFF principal forwarding |
| `tests/organizationService.test.ts` | PASS | agent org chart / goals |
| `tests/organizationBudgetRoutes.test.ts` | **KNOWN-FAIL** | see §5 R3 |
| `tests/onboarding.test.ts` | PASS (ENV: PG) | |
| `tests/studioProjectsWorkspaces.test.ts` | PASS | hierarchy 006 |
| `tests/studioPostgresRollback.test.ts` | PASS (ENV: PG) | |
| `tests/dashboardSourceOfTruth.test.ts` | PASS (ENV: PG for 2 tests) | |
| `tests/eventRoutinesIntegration.test.ts` | **KNOWN-FAIL** (1 test) + ENV: PG | see §5 R2 |
| `tests/taskBoardView.test.ts` | **KNOWN-FAIL** (suite does not compile) | see §5 R1 |
| `tests/broker{Contract,Service,Http,Security}.test.ts` | PASS | |
| `tests/brokerPersistence.test.ts` | PASS (ENV: PG) | 18 tests |
| `tests/budgetPostgres.test.ts`, `tests/costBudgets.test.ts` | PASS (budgetPostgres ENV: PG) | |
| `tests/postgresMultiInstanceRecovery.test.ts` | PASS (ENV: PG) | |
| `tests/workflowRuntimeContracts.test.ts` | PASS (ENV: PG for 1 test) | |
| `tests/memoryStorage`, `memorySemanticVector`, `memoryLiveEmbedding`, `memoryDistributedJobs`, `memoryEndToEnd` | PASS (ENV: PG/pgvector) | `memoryLiveEmbedding` ran with deterministic fixtures, not a live provider |
| All other memory suites (`memoryService`, `memoryRetrieval`, `memoryTemporalSemantics`, `episodicMemory`, `proceduralMemory`, `memoryConsolidation`, …) | PASS | in-memory |
| `tests/test_workbook_context.py` | PASS | `python3 -m unittest` (pytest not installed); not part of `pnpm test` |

## 3. Typechecks, builds, lint

Executed sequentially via `/tmp/phase0/verify.log`:

| Command | Exit | Status |
|---------|------|--------|
| `pnpm build:types` | 0 | PASS |
| `npx tsc --noEmit -p tsconfig.json` (root `src/`) | 0 | PASS |
| `npx tsc --noEmit -p apps/server/tsconfig.json` | 0 | PASS |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | 0 | PASS |
| `npx tsc --noEmit -p tsconfig.brokercheck.json` | 0 | PASS |
| `npx tsc --noEmit -p tsconfig.jestfullcheck.json` | 2 | **KNOWN-FAIL (config)** — 3× `TS6059` (`tests/fixtures/*.ts`, `tests/helpers/brokerHarness.ts` not under `rootDir` `src`) |
| `npx tsc --noEmit -p tsconfig.jestfullcheck.json --rootDir .` | 0 | PASS, **but ineffective**: inherits `exclude: ["**/*.test.ts"]` from `tsconfig.json`, so only 3 helper files under `tests/` are checked. Test files are type-checked **only** by `ts-jest` at run time (that is how R1 surfaced). |
| `pnpm --filter server build` | 0 | PASS |
| `pnpm --filter web build` (`next build --webpack`) | 0 | PASS |
| `pnpm --filter web lint` (`eslint`) | 1 | **KNOWN-FAIL** — 35 problems (30 errors, 5 warnings), predominantly `react-hooks/set-state-in-effect` (e.g. `apps/web/src/lib/useStudioLocale.ts:14`) |
| `git diff --check` | 0 | PASS |

## 4. Memory benchmarks & evaluations (offline, deterministic)

Run from a scratch directory so the tracked root reports were **not** overwritten:

```bash
cd /tmp/phase0/mem
TS_NODE_PROJECT=<repo>/tsconfig.json <repo>/node_modules/.bin/ts-node --transpile-only <repo>/scripts/memory/memoryEval.ts       # exit 0
TS_NODE_PROJECT=<repo>/tsconfig.json <repo>/node_modules/.bin/ts-node --transpile-only <repo>/scripts/memory/memoryBenchmark.ts  # exit 0
```

| Metric | Value |
|--------|-------|
| eval `security_violations` | 0 |
| eval `retrieval_hit_rate` / `harmful_memory_rate` / `context_pollution_rate` | 0.7143 / 0.3333 / 0.1111 |
| benchmark cross-tenant leakage / cross-namespace leakage | 0 / 0 |
| benchmark invalidated / superseded injection | 0 / 0 |
| benchmark weaknesses (pre-existing) | candidate volume growth (4 → 13.9); 218/256 candidate-stage false positives |

These are **in-memory** fixtures; they do not prove pgvector isolation (that is covered by
`memorySemanticVector.test.ts` / `memoryStorage.test.ts` under ENV: PG).

## 5. Known baseline regressions (pre-existing; NOT caused by the organization migration)

All three were introduced by the `006-project-workspace-hierarchy` work (commit `4e8f307`,
2026-10-07; migration `017_project_workspace_hierarchy.sql`), which made `projectId` mandatory on
tasks and removed implicit default-project creation. None were modified in Phase 0.

### R1 — `tests/taskBoardView.test.ts` (suite fails to compile)

- **Symptom**: `TS2322 … Types of property 'projectId' are incompatible` at `tests/taskBoardView.test.ts:10`.
- **Root cause**: the `task()` fixture builder (`tests/taskBoardView.test.ts:9-25`) does not set
  `projectId` / `workspaceId`; `apps/web/src/lib/taskStatus.ts:52-53` now declares
  `projectId: string; workspaceId: string | null` (required) on `Task`.
- **Classification**: **test fixture problem** (contract change not propagated to the fixture).
- **Smallest correct fix**: add `projectId: "project-1", workspaceId: null` to the fixture defaults.
- **Implication**: test files are not covered by any `tsc` gate (§3), so contract drifts in
  tests surface only at Jest time. Phase gates should add a real test-typecheck.

### R2 — `tests/eventRoutinesIntegration.test.ts` › "saves, lists, and isolates task comments by tenant"

- **Symptom**: `null value in column "project_id" of relation "studio_tasks" violates not-null constraint`.
- **Root cause**: raw SQL fixture at `tests/eventRoutinesIntegration.test.ts:67-71` inserts into
  `studio_tasks` without `project_id`; migration 017 (`017_project_workspace_hierarchy.sql:114`)
  made it `NOT NULL`. 32 other tests in the suite pass.
- **Classification**: **test fixture problem** (fixture bypasses the store and the new contract).
- **Smallest correct fix**: insert a `studio_projects` row for `tenantA` and add `project_id`
  to the task INSERT (or create the task through `PostgresStudioStore`).
- **Implication**: raw-SQL fixtures that bypass repository invariants will break again when
  `organization_id` columns become `NOT NULL`; future fixtures should use store APIs or shared builders.

### R3 — `tests/organizationBudgetRoutes.test.ts` (`POST /organization/strategy` → 400, expected 201)

- **Symptom**: `{"error":"No active project in this organization; create a project before continuing"}`.
- **Code path**: `apps/server/src/organization/organizationRoutes.ts:20` →
  `OrganizationService.requestStrategyProposal` (`apps/server/src/organization/organizationService.ts:130-151`) →
  `createGoal` (persists goal, line 137) → `ensureTenantProjectWorkspaceDefaults`
  (`apps/server/src/api/studio/tenantDefaults.ts:25-36`, now throws a plain `Error` instead of
  creating defaults) → `respondWithApiError` (`apps/server/src/api/shared/http.ts:38`) maps any
  non-`ApiError` to **400** and echoes its message.
- **Verified side effect** (out-of-tree repro `/tmp/phase0/repro.ts`, in-memory stores): the
  request returns 400 **and leaves an orphan goal in status `proposed`**, because the defaults
  lookup at line 138 runs **outside** the `try` (lines 139-150) that cancels the goal on failure.
- **Classification**: **combination** —
  1. *contract inconsistency*: org-level operations (strategy, delegate at line 121) still assume
     an implicit default project, which hierarchy 006 removed;
  2. *production bug*: non-atomic write leaves a dangling `proposed` goal; error mis-classified as 400;
  3. *test fixture*: test never creates a project.
- **Required repair (aligned with approved D-6)**: validate the explicitly selected project before `createGoal`; no first-active-project fallback. Return typed validation/conflict errors and update fixtures to supply the project. Persist the strategy goal and task in one shared transaction across their stores; cancellation after failure is not rollback. Add real-PG failure injection after goal insertion to prove neither new record survives, alongside missing/foreign-project tests. Apply explicit project validation to `delegate()`.
- **Architectural implication**: organization-level work (strategy, goals) is not naturally
  project-scoped, but every task must have a project. The target design must decide whether
  organization-level tasks belong to an explicit "organization operations" project or whether
  tasks may be organization-scoped without a project (see decision D-6 in `plan.md`).

## 6. Verification NOT performed

| Verification | Command | Reason |
|--------------|---------|--------|
| Playwright e2e (`apps/web/e2e/*.spec.ts`, incl. `organization-budgets.spec.ts`) | `pnpm --filter web exec playwright test` | Requires running web + server + browser; out of Phase 0 scope |
| Docker worker image / e2e | `pnpm worker:image:smoke`, `worker:e2e:*`, `verification:docker` | Requires building worker image and provider credentials |
| Real-tool / load verification | `pnpm verification:real-tools`, `verification:load` | Requires live services and credentials |
| Live-provider memory benchmark | `pnpm memory:benchmark -- --live` / `--live-embedding` | Requires provider API keys; would overwrite tracked reports |
| mTLS / Vault broker against real infra | — | Known gap (see `CLAUDE.md`); fake HTTP store only |
| Multi-instance broker rate limiting | — | Rate limiters are process-local (known gap) |

## 7. Gate commands for later phases

The historical 98/101 result combines the original full run with a targeted rerun on a dirty working tree; it is not a full-run result for commit `ba24f51e45b2daed132a8217199ab7b81aab6f8a`. Phase 0.5 must produce a fresh, separate baseline from a clean committed checkout: record full SHA, clean tracked working-tree status before/after, runtime and dependency-lock versions, database/migration versions, redacted environment configuration, exact commands, and durable CI/artifact log locations. Run the entire suite once with PostgreSQL enabled, not only previously failing suites; report all added tests and skips. Do not overwrite or relabel the historical evidence.

Every later phase must reproduce at least:

```bash
pnpm db:dev:up
pnpm test --runInBand                                   # with MEMORY_TEST_DATABASE_URL set
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p apps/server/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
pnpm --filter server build && pnpm --filter web build
git diff --check
```

and report deltas against §2–§5. The three KNOWN-FAIL suites and the lint/jestfullcheck
failures must be listed explicitly until fixed; they must not be counted as passing.


Fresh verified baseline: [Phase 0.5 implementation baseline](./baseline-phase-0.5.md).
