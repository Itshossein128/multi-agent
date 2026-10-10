# Incremental Migration Plan

**Feature**: `007-organization-tenancy-audit` | **Phase**: 0 (plan only) | **Date**: 2026-10-10 (revised after decisions)

Decision D-7 (user): **clear the database; no legacy tenants remain.** The migration is therefore a
one-time, guarded reset followed by a strict schema, instead of a backfill. Everything after the reset
follows normal expand → contract discipline.

Principles:

1. **The organization id is the existing `tenant_id` column** (D-1). No columns are renamed.
2. **One explicit reset**, executed by an operator in a maintenance window; never implicit, never automatic.
3. **Strict from the start**: because no legacy rows survive, constraints that would otherwise need a long
   migration (`NOT NULL`, tenant-qualified keys, composite FKs) are added in Phase 1.
4. After the reset, each later schema change is additive first; there are no down migrations in this repo,
   so rollback = previous app version on the expanded schema, or restore from backup.

## 1. Reset (Phase 1, once)

### 1.1 What is cleared

| Store | Cleared | Kept |
|-------|---------|------|
| Studio tables (`studio_*`: users, organizations, projects, workspaces, tasks, comments, agents, tools, workflows, runs, run events, approvals, routines, webhooks, heartbeats, trigger events, goals, reporting lines, budgets, repositories/repo states) | all rows | `studio_migrations` ledger |
| Memory tables (`studio_memories`, `studio_memory_jobs`) incl. embeddings | all rows | `studio_memory_migrations` ledger |
| Broker (`credential_broker_leases`, `credential_broker_audit`) | leases: all rows; audit: see plan §7 Q2 (default: `TRUNCATE`, which the row-level append-only trigger does not block) | DDL, trigger |
| Filesystem | working copies under `STUDIO_WORKSPACE_STORAGE_ROOT` | root directory |
| External | Vault/secret-store entries are **not** touched by the reset (operator task) | — |

No system agents/tools are seeded by code or migrations (verified: no `is_system = true` inserts), so
nothing needs re-seeding. Users must register again (or dev identity is recreated, §4).

### 1.2 Mechanism

- New operator command (e.g. `pnpm db:reset -- --confirm-destroy-all-data`):
  1. refuses without the flag; prints row counts per table first;
  2. refuses if the execution server is reachable and has running runs (drain first);
  3. optional `--backup <file>` runs `pg_dump` before clearing (operator choice; the product keeps no copy);
  4. `TRUNCATE … RESTART IDENTITY CASCADE` on the listed tables in one transaction;
  5. deletes working copies under the storage root (path containment checked);
  6. writes a reset record to stdout/log (no data retained).
- Migration `018` contains a **guard**: it aborts if any organization-owned table has rows while
  `studio_organization_memberships` does not yet exist — so the new schema can only be applied to an empty
  data set and no legacy tenant can slip through.

### 1.3 Ordering in the maintenance window

1. Stop schedulers/workers; drain or cancel running runs.
2. Run reset (with optional backup).
3. Apply migrations `018+` (studio), memory/broker DDL updates.
4. Deploy execution server, then web/BFF (same window; no cross-version compatibility required).
5. Create the first organization (owner registers → creates organization).
6. Run gate commands and the post-migration verification.

## 2. Schema evolution

| Step | Migration (proposed) | Phase | Content |
|------|---------------------|-------|---------|
| S1 | `018_organization_foundation.sql` | 1 | empty-data guard; `studio_organizations`: `status` (`active|suspended|deleting`), `slug` (unique, lowercase), `created_by`; `studio_organization_memberships(organization_id, user_id, role, status, invited_by, version, timestamps)` unique `(organization_id,user_id)`; `studio_organization_audit` (append-only); `studio_users.tenant_id` → nullable "last organization" (no longer authoritative) |
| S2 | `019_tenant_constraints.sql` | 1 | `tenant_id NOT NULL` on workflows/agents/tools/tasks/runs (with `CHECK (is_system OR tenant_id IS NOT NULL)` for agents/tools); add `tenant_id NOT NULL` to `studio_run_events`, `studio_approvals`, `studio_workspace_repositories`; `UNIQUE (tenant_id, id)` on FK targets; composite FKs for parent/child (task→project, workspace→project, comment→task, repo states/repositories→project, goal→project, memberships→organization); tenant-qualified trigger-dispatch unique index (drop global one) |
| S3 | `020_rls_prerequisites.sql` | 1 | roles `studio_migrator`/`studio_app`/`studio_worker` (or documented manual role creation where the DB user lacks `CREATEROLE`); `CREATE POLICY org_isolation … USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (same)` on every organization-owned table; `studio_organizations` policy on `id`; RLS **not enabled**; SECURITY DEFINER claim functions for workers |
| S4 | memory `006_*` | 1 | same `NOT NULL`/policy treatment for memory tables; optional index `(tenant_id, namespace_scope, namespace_id)` |
| S5 | broker DDL update | 1 | policies on leases (audit stays service-only) |
| S6 | `02x_run_initiator.sql` | 3 | `initiator_kind`, `membership_version_at_start` on runs (additive) |
| S7 | `02x_enable_rls.sql` | 5 | `ENABLE` + `FORCE ROW LEVEL SECURITY` on all policy tables |

Verification after S1–S5 (attached to the Phase 1 report): all data tables empty; all constraints and
policies present (catalog queries); `pg_class.relrowsecurity = false` until Phase 5.

## 3. Users and organizations after the reset

- Registration creates a **user only** (no implicit private tenant — removes `register/actions.ts:39`).
- Creating an organization (onboarding) atomically creates the organization row (`id` = new UUID, used as
  `tenant_id`), the slug, and the owner membership; audit entry recorded.
- `OrganizationGate`'s "no organization → onboarding" flow becomes "no membership → create or accept invite".

## 4. Dev identity

`AUTH_DEV_USER_ID`/`AUTH_DEV_TENANT_ID` (non-production only) must map to a real user + membership after the
reset; a dev seed command creates the dev user, organization and owner membership. The env tenant is no
longer trusted without a membership row.

## 5. Executions across the reset

All runs are drained or cancelled before the reset and their rows are cleared; no in-flight compatibility is
needed. After the reset, runs are created with non-null organization and later get initiator fields (S6).

## 6. API contract compatibility

Web and server are deployed together in the reset window, so the principal assertion moves directly to v2
`{userId, organizationId, exp, nonce, v: 2}`; the server may keep accepting `tenantId` as an alias for one
release to simplify tests, removed in Phase 5. Public API changes:

| Contract | Change | Phase |
|----------|--------|-------|
| `POST /studio/organizations` | creates org + owner membership + slug | 1 |
| `GET /studio/me/organizations`, `GET /studio/organizations/current/members` | new | 1 |
| Web URLs | `/o/[orgSlug]/…` for all authenticated pages | 2 |
| BFF | `/api/o/[orgSlug]/execution/[...path]` etc. | 2 |
| Members/invitations, `DELETE /studio/organizations/current` (name confirmation) | new | 2 |
| `/studio/organization` (agent chart) | permission gates | 2 |

## 7. Feature flags (post-reset)

| Flag | Values | Purpose |
|------|--------|---------|
| `ORG_MEMBERSHIP_ENFORCEMENT` | `shadow | enforce` | Phase 2 rollout of route-level permission checks |
| `ORG_MEMORY_SCOPE` | `false | true` | Phase 4 |
| `ORG_RLS` | `off | enforce` | Phase 5 activation switch (maps to the migration + role switch) |

## 8. Organization deletion (D-12)

- Location: organization settings; owner only (`org.delete`); the user must type the organization's exact
  name; server re-checks the name and permission.
- Data is **not retained**. Procedure (idempotent, resumable):
  1. set `status = deleting` (all access denied immediately, schedulers skip the org);
  2. cancel running runs; revoke broker leases; (Q3 default) delete the org's secrets via the broker;
  3. delete all organization rows (studio, memory incl. embeddings, jobs, budgets, goals, routines, webhooks),
     working copies on disk, memberships;
  4. delete the organization row; users remain; clear `last organization` pointers.
- Broker audit rows: per plan §7 Q2 (default kept as security records without secrets).
- A crash mid-way leaves `status = deleting`; a background job resumes the purge.

## 9. Rollback and recovery

- **Reset**: irreversible unless the operator took `--backup`; the product retains nothing (by decision).
- **Phase 1 schema**: forward-fix; previous app version is not supported after the reset window.
- **Phases 2–4**: schema changes additive → previous version runs on the expanded schema; flags revert.
- **Phase 5 RLS**: `DISABLE ROW LEVEL SECURITY` and switch the app back to the owner role.
