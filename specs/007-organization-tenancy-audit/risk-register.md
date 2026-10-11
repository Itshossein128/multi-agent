# Dependency & Risk Register

**Feature**: `007-organization-tenancy-audit` | **Phase**: 0 | **Date**: 2026-10-10

Likelihood / Impact: L / M / H.

## 1. Risks

| ID | Risk | L | I | Mitigation | Owner phase |
|----|------|---|---|------------|-------------|
| R-01 | Shared agent/tool ownership capture on edit becomes a cross-member data-loss/privilege issue once orgs have several members | H | H | Fix (preserve `owner_id`, tenant-guarded upsert) before any second member can join | P1 |
| R-02 | Check-then-upsert on global ids allows cross-org overwrite under race / id-existence oracle | M | H | Tenant-guarded `ON CONFLICT … WHERE` (pattern exists in `organizationStore.ts:71-79`) + composite keys (P1); uniform 404 (P2) | P1/P2 |
| R-03 | Optional `principal` in `StudioStore` lets a future route call unscoped SQL | M | H | Separate service vs user store surfaces; lint/test that all route handlers pass principal | P2 |
| R-04 | Stale JWT tenant after membership change/disable | H | H | Server-side membership resolution with version cache | P1/P2 |
| R-05 | No roles: any member can change budgets, CEO agent, goals | H | M | Permission gates; shadow first | P2 |
| R-06 | ~~Legacy NULL-tenant rows mis-assigned during migration~~ | — | — | **Closed by D-7** (database cleared) | — |
| R-07 | ~~017 heuristics produced questionable assignments~~ | — | — | **Closed by D-7**; composite FKs prevent recurrence | — |
| R-08 | No down migrations; contract steps irreversible | M | H | Expand/contract; backups; rehearsal on restored copy | all |
| R-09 | Studio runner executes all migrations in one transaction → no `CREATE INDEX CONCURRENTLY`; long locks on big tables | M | M | Keep DDL small; separate out-of-band index step or runner enhancement | P1/P3 |
| R-10 | Memory grant tenant not bound to run tenant | M | H | Equality check fail-closed | P3 |
| R-11 | Synthetic `system%`/`internal:%` userId bypass is a naming convention | L | H | Typed service principal; reject such ids at user creation | P2/P3 |
| R-12 | Global trigger-dispatch unique key → cross-org collision/DoS | L | M | Tenant-qualified index | P3 |
| R-13 | Frontend shows previous org's cached data after switch | H | M | Org-qualified query keys or full cache reset; e2e test | P2 |
| R-14 | Org-level operations need a project (regression R3) – wrong project chosen implicitly | H | M | Decision D-6; fix R3 first | P1 prerequisite |
| R-15 | Test files not type-checked by `tsc`; PG suites fail instead of skip when DB down | H | M | Fix `tsconfig.jestfullcheck.json`; gate scripts start DB | P1 prerequisite |
| R-16 | Error handler returns raw internal messages as 400 | H | L | Typed errors; generic 500 | P2 |
| R-17 | Routines execute as creator indefinitely, even after removal | M | M | D-5 policy at fire time | P3 |
| R-18 | Process-local broker rate limits / caches across multiple instances (existing known gap) | M | M | Out of scope; document; shared store later | P5 note |
| R-19 | Membership resolution adds latency to every request | M | L | In-process TTL cache keyed by membership version; single indexed lookup | P2 |
| R-20 | Two "organization" APIs (`/organizations` profile vs `/organization` agent chart) confuse implementers and reviewers | H | L | Naming convention in docs; route aliases later | P1 |
| R-21 | Long-term memory unavailable to BFF users (bearer-only) – org memory may change user-visible behavior | M | M | Derived grants behind `ORG_MEMORY_SCOPE` flag | P4 |
| R-22 | Uncommitted user changes in tree at baseline time may mask or create diffs | M | L | Re-run baseline at Phase 1 start on a clean commit | P1 |
| R-23 | Web lint failing (30 errors) prevents using lint as a gate | H | L | Baseline as known failure or fix separately | P1 prerequisite (optional) |
| R-24 | Reset destroys data irrecoverably (wrong DB, missed backup, Vault secrets left orphaned) | M | H | Explicit flag, row-count preview, active-run refusal, optional `--backup`; runbook lists Vault cleanup as operator step | P1 |
| R-25 | RLS prerequisite refactor is broad: every organization-scoped store query must run in a transaction that sets `app.tenant_id`; pooled connections must not leak settings; cross-org workers need a separate role or SECURITY DEFINER functions | H | M | `SET LOCAL` only (transaction-scoped); test harness that enables RLS on a scratch schema in Phase 1 to catch unscoped queries early; benchmark the per-query transaction overhead | P1/P5 |
| R-26 | DB user may lack `CREATEROLE`/ownership needed to create `studio_app`/`studio_worker` roles in some deployments | M | M | Migration detects and emits a manual SQL script; docs | P1 |
| R-27 | URL routing (`/o/[orgSlug]`) moves every authenticated page and BFF route; breaks bookmarks, e2e specs, and links in notifications | H | M | Mechanical move with redirects from old paths to the last organization; update Playwright specs in the same phase | P2 |
| R-28 | Broker audit log is append-only and globally hash-chained; deleting one organization's rows breaks chain verification; clearing it in the reset loses security history | M | M | Decision Q2 (default: TRUNCATE at reset, retain audit rows on org deletion — they hold no secrets) | P1/P2 |
| R-29 | Organization deletion across stores is non-atomic (DB + filesystem + broker + Vault) | M | H | `deleting` status first, idempotent resumable purge job, post-deletion verification | P2–P5 |

## 2. Dependencies

| ID | Dependency | Needed by | Status |
|----|-----------|-----------|--------|
| DEP-1 | PostgreSQL 16 + pgvector at `127.0.0.1:55432` (`pnpm db:dev:up`) | all PG suites, gates | available (container restarted in Phase 0) |
| DEP-2 | `MEMORY_TEST_DATABASE_URL` in `.env` | PG suites | set |
| DEP-3 | Decisions D-1…D-12 (`plan.md` §6) | Phase 1 start | **recorded 2026-10-10**; confirmations Q1–Q4 open (defaults apply) |
| DEP-9 | Maintenance window for the reset (D-7) | Phase 1 | to be scheduled by operator |
| DEP-4 | Fixes for baseline regressions R1–R3 | clean Phase 1 baseline | not started (out of Phase 0 scope) |
| DEP-5 | `INTERNAL_PRINCIPAL_SECRET`, NextAuth secret, broker config | P1/P2 integration tests | existing |
| DEP-6 | Playwright + running web/server | P2/P5 e2e | available, not run in Phase 0 |
| DEP-7 | Spec 006 hierarchy (projects/workspaces) fully landed | P1 (org-level task decision) | landed with regressions |
| DEP-8 | Credential broker (spec in `CLAUDE.md`) | P3 tool connections | implemented; mTLS/Vault unproven against real infra |

## 3. Unresolved design decisions

Decisions D-1 … D-12 are resolved (see [plan.md](./plan.md) §6). Remaining confirmations Q1–Q4 are in
[plan.md](./plan.md) §7, each with a default that applies if unanswered.


## Review corrections (2026-10-10)

Documentation review identified and corrected owner-target authorization, global/system RLS rules, security-compatible rollback, staged deletion exposure, strategy-write atomicity, and baseline reproducibility. Phase 0.5 requires a fresh full-suite run on a clean committed SHA; this documentation change does not claim new test results. Deletion stays disabled until the Phase 5 cross-store gate; broker audit retention is the explicit exception to application-data deletion. Phase 1's destructive reset still requires the documented operator procedure; no reset or implementation was performed by this correction.
