---
description: "Organization-centric tenancy — Phases 1–5 task list"
---

# Tasks: Organization-Centric Tenancy Migration (Phases 1–5)

**Input**: Design documents from `/specs/007-organization-tenancy-audit/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [data-model.md](./data-model.md),
[migration-plan.md](./migration-plan.md), [threat-model.md](./threat-model.md),
[test-baseline.md](./test-baseline.md); Phase 0.5 nested plan/tasks in [phase-0.5/](./phase-0.5/)

**Tests**: **Required for security invariants** (plan §3): every new security invariant has at least one
negative test written and observed failing before implementation. Phase DoD suites from plan §2 are
included as story test tasks. A test counts only if it executed (PG suites must not skip).

**Phase 0.5**: Complete under [phase-0.5/tasks.md](./phase-0.5/tasks.md). Do not reopen unless a gate
command regresses. Scope guard for this list: Phase 1+ only.

**Implementation status (2026-10-11)**: Setup (T001–T003), Foundational (T004–T018), and US5 (T019–T024)
are complete. US1–US4, US6, and Polish remain for the next implementation phase.

**Open confirmations** (plan §7): apply defaults unless product owner overrides before Phase 1 —
Q1 stop at next checkpoint; Q2 reset clears broker audit (`TRUNCATE`), deletion keeps audit rows;
Q3 delete Vault secrets + cancel runs on org deletion; Q4 slug editable by owner/admin, no redirects.

**Organization**: Tasks grouped by user story (US1–US6 from [spec.md](./spec.md)) so each increment is
independently testable. Plan phases map as: Foundational+US5 ≈ plan Phase 1; US1+US2 ≈ plan Phase 2;
US3 ≈ plan Phase 3; US4 ≈ plan Phase 4; US6+Polish ≈ plan Phase 5 (deletion enable + RLS).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on incomplete tasks)
- **[Story]**: US1…US6 on user-story phases only; Setup / Foundational / Polish carry no story label

---

## Phase 1: Setup

**Purpose**: confirm prerequisites and freeze decision defaults before schema or reset work.

- [X] T001 Confirm Phase 0.5 gate green per [baseline-phase-0.5.md](./baseline-phase-0.5.md) and [phase-0.5/recheck.md](./phase-0.5/recheck.md): `pnpm test --runInBand` with `MEMORY_TEST_DATABASE_URL`, root + `apps/server` `tsc --noEmit`, and test typecheck; abort if R1–R3 regress
- [X] T002 Record plan §7 Q1–Q4 outcomes (explicit answers or stated defaults) in [plan.md](./plan.md) §7 and mirror the chosen defaults in a short note at the top of [docs/development.md](../../docs/development.md) under the org-migration reset section (create the heading if missing)
- [X] T003 [P] Add feature-flag stubs `ORG_MEMBERSHIP_ENFORCEMENT`, `ORG_MEMORY_SCOPE`, `ORG_DELETION_ENABLED`, `ORG_RLS` (defaults `shadow`/`false`/`false`/`off`) in `apps/server/src` env config and document them in [docs/development.md](../../docs/development.md)

**Checkpoint**: Phase 0.5 green; decisions and flags recorded.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: guarded reset plumbing, strict schema (018–020 + memory/broker), DB helpers and roles that every story needs. **No user-story work until this phase completes.**

**⚠️ CRITICAL**: Blocks US1–US6

### Reset & migration guard

- [X] T004 Write failing tests in `tests/dbReset.test.ts` for `pnpm db:reset`: refuse without `--confirm-destroy-all-data`; refuse when execution server reports running runs; with flag + empty run set, truncate studio/memory/broker data tables while keeping `studio_migrations` / `studio_memory_migrations` ledgers; path-containment for `STUDIO_WORKSPACE_STORAGE_ROOT` cleanup. Run and confirm failure (module/script missing)
- [X] T005 Implement operator reset in `scripts/db-reset.ts` (or `scripts/db-reset.mjs`) wired as `pnpm db:reset` in root `package.json`: print row counts; optional `--backup <file>` via `pg_dump`; `TRUNCATE … RESTART IDENTITY CASCADE` in one transaction; clear workspace working copies; log reset record — make T004 pass
- [X] T006 Write failing migration-guard test in `tests/organizationMigrationGuard.test.ts`: applying `018_organization_foundation.sql` aborts when any organization-owned table has rows while `studio_organization_memberships` does not exist; succeeds on empty data. Run and confirm failure
- [X] T007 Create `infrastructure/studio/migrations/018_organization_foundation.sql` with empty-data guard; `studio_organizations.status` (`active|suspended|deleting`), `slug` (unique, lowercase, URL-safe), `created_by`; `studio_organization_memberships(organization_id, user_id, role owner|admin|member|viewer, status invited|active|suspended|removed, invited_by, version, timestamps)` unique `(organization_id, user_id)`; append-only `studio_organization_audit`; `studio_users.tenant_id` nullable last-organization only — make T006 pass

### Strict tenant schema & RLS prerequisites

- [X] T008 [P] Create `infrastructure/studio/migrations/019_tenant_constraints.sql`: `tenant_id NOT NULL` on org-owned tables including workflows/tasks/runs; agents/tools `CHECK ((is_system AND tenant_id IS NULL) OR (NOT is_system AND tenant_id IS NOT NULL))` with `is_system NOT NULL DEFAULT false`; add `tenant_id NOT NULL` to `studio_run_events`, `studio_approvals`, `studio_workspace_repositories`; `UNIQUE (tenant_id, id)` on FK targets; composite parent/child FKs (task→project, workspace→project, comment→task, repo→project, goal→project, memberships→organization); tenant-qualified trigger-dispatch unique index (drop global)
- [X] T009 [P] Create `infrastructure/studio/migrations/020_rls_prerequisites.sql`: roles `studio_migrator` / `studio_app` / `studio_worker` (or documented manual `CREATEROLE` steps); command-specific policies requiring `tenant_id = current_setting('app.tenant_id', true)` for SELECT/INSERT/UPDATE/DELETE; agents/tools SELECT also permits `is_system = true` but INSERT/UPDATE/DELETE require `NOT is_system` and tenant equality (USING + WITH CHECK); SECURITY DEFINER claim functions for workers; **do not** `ENABLE ROW LEVEL SECURITY`
- [X] T010 [P] Add memory migration under `infrastructure/memory/migrations/` for the same `NOT NULL`/policy treatment and optional index `(tenant_id, namespace_scope, namespace_id)`; broker DDL policy update for leases (audit stays service-only) under `infrastructure/broker/`
- [X] T011 Write failing tests in `tests/withOrganization.test.ts` for `withOrganization(orgId, principalKind, fn)` setting `SET LOCAL app.tenant_id` and `app.principal_kind`, restoring on exit/error. Run and confirm failure
- [X] T012 Implement `withOrganization` in `apps/server/src/organization/withOrganization.ts` (or `src/studio/infrastructure/withOrganization.ts`) and route organization-scoped Postgres store queries through it — make T011 pass
- [X] T013 [P] Write failing RLS-shadow harness tests in `tests/rlsShadowHarness.test.ts` on a scratch schema with policies forced on: unscoped store query fails; global agent/tool reads across orgs allowed; system insert/update/delete and personal-to-system promotion denied. Run and confirm failure
- [X] T014 Ensure every organization-scoped store path used by foundation suites runs inside `withOrganization`; make T013 pass for the covered stores (extend coverage as later stories touch more stores)

### Membership store & types (shared)

- [X] T015 [P] Extend Organization / membership types in `src/studio/contracts.ts` (and `packages/types` if exported): Organization `status`, `slug`; OrganizationMembership fields per [data-model.md](./data-model.md) §1; permission union matching the role matrix
- [X] T016 [P] Write failing contract tests in `tests/organizationMembershipStore.test.ts` for create/get/list/update status+role/version bump on both `InMemoryStudioStore` and Postgres adapters. Run and confirm failure
- [X] T017 Implement `OrganizationMembershipStore` methods in `src/studio/infrastructure/in-memory-studio-store.ts` and `src/studio/infrastructure/postgres-studio-store.ts` (or dedicated store modules) — make T016 pass
- [X] T018 Document the reset runbook (maintenance window order from migration-plan §1.3) in [docs/development.md](../../docs/development.md)

**Checkpoint**: Reset + migrations apply on empty DB; membership store green; RLS policies present but disabled; `withOrganization` used by scoped queries.

---

## Phase 3: User Story 5 — Clean start without legacy tenants (Priority: P1) 🎯 MVP

**Goal**: Operator can wipe all application data with explicit confirmation; new schema refuses legacy rows; first user can register and create an organization as owner with no pre-reset data visible (FR-108, SC-002).

**Independent Test**: Populate data → reset without flag (nothing deleted) → reset with flag → apply 018+ → assert empty tables + constraints → register user → create org → owner membership exists; no pre-reset rows.

### Tests for User Story 5

- [X] T019 [P] [US5] Extend `tests/dbReset.test.ts` for acceptance: populated installation + reset without confirmation leaves all rows; with confirmation empties listed stores and filesystem working copies while ledgers remain
- [X] T020 [P] [US5] Write failing tests in `tests/organizationOnboardingAfterReset.test.ts`: registration creates user only (no implicit private tenant); `POST` organization creation atomically creates org (`id` = tenant key), unique lowercase slug, exactly one `owner` membership with `status=active`, and an audit row; failure mid-transaction leaves neither org nor membership. Run and confirm failure

### Implementation for User Story 5

- [X] T021 [US5] Change registration in `apps/web/src/app/.../register/actions.ts` (and any server register path) to create a user only — stop minting a private tenant ([migration-plan.md](./migration-plan.md) §3)
- [X] T022 [US5] Implement atomic organization creation + owner membership + audit in `apps/server/src/api/studio/organizationProfileRoutes.ts` and organization service/store; expose `POST /studio/organizations` and `GET /studio/me/organizations` — make T020 pass
- [X] T023 [US5] Add non-production dev seed command (e.g. `pnpm db:seed:dev`) that creates `AUTH_DEV_USER_ID` user, organization, and owner membership; stop trusting env tenant without a membership row ([migration-plan.md](./migration-plan.md) §4)
- [X] T024 [US5] Run Independent Test for US5 (reset → migrate → register → create org) and attach command transcript under `specs/007-organization-tenancy-audit/evidence/phase-1/`

**Checkpoint**: MVP — clean DB + first organization owner path works. Existing single-org pages may still use pre-Phase-2 URLs.

---

## Phase 4: User Story 1 — Belong to and switch between organizations (Priority: P1)

**Goal**: One account, many organizations; server-verified OrganizationContext; URL `/o/[orgSlug]/…`; switch clears cross-org UI/cache (FR-101, FR-102, FR-112, SC-001, SC-007).

**Independent Test**: Two orgs with different data; one user in both; switch A↔B; no screen/list/search/action shows or affects the other org; non-member slug → 404 without existence disclosure.

### Tests for User Story 1

- [X] T025 [P] [US1] Write failing tests in `tests/organizationContextResolver.test.ts`: active member resolves context; non-member / suspended org / removed member → deny; cache keyed by membership version invalidates on bump. Run and confirm failure
- [X] T026 [P] [US1] Write failing tests in `tests/organizationAssertionV2.test.ts` for principal assertion v2 `{userId, organizationId, exp, nonce, v: 2}` (accept `tenantId` alias until Phase 5). Run and confirm failure
- [X] T027 [P] [US1] Write failing Playwright specs in `apps/web/e2e/organization-routing.spec.ts`: org switch, deep link same-org, non-member slug 404, stale cache not reused after switch. Run and confirm failure

### Implementation for User Story 1

- [X] T028 [US1] Implement `OrganizationContextResolver` in `apps/server/src/auth/organizationContext.ts` (membership lookup + short TTL cache by version) and attach context on Hono requests — make T025 pass
- [X] T029 [US1] Update assertion signing/verification in `apps/server/src/auth/principal.ts` and `src/auth/internalPrincipal.ts` to v2 `{userId, organizationId, …}` — make T026 pass
- [X] T030 [P] [US1] Move organization-scoped App Router pages under `apps/web/src/app/(authenticated)/o/[orgSlug]/…` (projects, tasks, runs, budgets, routines, webhooks, org library, organization chart, memory); keep global account, login, org create/list outside
- [X] T031 [P] [US1] Add BFF routes under `apps/web/src/app/api/o/[orgSlug]/execution/[...path]/route.ts` (and other BFF proxies): resolve slug → org, verify active membership, then sign assertion; non-member → 404
- [X] T032 [US1] Replace `OrganizationGate` with org layout in `apps/web/src/app/(authenticated)/o/[orgSlug]/layout.tsx`; add org switcher in `apps/web/src/components/layout/AppSidebar.tsx` navigating by slug; include organization in TanStack Query keys and hard-reset cache on switch
- [X] T033 [US1] Redirect `/` and post-login using `users.tenant_id` only if still an active member, else first active membership, else organization creation (`apps/web/src/auth.ts` / authenticated `page.tsx`)
- [X] T034 [US1] Make T027 pass; run route matrix smoke for same-org / foreign-org / non-member on representative studio routes

**Checkpoint**: Multi-org switch works with URL-based isolation; foreign slugs 404.

---

## Phase 5: User Story 2 — Administer organization membership and roles (Priority: P1)

**Goal**: Invite, role-change, remove; permission matrix enforced; last-owner protection; membership audit; revocation ≤60s (FR-104, FR-106, FR-110, SC-003).

**Independent Test**: One user per role in one org; every sensitive action allowed/denied per [data-model.md](./data-model.md) permission matrix; removed member denied within one minute.

### Tests for User Story 2

- [ ] T035 [P] [US2] Write failing permission-matrix tests in `tests/organizationPermissions.test.ts` covering owner/admin/member/viewer × sensitive actions (`budgets.manage`, `agent_org.manage`, `members.manage`, `credentials.manage`, `org.delete`, `runs.read_all`, role grant rules). Run and confirm failure
- [ ] T036 [P] [US2] Write failing tests in `tests/organizationMembershipAdmin.test.ts`: last active owner cannot be removed/suspended/demoted; admin cannot modify/remove/suspend/demote any owner or grant owner; concurrent last-owner protection under organization-scoped lock; audit row on every membership change. Run and confirm failure
- [ ] T037 [P] [US2] Write failing revocation test in `tests/organizationMembershipRevocation.test.ts`: after remove, next request denied within 60s (cache TTL / version bump). Run and confirm failure

### Implementation for User Story 2

- [ ] T038 [US2] Implement role→permission map and `requirePermission` helpers in `apps/server/src/auth/authorization.ts` — make T035 pass for unit cases
- [ ] T039 [US2] Implement invitations + member management APIs in `apps/server/src/api/studio/` (invite, accept, change role, remove/suspend) with atomic org-scoped lock and append-only writes to `studio_organization_audit` — make T036 pass
- [ ] T040 [US2] Enforce membership + permissions on every organization-scoped server route; typed errors (uniform 404 for foreign ids); set `ORG_MEMBERSHIP_ENFORCEMENT=enforce` only after shadow run with zero unexplained `authz.would_deny` (plan §3)
- [ ] T041 [US2] Gate agent org chart / goals / budgets / credentials / org settings routes with the matrix; admins/owners get `runs.read_all` (D-4)
- [ ] T042 [US2] Replace `system%` / `internal:%` string checks with typed service principals (`principalKind: "service"`) in `apps/server/src/auth/` and `src/auth/internalPrincipal.ts` (D-11)
- [ ] T043 [US2] Add membership admin UI under `apps/web/src/app/(authenticated)/o/[orgSlug]/settings/` (or equivalent) for invite/role/remove; make T037 pass
- [ ] T044 [US2] Run Independent Test matrix to 100% pass; evidence threat-model T-1…T-6, T-13, T-14, T-19 under `specs/007-organization-tenancy-audit/evidence/phase-2/`

**Checkpoint**: Multi-member orgs are safe; invitations allowed only with enforcement active.

---

## Phase 6: User Story 3 — Executions keep their original organization (Priority: P2)

**Goal**: Runs, routines, triggers, and jobs always execute in the originating organization; D-5 revocation policy; no cross-org credentials/memory/budgets/workspaces (FR-105, INV-3, INV-7).

**Independent Test**: Runs in two orgs with interleaved approvals/restarts/triggers; every event, lease, memory access, budget charge, and workspace file belongs to the originating org.

### Tests for User Story 3

- [ ] T045 [P] [US3] Write failing tests in `tests/organizationExecutionIsolation.test.ts`: removed initiator → task/run history kept; in-flight run stops at next resume/approval/credential lease with `ORGANIZATION_ACCESS_REVOKED`; no new lease; routines of removed owner stop firing. Run and confirm failure
- [ ] T046 [P] [US3] Write failing tests for interleaved multi-org outbox/routine/heartbeat/memory job handlers and identical trigger keys across orgs in `tests/organizationBackgroundIsolation.test.ts`. Run and confirm failure
- [ ] T047 [P] [US3] Write failing tests for memory-grant ↔ run-org equality, workspace path traversal / foreign-prefix rejection, and broker cross-org consume rejection in `tests/organizationExecutionSecurity.test.ts`. Run and confirm failure

### Implementation for User Story 3

- [ ] T048 [US3] Add migration `infrastructure/studio/migrations/02x_run_initiator.sql` with additive columns `initiator_kind` (`user|service|schedule|trigger`) and `membership_version_at_start` on runs
- [ ] T049 [US3] Persist initiator fields and apply D-5 policy in `apps/server/src/runtime/runExecutor.ts` (and approval/resume/credential paths) — make T045 pass
- [ ] T050 [US3] Execute outbox/routine/heartbeat/memory job handlers through `withOrganization` with per-item org assertions in `apps/server/src/triggers/*`, runtime job processors, and memory job handlers — make T046 pass
- [ ] T051 [US3] Enforce memory-grant tenant equality, workspace path org prefix checks, and org-owned tool connections requiring `credentials.manage` — make T047 pass
- [ ] T052 [US3] Wire `studio_worker` claim functions for cross-org claim + per-org handler execution; confirm `tests/postgresMultiInstanceRecovery.test.ts` and broker suites still pass
- [ ] T053 [US3] Run Independent Test; evidence T-7…T-12 under `specs/007-organization-tenancy-audit/evidence/phase-3/`

**Checkpoint**: Background and long-running work cannot cross organizations.

---

## Phase 7: User Story 6 — Delete an organization (Priority: P2)

**Goal**: Owner deletes org from settings by typing exact name; resumable hard purge of all application data; broker audit retention exception only; feature disabled until Phase 5 verification (FR-113, SC-008).

**Independent Test**: Org with members/projects/runs/memories/files → delete → zero application data (verify retained broker audit separately); members still sign in to other orgs.

### Tests for User Story 6

- [ ] T054 [P] [US6] Write failing tests in `tests/organizationDeletion.test.ts`: name mismatch → no delete; admin/member denied; `ORG_DELETION_ENABLED=false` rejects with no side effects; confirmed delete sets `status=deleting`, cancels runs, revokes leases, deletes secrets (Q3), purges studio/memory/jobs/files/memberships/org row; interrupted purge resumes; never report completed while residual rows exist. Run and confirm failure
- [ ] T055 [P] [US6] Write failing concurrent late-write test: worker attempting write during purge cannot resurrect org-owned rows. Run and confirm failure (may live in same suite)

### Implementation for User Story 6

- [ ] T056 [US6] Implement deletion API `DELETE /studio/organizations/current` (name confirmation, `org.delete`) and resumable purge worker in `apps/server/src/organization/` + routes; retain service-only broker audit rows only (Q2) — keep `ORG_DELETION_ENABLED=false` by default
- [ ] T057 [US6] Add organization settings deletion UI under `apps/web/src/app/(authenticated)/o/[orgSlug]/settings/` that requires typing the exact organization `name`; hide UI when flag is false
- [ ] T058 [US6] Make T054–T055 pass against the purge implementation with flag enabled in tests only; do **not** enable in default env until Polish Phase T070

**Checkpoint**: Deletion path complete behind flag; not product-enabled yet.

---

## Phase 8: User Story 4 — Organization memory (Priority: P3)

**Goal**: Org-scoped memory readable by members, writable with `memory.org.write`; grants from OrganizationContext; precedence run > agent > project > organization; no cross-org leakage (FR-107, INV-6, SC-004).

**Independent Test**: Store org fact in A; agents in A and B; fact used only in A and ranked below conflicting project knowledge.

### Tests for User Story 4

- [ ] T059 [P] [US4] Write failing tests in `tests/organizationMemoryScope.test.ts`: pgvector retrieval filters org before ranking (two orgs, identical embeddings); viewer denied write/forget; member read ok; consolidation never writes into another org. Run and confirm failure
- [ ] T060 [P] [US4] Write failing precedence/conflict tests (incl. temporal supersession) for organization namespace in context assembler. Run and confirm failure

### Implementation for User Story 4

- [ ] T061 [US4] Derive memory grants from OrganizationContext for user runs (`organization`, project, agent, user namespaces per permission) in `apps/server/src/runtime/` / memory access modules; bind `MEMORY_PRINCIPALS` service tokens to one org
- [ ] T062 [US4] Enforce context-assembler precedence run > agent > project > organization; gate write/forget with `memory.org.write`; consolidation project→org only with explicit approval — make T059–T060 pass
- [ ] T063 [US4] Add/adjust memory explorer org scope UI under `apps/web/src/app/(authenticated)/o/[orgSlug]/org/memory/`; enable with `ORG_MEMORY_SCOPE=true`
- [ ] T064 [US4] Run memory suites + eval/benchmark; require security metrics 0 cross-org leakage; document precedence in [docs/organization-and-cost-budgets.md](../../docs/organization-and-cost-budgets.md) or memory docs

**Checkpoint**: Organization memory usable without cross-org leakage.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: RLS activation, assertion cleanup, enable deletion, docs, single verification report (plan Phase 5).

- [ ] T065 Create `infrastructure/studio/migrations/02x_enable_rls.sql` (`ENABLE` + `FORCE ROW LEVEL SECURITY` on all policy tables); map `ORG_RLS=enforce` to app connecting as `studio_app` and workers as `studio_worker`
- [ ] T066 Write and pass raw-SQL negative tests: query without `app.tenant_id` returns 0 organization-owned rows; cross-org insert rejected by `WITH CHECK`; worker can claim across orgs but handlers still execute per org
- [ ] T067 Remove v1 assertion acceptance and `tenantId` response aliases; harden assertion replay (nonce/exp) in `apps/server/src/auth/principal.ts`
- [ ] T068 [P] Update docs: [docs/architecture.md](../../docs/architecture.md), [docs/production-saas-readiness-gaps.md](../../docs/production-saas-readiness-gaps.md), [docs/organization-and-cost-budgets.md](../../docs/organization-and-cost-budgets.md), [docs/development.md](../../docs/development.md)
- [ ] T069 Reproduce gate commands from [test-baseline.md](./test-baseline.md) §7 under `studio_app` with RLS enforced (full Jest + PG + Playwright + memory eval/benchmark); record exact commands/results in `specs/007-organization-tenancy-audit/evidence/phase-5/verification-report.md`
- [ ] T070 Enable `ORG_DELETION_ENABLED=true` only after T054–T055 and T069 purge verification under RLS (including concurrent late write); confirm SC-008
- [ ] T071 [P] Rehearse recovery notes (SC-006): Phase 1 reset irreversible without operator backup; Phases 2–5 only security-compatible rollback build or maintenance + forward-fix — document in verification report

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Phase 0.5 complete — start here
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS** all user stories
- **US5 (Phase 3)**: Depends on Foundational — first deliverable / MVP
- **US1 (Phase 4)**: Depends on Foundational + US5 org-creation APIs
- **US2 (Phase 5)**: Depends on Foundational + US1 context/resolver (membership admin needs org context)
- **US3 (Phase 6)**: Depends on US1 + US2 (enforced membership + permissions for credential/run paths)
- **US6 (Phase 7)**: Depends on US2 (`org.delete`); purge completion spans US3 stores; **enable** only after Polish RLS gate
- **US4 (Phase 8)**: Depends on US1 + US3 (context-derived grants + run-org equality)
- **Polish (Phase 9)**: Depends on US1–US6 implementations

### User Story Dependencies

- **US5 (P1)**: After Foundational — no dependency on other stories
- **US1 (P1)**: After US5 org creation path
- **US2 (P1)**: After US1 OrganizationContext
- **US3 (P2)**: After US1 + US2
- **US6 (P2)**: Implement after US2; product-enable after Polish
- **US4 (P3)**: After US1 + US3

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Schema/models before services; services before routes/UI
- Story Independent Test before moving to next priority

### Parallel Opportunities

- T003 with T001–T002 after decisions noted
- T008, T009, T010 in parallel after T007
- T015, T016 in parallel once migrations exist
- Within US1: T025–T027 parallel; T030–T031 parallel after resolver
- Within US2: T035–T037 parallel
- Within US3: T045–T047 parallel
- US6 implementation (flag off) can proceed in parallel with US4 after US2/US3 stores exist
- Polish doc tasks T068 parallel with T065–T067 once behavior frozen

---

## Parallel Example: User Story 1

```bash
# After US5 checkpoint — launch US1 tests together:
Task: "organizationContextResolver tests in tests/organizationContextResolver.test.ts"
Task: "organizationAssertionV2 tests in tests/organizationAssertionV2.test.ts"
Task: "Playwright organization-routing.spec.ts"

# After resolver+assertion green — launch UI/BFF moves together:
Task: "Move pages under apps/web/src/app/(authenticated)/o/[orgSlug]/"
Task: "BFF routes under apps/web/src/app/api/o/[orgSlug]/"
```

---

## Parallel Example: User Story 2

```bash
# Launch permission/membership tests together:
Task: "tests/organizationPermissions.test.ts"
Task: "tests/organizationMembershipAdmin.test.ts"
Task: "tests/organizationMembershipRevocation.test.ts"
```

---

## Implementation Strategy

### MVP First (US5 only)

1. Complete Setup + Foundational
2. Complete US5 (reset, migrate, register, create org)
3. **STOP and VALIDATE** Independent Test for US5
4. Demo: empty DB → first organization owner

### Incremental Delivery

1. Setup + Foundational → schema and helpers ready
2. US5 → clean start MVP
3. US1 → multi-org switch + URL isolation
4. US2 → safe multi-member administration
5. US3 → execution/background isolation
6. US6 (flag off) → deletion path ready
7. US4 → organization memory
8. Polish → RLS enforce + enable deletion + verification report

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. Then: Dev A US5→US1; Dev B prepares US2 tests/matrix against membership store; Dev C drafts US3 migration + isolation tests
3. Serialize enforcement flag flip (US2) and RLS enable (Polish)

---

## Notes

- Phase 0 analysis artifacts are frozen; do not treat Phase 0 FR-001…FR-007 as implementation tasks
- Nested [phase-0.5/tasks.md](./phase-0.5/tasks.md) remains the record for baseline repair
- Never restore weaker authorization after admitting additional members (plan Phase 2 rollback)
- `ORG_DELETION_ENABLED` and `ORG_RLS` stay off/false until Polish gates pass
- Commit after each task or logical group; attach evidence under `specs/007-organization-tenancy-audit/evidence/`
