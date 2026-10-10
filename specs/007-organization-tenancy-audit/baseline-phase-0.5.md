# Phase 0.5 — Verified implementation baseline

The required Phase 0.5 work is complete. One complete successful Jest run on a clean,
committed source tree passed **104 suites / 1312 tests**, with **zero failed or skipped tests**.
This is baseline repair, not implementation of the organization migration program.
Optional CI task T040 remains deferred pending review point R-12.

## Source and runtime

- Tested source SHA: `5bb28b41af0357a726845f5d110473a996ab56f2`.
- Isolated worktree: `/tmp/ma-baseline-5bb28b41af0357a726845f5d110473a996ab56f2`.
- Started: `2026-10-10T19:45:46.310490+00:00`; finished: `2026-10-10T19:49:45.925270+00:00` (UTC).
- Tracked status before and after: empty (`git status --porcelain --untracked-files=no`).
- Node: `v25.2.1`; pnpm: `10.17.0`.
- `pnpm-lock.yaml` SHA-256: `9370e0b172d9d61e40c6351df99c753aacf698981b24eed5609450dc5b5a75df`.
- PostgreSQL / pgvector: `PostgreSQL 16.15 (Debian 16.15-1.pgdg12+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit; 0.8.6`.
- Explicit `MEMORY_TEST_DATABASE_URL`: PostgreSQL at `127.0.0.1:55432`; credentials redacted.
- `STUDIO_DATABASE_URL`, `MEMORY_DATABASE_URL`, and `NODE_ENV` removed from the baseline
  process environment. No `.env` files copied into the isolated checkout.
- No migration files added or changed, no database reset, and no Phase 1 implementation changes.
- Temporary baseline worktree removed after verification (exit 0).

## Complete Jest result

Counts below come directly from [jest.json](./evidence/phase-0.5/jest.json), not a combination of runs.
The full output is [jest.log](./evidence/phase-0.5/jest.log).

| JSON field | Count |
|------------|-------|
| `numTotalTestSuites` | 104 |
| `numPassedTestSuites` | 104 |
| `numFailedTestSuites` | 0 |
| `numPendingTestSuites` | 0 |
| `numTotalTests` | 1312 |
| `numPassedTests` | 1312 |
| `numFailedTests` | 0 |
| `numPendingTests` | 0 |
| `numTodoTests` | 0 |

The historical baseline discovered 101 suites / 1265 tests. Three new suites provide 20 tests:
`organizationProjectValidation.test.ts` (7), `organizationUnitOfWork.test.ts` (5),
and `organizationStrategyAtomicity.test.ts` (8). Sixteen new tests extend
`organizationService.test.ts`; the repaired `taskBoardView` fixture now lets its 11 tests execute.
The resulting total is 104 suites / 1312 tests. PostgreSQL-gated suites executed, including
transaction failures during task insertion, event insertion and deferred COMMIT.

## Commands and gates

All required commands exited 0. Durations are wall-clock seconds; timestamps and working
locations are in [commands.json](./evidence/phase-0.5/commands.json).
[Command transcript](./evidence/phase-0.5/command-transcript.log),
[setup output](./evidence/phase-0.5/setup.log), and
[gate output](./evidence/phase-0.5/gates.log) retain the exact invocation and output.

| Command | Exit | Seconds | Output |
|---------|------|---------|--------|
| `git worktree add --detach /tmp/ma-baseline-5bb28b41af0357a726845f5d110473a996ab56f2 5bb28b41af0357a726845f5d110473a996ab56f2` | 0 | 0.435 | `setup.log` |
| `git status --porcelain --untracked-files=no` | 0 | 0.217 | `command-transcript.log` |
| `node --version` | 0 | 0.004 | `command-transcript.log` |
| `pnpm --version` | 0 | 0.143 | `command-transcript.log` |
| `pnpm install --frozen-lockfile` | 0 | 3.224 | `setup.log` |
| `psql $MEMORY_TEST_DATABASE_URL -Atc select version(); select extversion from pg_extension where extname='vector';` | 0 | 0.089 | `command-transcript.log` |
| `pnpm build:types` | 0 | 1.681 | `gates.log` |
| `pnpm test --runInBand --json --outputFile=/tmp/phase0.5/baseline/jest.json` | 0 | 161.01 | `jest.log` |
| `npx tsc --noEmit -p tsconfig.json` | 0 | 5.835 | `gates.log` |
| `npx tsc --noEmit -p apps/server/tsconfig.json` | 0 | 5.651 | `gates.log` |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | 0 | 6.423 | `gates.log` |
| `pnpm typecheck:tests` | 0 | 8.471 | `gates.log` |
| `pnpm --filter server build` | 0 | 6.543 | `gates.log` |
| `pnpm --filter web build` | 0 | 39.875 | `gates.log` |
| `git diff --check` | 0 | 0.004 | `gates.log` |
| `git status --porcelain --untracked-files=no` | 0 | 0.004 | `command-transcript.log` |

Additional checks: `pnpm --filter web lint` exited 1 with the same documented
**30 errors / 5 warnings** ([log](./evidence/phase-0.5/web-lint.log)); it is non-gating
per the plan. Focused organization-page lint reports the pre-existing effect error;
new project navigation uses Next `Link`.
The focused memory benchmark rerun exited 0 (8 tests), migration inventory verification
exited 0, and the browser check exited 0 (three checked scenarios).

## Applied migration inventory

The suites use isolated schemas and the migration runners. An additional isolated-schema
run on this SHA recorded each applied migration ([proof](./evidence/phase-0.5/migration-proof.log));
the scratch schema was dropped afterwards. Studio migrations:

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

Memory migrations (pgvector enabled):

- `001_memories.sql`
- `002_pgvector.sql`
- `003_temporal_validity.sql`
- `004_memory_jobs.sql`
- `005_memory_jobs_tenant_identity.sql`

## Failure history and verification boundary

The first complete clean-worktree attempt on this same SHA failed the existing memory
benchmark serialization assertion: its Git commit field was `null`. That attempt reported
103 passed / 1 failed suites and 1311 passed / 1 failed tests,
with zero skipped tests. Its [Jest JSON](./evidence/phase-0.5/failed-attempt/jest.json),
[output](./evidence/phase-0.5/failed-attempt/jest.log), and command metadata are retained separately.
The focused suite passed, then the full baseline procedure was rerun in a freshly created
clean worktree, with temporary browser/server processes stopped. The precise cause of the
initial Git-provenance failure was not established. The successful baseline above is one
entire run and does not combine that failed attempt with targeted results.
An earlier attempt at `685b4c9` was interrupted after newly introduced anchor lint errors
were found; it is not counted as a baseline. Those links were fixed in the tested source SHA.

Browser verification used the actual Next organization page and authenticated BFF, with
isolated in-memory adapters and development authentication. It checked required strategy
project selection, navigation to `/projects`, shared goal/task project IDs, and required
project selection for projectless delegation. See the [browser log](./evidence/phase-0.5/browser-check-final.log)
and [screenshot](./evidence/phase-0.5/browser-check.png). Real PostgreSQL atomicity is proven
by Jest failure injection, rather than a deployed browser-to-PostgreSQL session.
No provider execution or production deployment was performed.

The Spec Kit prerequisite script cannot run here because PowerShell is unavailable.
The selected nested plan/tasks explicitly reference parent `spec.md` FR-111. A formal
`/speckit-converge` run remains blocked: the active parent feature has no `tasks.md`, while
the nested Phase 0.5 directory has no `spec.md`. It needs a complete co-located artifact set;
this report does not claim that the full organization program has converged.

TDD red and green logs, including executed PostgreSQL failures and the negative test-typecheck
check, are retained in [evidence/phase-0.5](./evidence/phase-0.5/).

Committed logs have database credentials redacted and trailing whitespace normalized;
result values, failures, and command output content are retained.
