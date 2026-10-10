# Phase 0.5 Quickstart — Validation and Baseline

**Plan**: [plan.md](./plan.md) | **Contract**: [contracts/organization-operations.md](./contracts/organization-operations.md)

## 1. Prerequisites

- PostgreSQL 16 + pgvector on `127.0.0.1:55432`: `pnpm db:dev:up` (project compose file).
- `MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"`
  exported explicitly (do not rely on `.env` for baseline runs).
- `pnpm install --frozen-lockfile`.

## 2. Targeted validation (during implementation)

| Scenario | Command | Expected |
|----------|---------|----------|
| Fixtures repaired | `pnpm test --runInBand tests/taskBoardView.test.ts tests/eventRoutinesIntegration.test.ts` | both suites pass; 0 skipped |
| Explicit project + in-memory atomicity | `pnpm test --runInBand tests/organizationService.test.ts tests/organizationBudgetRoutes.test.ts` | pass; strategy without/foreign/retired project → 400/404/409 with no goal or task |
| Real-PG failure injection | `pnpm test --runInBand tests/organizationStrategyAtomicity.test.ts` | pass and **not skipped**; each injected failure leaves 0 new goals/tasks/events |
| Test typecheck | `pnpm typecheck:tests` | exit 0 |
| Negative check of the typecheck gate | temporarily remove `projectId` from the R1 fixture, run `pnpm typecheck:tests` | non-zero exit (revert immediately; not committed) |
| Web | `pnpm --filter web build`; open `/organization`: strategy requires a project; delegation of a project-less goal asks for one | build passes; UI matches contract |

## 3. Fresh baseline on a clean committed SHA

Run only after all Phase 0.5 commits exist. Evidence directory:
`specs/007-organization-tenancy-audit/evidence/phase-0.5/` (committed afterwards in a separate docs commit).

```bash
SHA=$(git rev-parse HEAD)
WT=/tmp/ma-baseline-$SHA
git worktree add --detach "$WT" "$SHA"
cd "$WT"
git status --porcelain --untracked-files=no          # must print nothing (record)
node --version; pnpm --version; sha256sum pnpm-lock.yaml
pnpm install --frozen-lockfile
export MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory"
psql "$MEMORY_TEST_DATABASE_URL" -Atc "select version(); select extversion from pg_extension where extname='vector';"
pnpm build:types
pnpm test --runInBand --json --outputFile="$WT/jest.json" 2>&1 | tee "$WT/jest.log"   # ONE full run
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p apps/server/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
pnpm typecheck:tests
pnpm --filter server build
pnpm --filter web build
git diff --check
git status --porcelain --untracked-files=no          # must print nothing (record)
```

Record in `baseline-phase-0.5.md`:

- full SHA, worktree path, timestamps and durations;
- tracked-tree status before/after (both empty);
- Node, pnpm, lockfile SHA-256, PostgreSQL and pgvector versions;
- applied migration lists (studio 001–017, memory 001–005) as executed by the suites' migration runners;
- redacted environment (variable names and hosts only);
- from `jest.json`: `numTotalTestSuites`, `numPassedTestSuites`, `numFailedTestSuites`, `numPendingTestSuites`,
  `numTotalTests`, `numPassedTests`, `numFailedTests`, `numPendingTests` (skipped), `numTodoTests`;
- list of suites added since the historical baseline;
- exit code of every command above; known non-gating failures (web lint) listed separately;
- location of committed logs.

Afterwards: `git worktree remove "$WT"`. Do not edit the historical sections of `../test-baseline.md`; add
only a link to `baseline-phase-0.5.md`.

## 4. Expected outcome

0 failed suites, 0 skipped PG suites in the gate run, all gate commands exit 0 (web lint excluded and listed),
and the evidence committed separately from the tested SHA.
