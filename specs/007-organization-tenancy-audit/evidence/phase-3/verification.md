# US3 implementation verification — 2026-10-12

Scope: `specs/007-organization-tenancy-audit`, US3 T045–T053, branch `develop`, working tree
uncommitted (no commit/push performed). PostgreSQL 16 available at
`MEMORY_TEST_DATABASE_URL=postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory`.
No application database was reset; every PostgreSQL suite used a disposable schema or
per-test random schema as before.

## Delivered behavior

- Every run records `initiator_kind` (`user|service|schedule|trigger`) and
  `membership_version_at_start` (migration `021_run_initiator.sql`, additive columns plus a
  partial index and a CHECK constraint). The kind is derived server-side from trusted metadata
  and principal kind, never from request input.
- D-5 policy is enforced at every execution checkpoint: run start, approval resume, queued-run
  restore after restart, retry, and credential lease issuance. An initiator removed from the
  organization, a suspended organization, or a run whose organization no longer matches stops
  with typed `ORGANIZATION_ACCESS_REVOKED`; task rows and run history are retained.
- No broker credential lease can be issued after revocation: `RunAccessCheckpoint` wraps the API
  credential resolver at composition time (`apps/server/src/index.ts`) and revalidates the run
  plus the requested tenant before any lease is issued. A foreign organization's tenant is never
  accepted for a run, and a run can never borrow another organization's tenant.
- Outbox, routine, heartbeat and durable memory-job handlers each execute inside an ambient
  organization scope derived from the item's own `tenant_id` (`organizationJobScope.ts`,
  AsyncLocalStorage + `withOrganization` transactions that set `app.tenant_id` /
  `app.principal_kind`). Per-item `assertOrganizationScope` fails closed when no scope is active
  or a foreign scope is observed. Production schedulers are wired to the PostgreSQL scope runner.
- Cross-organization claims go through SECURITY DEFINER functions
  (`studio_claim_trigger_events/routines/heartbeats` in `021_run_initiator.sql`,
  `studio_claim_memory_jobs` in memory migration `007_memory_job_claims.sql`), so a
  least-privileged worker role can claim across organizations while handlers execute strictly
  inside the item's organization (INV-7). The inline SQL remains as a compatibility fallback when
  the function is absent.
- Memory grants must belong to the run's organization on start, retry and queued-run restore
  (`MEMORY_ACCESS_ORGANIZATION_MISMATCH`); durable memory handlers validate the trusted captured
  scope before touching memory.
- Workspace paths handed to execution are canonicalized and rejected when they traverse or fall
  under another organization's storage prefix; the resolver silently re-derives the correct
  organization path instead of failing the run.
- Trigger idempotency and dispatch keys are tenant-qualified end to end (index from
  `019_tenant_constraints.sql`); identical keys in two organizations produce two independent
  events and two independent runs.
- Routines of a removed owner stop firing (recorded as `skipped` history) while active owners
  keep firing; scheduled work of a suspended organization does not fire.

## TDD and enforcement transition

Executed red logs are retained: `red-us3.txt` records the three US3 suites failing to compile
before implementation (missing `organizationJobScope`, `runOrganizationAccess`,
`runAccessCheckpoint`, initiator columns) and the failing checkpoint tests once compilation was
restored. Green evidence is `green-us3.txt` (9 suites, 132 tests) and `full-with-pg.txt`
(132 suites, 2369 tests, zero skipped).

`tests/productionEpisodicMemory.test.ts` "Scenario 0" fails identically in the pre-US3 baseline
(`baseline-full.txt`, same assertion at line 119); it is a pre-existing failure and is not
claimed as part of this slice.

## Evidence mapping (threat model T-7…T-12)

| Threat | Evidence |
|---|---|
| T-7 execution context confusion | `organizationExecutionIsolation.test.ts` (initiator fields, approval resume, retry, queued restore, suspended org); `RunAccessCheckpoint` installed in production composition |
| T-8 memory leakage across orgs | `organizationExecutionSecurity.test.ts` (foreign grant rejected on start/retry/restore); full-leakage retrieval work stays in US4 |
| T-9 background job cross-org mixing | `organizationBackgroundIsolation.test.ts` (interleaved orgs, per-item scope assertions, memory job tenant mix rejected) |
| T-10 dedupe collision DoS | tenant-qualified index `019_tenant_constraints.sql`; `organizationBackgroundIsolation.test.ts` "identical trigger idempotency and dispatch keys" |
| T-11 filesystem escape | `organizationExecutionSecurity.test.ts` workspace prefix + traversal assertions |
| T-12 credential misuse | `organizationExecutionSecurity.test.ts` broker cross-org consume rejection; `brokerSecurity.test.ts`; originating-org lease still succeeds |

## Verification commands and results

| Gate | Result |
|---|---|
| Full Jest + PostgreSQL (no skips) | 132 suites / 2369 tests: 2368 passed, 1 pre-existing failure (`productionEpisodicMemory` Scenario 0, identical in baseline) |
| US3 + multi-instance recovery + broker suites | 9 suites / 132 tests passed (`green-us3.txt`) |
| `npx tsc --noEmit` (root) | passed |
| `npx tsc --noEmit` (`apps/server`) | passed |
| `npx tsc -p tsconfig.test.json` | passed |
| `pnpm --filter server build` | passed |

## Known gaps intentionally left to later phases

- RLS stays disabled until T065/T069 (Phase 5); migration 021 and 007 only add the claim
  functions and grant them to `studio_worker`.
- Membership-derived memory grants (T059–T063, US4) and the deletion purge worker (US6) are
  separate slices.
- Rate-limited/queued `MEMORY_PRINCIPALS` static-token binding hardening belongs to US4 (T061).
