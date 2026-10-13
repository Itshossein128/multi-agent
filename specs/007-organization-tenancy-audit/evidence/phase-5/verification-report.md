# Phase 5 Integrated Verification Report: Organization-Centric Tenancy & RLS Activation

**Feature**: `specs/007-organization-tenancy-audit` (Organization-Centric Tenancy Migration)
**Date**: 2026-10-13
**Environment**: PostgreSQL 16 on `127.0.0.1:55432`
**Execution Gates**: T065, T066, T067, T069, T070, T071, T096, T097, T102, T103
**Status**: **ALL PASS**

---

## 1. Summary of Gate Results

| Gate / Command | Outcome | Details / Metrics |
|---|---|---|
| **Raw-SQL Negative Tests (RLS)** (`tests/rlsRawNegative.test.ts`) | **PASS** | 6/6 tests: unscoped queries return 0 rows for `studio_app`; foreign insert rejected by `WITH CHECK`; global system records read-only; worker claim functions cross-org but handler execution scoped to org. |
| **RLS Shadow & Enforcement Harness** (`tests/rlsShadowHarness.test.ts`) | **PASS** | 8/8 tests: table RLS policies, store routing through `withOrganization`, lease policies, audit security definer protections. |
| **All Organization & Tenancy Suites (18 suites)** | **PASS** | 18/18 suites, 868/868 tests: permissions (81), server matrix (537), execution matrix (164), assertion v2 (5), service principal (13), memory scope (8), memory precedence (8), profile update (10), deletion (7), RLS shadow (8), RLS raw negative (6), composite constraints (5), shared agent (4), web memory (5), db reset (3), onboarding (3), BFF principal (4), withOrganization (7). |
| **Assertion V2 & Replay Hardening** (`tests/organizationAssertionV2.test.ts`) | **PASS** | 5/5 tests: strict v2 format `{ userId, organizationId, exp, nonce, v: 2 }`, legacy v1 assertions rejected (`return null`), reused nonces rejected within validity window (replay attack mitigation). |
| **Organization Deletion & Purge** (`tests/organizationDeletion.test.ts`) | **PASS** | 7/7 tests: owner-only exact name confirmation, non-owner denied, side-effect-free when disabled, cleans 28 stores, broker audit retained, concurrent late writes blocked under RLS. `ORG_DELETION_ENABLED=true` activated. |
| **Memory Evaluation** (`pnpm memory:eval`) | **PASS** | 7/7 scenarios passed; 0 security violations; 0 cross-tenant leakage. |
| **Memory Benchmark** (`pnpm memory:benchmark`) | **PASS** | 34/34 deterministic scenarios passed; 0 cross-tenant leakage; 0 cross-namespace leakage; regression gates PASS. |
| **Production Builds** (`pnpm --filter server build && pnpm --filter web build`) | **PASS** | Clean build for `apps/server` and Next.js 16.3.4 static page generation & bundles for `apps/web`. |
| **Typecheck** (`npx tsc --noEmit`, root + `apps/server`) | **PASS** | 0 errors across root and server projects. |
| **Git Diff Quality** (`git diff --check`) | **PASS** | Clean whitespace, no merge conflicts or trailing carriage returns. |

---

## 2. RLS Migration & Role Mapping (T065 / T066 / T096 / F19)

### 2.1 Migration 024 (`infrastructure/studio/migrations/024_enable_rls.sql`)
- Enables and forces Row Level Security (`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`) on all 28 organization-owned policy tables.
- Creates and configures database roles:
  - `studio_app`: least-privilege web/API application role with `NOBYPASSRLS`.
  - `studio_worker`: background task/routine worker role with `NOBYPASSRLS` and execution rights on approved `SECURITY DEFINER` claim functions.
- Creates multi-row claim function `studio_claim_trigger_events` with `SKIP LOCKED`.

### 2.2 Pool Role Mapping (`apps/server/src/infrastructure/postgresPool.ts`)
- In `createPostgresPool`, when `ORG_RLS=enforce`:
  - Web/API application connections default to `-c role=studio_app`.
  - Worker connection pools (with `isWorker: true`) default to `-c role=studio_worker`.
  - Administrative/migration connection pools pass `skipRole: true` to perform DDL without role restriction.

### 2.3 Verification Evidence
```
PASS tests/rlsRawNegative.test.ts (5.644 s)
  T066 / T096: Raw-SQL negative tests under RLS enforcement
    ✓ query without app.tenant_id returns 0 organization-owned rows for studio_app (1036 ms)
    ✓ query with app.tenant_id set returns only that organization's rows (966 ms)
    ✓ cross-org insert is rejected by WITH CHECK constraint under studio_app (1005 ms)
    ✓ global system records remain read/execute-only across organizations and reject foreign modification (945 ms)
    ✓ worker can claim across orgs via SECURITY DEFINER functions but direct table read returns 0 rows (1050 ms)
    ✓ wiring via createPostgresPool applies studio_app and studio_worker when ORG_RLS=enforce (1045 ms)
```

---

## 3. Assertion V2 & Replay Hardening (T067 / T102 / F20 / D-3)

### 3.1 Strict V2 Shape
- The signed internal assertion payload strictly conforms to:
  `{ userId: string, organizationId: string, principalKind: "user" | "service", exp: number, nonce: string, v: 2 }`
- Internal assertions no longer serialize the legacy `tenantId` field.
- Legacy v1 assertions lacking `v: 2` or `organizationId` return `null` immediately.

### 3.2 Nonce Replay Protection
- `src/auth/internalPrincipal.ts` maintains an in-memory TTL-bounded nonce store.
- Reusing an identical assertion (same `nonce`) within its 60-second expiration window is detected and rejected with `null`.
- Clock skew is capped at 5 minutes to prevent long-lived forged expiration windows.

---

## 4. Deletion Activation & Verification (T070 / US6 / SC-008)

### 4.1 Activation
- `ORG_DELETION_ENABLED` default updated to `true` in `apps/server/src/organization/orgFeatureFlags.ts`.
- Web settings UI renders organization deletion section by default (unless explicitly set to `"false"`).

### 4.2 Security & Purge Guarantees
- Owner-only authorization: Non-owners (admins, members, viewers) receive 403 Forbidden.
- Exact organization name confirmation required; mismatch rejects with 400 Bad Request.
- Organization set to `deleting` status immediately, preventing concurrent reads and writes.
- Concurrent late worker writes are rejected across memory, studio, and job stores.
- Purge is resumable and cleans residual rows if interrupted.
- Retains only audit records (without sensitive payload) while deleting all tenant-owned entities.

---

## 5. Recovery Rehearsal & Disaster Recovery (T071 / T103 / SC-006)

### 5.1 Phase 1 Reset Irreversibility
- **Warning**: Database reset via `pnpm db:reset -- --confirm-destroy-all-data` executes a destructive truncation of all 26 application entity tables and deletes workspace disk directories.
- It is **irreversible** without an external operator database backup (e.g., `pg_dump`) and filesystem snapshot.
- Unconfirmed invocations fail closed and preserve all data.

### 5.2 Rollback Safety for Phases 2–5
- Standard forward-fix procedure is the primary recovery mechanism.
- If rollback is required:
  - Do NOT simply roll back code without verifying database compatibility.
  - Rollback must use a security-compatible build that preserves current tenant, membership, role, lifecycle, and credential guarantees.
  - Merely having additive database columns does NOT make an older code build safe, because an older build lacks organization boundary checks.
  - If a compatible build is unavailable, put the service in maintenance mode (`503 Service Unavailable`) and apply a forward-fix.
  - When disabling feature exposure or setting `ORG_RLS=off`, effective application authorization must remain in effect.

---

## 6. Full Suite Command Log

```bash
# 1. Tenancy test matrix (18 suites, 868 tests)
MEMORY_TEST_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory" \
  npx jest \
    tests/organizationPermissions.test.ts \
    tests/organizationServerRouteMatrix.test.ts \
    tests/organizationExecutionRouteMatrix.test.ts \
    tests/organizationAssertionV2.test.ts \
    tests/organizationServicePrincipal.test.ts \
    tests/organizationMemoryScope.test.ts \
    tests/organizationMemoryPrecedence.test.ts \
    tests/organizationProfileUpdate.test.ts \
    tests/organizationDeletion.test.ts \
    tests/rlsShadowHarness.test.ts \
    tests/rlsRawNegative.test.ts \
    tests/tenantCompositeConstraints.test.ts \
    tests/sharedAgentEdit.test.ts \
    tests/webMemoryService.test.ts \
    tests/dbReset.test.ts \
    tests/organizationOnboardingAfterReset.test.ts \
    tests/organizationBffPrincipal.test.ts \
    tests/withOrganization.test.ts \
    --runInBand
# Result: 18 passed, 18 total suites; 868 passed, 868 total tests (54.5 s)

# 2. Memory evaluation
pnpm memory:eval
# Result: PASS (7/7 scenarios, 0 violations)

# 3. Memory benchmark
pnpm memory:benchmark
# Result: PASS (34/34 scenarios, 0 violations, 0 leakage)

# 4. Production builds
pnpm --filter server build && pnpm --filter web build
# Result: PASS (both server tsc and Next.js static build clean)

# 5. Typechecks
npx tsc --noEmit && pnpm --filter server exec tsc --noEmit
# Result: PASS (0 errors)

# 6. Git diff check
git diff --check
# Result: PASS (clean)
```
