# Existing Organization Capability Inventory

**Feature**: `007-organization-tenancy-audit` | **Phase**: 0 (audit only) | **Date**: 2026-10-10

This inventory distinguishes **implemented** behavior (verified in code/tests) from
**documented or intended** behavior. "Organization" currently means three different things
in this repository; none of them is a human membership model.

## 1. The three "organization" concepts

| # | Concept | API surface | Storage | Key | Introduced |
|---|---------|-------------|---------|-----|------------|
| O1 | **Tenant string** (de-facto organization) | carried in signed principal `{userId, tenantId}` | `tenant_id` columns on almost every table | opaque text, UUID for registered users | migrations 004/005 |
| O2 | **Organization profile** (tenant profile row) | `GET /studio/organizations/current`, `POST /studio/organizations` | `studio_organizations` | `id = tenant_id` | migration 017, spec 006 |
| O3 | **Agent organization chart + goals** | `GET /studio/organization`, `PUT /organization/agents/:id`, `POST /organization/goals`, `POST /organization/strategy`, `PATCH /organization/goals/:id`, `POST /organization/goals/:id/delegate` | `studio_agent_reporting`, `studio_organization_goals` | `tenant_id` | migration 014, `docs/organization-and-cost-budgets.md` |

Related tenant-wide controls: **budgets** (`/studio/budgets`, scope `company` = tenant), and
**projects/workspaces** (hierarchy 006).

### O1 — Tenant string

- Minted at registration: `apps/web/src/app/register/actions.ts:38-45` creates `userId = randomUUID()` and
  `tenantId = randomUUID()` ("Provision a new private tenant") and inserts one `studio_users` row.
- Stored once per user: `infrastructure/studio/migrations/005_users.sql` — `studio_users.tenant_id text NOT NULL`;
  there is **no membership table** and no way to belong to two tenants.
- Copied into the NextAuth JWT at sign-in only: `apps/web/src/auth.ts:52` (DB user) and `:66-72` (dev login via
  `AUTH_DEV_USER_ID` / `AUTH_DEV_TENANT_ID`, non-production only); `jwt`/`session` callbacks `:88-97`. The tenant is
  **never re-validated** after sign-in (user disablement or tenant change does not invalidate an active JWT).
- Forwarded by the BFF as an HMAC-SHA256 assertion `{userId, tenantId, exp(+60 s), nonce}`:
  `src/auth/internalPrincipal.ts:2-12`, `apps/web/src/lib/executionBff.ts:23-31`. The nonce is not tracked for
  replay; the assertion is replayable for its 60 s lifetime.
- Verified by the server for every route except `/health` and `/api/webhooks/*`: `apps/server/src/index.ts:58-63`.

### O2 — Organization profile (`studio_organizations`)

Implemented:

- Contract: `src/studio/contracts.ts:51-52` ("Tenant organization profile (id equals tenantId). Distinct from
  agent goals `/organization`."), store methods `:236-240`.
- Service: `apps/server/src/api/studio/organizationProfileService.ts` — `getCurrent` (404 when absent),
  `create` (409 when present; `id = principal.tenantId`, `ownerId = principal.userId`, name ≤120, description ≤2000,
  arbitrary `config` object).
- Routes: `apps/server/src/api/studio/organizationProfileRoutes.ts:9-12`.
- Postgres: `src/studio/infrastructure/postgres-studio-store.ts:843-873` — `SELECT … WHERE id = principal.tenantId`;
  insert asserts `profile.id === principal.tenantId`.
- Migration 017 (`017_project_workspace_hierarchy.sql:8-44`) backfills one profile per distinct tenant (excluding
  `_orphan`) named `'Organization'`, owner = earliest user, else earliest project owner, else literal `'system'`.
- Web: first-run wizard `apps/web/src/app/(authenticated)/onboarding/organization/page.tsx`; `OrganizationGate`
  (`apps/web/src/components/layout/OrganizationGate.tsx:21-36`) redirects to onboarding on 404.

Not implemented (gaps):

- No update/rename/delete/archive endpoint; no lifecycle status.
- `owner_id` is recorded but **never consulted** for authorization.
- No membership, roles, invitations, or transfer of ownership.
- No role check on `create`: any authenticated principal of the tenant may create the profile (first-writer wins).
- `config` is unvalidated JSON.

### O3 — Agent organization chart and goals

Implemented (`apps/server/src/organization/*`):

- **Reporting lines** (`studio_agent_reporting`, migration 014): roles `ceo|manager|member` for **AI agents**;
  exactly one CEO per tenant (partial unique index); non-CEO requires a manager that already has a role; cycle
  detection in service (`organizationService.ts:40-50`) and again in store under
  `pg_advisory_xact_lock('organization:'+tenant)` (`organizationStore.ts:86-111`).
- **Goals** (`studio_organization_goals`): status machine `proposed→active|cancelled`, `active→completed|cancelled`
  (`organizationService.ts:87-93`); optional parent goal, project, owner agent; `createdBy = principal.userId`.
  `saveGoal` upsert is tenant-guarded (`organizationStore.ts:71-79`).
- **Strategy proposal**: creates a `proposed` goal owned by the CEO agent plus a task assigned to the CEO agent
  (`organizationService.ts:130-151`); approval requires the strategy task to finish with output (`:94-100`).
- **Delegation**: creates a task for an agent that reports (transitively) to the goal owner (`:106-128`).
- **Overview**: goals, reporting lines, visible agents, goal-linked tasks (`:20-25`).
- Route `POST /organization/goals` strips `proposedByAgentId` from client input (`organizationRoutes.ts:15-19`).

Observed defects and semantic gaps:

| ID | Finding | Evidence |
|----|---------|----------|
| OC-1 | **No human authorization**: any tenant user can appoint/replace the CEO agent, approve/cancel goals, delegate. | no role check anywhere in `organizationService.ts`; principal has no roles (`internalPrincipal.ts:2`) |
| OC-2 | Strategy request is **non-atomic**: goal persisted before project resolution; failure leaves an orphan `proposed` goal (baseline regression R3). | `organizationService.ts:137-139`; repro in `test-baseline.md` §5 |
| OC-3 | Org-level operations require a project (hierarchy 006) but fall back to "first active project", an arbitrary choice. | `organizationService.ts:121,138`; `tenantDefaults.ts:13-19` |
| OC-4 | Org chart is tenant-wide but agents are **personal** (owner-only visibility). User B cannot place user A's agent in the chart (404), and `overview` hides goals owned by agents the caller cannot see, so two members of one tenant see different charts. | `organizationService.ts:24,30`; agent visibility `postgres-studio-store.ts:364,374` |
| OC-5 | `createGoal`/`updateGoal` validate owner agent with `getAgent` only — unlike `setReportingLine`/`delegate`, they do not reject `isSystem` agents. | `organizationService.ts:71,103` vs `:30,113` |
| OC-6 | `delegate` constructs `TaskService` without the executor (inconsistent with `overview`/`updateGoal`). | `organizationService.ts:122` vs `:22,95` |
| OC-7 | Goals load the full tenant goal list for every lookup (no `getGoal(id)`), O(n) per request. | `organizationService.ts:63,82,108` |

### Budgets (tenant-wide control used by the org UI)

- `studio_budgets` PK `(tenant_id, scope, scope_id)`; scopes `company|agent|project` (migration 015).
- `scope=company` forces `scopeId = principal.tenantId` (`apps/server/src/budgets/budgetService.ts:17`);
  agent/project scopes verify the target through the principal-scoped store (`:19-20`).
- **No role check**: any tenant member may set or raise the company cap.
- Reservation settlement by `run_id` only (`budgetStore.ts:136-171`), safe while run ids are globally unique.

## 2. How organizations relate to users today

| Relationship | Implemented | Notes |
|--------------|-------------|-------|
| User → tenant | 1 : 1 (`studio_users.tenant_id NOT NULL`) | private tenant per registration |
| Tenant → organization profile | 1 : 0..1 (`studio_organizations.id = tenant_id`) | created by wizard or 017 backfill |
| Organization profile → owner | 1 : 1 text (`owner_id`) | informational only |
| User ↔ organization membership | **absent** | membership ≡ "same `tenant_id` in `studio_users`"; no API to add a second user to a tenant |
| Roles / permissions | **absent** | `RequestPrincipal = {userId, tenantId}` |
| Agent ↔ organization role | `studio_agent_reporting` | AI agents only (ceo/manager/member) |

## 3. Ownership semantics (`tenantId`, `ownerId`, `isSystem`, `organizationId`)

- `organizationId` **does not exist** anywhere in schema or contracts; `studio_organizations.id` doubles as it.
- Authorization helpers: `apps/server/src/auth/authorization.ts`
  - `authorizePersonalResource` (workflows, runs): `tenantId` **and** `ownerId` must match; ownerless fails closed (`:50-55`).
  - `authorizeTenantResource` (tasks): `tenantId` must match (`:61-66`).
  - `authorizeToolOrAgent`: `isSystem` → read/execute only; `ownerId` set → owner only; `tenantId` only → any tenant member; else deny (`:75-93`).
- Store predicates mirror this in SQL, with two additional behaviors:
  - **Synthetic-principal bypass**: owner checks are skipped when `userId LIKE 'system%' OR LIKE 'internal:%'`
    (`postgres-studio-store.ts:308,318,364,374`). Used by schedulers (`heartbeatScheduler.ts:71` `system-heartbeat`,
    `triggerOutboxProcessor.ts:147` `system-trigger`). Safe today only because registered user ids are UUIDs and dev
    ids are operator-configured; it is a naming convention, not a typed capability.
  - **Ownership capture**: `saveAgent`/`saveTool` always stamp `owner_id = principal.userId`
    (`postgres-studio-store.ts:383-397,443-456`). A tenant-shared row (`owner_id IS NULL`) passes the pre-check
    (`:387`) and becomes the editor's personal resource on save. There is no API path that creates tenant-shared
    agents/tools, so "tenant-scoped" agents exist only via migration/system data.
- Per-entity classification (implemented):

| Entity | Class | Tenant column | Owner column |
|--------|-------|---------------|--------------|
| Workflows, Runs | personal | nullable | nullable |
| Agents, Tools | personal / tenant-shared / system | nullable | nullable + `is_system` |
| Tasks, Projects, Workspaces, Comments, Routines, Webhooks, Heartbeats | tenant | NOT NULL (tasks nullable) | projects/workspaces/routines/webhooks NOT NULL owner (informational) |
| Org profile, goals, reporting, budgets | tenant | NOT NULL / `id` | — |
| Memories, memory jobs | tenant + namespace | NOT NULL (PK part) | `memory_owner` metadata on runs |
| Broker leases / audit | tenant + principal | NOT NULL | principal id |

## 4. Relationship of strategy, goals, budgets, projects, tasks

```text
tenant (O1) ──1:0..1── organization profile (O2)
   │
   ├── agent reporting lines (O3, CEO/manager/member over agents)
   ├── goals (O3) ──0..1── project ; ──0..1── owner agent ; ──0..1── parent goal
   │       └── tasks (metadata.organizationGoalId, strategyProposal) ──1── project (NOT NULL since 017)
   ├── budgets: company(tenant) / project / agent  ──► checked per agent invocation
   └── projects ──1:N── workspaces (optional per task) ──1:N── tasks ──► runs (personal, owner+tenant)
```

Goal→task linkage is **metadata only** (`task.metadata.organizationGoalId`), not a foreign key; goals do not
own budgets; project budgets apply only to task-linked runs (`docs/organization-and-cost-budgets.md`).

## 5. Reuse assessment

| Asset | Reuse? | Rationale |
|-------|--------|-----------|
| `tenant_id` as the isolation key on all tables | **Reuse as the organization key** | Present and indexed everywhere; renaming would touch ~30 tables with no security gain. Introduce `organizationId` as the domain name mapped 1:1 to `tenant_id` (decision D-1). |
| `studio_organizations` (O2) | **Extend into the Organization entity** | Already 1:1 with tenant, already backfilled; add status/lifecycle, slug, and membership relation. |
| `studio_users` | **Reuse; demote `tenant_id` to "last organization"** | Keep for credentials; membership moves to a new table; registration stops minting a private tenant (data is cleared at the transition, D-7). |
| Signed principal | **Extend** with selected `organizationId` (= tenantId) + membership role/version, or keep `{userId, tenantId}` and resolve membership server-side (decision D-3). |
| `authorization.ts` helpers | **Extend** with role/permission checks; keep personal/tenant/system classes. |
| O3 agent org chart & goals | **Keep as-is, rename in docs** to "Agent organization"; do not conflate with human membership. Add human permission gates (OC-1). |
| Budgets | **Reuse**; `company` scope = organization. Add permission gate. |
| Memory `namespace_scope='organization'` | **Reuse** — already in schema (`infrastructure/memory/migrations/001_memories.sql:4,7`) and types (`packages/types/src/memory.ts:3-4`); needs grant derivation and semantics, not a new table. |
| Synthetic `system-*` principals | **Replace** with a typed service principal (kind = user/service) during Phase 2. |
