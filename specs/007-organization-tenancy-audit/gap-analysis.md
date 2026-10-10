# Current vs. Target Gap Analysis

**Feature**: `007-organization-tenancy-audit` | **Phase**: 0 | **Date**: 2026-10-10

Severity: **H** = can cause cross-organization exposure or privilege escalation once multi-member orgs
exist; **M** = correctness/operability blocker for the migration; **L** = hygiene.

## 1. Identity and membership

| # | Target capability | Current state | Gap | Sev |
|---|-------------------|---------------|-----|-----|
| G-ID-1 | Users belong to many orgs | `studio_users.tenant_id NOT NULL`, 1:1 (`005_users.sql`) | membership table, APIs (no backfill: database reset, D-7) | M |
| G-ID-2 | Roles & permissions | principal is `{userId, tenantId}` (`internalPrincipal.ts:2`); no roles | role model, permission checks on every mutating org route | **H** (once >1 member) |
| G-ID-3 | Server verifies membership per request | server trusts assertion; no lookup (`principal.ts:4-6`) | membership resolution middleware | **H** |
| G-ID-4 | Session revocation on disable/removal | tenant frozen in JWT at sign-in (`auth.ts:88-97`) | server-side re-validation (membership version) | **H** |
| G-ID-5 | Org selection | none; `OrganizationGate` assumes one org | URL-based selection `/o/[orgSlug]` (D-8), switcher, BFF membership validation | M |
| G-ID-6 | Invitations / adding members | no path to share a tenant (register always mints a new tenant) | invite flow | M |
| G-ID-7 | Assertion replay protection | nonce unchecked, 60 s window | optional nonce cache or shorter TTL + mTLS between BFF and server | L |

## 2. Organization entity

| # | Target | Current | Gap | Sev |
|---|--------|---------|-----|-----|
| G-ORG-1 | Org lifecycle (active/suspended/deleted) | no status; create + read only | status column, update/suspend/delete endpoints | M |
| G-ORG-2 | Owner via membership | `owner_id` text, never checked | membership owner; deprecate column | M |
| G-ORG-3 | Profile creation restricted | any tenant user can create (first writer wins) | after G-ID-1, creation happens with org creation only | M |
| G-ORG-4 | Consistent org row for every tenant | 017 backfill excluded `_orphan`; tenants created after 017 rely on wizard | resolved by reset + composite FK from every owned row to the organization | M |
| G-ORG-6 | Organization deletion | none | settings UI with name confirmation, owner-only, hard delete across all stores (D-12) | M |
| G-ORG-5 | Two meanings of "organization" | `/organizations` (profile) vs `/organization` (agent chart) | naming/doc clarity; keep both, rename UI copy | L |

## 3. Persistence and scoping

Table inventory (abridged; T = tenant_id, O = owner_id):

| Table(s) | T | O | Gap |
|----------|---|---|-----|
| `studio_workflows`, `studio_agents`, `studio_tools`, `studio_runs` | nullable | nullable | NOT NULL in Phase 1 (empty DB after reset); tenant-guarded upserts |
| `studio_tasks` | nullable | nullable | NOT NULL; `project_id` already NOT NULL |
| `studio_projects`, `studio_workspaces` | NOT NULL | NOT NULL | — |
| `studio_workspace_repositories` | **none** | — | add tenant column or enforce via parent join + FK |
| `studio_project_repositories`, `studio_workspace_repo_states` | NOT NULL | — | FKs absent |
| `studio_task_comments`, `studio_routines*`, `studio_webhook_*`, `studio_agent_heartbeats`, `studio_trigger_events` | NOT NULL | some | — |
| `studio_agent_reporting`, `studio_organization_goals`, `studio_budgets*` | NOT NULL | — | — |
| `studio_organizations` | id = tenant | NOT NULL | status, membership |
| `studio_users` | NOT NULL | — | becomes default org |
| `studio_memories`, `studio_memory_jobs` | NOT NULL (PK part) | — | — |
| `credential_broker_leases`, `credential_broker_audit` | NOT NULL | principal | — |

| # | Target | Current | Gap | Sev |
|---|--------|---------|-----|-----|
| G-DB-1 | Every org-owned row has non-null org | 5 core tables nullable (`004_ownership.sql`) | NOT NULL directly after reset (Phase 1) | M |
| G-DB-2 | Writes cannot cross orgs even under races | check-then-upsert on global id without tenant guard (agents/tools/workflows/tasks/projects…, e.g. `postgres-studio-store.ts:383-397`) | `ON CONFLICT … WHERE t.tenant_id = EXCLUDED.tenant_id` (pattern already used by `organizationStore.ts:71-79`) or composite keys | **H** |
| G-DB-3 | User-facing store calls always scoped | `principal?` optional → id-only SQL | split internal (service) and user APIs; make principal required on user paths | **H** |
| G-DB-4 | Dedupe keys tenant-qualified | global unique `triggerDispatchKey` (`013_…:10-12`); lookup may omit tenant | tenant-qualified index | M |
| G-DB-5 | Defense in depth | no RLS; single DB role | RLS prerequisites (policies, roles, `app.tenant_id` helper, tenant columns on run events/approvals/workspace repositories) in Phase 1; enabled and tested in Phase 5 (D-10) | M |
| G-DB-6 | Down/rollback | no down migrations in any family | expand/contract discipline; backups; compensating migrations | M |
| G-DB-7 | Hierarchy consistency | child/parent tenant equality not enforced (017 workspace backfill picks project from task majority without tenant check, `017_…:124-142`) | composite FKs `(tenant_id, parent_id)` in Phase 1 (legacy rows removed by reset) | M |

## 4. Authorization of existing organization features

| # | Feature | Current | Target permission | Sev |
|---|---------|---------|-------------------|-----|
| G-AZ-1 | Set CEO / reporting lines | any tenant user | `agent_org.manage` | **H** |
| G-AZ-2 | Approve/cancel goals | any tenant user | `agent_org.manage` | **H** |
| G-AZ-3 | Company/project/agent budgets | any tenant user | `budgets.manage` | **H** |
| G-AZ-4 | Org profile create | any tenant user | org creation flow only | M |
| G-AZ-5 | Shared agent/tool edits | editing captures ownership (`postgres-studio-store.ts:387-391`) | preserve `owner_id` on update; `resources.write` | **H** |
| G-AZ-6 | Synthetic `system%`/`internal:%` bypass | string prefix on userId | typed service principal | M |
| G-AZ-7 | Run visibility | owner only | owner + `runs.read_all` [D-4] | L |
| G-AZ-8 | Error classification | non-ApiError → 400 with raw message (`http.ts:38`) | 500 with generic message; typed errors | M |

## 5. Execution and infrastructure

| # | Target | Current | Gap | Sev |
|---|--------|---------|-----|-----|
| G-EX-1 | Runs preserve org context | ✓ persisted owner/tenant used on resume/credentials | add NOT NULL + initiator kind | L |
| G-EX-2 | Membership-loss policy | none; routines run as creator forever (`routineScheduler.ts:222`) | D-5 policy at fire/resume/credential time | M |
| G-EX-3 | Background jobs | cross-tenant claimers by design; synthetic principals | document trust boundary; per-org fairness; typed service principal | M |
| G-EX-4 | Run store isolation | `hydrate()` loads all runs; id-only get/update | acceptable internally; all HTTP paths must call `canAccess` (verify in Phase 3) | M |
| G-EX-5 | Workspace filesystem isolation | paths keyed by tenant/project (`workspace-storage.ts`) | path-traversal and tenant-prefix tests | M |
| G-EX-6 | Credentials per org | broker binds tenant+principal; no tool-connection table | org-owned tool connections; `credentials.manage` | M |
| G-EX-7 | Org-level work requires a project | strategy/delegate pick "first active project" (OC-3, regression R3) | D-6 | M |

## 6. Memory

| # | Target | Current | Gap | Sev |
|---|--------|---------|-----|-----|
| G-MEM-1 | Org memory scope | `organization` scope exists in schema/types; no grant derivation or semantics | define precedence, grants, write policy | M |
| G-MEM-2 | Grants derived from membership | static `MEMORY_PRINCIPALS` bearer tokens; BFF users cannot use memory | derived grants for user runs | M |
| G-MEM-3 | Grant tenant = run tenant | no equality check found at run start | fail-closed check | **H** |
| G-MEM-4 | Background memory jobs | claim by id across tenants; `memory-maintenance` principal | keep; ensure every job carries tenant and handler re-validates namespace | L |
| G-MEM-5 | Legacy memories | cleared by the reset (D-7) | none; post-reset rule: `user`-scope memories stay in the org where they were created | L |
| G-MEM-6 | Memory deletion with organization | none | purge memories, embeddings and jobs on org deletion (D-12) | M |

## 7. Frontend

| # | Target | Current | Gap | Sev |
|---|--------|---------|-----|-----|
| G-FE-1 | Org switcher | none | `AppSidebar` selector, session selection | M |
| G-FE-2 | Cache isolation on switch | query keys not org-qualified | org-qualified keys or full `queryClient.clear()` + store reset | **H** (stale cross-org data on screen) |
| G-FE-3 | Member management UI | none | org settings → members | M |
| G-FE-4 | Permission-aware UI | none | hide/disable controls by permission (server remains authority) | L |

## 8. Verification tooling

| # | Gap | Sev |
|---|-----|-----|
| G-VT-1 | Test files are not type-checked by any `tsc` gate (`tsconfig.jestfullcheck.json` broken and excludes `*.test.ts`) | M |
| G-VT-2 | `web lint` fails (30 errors) — cannot be used as a gate until fixed or baselined | L |
| G-VT-3 | PG suites silently fail (not skip) when `.env` sets the URL but DB is down; gates must start DB explicitly | L |
| G-VT-4 | No cross-org negative test matrix (every route × foreign org) | **H** |
