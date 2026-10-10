# Implementation Plan: Organization-Centric Tenancy Migration (Phases 1–5)

**Branch**: n/a (Phase 0 planning on current branch) | **Date**: 2026-10-10 (decisions recorded 2026-10-10) | **Spec**: [spec.md](./spec.md)

**Input**: Phase 0 audit — [current-architecture.md](./current-architecture.md),
[organization-inventory.md](./organization-inventory.md), [data-model.md](./data-model.md),
[gap-analysis.md](./gap-analysis.md), [threat-model.md](./threat-model.md),
[migration-plan.md](./migration-plan.md), [risk-register.md](./risk-register.md),
[test-baseline.md](./test-baseline.md).

> Phase 0 is complete. Decisions D-1…D-12 were answered by the user (§6). **No phase below has been started.**

## Summary

The repository already has a de-facto organization key (`tenant_id` on every table), a 1:1 organization
profile row (`studio_organizations.id = tenant_id`), and a separate AI-agent org chart with goals. It
lacks human membership, roles, server-side membership verification, and several write-path guards.

The plan **extends** the existing organization profile into the Organization entity and keeps `tenant_id`
as the organization id (D-1). Because the user chose to **clear the database** instead of migrating legacy
tenants (D-7), Phase 1 starts from an empty data set: the strict schema (non-null organization on every row,
tenant-qualified keys, row-level-security prerequisites) is introduced up front rather than through a long
expand/contract migration. Organizations are addressed in the URL (D-8), RLS is prepared in Phase 1 and
enforced in Phase 5 (D-10), and organizations can be permanently deleted from settings (D-12).

## Technical Context

**Language/Version**: TypeScript 5.7 (Node execution server, Next.js 16 web)
**Primary Dependencies**: Hono, NextAuth (credentials), LangGraph, pg/pgvector, TanStack Query, zustand
**Storage**: PostgreSQL 16 + pgvector (studio, memory, broker tables); forward-only migration runners
**Testing**: Jest (`pnpm test --runInBand`, PG suites via `MEMORY_TEST_DATABASE_URL`), Playwright (`apps/web/e2e`), `tsc`
**Target Platform**: self-hosted web app + execution server + credential broker
**Project Type**: pnpm monorepo (apps/web BFF, apps/server API, src core, packages/types)
**Constraints**: no cross-org exposure at any step; one planned maintenance window for the reset; afterwards zero/minimal downtime
**Scale/Scope**: ~30 tenant-bearing tables, ~100 server routes, 101 Jest suites

## Constitution Check

`.specify/memory/constitution.md` is an unfilled template; no ratified principles to check. Gates below
substitute for constitution gates: test-first for security invariants, expand/contract migrations after the
reset, and phase-level verification evidence.

## 1. Reassessment of Phase 1

The original Phase 1 ("Organization and Membership") assumed organizations did not exist. The audit shows:

- Organization **already exists** as tenant key + profile row → Phase 1 must *extend*, not create.
- Multiple ownership/tenancy models coexist (personal / tenant / system, `system%` prefix bypass,
  `MEMORY_PRINCIPALS` grants) → consolidation is needed, staged with the phases that touch each model.
- Some authorization defects (ownership capture R-01, unguarded upserts R-02, no roles R-05, frozen JWT
  tenant R-04) become exploitable **the moment a second member joins** → write-path guards land in Phase 1.
- The database reset (D-7) removes all legacy-data risk, so Phase 1 can also take the schema-tightening
  work that was originally deferred to Phase 5, plus the RLS prerequisites (D-10).

**Phase 1 = combination**: "Organization foundation on a clean database":

1. Prerequisite **Phase 0.5**: fix baseline regressions R1–R3, fix the test-typecheck gate, re-record baseline.
2. Explicit, guarded **database reset** of all application data (D-7); new migrations refuse to run while
   legacy tenant data exists.
3. Organization (status, slug), memberships, roles, organization audit; organization creation always creates
   the owner membership.
4. Strict schema: `tenant_id NOT NULL` on every organization-owned table, tenant columns added where
   missing (`studio_run_events`, `studio_approvals`, `studio_workspace_repositories`), tenant-qualified unique
   keys and composite parent/child consistency, tenant-guarded upserts, ownership-capture fix.
5. RLS prerequisites (policies created, **not enabled**), tenant-scoped DB access helper, DB role split.
6. Server-side OrganizationContext resolution (membership lookup) — enforced for organization creation and
   membership APIs; full route enforcement in Phase 2.

## 2. Phase plan with acceptance gates

### Phase 0.5 — Baseline repair (prerequisite, not part of the org program)

- **Changes**: `tests/taskBoardView.test.ts` fixture (`projectId`, `workspaceId`);
  `tests/eventRoutinesIntegration.test.ts` fixture (project row + `project_id`);
  `OrganizationService.requestStrategyProposal`/`delegate` resolve the project **before** persisting and
  require an explicit `projectId` (D-6), typed `ApiError(409/400)`; `tests/organizationBudgetRoutes.test.ts`
  creates a project; `tsconfig.jestfullcheck.json` actually type-checks tests.
- **DoD**: full suite 101/101 suites green with PG; failed strategy request leaves no goal (new test);
  test-typecheck gate passes.

### Phase 1 — Organization foundation on a clean database

| Item | Content |
|------|---------|
| Dependencies | Phase 0.5; D-1, D-2, D-3, D-7, D-10 (prereq part) |
| Code changes | **Reset**: operator command (e.g. `pnpm db:reset -- --confirm-destroy-all-data`) that truncates studio, memory, and broker data tables (keeping migration ledgers), and empties `STUDIO_WORKSPACE_STORAGE_ROOT` working copies; refuses in non-interactive mode without the flag. **Migration 018+**: guard (abort if any tenant data exists without the new tables populated), `studio_organizations.status` + `slug` (unique), `studio_organization_memberships`, `studio_organization_audit`, `studio_users.tenant_id` dropped from authority (kept nullable as "last organization" or removed — see data-model), `tenant_id NOT NULL` everywhere incl. new columns on `studio_run_events`/`studio_approvals`/`studio_workspace_repositories`, tenant-qualified trigger dispatch index, composite `(tenant_id, id)` uniqueness for FK targets and composite FKs for parent/child, RLS policies (`USING tenant_id = current_setting('app.tenant_id')`) created but RLS disabled. **Code**: `withOrganization(orgId, fn)` DB helper (`SET LOCAL app.tenant_id`, `app.principal_kind`) used by all store queries; DB roles `studio_migrator` (owner), `studio_app` (no BYPASSRLS), `studio_worker` (cross-org claim functions); registration creates user only, organization creation is a separate step that creates the owner membership; `OrganizationMembershipStore` (in-memory + Postgres); `OrganizationContextResolver`; principal assertion v2 `{userId, organizationId}`; tenant-guarded upserts; `owner_id` preserved on update; membership read APIs |
| Required tests | reset command refuses without flag and leaves ledgers intact; migration guard aborts on legacy data; membership store contract (both adapters); org creation creates exactly one owner membership atomically; resolver: member / non-member / suspended org / removed member; concurrent cross-org id collision per guarded upsert; shared agent edit keeps `owner_id NULL`; every store query runs inside `withOrganization` (test harness enables RLS on a scratch schema and runs the store suites → any unscoped query fails); composite FK rejects child in another org |
| Security invariants | INV-1 at data level (constraints), INV-5 (no legacy rows exist), INV-8; org audit records every membership change |
| Data migration | none — reset; verification: all data tables empty before 018; constraints present after |
| Rollback | before reset: restore operator backup (if taken); after reset: forward-fix only (no legacy state to return to) |
| DoD | gate commands green (test-baseline §7) + new suites; RLS-shadow harness green; reset runbook documented in `docs/development.md` |

### Phase 2 — Organization Context, URL Routing & Resource Authorization

| Item | Content |
|------|---------|
| Dependencies | Phase 1; D-2, D-4, D-8, D-11 |
| Code changes | **URL routing** `/o/[orgSlug]/…` for all authenticated pages (existing `/org/*` org library, projects, tasks, runs, budgets, routines, webhooks, organization chart move under it); root and login redirect to the user's last/default organization or to organization creation; BFF routes `/api/o/[orgSlug]/execution/[...path]` (and other BFF routes) resolve slug → org and verify membership before signing the assertion; `OrganizationGate` replaced by an org layout; org switcher in `AppSidebar` navigates between slugs; query keys include organization; full cache reset on org change. **Server**: enforce membership + permissions on every route; permission gates on org settings, agent chart, goals, budgets, projects, credentials; admins/owners can read teammates' runs (`runs.read_all`, D-4); invitations & member management; typed errors (no raw 400s); user-path store methods require organization context; typed service principal replaces `system%`/`internal:%` checks (D-11); uniform 404 for foreign ids |
| Required tests | route × {same org, foreign org, non-member, removed member, each role} matrix; slug of an org the user is not a member of → 404 page, no data request succeeds; manual URL edit to another slug cannot reuse cached data; removed member denied within TTL; last-owner protection; role escalation denied; Playwright: org switch + deep links + stale-cache checks |
| Security invariants | INV-1, INV-2, INV-4 |
| Data migration | none |
| Rollback | redeploy previous version (schema unchanged in this phase) |
| DoD | matrix 100% pass; Playwright URL/switch specs green; threat-model T-1…T-6, T-13, T-14, T-19 evidenced |

### Phase 3 — Execution & Infrastructure Isolation

| Item | Content |
|------|---------|
| Dependencies | Phase 2; D-5 |
| Code changes | runs: `initiatorKind`, `membershipVersionAtStart`; D-5 policy (tasks and run history stay in the organization; in-flight runs of a removed initiator stop at the next resume/approval/credential lease with `ORGANIZATION_ACCESS_REVOKED`; routines of a removed owner stop firing); memory-grant ↔ run-org equality check; per-item org assertions in outbox/routine/heartbeat/memory job handlers (executed through `withOrganization`); worker claim functions for `studio_worker` role; workspace path tests; org-owned tool connections (credential aliases) with `credentials.manage` |
| Required tests | removed initiator → task kept, run stopped, no lease issued; interleaved multi-org outbox/routine/heartbeat processing; trigger key collision across orgs; memory grant mismatch rejected; path traversal / foreign-prefix rejection; broker cross-org consume rejected (existing); recovery after restart preserves org |
| Security invariants | INV-3, INV-7 |
| Data migration | additive columns only |
| Rollback | additive; previous version ignores new columns |
| DoD | all above green incl. `postgresMultiInstanceRecovery` and broker suites; T-7…T-12 evidenced |

### Phase 4 — Organization Memory

| Item | Content |
|------|---------|
| Dependencies | Phase 3; D-9 |
| Code changes | grants derived from OrganizationContext for user runs (`organization`, project, agent, user namespaces per permission); context-assembler precedence run > agent > project > organization; org memory write/forget gated by `memory.org.write`; consolidation promotion project → org only with explicit approval; memory explorer org scope; `MEMORY_PRINCIPALS` tokens bound to one org for services |
| Required tests | pgvector retrieval filters org before ranking (two orgs, identical embeddings); org memory visible only to members; precedence/conflict incl. temporal supersession; consolidation never writes into another org; eval + benchmark security metrics 0 |
| Security invariants | INV-6 |
| Data migration | none (fresh data); optional index `(tenant_id, namespace_scope, namespace_id)` |
| Rollback | `ORG_MEMORY_SCOPE=false` |
| DoD | memory suites + eval/benchmark green, security metrics 0; precedence documented |

### Phase 5 — Final Integration, RLS Activation, Deletion Verification, Cleanup

| Item | Content |
|------|---------|
| Dependencies | Phases 1–4 |
| Code changes | **Enable RLS** (`ENABLE` + `FORCE ROW LEVEL SECURITY`) on all organization-owned tables; app connects as `studio_app`; workers as `studio_worker`; remove v1 assertion acceptance and `tenantId` response aliases; assertion replay hardening; docs (`architecture.md`, `production-saas-readiness-gaps.md`, `organization-and-cost-budgets.md`, `development.md`) |
| Required tests | full suite + PG + Playwright + memory eval/benchmark **under the `studio_app` role with RLS enforced**; raw-SQL negative tests (query without `app.tenant_id` returns 0 rows; cross-org insert rejected by `WITH CHECK`); worker role can claim across orgs but handlers still execute per org; organization deletion end-to-end (below) |
| Security invariants | INV-1…INV-9 evidenced in one report |
| Data migration | `ALTER TABLE … ENABLE/FORCE ROW LEVEL SECURITY` (reversible by `DISABLE`) |
| Rollback | `DISABLE ROW LEVEL SECURITY` per table; app role switch back |
| DoD | single verification report with exact commands/results; RLS enforced in all environments; no KNOWN-FAIL items except explicitly accepted |

Organization **deletion** (D-12) is implemented in Phase 2 (settings UI + API, owner only) with purge
across studio, memory, workspaces and broker leases extended in Phases 3–4 as those domains gain
organization ownership; Phase 5 verifies complete removal under RLS.

## 3. Cross-phase gate rules

- Every phase reproduces the gate commands in [test-baseline.md](./test-baseline.md) §7 and reports deltas.
- A test counts as passing only if it executed (PG suites require the DB up; skipped ≠ passed).
- Every new security invariant has at least one negative test written **before** the implementation.
- No flag moves to `enforce` without a shadow run with zero unexplained `authz.would_deny`.

## 4. Project Structure (expected touch points)

```text
infrastructure/studio/migrations/018_*.sql …            scripts/db-reset (new, Phase 1)
src/studio/contracts.ts, src/studio/infrastructure/{postgres,in-memory}-studio-store.ts
src/memory/infrastructure/*, src/broker/{leaseStore,audit}.ts (tenant helper / reset)
apps/server/src/auth/{principal,authorization}.ts  (+ organizationContext.ts)
apps/server/src/organization/*  (agent org chart: permission gates only)
apps/server/src/api/studio/organizationProfile*.ts (+ membership, deletion routes)
apps/server/src/runtime/runExecutor.ts, triggers/*, budgets/*, memory/access.ts
src/auth/internalPrincipal.ts
apps/web/src/app/(authenticated)/o/[orgSlug]/**, app/api/o/[orgSlug]/**, auth.ts, lib/executionBff.ts,
  components/layout/{OrganizationGate,AppSidebar}.tsx, hooks/*
tests/** (new suites per phase), apps/web/e2e/** (org routing specs)
```

## 5. Phase 1 recommendation (final)

Start Phase 1 after Phase 0.5 is merged and the open confirmations in §7 are answered. Phase 1 scope:
guarded reset, organization/membership/audit schema with strict constraints, RLS prerequisites (policies
created, disabled), tenant-scoped DB helper and role split, tenant-guarded writes and ownership-capture fix,
OrganizationContext resolver, organization creation + membership read APIs. Existing pages keep working for
the (new) single-organization users until Phase 2 introduces URL routing.

## 6. Decision record

| ID | Decision | Outcome (user, 2026-10-10) | Applied in |
|----|----------|----------------------------|------------|
| D-1 | Organization id = existing `tenant_id` column/value | **Approved** | P1 |
| D-2 | Roles owner/admin/member/viewer with the permission matrix in `data-model.md` | **Approved** | P1/P2 |
| D-3 | Assertion carries selected `organizationId`; role resolved server-side per request | **Approved** | P1 |
| D-4 | Owners/admins can read teammates' runs (`runs.read_all`); members see their own | **Approved** | P2 |
| D-5 | Initiator loses membership | **"Tasks are kept"**: tasks and run history remain in the organization; in-flight runs stop at the next resume/approval/credential lease; routines of a removed owner stop firing (interpretation — see §7 Q1) | P3 |
| D-6 | Org-level tasks require an explicit project; no "first active project" fallback | **Approved** | P0.5 |
| D-7 | Legacy tenants | **Changed: clear the database; no legacy tenants remain.** Replaces backfill/quarantine. | P1 |
| D-8 | Organization selection | **Changed: URL-based routing** (`/o/[orgSlug]/…`) implemented | P2 |
| D-9 | Memory grants derived from membership; org-bound tokens for services | **Approved** | P4 |
| D-10 | Database RLS | **Approved: prerequisites in Phase 1; activated and tested in Phase 5** | P1, P5 |
| D-11 | Typed service principals replace `system%`/`internal:%` | **Approved** | P2 |
| D-12 | Organization deletion | **Changed: from organization settings, confirmed by typing the organization's name; data is not retained** (hard delete) | P2–P5 |

## 7. Open confirmations (small; do not block Phase 0.5)

| # | Question | Default if unanswered |
|---|----------|-----------------------|
| Q1 | D-5: is the interpretation right that in-flight runs of a removed member **stop** (task kept, re-runnable by others), rather than continue to completion? | stop at next checkpoint |
| Q2 | D-7/D-12: the credential broker audit log is append-only and hash-chained across all tenants. Clear it in the reset? Delete an organization's audit rows on deletion (breaks chain verification) or keep them as security records outside "organization data"? | reset: clear (TRUNCATE); deletion: keep audit rows (no secrets stored) |
| Q3 | D-12: also delete the organization's secrets in Vault/secret store and cancel its running executions automatically? | yes, both |
| Q4 | D-8: may an organization's slug be changed after creation (old URLs then 404), or is it fixed at creation? | editable by owner/admin, no redirects |
