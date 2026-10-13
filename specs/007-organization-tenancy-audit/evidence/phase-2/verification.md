# US2 implementation verification — 2026-10-11

Scope: `specs/007-organization-tenancy-audit`, US2 T035–T044, branch `develop`, base HEAD `c3bc18b`. The workspace includes the prior uncommitted US1 slice. No application database was reset, no commit/push was performed, and the read-only requirements checklist remains 16/16 checked.

## Delivered behavior

- Registered users can be invited by email or user id. Invitations remain pending until that authenticated user accepts. Global listing/acceptance works without an active organization membership. Invite/accept/member changes refuse shadow mode.
- Owners/admins manage members. Admins cannot grant owner or modify any existing owner. The last active owner cannot be removed, suspended or demoted. Both stores serialize checks, mutation and audit under one organization lock; PostgreSQL locks the organization parent row before reading membership/owner counts.
- Every actual role/status change increments membership version and appends audit details atomically. Audit failure rolls the change back; PostgreSQL audit rejects UPDATE and DELETE. Removed users are retained in history.
- Server membership, active organization and active account checks apply to all authenticated scoped routes, including legacy assertions with only the tenant alias. Role permissions are server-derived; incoming permission/role/version hints cannot grant access. Fresh membership checks make removal, suspension and demotion effective on the next request.
- Budgets, agent reporting/goal approval, member administration, credential configuration/diagnostics/webhook secrets and audit are gated. Owners/admins read teammates' same-org runs, including list/detail access, while control actions remain owner-only. Foreign org ids and membership failures return the same public 404; unexpected failures return a generic 500; known validation errors remain typed 400s.
- Signed typed service principals replace identity-prefix and worker-secret-header authority. Missing kind defaults to user for legacy assertions. Service access stays tenant-bound, checks organization lifecycle and carries no human administration permissions.
- `/o/[orgSlug]/settings` supplies role-sensitive invitation, role, suspension/restoration and removal controls. `/invitations` supports acceptance, including zero-membership onboarding. Organization-qualified member queries and document navigation preserve the US1 cache boundaries.

## TDD and enforcement transition

Executed red logs are retained, not just newly written tests: core 27 failures / 50 executed tests; typed-service 4/4 failures; run visibility 4/4 failures; credential-role cases failed before their gates; the default-enforcement test failed before the flag transition. Compilation-only fixture attempts are excluded from these red artifacts.

`shadow-gate.txt` records valid owner traffic over representative reads and budget writes with zero `authz.would_deny`. Its deliberately denied viewer request emits one explained shadow denial and fails closed for a multi-member org. Only after that check was membership enforcement made the default and `.env.example` set to `enforce`. Compiled-server browser traffic also recorded zero shadow denials.

`enforce-final.txt`: 14 suites, 834 tests, zero skips, with `ORG_MEMBERSHIP_ENFORCEMENT=enforce` and real PostgreSQL. The gate matrices independently declare policy and cover all 87 scoped Studio routes and 26 execution/tool/dashboard/memory routes against owner/admin/member/viewer/non-member/removed users. Allowed rows establish passage through the permission gate with non-500 assertions, valid 200/404 responses, credential-bearing mutations, and two-organization member foreign resource isolation in both memory and PostgreSQL. Successful operations, real owner concurrency, audit rollback, run visibility and live-session revocation have separate behavioral checks. Memory-data retrieval is not claimed by this gate; the memory server was disabled for browser checks.

Legacy domain-router tests lack accounts/membership fixtures and explicitly use the pre-admission shadow setup in `tests/organizationLegacyFixtures.cjs`. The authorization suites explicitly override it with enforcement. Production defaults are enforce; the fixture setup cannot change production configuration.

## Verification commands and results

| Gate | Result |
|---|---|
| Full Jest + PostgreSQL | 126 suites / 2164 tests passed, zero skipped |
| Enforcement-focused Jest + PostgreSQL | 14 suites / 834 tests passed, zero skipped |
| `pnpm exec tsc --noEmit` | passed |
| `pnpm --filter server exec tsc --noEmit` | passed |
| `pnpm --filter web exec tsc --noEmit` | passed |
| `pnpm typecheck:tests` | passed |
| `pnpm build:types` then server build | passed |
| `pnpm --filter web build` | passed |
| Targeted ESLint on new settings/invitations/BFF files | passed, zero warnings |
| Playwright membership + US1 routing | 2 passed against final production web build and compiled server |
| `git diff --check` | passed |

Full command: `MEMORY_TEST_DATABASE_URL=postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory pnpm test --runInBand --json --outputFile=/tmp/us2-tdd/full-report.json`.

Browser command: `E2E_BASE_URL=http://localhost:3082 pnpm --filter web exec playwright test e2e/organization-membership.spec.ts e2e/organization-routing.spec.ts --reporter=list`.

Browser services used the task-owned `us2_e2e_20261011` database, enforcement enabled, compiled execution server on 4082 and production Next.js server on 3082. Live model execution, external broker/Vault/mTLS, active RLS, deletion, and organization memory were not exercised. Both temporary services and the database were removed after verification; the original PostgreSQL development container was preserved.

The PowerShell prerequisite could not run (not executable and no PowerShell installed); direct absolute-path/document validation located this feature and the existing tasks/plan/data-model. The constitution is an unfilled template; no parent research/contracts/quickstart exists. Ignore files/configs cover the relevant Node/Docker/build/env outputs; packages are private. There are no pre/post extension hooks.

An unchanged episodic-retrieval test failed once during overlapping broad checks and then passed focused and in a fresh full run; no memory behavior was changed. A fresh final log/report supersedes the overlapping logs.

## Threat-model evidence

| Threat | Executed evidence |
|---|---|
| T-1 cross-org read | US1 foreign project/BFF/browser checks rerun; all scoped routes × non-member/removed; same-org/foreign run checks |
| T-2 cross-org id collision/write | Existing tenant-guarded store and PostgreSQL write-path suites rerun in the full gate; US2 does not rewrite those guards |
| T-3 selected-org spoofing | BFF URL-vs-session tests, foreign/missing slugs, signed assertions, and switch browser case rerun |
| T-4 stale privileges | Warm-context legacy-principal removal/demotion, disabled account checks, PostgreSQL membership updates, live browser suspension/restoration/removal |
| T-5 escalation | Full role gates, spoofed permission/role/version rejection, admin-vs-owner restrictions, atomic last-owner concurrency |
| T-6 synthetic principal abuse | Executed prefix negatives for in-memory and PostgreSQL private workflow access; explicit signed service kind and same/foreign tenant checks; production prefix/header bypasses removed |
| T-13 stale frontend data | US1 same-account A↔B project/task/cache/deep-link/cross-tab browser case rerun; member query key includes organization |
| T-14 error disclosure | Injected private audit failure returns generic 500 with rollback; private cascade errors masked; uniform public 404 tests; known input errors retain typed 400s |
| T-19 URL org confusion | URL-resolved BFF/layout membership; foreign/missing slugs identical 404; removed member page and BFF denied with the same live session |

US3 execution checkpoints/background revocation, service memory-grant equality, organization memory, deletion and RLS activation remain deferred to their listed tasks. No new destructive reset or production deployment was performed.

`source-manifest.sha256` identifies the source/test workspace used for verification; `SHA256SUMS` covers the retained artifacts. The results describe this uncommitted workspace, not a clean committed SHA.

Captured text logs have trailing whitespace and extra trailing blank lines normalized for Git review; test outcomes and diagnostics are unchanged.
