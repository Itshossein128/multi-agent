# Phase 0.5 workflow recheck — first implementation pass

Requested sequence: tasks → implement → converge → implement. The user confirmed
Phase 0.5 scope. The phase-local spec consolidates the existing parent FR-111,
phase plan, research, contract and data model. The parent spec and both plans are unchanged.
The ignored machine-local `.specify/feature.json` selects this phase.

PowerShell is unavailable and the installed scripts are not executable in this shell
(exit 126). Their context, required file, and template checks were performed directly:
spec, plan, tasks, and the task template all exist at absolute paths. The inherited
requirements checklist is read-only and passes 16/16. The constitution remains an
unfilled template. `.specify/extensions.yml` is absent: no before/after hooks apply.

## Generated task pass

T042–T048 revalidate four stories in dependency order while preserving T001–T041.
CI task T040 remains deferred and excluded from required completion counts.

| Source | Current evidence | Assessment before convergence |
|---|---|---|
| US1/AC1–AC2, FR-001, G1 | Fixture fields/project seed inspected; 2 suites / 27 tests passed, exit 0 | Satisfied |
| US2/AC1–AC5/AC8, FR-002/003/005, G2/G3 | 5 organization suites / 39 tests passed, exit 0; PostgreSQL task/event/COMMIT failure injection executed | Satisfied for exercised cases |
| US2/AC6, FR-006, R-3 | Strategy catches placeholder failure after the UoW commit and logs IDs; dedicated failure assertion absent | Behavior implemented; boundary proof missing |
| US2/AC7, US3/AC5 | Organization page requires strategy project, offers creation, and selects delegation project; prior browser evidence retained | UI unchanged and previously verified |
| US3/AC1–AC3, FR-004, G2 | Existing delegation validation cases passed; no organization fallback caller remains | Satisfied |
| US3/AC4, FR-111, data-model delegation write set | `delegate` calls `TaskService.create`, which sets `requireAssignmentTrigger: false`; event failures are swallowed | Partial: task/event outcome not enforced |
| FR-111, organization task-creation failure boundary | `TaskService.create` invokes placeholder naming after transaction commit without catching; delegation inherits it | Partial: failed response can follow committed records |
| US4/AC1–AC3, FR-007, G5 | Strict shared config inspected; test typecheck exit 0; retained negative proof exits 2 for missing projectId; config unchanged | Satisfied |
| FR-008, SC-004, G4/G7 | Existing normal TaskService behavior retained; no migration/reset/Phase 1 changes | Scope preserved |
| FR-009, SC-003, G6 | Prior baseline on 5bb28b41af0357a726845f5d110473a996ab56f2: 104 suites / 1312 tests, all required gates passed; current source/config matches it | New clean-SHA baseline required after any remediation |

First-pass logs are in `../evidence/phase-0.5-recheck/`: `fixtures.log`,
`organization.log`, and `typecheck-tests.log`. PostgreSQL environment was explicit at
127.0.0.1:55432; credentials are omitted from this report. All three commands exited 0.
Neither the historical baseline nor this first-pass result certifies the uncovered
failure paths. Convergence assesses them next and appends traceable repair tasks.


## Second implementation pass — convergence findings closed

- **F1 / T049**: in-memory and real-PG event-failure tests reproduced swallowed failures
  (2 failed / 29 passed tests, exit 1). Delegation now validates and prepares first,
  then persists task plus assignment event strictly in one studio transaction.
  Task, event, and deferred-COMMIT failures preserve the original goal and leave no new
  task/event. Retry succeeds and clients are released. Normal `TaskService.create` is unchanged.
- **F2 / T050**: a real placeholder-name storage failure reproduced HTTP 400 after a
  committed delegation (1 failed / 21 passed tests, exit 1). Delegation naming now runs
  best effort after commit; HTTP 201 returns the committed task and the warning contains
  only goal/task IDs. Internal diagnostics are excluded.
- **F3 / T051**: strategy naming-failure proof checks HTTP 201, committed goal/task/event,
  and ID-only warning. Strategy behavior already satisfied the plan; its proof is now explicit.
- **F4 / T052**: fresh clean-source baseline recorded below. The targeted remediation
  check passed 7 suites / 85 tests, exit 0, with PostgreSQL executed. The browser check
  passed all three scenarios through the actual Next page and authenticated BFF, using
  isolated in-memory adapters and development authentication. Temporary servers were
  stopped before the complete baseline. It does not prove deployed browser-to-PostgreSQL execution.

Red/green logs and browser evidence are in
[`../evidence/phase-0.5-recheck/`](../evidence/phase-0.5-recheck/).

## Fresh clean-source baseline

- Tested source SHA: `987bee4e4aa604b51cb4a8de1de68bd4cd83d01c`.
- Worktree: `/tmp/ma-baseline-987bee4e4aa604b51cb4a8de1de68bd4cd83d01c` (removed after verification).
- Started `2026-10-10T20:00:14.772671+00:00`; finished `2026-10-10T20:04:39.872351+00:00` (UTC).
- Tracked status before/after: both empty.
- Node `v25.2.1`; pnpm `10.17.0`.
- Lockfile SHA-256: `9370e0b172d9d61e40c6351df99c753aacf698981b24eed5609450dc5b5a75df`.
- Database: `PostgreSQL 16.15 (Debian 16.15-1.pgdg12+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit; 0.8.6`.
- Explicit `MEMORY_TEST_DATABASE_URL` at `127.0.0.1:55432`; credentials redacted.
  `STUDIO_DATABASE_URL`, `MEMORY_DATABASE_URL`, `NODE_ENV` removed from the baseline
  environment; no `.env` files copied.
- The result is one complete full Jest run. No targeted results were combined.
- All named required gates exited 0. Web lint remains non-gating: exit 1,
  30 errors / 5 warnings, unchanged from the historical baseline.
- Seven new tests were added: two in-memory delegation rollback cases, three real-PG
  delegation failure cases, and two naming-failure cases. Suites remain 104; tests rise
  from 1312 to 1319. All PostgreSQL tests executed with zero skips.

| Jest field | Count |
|---|---:|
| `numTotalTestSuites` | 104 |
| `numPassedTestSuites` | 104 |
| `numFailedTestSuites` | 0 |
| `numPendingTestSuites` | 0 |
| `numTotalTests` | 1319 |
| `numPassedTests` | 1319 |
| `numFailedTests` | 0 |
| `numPendingTests` | 0 |
| `numTodoTests` | 0 |

Full [Jest JSON](../evidence/phase-0.5-recheck/baseline/jest.json),
[Jest log](../evidence/phase-0.5-recheck/baseline/jest.log),
[metadata](../evidence/phase-0.5-recheck/baseline/metadata.json),
[command metadata](../evidence/phase-0.5-recheck/baseline/commands.json),
[transcript](../evidence/phase-0.5-recheck/baseline/command-transcript.log),
and [gate output](../evidence/phase-0.5-recheck/baseline/gates.log) are retained.
Committed logs redact database credentials and normalize trailing whitespace.
A [source-file hash manifest](../evidence/phase-0.5-recheck/source-files-sha256.json)
confirms the final source/config files match the tested checkout.

| Command | Exit | Seconds |
|---|---:|---:|
| `git worktree add --detach /tmp/ma-baseline-987bee4e4aa604b51cb4a8de1de68bd4cd83d01c 987bee4e4aa604b51cb4a8de1de68bd4cd83d01c` | 0 | 0.477 |
| `git status --porcelain --untracked-files=no` | 0 | 0.234 |
| `node --version` | 0 | 0.005 |
| `pnpm --version` | 0 | 0.972 |
| `pnpm install --frozen-lockfile` | 0 | 4.982 |
| `psql $MEMORY_TEST_DATABASE_URL -Atc select version(); select extversion from pg_extension where extname='vector';` | 0 | 0.3 |
| `pnpm build:types` | 0 | 2.746 |
| `pnpm test --runInBand --json --outputFile=/tmp/phase0.5-recheck/baseline/jest.json` | 0 | 172.371 |
| `npx tsc --noEmit -p tsconfig.json` | 0 | 4.402 |
| `npx tsc --noEmit -p apps/server/tsconfig.json` | 0 | 5.242 |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | 0 | 6.314 |
| `pnpm typecheck:tests` | 0 | 8.982 |
| `pnpm --filter server build` | 0 | 7.39 |
| `pnpm --filter web build` | 0 | 49.917 |
| `git diff --check` | 0 | 0.706 |
| `git status --porcelain --untracked-files=no` | 0 | 0.02 |

Additional checks: migration inventory execution, lockfile checksum and worktree removal
exit 0; browser check exit 0; web lint exit 1 as documented. The applied migration lists
were verified in a scratch schema, then that schema was dropped:

- `001_studio_entities.sql`
- `002_runs.sql`
- `003_tasks.sql`
- `004_ownership.sql`
- `005_users.sql`
- `006_task_domain.sql`
- `007_run_tool_snapshot.sql`
- `008_run_result.sql`
- `009_run_memory_access.sql`
- `010_procedural_memory_status.sql`
- `011_projects_workspaces.sql`
- `012_event_routines_triggers.sql`
- `013_event_routines_hardening.sql`
- `014_organization_goals.sql`
- `015_cost_budgets.sql`
- `016_run_execution_leases.sql`
- `017_project_workspace_hierarchy.sql`
- `001_memories.sql`
- `002_pgvector.sql`
- `003_temporal_validity.sql`
- `004_memory_jobs.sql`
- `005_memory_jobs_tenant_identity.sql`

## Final requirement and acceptance coverage

| Requirements / acceptance | Final evidence |
|---|---|
| FR-001, US1/AC1–AC2, G1 | Both fixture suites pass in the full run |
| FR-002/005, US2/AC1–AC2/AC8, G2 | Shared 400/404/409 validation and goal optional-project cases pass |
| FR-003, US2/AC3–AC5, G3 | Atomic success/failure, mixed-store 503, PG task/event/COMMIT boundaries and client release pass |
| FR-006, US2/AC6 | Actual naming-write failure still returns 201 and logs only IDs |
| US2/AC7, US3/AC5 | Fresh browser flow proves required selection, project navigation, strategy project and delegation request |
| FR-004, US3/AC1–AC3, G2 | Explicit project resolution/mismatch/isolation/retired cases pass, no fallback |
| FR-111, US3/AC4 | New memory/PG delegation failure and retry cases pass; post-commit naming does not report failed creation |
| FR-007, US4/AC1–AC3, G5 | Strict shared config; test typecheck passes; unchanged config's retained negative fixture proof remains valid |
| FR-008, SC-004, G4/G7 | Normal task suites pass; TaskService unchanged in remediation; no migrations/reset/Phase 1 changes |
| FR-009, SC-001–SC-003, G6 | One clean-source full run plus all named gates passes, zero failures/skips; evidence committed separately |

Optional R-12/T040 remains deferred. Existing web lint and global unexpected-error mapping
remain outside Phase 0.5's gating scope. Original plan and historical baseline content are preserved.
The final convergence assessment checks only this phase's complete spec/plan/tasks set.

## Final convergence outcome

**Converged for Phase 0.5**: 10 functional requirements, 18 acceptance scenarios,
4 success criteria, 11 plan decisions and G1–G7 checked; zero remaining required
findings. All 51 required tasks are complete; optional T040 remains deferred. The
constitution check was skipped because it is a template. Before/after extension
hooks are absent. The final assessment left tasks.md byte-for-byte unchanged;
no empty convergence phase was appended. Source-file hashes match the tested SHA.

For subsequent sessions, select this co-located phase with
`SPECIFY_FEATURE_DIRECTORY=specs/007-organization-tenancy-audit/phase-0.5`;
`.specify/feature.json` is intentionally ignored machine-local state. PowerShell
helpers require PowerShell; this run used their equivalent path/file checks directly.
The parent organization migration program remains outside this convergence result.
