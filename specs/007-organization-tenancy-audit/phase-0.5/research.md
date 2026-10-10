# Phase 0.5 Research — Baseline Repair

**Plan**: [plan.md](./plan.md) | **Date**: 2026-10-10 | **Inspected at**: `111f719` (develop, in sync with origin)

Each item: Decision / Rationale / Alternatives considered. Evidence is from code read at `111f719`.

## Inspection facts

- `OrganizationService.requestStrategyProposal` persists the goal (`organizationService.ts:137`) before
  resolving a project via `ensureTenantProjectWorkspaceDefaults` (`:138`, outside the `try` at `:139-150`);
  on task failure it **cancels** the goal (`:148`) instead of rolling back. `delegate` uses the same fallback (`:121`).
- Both stores share one PostgreSQL pool in production: `PostgresOrganizationStore(studio.pool)`
  (`apps/server/src/index.ts:129`) and `PostgresStudioStore(pool)` (`apps/server/src/studio/composition.ts:24-26`).
- `PostgresStudioStore` already supports a client-bound instance (`constructor(pool, client?)`,
  `postgres-studio-store.ts:287-288`) and `transaction()` rejects nesting (`:291`).
  `PostgresOrganizationStore` has no transaction or client support (`organizationStore.ts:64-112`).
- `InMemoryStudioStore.transaction` snapshots/restores only studio maps (`in-memory-studio-store.ts:72-…`);
  `InMemoryOrganizationStore` has no snapshot.
- `TaskService.create` validates (reads), then writes task + assignment-trigger outbox event in
  `store.transaction` (`taskService.ts:251-255`), then runs `derivePlaceholderNames` **after commit** (`:256`).
  It already rejects unknown/foreign (tenant-scoped `getProject`) and retired projects (`:1197-1200`).
  `saveTask` and `enqueueTriggerEvent` do not open nested transactions.
- `createStudioRouter` defaults `organizationStore` to `InMemoryOrganizationStore` even when the studio
  store is Postgres (`apps/server/src/api/studio.ts:33-39`).
- Web UI sends `projectId: projectId || null` for strategy ("No project" option) and only `{agentId}` for
  delegation (`apps/web/src/app/(authenticated)/organization/page.tsx:60,65,75`).
- `tests/organizationService.test.ts:43` calls strategy without `projectId`, and `:38` delegates a goal
  without a project — both currently rely on the fallback.
- Measured with a candidate strict test tsconfig (out-of-tree, `/tmp/phase0/tscheck`): **exactly 1 error**
  across all test files — the R1 fixture (`tests/taskBoardView.test.ts:10`). Strict and non-strict agree.
- `jest.config.js:11` passes inline compiler options to ts-jest (not the root tsconfig), so Jest-time type
  checking is non-strict and differs from any `tsc` gate.
- CI (`.github/workflows/ci.yml`) has no PostgreSQL service and no typecheck step; `.env` is git-ignored, so in
  CI `MEMORY_TEST_DATABASE_URL`-gated suites **skip**, while `onboarding`, `postgresMultiInstanceRecovery`, and
  `eventRoutinesIntegration` hard-code `127.0.0.1:55432` and would fail. `gh run list` shows no recorded runs.
- Working tree at inspection: tracked file `graphify-out/2026-10-10/.graphify_labels.json` modified by an
  external tool → the main checkout is not a clean baseline source.

## R-1 Atomicity across organization and studio stores

- **Decision**: introduce an `OrganizationUnitOfWork` port with `run<T>(op: ({ studio, organization }) => Promise<T>)`.
  - Postgres: one client from the shared pool, `BEGIN`, construct `new PostgresStudioStore(pool, client)` and
    `new PostgresOrganizationStore(pool, client)`, `COMMIT`/`ROLLBACK`, always `release()`.
  - In-memory: `studio.transaction(tx => …)` plus an organization-store snapshot restored on error.
  - Strategy performs **all validation first**, then inside `run`: `saveGoal` → insert task → enqueue
    assignment trigger. Commit makes all three visible together.
- **Rationale**: the two tables live in the same database and pool; a single transaction gives true
  atomicity (incl. crash between writes), which compensation cannot.
- **Alternatives**: compensating delete/cancel (not atomic under crash; leaves history) — rejected by the
  corrected plan; moving goals into `StudioStore` (large API churn) — rejected; a single SQL CTE (bypasses
  `TaskService` validation and outbox logic) — rejected.

## R-2 Calling task creation inside an outer transaction

- **Decision**: split `TaskService.create` into `prepareCreate(body, principal) → StudioTask` (validation and
  reads only, no writes) and `persistNew(task, principal, tx)` (saveTask + `enqueueAssignmentTrigger(..., tx)`).
  `create()` = `prepareCreate` + `store.transaction(tx => persistNew(...))` + `derivePlaceholderNames`
  (unchanged behavior). Strategy calls `prepareCreate` before the unit of work and `persistNew` inside it.
  `createProject` inline creation is rejected in the strategy path (it writes during preparation).
- **Rationale**: keeps one validation path; avoids weakening the "nested transactions unsupported" guard.
- **Alternatives**: make `transaction()` re-entrant when client-bound — rejected (changes a global safety
  guard); duplicate validation in `OrganizationService` — rejected (drift).

## R-3 Post-commit placeholder naming in the strategy path

- **Decision**: after commit, call placeholder derivation best-effort (catch + structured log
  `organization.strategy.placeholder_failed`); the request still returns 201 with the committed goal/task.
- **Rationale**: naming is cosmetic and must not turn a committed operation into a reported failure.
- **Alternatives**: include it in the transaction — rejected (it can rename unrelated project rows and
  widens the transaction); skip it — rejected (behavior parity with normal task creation).

## R-4 Explicit, authorized project for strategy

- **Decision**: `projectId` is **required**. Validation before any write, via a shared helper
  `requireActiveProject(projectId, principal)`:
  missing/blank → `400 projectId is required`; not visible to the caller's tenant (unknown or foreign) →
  `404 Project not found` (same response for both, no existence disclosure); `status !== "active"` →
  `409 Project is retired`. "Authorized" in Phase 0.5 = visible through the principal-scoped store in the
  caller's tenant and active; role-based permission arrives in Phase 2 (`projects`/`strategy.request`).
- **Rationale**: approved D-6; no first-active-project fallback.
- **Alternatives**: auto-create an "Operations" project — deferred (UI offers creation instead);
  keep 400 for unknown project — rejected (404 avoids distinguishing foreign from missing).

## R-5 Explicit project for delegation

- **Decision**: effective project = goal's `projectId` if set; a request `projectId` is then optional and must
  equal it (`400 projectId must match the goal's project`). If the goal has no project, request `projectId` is
  required (`400`). Same `requireActiveProject` checks (404/409). Remove the `ensureTenantProjectWorkspaceDefaults`
  call. Delegation creates a single task through `TaskService.create` (already transactional).
- **Rationale**: a goal's project, set explicitly at goal creation, counts as explicit; keeps goal↔task scope
  coherent. **Review point**: if delegations should be allowed into other projects, relax the equality rule.
- **Alternatives**: always require body `projectId` — stricter but redundant when the goal has one.

## R-6 `POST /organization/goals` project validation

- **Decision**: when `projectId` is supplied, use the same `requireActiveProject` (404/409) instead of
  today's `400 Project not found` (`organizationService.ts:69`). `projectId` stays optional for goals.
- **Rationale**: one validation rule for all organization operations. Minor status-code change; no test asserts it.

## R-7 Composition and fail-closed wiring

- **Decision**: `createStudioRouter(..., organizationUnitOfWork?)`. Production (`index.ts`) passes
  `new PostgresOrganizationUnitOfWork(studio.pool)` when Postgres, in-memory UoW otherwise. Router default:
  in-memory UoW only when **both** stores are in-memory instances; otherwise an unavailable UoW that throws
  `ApiError(503, "Atomic organization operations are not configured")` before any write.
  `OrganizationService` constructor takes the UoW as an optional 4th argument with the same defaulting.
- **Rationale**: never silently run non-atomic writes on mixed stores; existing tests that build a Postgres
  studio store without an organization store are unaffected unless they call strategy.
- **Alternatives**: `instanceof`-sniffing pools inside stores — rejected (hidden coupling).

## R-8 Real-PostgreSQL failure injection

- **Decision**: new suite `tests/organizationStrategyAtomicity.test.ts`, per-test random schema +
  `runStudioMigrations` (existing pattern). Inject failures with **test-only database triggers** created in the
  scratch schema:
  1. `BEFORE INSERT ON studio_tasks … RAISE EXCEPTION` → failure after goal insert, before task completion;
  2. `BEFORE INSERT ON studio_trigger_events … RAISE` → failure after task insert, before commit;
  3. `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` on `studio_tasks` → failure **at COMMIT**.
  For each: response non-2xx; counts of `studio_organization_goals`, `studio_tasks`, `studio_trigger_events`
  for the tenant unchanged; pool has no leaked client (`pool.waitingCount === 0`, a follow-up strategy
  request succeeds after dropping the trigger). Also: missing/foreign/retired project → 400/404/409 with zero
  new rows; success path → exactly one goal, one task (metadata `organizationGoalId`, `strategyProposal`), one
  assignment event, all committed. The suite is gated like other PG suites but **must execute** in the gate run
  (skipped ≠ passed).
- **Rationale**: real DB errors at each write boundary, including commit, with no production fault hooks.
- **Alternatives**: mocking `pool.query` — not real PostgreSQL; production fault-injection flags — rejected.
- **Note**: unexpected errors currently map to HTTP 400 with the raw message (`http.ts:38`, gap G-AZ-8,
  Phase 2). Phase 0.5 asserts non-2xx + no rows and records the observed status; it does not change the global
  error handler.

## R-9 In-memory parity tests

- **Decision**: extend `tests/organizationService.test.ts` (or new in-memory suite) with injected failures via
  `jest.spyOn(studio, "saveTask")` / `enqueueTriggerEvent` rejecting → no goal, no task, no event; plus
  missing/foreign/retired project cases and the mixed-store 503 case.

## R-10 Test TypeScript configuration

- **Decision**: add `tsconfig.test.json` (strict; `rootDir "."`; `noEmit`; `types: ["jest","node"]`;
  `jsx: "react-jsx"`; `lib: es2022, dom, dom.iterable`; `paths` mirroring `jest.config.js` `moduleNameMapper`
  (`@/*`, `@multi-agent/types`, `next-auth`, `next-auth/*`); `include: ["tests/**/*.ts", "src/**/*.test.ts"]`;
  no `*.test.ts` exclude). Delete the broken `tsconfig.jestfullcheck.json`. Add script `typecheck:tests`
  (`tsc -p tsconfig.test.json`). Point ts-jest at the same file (`tsconfig: "<rootDir>/tsconfig.test.json"`)
  so Jest and `tsc` agree.
- **Rationale**: measured cost is one existing error (R1); strict is affordable.
- **Alternatives**: patch `jestfullcheck` (`rootDir`, override `exclude`) — workable but keeps a misleading
  name; non-strict — no benefit given the measurement.
- **Risk**: switching ts-jest to strict could surface errors only visible under ts-jest's per-file
  compilation; mitigated by running the full suite in the gate.

## R-11 Fresh baseline on a clean committed SHA

- **Decision**: after Phase 0.5 changes are committed, run the baseline in an isolated worktree:
  `git worktree add /tmp/ma-baseline-<sha> <sha>` → `pnpm install --frozen-lockfile` → start PG
  (`pnpm db:dev:up`) → run with explicit env (no `.env` copy):
  `MEMORY_TEST_DATABASE_URL=… pnpm test --runInBand --json --outputFile=<evidence>/jest.json` plus full log.
  Record: full SHA; `git status --porcelain --untracked-files=no` before/after (must be empty); Node, pnpm,
  `pnpm-lock.yaml` SHA-256; PostgreSQL/pgvector versions; applied studio/memory migration lists; redacted
  env (variable names, hosts, no secrets); exact commands; durations; discovered/executed/skipped counts
  (`numTotalTestSuites`, `numTotalTests`, `numPendingTests`, …) from `jest.json`; the typecheck/build commands.
  Evidence committed under `specs/007-organization-tenancy-audit/evidence/phase-0.5/` in a **separate docs
  commit** that references the tested SHA; `test-baseline.md` keeps the historical baseline unchanged and links
  the new `baseline-phase-0.5.md`.
- **Rationale**: the main checkout is dirty (graphify) and `.env`-dependent; a worktree gives an exact,
  reproducible tree without touching the user's checkout.
- **Alternatives**: rely on CI — no runs recorded and no PG service; see R-12.

## R-12 CI alignment (review point)

- **Decision (recommended, optional for Phase 0.5 DoD)**: add a `pgvector/pgvector:pg16` service, set
  `MEMORY_TEST_DATABASE_URL`, and add `pnpm typecheck:tests` to `.github/workflows/ci.yml`, so the same gate
  runs remotely with durable logs.
- **Rationale**: today CI would skip most PG suites and fail three hard-coded ones; GitHub shows no runs.
- **Alternative**: keep CI unchanged and rely on committed local evidence (meets the documented DoD).

## Out of scope (recorded, not changed)

- Other `ensureTenantProjectWorkspaceDefaults` callers (`taskService.ts:1179-1185`,
  `dashboardService.ts:215`) — not organization operations; revisit in Phase 2.
- Global error mapping (G-AZ-8), role permissions, schemas, data reset, Phase 1 work.
