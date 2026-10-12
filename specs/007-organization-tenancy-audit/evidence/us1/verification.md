# US1 implementation verification — 2026-10-11

US1: one account belongs to and switches between organizations (program T025–T034).
Implementation is complete for this story; US2–US4, US6, RLS activation and organization memory stay deferred.

The working tree started clean on `develop`, HEAD `c3bc18b`. These changes are uncommitted.
Source hashes are in `source-files-sha256.json`. This is a working-tree verification, not a clean-SHA
release baseline or live deployment verification.

## Verified behavior

- Organization selection comes from the URL and fresh active membership/user checks, including legacy
  BFF calls. Mutable session tenant values cannot authorize another organization.
- Context resolution rechecks profile status and membership version before reusing cached role/permissions.
  Hono attaches the resolved context; the default server enforcement mode remains `shadow` as planned.
  Denials in shadow emit `authz.would_deny`; the browser BFF and organization layout always reject non-members.
- Organization-scoped project/workspace/task/dashboard BFFs share existing handlers and preserve existing
  action contracts. Execution BFF uses the same verified principal resolver.
- Resource links and API calls preserve the URL organization. Query keys include organization.
  The switcher performs document navigation, intentionally discarding query caches, editor state, streams,
  and pending requests. URLs determine the first request before provider effects run and isolate tabs.
- Home redirects choose a still-active last membership, otherwise the first active membership, otherwise
  onboarding. Next.js redirect exceptions are no longer swallowed. Creating another organization allocates
  a fresh identity and owner membership. SSE URLs and asynchronous App Router params are valid.

## TDD proof

`jest-red.txt`: 7 behavioral failures / 4 passes before implementation (three suites).
`route-matrix-red.txt`: non-member signed organization request returned 200 instead of 404.
`client-red.txt`: first request used a stale provider slug; the existing SSE URL also failed typechecking.
`legacy-session-red.txt`: a session tenant hint was trusted without a membership check.
`browser-head-red.txt`: the strengthened test on original HEAD returned 409 when the same account created
its second organization. An initial 127.0.0.1 development-host attempt did not hydrate; it is not used as
behavioral red proof. The valid HEAD proof used localhost in `/tmp/us1-red-checkout`.

## Final gates

| Command | Result | Evidence |
|---|---|---|
| `MEMORY_TEST_DATABASE_URL=<local PG16> pnpm test --runInBand` | 117 suites, 1367 tests passed; 0 skipped; exit 0 | [full-green.txt](./full-green.txt) |
| Targeted US1 + ownership/task/clarification/registry regressions | 11 suites, 85 tests passed | [targeted-green.txt](./targeted-green.txt) |
| Baseline fixture suites, explicit PostgreSQL | 3 suites, 41 tests passed | [fixture-green.txt](./fixture-green.txt) |
| `pnpm exec tsc --noEmit` | Pass | [root-typecheck.txt](./root-typecheck.txt) |
| `pnpm --filter server build` | Pass, includes server TypeScript | [server-build.txt](./server-build.txt) |
| `pnpm typecheck:tests` | Pass | [test-typecheck.txt](./test-typecheck.txt) |
| `pnpm --filter web exec tsc --noEmit` | Pass after regenerating stale Next type artifacts | [web-typecheck.txt](./web-typecheck.txt) |
| `pnpm --filter web build` | Pass | [web-build.txt](./web-build.txt) |
| `E2E_BASE_URL=http://localhost:3081 pnpm --filter web exec playwright test e2e/organization-routing.spec.ts --reporter=list` | 1 passed against built web + compiled server | [browser-production-green.txt](./browser-production-green.txt) |
| `git diff --check` | Pass | final tool output |

The production-build browser test covers one account owning A and B, different projects and tasks,
A↔B switching, copied project links, two tabs with different organization pointers, last-organization
redirect, foreign resource IDs, and matching page/API 404s for foreign and missing slugs. Negative BFFs:
projects, workspaces, tasks, dashboard, execution agents, execution budgets and execution runs.

## Baseline fixture alignment

Original HEAD with PostgreSQL: 4 failing suites, 15 failing tests, 1337 passing tests (115 suites total).
The existing SSE variable prevented its BFF suite from executing. After the US1 product fixes, the same
15 fixture failures remained in three suites. Those failures were reproduced before these test-only edits:

- `auth.test.ts`: registration/login now assert nullable last organization, matching the existing user-only
  registration contract; password hashing and authentication checks remain.
- `memoryStorage.test.ts`: migration-list expectation includes existing migration 006; the exact-list check remains.
- `dashboardSourceOfTruth.test.ts`: seed an actual project in the task's tenant and use its optional null workspace;
  restart/durable task/run assertions remain.

The final full run is one complete execution; counts were not combined across attempts.

## Environment, scope and workflow

The Spec Kit pointer was stale (completed Phase 0.5). `.specify/feature.json` now selects the parent program.
PowerShell is unavailable and the bundled script is not executable; prerequisite resolution/file checks were
performed directly. Parent requirements checklist remains untouched: 16 total / 16 checked / 0 unchecked.
Parent plan/data model and the unratified constitution template were read. Parent research/contracts/quickstart
are absent. Existing Git/Docker/ESLint ignore patterns were verified; this task does not publish a package.
`.specify/extensions.yml` is absent, so before/after hooks are skipped per the skill.

Browser integration used a newly created `us1_e2e_20261011` database and local ports 3081/4081. No reset or
migration was run against existing application data. The final compiled server used development credentials,
`MEMORY_STORE=disabled`, and `ORG_MEMBERSHIP_ENFORCEMENT=enforce` only in this isolated test environment.
No real provider execution, Vault, mTLS, RLS activation or organization-memory retrieval is claimed.
Temporary servers, database and HEAD worktree are removed after evidence retention. PostgreSQL dev service
remains available. No commit, push or deployment was performed.
