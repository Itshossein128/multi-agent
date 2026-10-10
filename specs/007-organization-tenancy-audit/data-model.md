# Target Domain Model — Organization-Centric Tenancy

**Feature**: `007-organization-tenancy-audit` | **Phase**: 0 (design only; nothing implemented) | **Date**: 2026-10-10

Design rule: **extend what exists**. The organization key is the existing `tenant_id` value; the existing
`studio_organizations` row becomes the Organization entity; the existing agent org chart keeps its meaning.
Items tagged **[D-n]** depend on a decision listed in [plan.md](./plan.md) §6.

## 1. Entities

### User (existing `studio_users`, extended)

| Field | Status | Notes |
|-------|--------|-------|
| `id` | existing | UUID for registered users; immutable |
| `email`, `password_hash`, `display_name`, `status` | existing | |
| `tenant_id` | existing → **nullable "last organization"** | after the reset (D-7) registration no longer creates a private tenant; the column only remembers the last-used organization for redirects and is validated against membership on use; never an authority for access |

Lifecycle: `active → disabled`. Disabling a user must revoke all sessions on next request (requires
server-side re-validation; see Organization Context).

### Organization (existing `studio_organizations`, extended)

| Field | Status | Notes |
|-------|--------|-------|
| `id` | existing | UUID; **is the `tenant_id` value** on every owned row [D-1]; immutable; never reused |
| `name`, `description`, `config` | existing | `config` gets a schema; `name` is the deletion confirmation phrase |
| `owner_id` | existing → **removed or ignored** | replaced by membership with role `owner` (no legacy data to keep, D-7) |
| `status` | new | `active | suspended | deleting` |
| `slug` | new [D-8] | unique, lowercase, URL-safe; used in `/o/[orgSlug]/…`; editability per plan §7 Q4 |
| `created_by`, `created_at`, `updated_at` | partly existing | |

Invariants: ≥1 active `owner` membership while `status = active`. Deletion [D-12] is a hard delete:
`deleting` blocks normal access while the purge runs; only the authorized purge worker may continue cleanup. After completion, the row and owned application data are gone. The sole retention exception is service-only, secret-free broker audit records (plan §7 Q2); they cannot authorize access or execution.

### OrganizationMembership (new)

| Field | Notes |
|-------|-------|
| `organization_id` | FK → organizations.id |
| `user_id` | FK → users.id |
| `role` | `owner | admin | member | viewer` [D-2] |
| `status` | `invited | active | suspended | removed` |
| `invited_by`, `created_at`, `updated_at`, `removed_at` | audit |
| `version` | monotonically increasing; bumped on role/status change (used to invalidate cached contexts) |

Unique `(organization_id, user_id)`. Cardinality: User **N : M** Organization through membership.
Removal is soft (status) so historical `created_by`/`owner_id` references stay resolvable.

### OrganizationRole and permissions

Roles are a fixed set mapped to permissions in code (no custom roles in this program) [D-2]:

| Permission | owner | admin | member | viewer |
|------------|:-----:|:-----:|:------:|:------:|
| `org.read` (profile, members list) | ✓ | ✓ | ✓ | ✓ |
| `org.update` (profile, config) | ✓ | ✓ | | |
| `org.delete`, `org.transfer_ownership` | ✓ | | | |
| `members.manage` (invite, remove, change role ≤ own) | ✓ | ✓ | | |
| `budgets.manage` | ✓ | ✓ | | |
| `agent_org.manage` (CEO/reporting lines, approve/cancel goals) | ✓ | ✓ | | |
| `goals.create`, `goals.delegate`, `strategy.request` | ✓ | ✓ | ✓ | |
| `projects.manage` (create/archive projects, repositories) | ✓ | ✓ | ✓ | |
| `resources.write` (tasks, workspaces, own agents/tools/workflows) | ✓ | ✓ | ✓ | |
| `resources.read` (org-scoped resources) | ✓ | ✓ | ✓ | ✓ |
| `runs.execute` | ✓ | ✓ | ✓ | |
| `runs.read_all` (teammates' runs) [D-4] | ✓ | ✓ | | |
| `credentials.manage` (tool connections / provider credentials) | ✓ | ✓ | | |
| `memory.org.read` | ✓ | ✓ | ✓ | ✓ |
| `memory.org.write` / `memory.org.forget` | ✓ | ✓ | | |
| `audit.read` | ✓ | ✓ | | |

Rules: authorize both the target member's current role and the requested resulting role. Admins may manage only non-owner memberships and may assign at most admin; they cannot remove, suspend, demote, or otherwise modify an owner, even when another owner remains. Only owners may grant or modify owner membership. The last active owner cannot be removed, suspended, or demoted. Evaluate these rules and update membership atomically under an organization-scoped lock, including concurrent owner changes.

### OrganizationContext (new, server-side value object)

```text
OrganizationContext {
  organizationId   // = tenant_id value
  userId
  principalKind    // "user" | "service"            (replaces system%/internal:% string convention) [D-11]
  role             // from active membership (users) or service grant
  permissions      // derived from role
  membershipVersion
  resolvedAt
}
```

Resolution (per request, server-side, never trusted from the client):

1. The organization is selected **by URL** [D-8]: pages live under `/o/[orgSlug]/…` and BFF calls under
   `/api/o/[orgSlug]/…`. The BFF resolves slug → organization id, checks the session user's active membership,
   and only then signs `{userId, organizationId, exp, nonce, v: 2}` [D-3]. A slug the user is not a member of
   yields 404 (no existence disclosure).
2. Server verifies the signature, then **loads the active membership** for `(organizationId, userId)`
   (short TTL cache keyed by membership version). No membership or org not `active` → 404/403.
3. The context is attached to the Hono request and passed to stores as today's `StudioPrincipal` shape
   (`tenantId := organizationId`) so store predicates keep working; every organization-scoped store query runs inside
   `withOrganization(orgId)` which sets `app.tenant_id` for RLS [D-10].

Global account operations, organization listing/creation and invitation acceptance must authenticate the user without requiring an existing organization membership. Define narrowly scoped user/bootstrap queries for these operations; do not manufacture an organization context or use unrestricted store access. Include a zero-membership onboarding test under RLS.

`/` and post-login redirect to `users.tenant_id` (last organization) if still a member, otherwise to the
first active membership, otherwise to organization creation.

### Execution context (extension of `Run`)

Runs already persist `ownerId` and `tenantId` and re-derive context from the persisted run on
resume/approval/recovery/credential issuance (`runExecutor.ts:197-199,316,339`). Target additions:

| Field | Notes |
|-------|-------|
| `tenantId` | semantic name `organizationId`; NOT NULL for new runs |
| `ownerId` | initiating user (or service principal id) |
| `initiatorKind` | `user | service | schedule | trigger` |
| `membershipVersionAtStart` | for audit and for the D-5 policy |

Policy on membership loss [D-5, user: "tasks would be kept"]: the removed member's **tasks, runs and run
history stay in the organization** (organization-owned; nothing is deleted or transferred automatically) and
can be reassigned/re-run by remaining members. In-flight runs they initiated stop at the next checkpoint:
new credential leases, resume after approval, and retries re-check the initiator's active membership with
`runs.execute` and otherwise fail with `ORGANIZATION_ACCESS_REVOKED` (interpretation pending plan §7 Q1).
Routines owned by a removed member stop firing until reassigned.

### Resource ownership classes (target)

| Class | Definition | Members of the same org | Other orgs |
|-------|------------|-------------------------|------------|
| **Organization-owned** | `tenant_id = org`, `owner_id` informational | per role permissions | never |
| **Member-personal within org** | `tenant_id = org`, `owner_id = user` | owner; admins per D-4 | never |
| **Global / system** | `is_system = true`, no org | read/execute only | read/execute only |

Every non-system row has exactly one organization. Resources keep their natural hierarchy (Task → Project →
Organization; Workspace → Project → Organization; Comment → Task); the org column is **denormalized onto each
row** (as `tenant_id` already is) so every query can filter without joins, and composite consistency is
checked (child.tenant_id = parent.tenant_id).

| Resource | Class | Hierarchy parent |
|----------|-------|------------------|
| Project | org-owned | Organization |
| Workspace | org-owned | Project |
| Task, Comment | org-owned | Project / Task |
| Goal, reporting line, budget | org-owned | Organization |
| Agent, Tool | member-personal (default) or org-owned (shared) or system | Organization |
| Workflow | member-personal (default) or org-owned (shared) | Organization |
| Run | member-personal (initiator) with org visibility per D-4 | Organization (+ optional Task/Project) |
| Routine, webhook trigger, heartbeat | org-owned (creator recorded) | Organization / Agent |
| Tool connection / credential alias | org-owned; secret material only in the broker/Vault | Organization |
| Memory | org-owned rows, namespace-scoped | Organization → namespace |

### Organization memory scope

Reuse the existing namespace machinery: `namespace = { scope: "organization", id: <organizationId> }`
(already permitted by schema and types). Semantics:

- Contains durable, organization-wide facts/procedures (policies, conventions, decisions); lower precedence
  than project/agent/run memory in the context assembler when they conflict, higher than none.
- Read grant: any active member (`memory.org.read`). Write/forget: `memory.org.write` (admin+) or consolidation
  jobs promoting project memories explicitly approved for org scope.
- Grants are **derived from OrganizationContext** for user-initiated runs (instead of static
  `MEMORY_PRINCIPALS` tokens) [D-9]; static tokens remain for service integrations, each bound to one org.
- The memory grant's `tenantId` MUST equal the run's organization; mismatches fail closed.
- Retrieval keeps the existing invariant: filter by `tenant_id` (and namespace) **before** vector ranking.
- Temporal semantics, supersession, and conflict handling are unchanged; organization scope participates in
  conflict groups like other scopes.

## 2. Relationships

```text
User ──N:M── Organization            via OrganizationMembership(role, status, version)
Organization ──1:N── Project ──1:N── Workspace
                      └──1:N── Task ──1:N── Comment
Organization ──1:N── Agent/Tool/Workflow (personal or shared) ; system Agent/Tool are global
Organization ──1:N── Goal, ReportingLine (agents), Budget, Routine, WebhookTrigger
Organization ──1:N── Run (initiator = User or service) ──► credential leases (broker, tenant-bound)
Organization ──1:N── Memory (namespaces: organization, project, agent, workflow, user)
```

## 3. Mapping from current to target

| Current | Target | Migration |
|---------|--------|-----------|
| all application data | — | **cleared by the guarded reset** (D-7); no backfill |
| `tenant_id` columns | organization key | NOT NULL on owned rows; conditional global/system exception for agents/tools (migration-plan §2); added to run events, approvals, workspace repositories |
| `studio_organizations` | Organization | add `status`, `slug`; creation creates owner membership |
| `studio_organizations.owner_id` | membership(role=owner) | dropped/ignored |
| `studio_users.tenant_id` | last-used organization (nullable) | registration stops minting tenants |
| `{userId, tenantId}` principal | `{userId, organizationId}` assertion + server-resolved OrganizationContext | switched in the reset window; `tenantId` alias accepted until Phase 5 |
| `system-heartbeat`, `system-trigger`, `memory-maintenance`, `internal:*` | typed service principals | replace prefix checks with `principalKind = service` |
| `MEMORY_PRINCIPALS` tokens | derived grants for users; org-bound tokens for services | add tenant-equality check first |
| Agent org chart (`/organization`) | unchanged meaning ("agent organization") | add permission gates |
