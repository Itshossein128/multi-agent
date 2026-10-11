# Current Architecture Report (Tenancy & Organization Lens)

**Feature**: `007-organization-tenancy-audit` | **Phase**: 0 | **Date**: 2026-10-10 | **Commit**: `b6a586d` (+ uncommitted user changes)

Scope: how identity, tenant, ownership and organization context flow through the system today.
Everything here is **implemented** behavior traced in code unless marked *documented*. The detailed
organization inventory is in [organization-inventory.md](./organization-inventory.md).

## 1. Topology

```text
Browser ──► apps/web (Next.js 16, NextAuth credentials, BFF)
              │  /api/execution/[...path]  → proxyExecution()  (signs X-Multi-Agent-Principal)
              │  /api/organizations, /api/projects, /api/tasks, /api/workspaces, /api/dashboard (thin BFF routes)
              ▼
         apps/server (Hono) ── global principal middleware (except /health, /api/webhooks/*)
              ├─ /studio      createStudioRouter  (agents, tools, workflows, tasks, projects, workspaces,
              │                organizations (profile), organization (agent chart/goals), budgets, routines, webhooks, comments)
              ├─ /runs        RunApiService → RunExecutor → GraphRunner (LangGraph) → AgentRuntime → executors
              ├─ /memories    separate bearer-token grants (MEMORY_PRINCIPALS)
              ├─ /dashboard, /tools
              ├─ /api/webhooks  HMAC-authenticated inbound triggers (no principal)
              └─ background: RoutineScheduler, HeartbeatScheduler, TriggerOutboxProcessor, run recovery,
                 memory job workers, budget reconciliation
         src/broker (separate service) ── credential leases bound to tenant+principal+run
         PostgreSQL (studio + memory + broker tables; pgvector) — no RLS
```

## 2. Authentication (apps/web)

| Aspect | Implementation | Evidence |
|--------|----------------|----------|
| Provider | NextAuth Credentials (email + bcrypt hash in `studio_users`) | `apps/web/src/auth.ts:28-52` |
| Dev login | `AUTH_DEV_ENABLED=true` + `AUTH_DEV_PASSWORD`, only when `NODE_ENV !== "production"`; identity from `AUTH_DEV_USER_ID` / `AUTH_DEV_TENANT_ID` | `auth.ts:66-72` |
| Registration | server action creates user **and a new private tenant** (both `randomUUID()`) | `apps/web/src/app/register/actions.ts:38-45` |
| Session | JWT; `tenantId` copied from user at sign-in, carried in token/session | `auth.ts:88-97` |
| Principal helper | `getAuthenticatedPrincipal()` → `{userId, tenantId}` or null | `auth.ts:105-109` |
| Re-validation | none after sign-in (status/tenant changes do not affect live JWTs) | — |

## 3. BFF and signed internal principal

- Generic proxy `apps/web/src/app/api/execution/[...path]/route.ts` → `proxyExecutionWith`
  (`apps/web/src/lib/executionBff.ts:23-43`): rejects unauthenticated (401), forwards only an allow-list of
  headers (`accept`, `content-type`, `idempotency-key`, `last-event-id`, `prefer`, `x-request-id`; `:10-17`),
  and sets `X-Multi-Agent-Principal`. The client never supplies `tenantId`; any path under the server is reachable.
- Assertion format (`src/auth/internalPrincipal.ts:2-12`): base64url JSON `{userId, tenantId, exp = now+60s, nonce}`
  + HMAC-SHA256 with `INTERNAL_PRINCIPAL_SECRET`; constant-time compare; **nonce not checked for reuse**.
- Server: `resolveRequestPrincipal` (`apps/server/src/auth/principal.ts:4-6`) and global middleware
  (`apps/server/src/index.ts:59-63`).
- Implication: **the BFF is the sole authority for which tenant a user acts in**; the server trusts the
  assertion and performs no membership lookup.

## 4. Authorization

- Helper classes in `apps/server/src/auth/authorization.ts` (personal / tenant / tool-or-agent with system).
- SQL predicates in `src/studio/infrastructure/postgres-studio-store.ts` duplicate the same logic, plus the
  `system%`/`internal:%` userId bypass (`:308,318,364,374`).
- Runs: `RunApiService.canAccess` requires owner **and** tenant (`apps/server/src/api/runs/runApiService.ts:38-45`);
  run lists filter by owner+tenant (`apps/server/src/runtime/store/inMemoryRunStore.ts:100-103`). Runs are **personal**:
  teammates in the same tenant cannot see each other's runs.
- `principalFor` falls back to a memory bearer grant when no internal principal exists (`runApiService.ts:31-36`),
  but the global middleware already requires the internal principal, so the fallback is effectively dead for HTTP.
- No roles, permissions, or admin concept anywhere in the principal or helpers.
- Error mapping: `respondWithApiError` turns **any** non-`ApiError` into HTTP 400 and echoes the message
  (`apps/server/src/api/shared/http.ts:34-39`) — internal errors are mis-classified and may disclose details.

## 5. Persistence & query scoping

Full table inventory: see the schema audit summary in [gap-analysis.md](./gap-analysis.md) §3. Key facts:

- Three migration families, all **forward-only, no down migrations**:
  studio (`src/studio/infrastructure/migrate.ts`, hard-coded list 001–017, one transaction + advisory lock, checksums,
  `reconcileLegacySchema`), memory (`src/memory/infrastructure/migrate.ts`, 001–005, optional vector 002),
  broker (`infrastructure/broker/migrate.cjs`, idempotent DDL, no ledger).
- Isolation is **application-enforced** by `tenant_id`; **no Postgres RLS**; one DB role sees all tenants.
- `tenant_id`/`owner_id` are **nullable** on `studio_workflows`, `studio_agents`, `studio_tools`, `studio_tasks`,
  `studio_runs` (added by `004_ownership.sql`, never tightened); NOT NULL on newer tables (projects, workspaces,
  comments, routines, webhooks, org goals, budgets, memories, broker).
- **Global text primary keys** (`id`) on most entities; pre-save checks read by id only then upsert
  `ON CONFLICT (id) DO UPDATE` without a tenant guard (e.g. agents `postgres-studio-store.ts:383-397`) — a
  check-then-act race and an id-existence oracle ("Access denied" vs success). `studio_organization_goals.saveGoal`
  is the exception (tenant-guarded upsert).
- `StudioStore` methods take `principal?: StudioPrincipal`; when omitted, Postgres paths run **id-only / unscoped**
  queries (intended for internal callers; e.g. `postgres-studio-store.ts:311,321,367,377,490,497`).
- Synthetic tenants: `_orphan` (migration 011) and owner `'system'` (017 backfill).
- Hierarchy (spec 006 / migration 017): organization profile (id = tenant) → project → optional workspace → task;
  `studio_tasks.project_id NOT NULL`; workspace/repository link tables lack tenant columns and FKs
  (`017_project_workspace_hierarchy.sql:238-245`).

## 6. Domain resources (tenancy class today)

| Resource | Owner model | Visible to |
|----------|-------------|------------|
| Workflow | personal (tenant+owner) | owner; synthetic `system*`/`internal:*` principals of same tenant |
| Agent / Tool | personal by default; tenant-shared if `owner_id IS NULL`; global if `is_system` | owner / tenant / everyone (read+execute) |
| Project, Workspace | tenant (owner recorded) | whole tenant |
| Task, Comment | tenant | whole tenant |
| Goal, reporting line, org profile, budget | tenant | whole tenant |
| Routine, webhook trigger, heartbeat | tenant (owner recorded) | whole tenant |
| Run | personal | owner only |
| Memory | tenant + namespace grant | holders of a configured bearer grant |
| Credential lease | tenant + principal + run | broker service only |
| Tool connection | **no dedicated table**; tools live in `studio_tools.record` JSON | as Tool |

## 7. Execution & background work

| Flow | Context source | Evidence |
|------|----------------|----------|
| HTTP run start | request principal → `Run.ownerId/tenantId` persisted | `apps/server/src/runtime/runExecutor.ts:274-291` |
| Agent test run | same | `runExecutor.ts:223-229` |
| Resume / approval / recovery | re-derived from **persisted run** (`entry.run.ownerId/tenantId`) — context preserved | `runExecutor.ts:316,339` |
| Credentials for a run | `credentialPrincipalForRun(runId)` from persisted run | `runExecutor.ts:197-199` |
| Memory maintenance jobs | synthetic `principalId: "memory-maintenance"`, tenant from job row, namespace from job | `runExecutor.ts:168-169` |
| Routine scheduler | `{tenantId: routine.tenantId, userId: routine.ownerId}` (creator's identity, even if they later leave) | `apps/server/src/triggers/routineScheduler.ts:222` |
| Heartbeat scheduler | `{tenantId, userId: "system-heartbeat"}` | `heartbeatScheduler.ts:71` |
| Trigger outbox | `{tenantId: event.tenantId, userId: event.payload.userId ?? "system-trigger"}`; inbound webhook data nested under `payload.payload`, so external callers cannot set `userId` | `triggerOutboxProcessor.ts:145-148`; `postgres-studio-store.ts:1681-1692` |
| Claim loops | intentionally cross-tenant (`claimNextTriggerEvent`, `claimDueRoutines` (no row lock), `claimDueHeartbeats`) | `postgres-studio-store.ts:1213-1236,1391-1401,1737-1756` |
| Run store | `hydrate()` loads all runs; `get/update/status` by run id only | `postgresRunStore.ts:172-178,418-419` |
| Trigger dispatch dedupe | **globally** unique `metadata->>'triggerDispatchKey'`; lookup may omit tenant | `013_event_routines_hardening.sql:10-12`; `postgresRunStore.ts:405-410` |
| Budgets | reserve per invocation with row locks; settle by run id | `apps/server/src/budgets/*` |
| Broker | lease bound to tenant+principal+run+provider+alias at consume | `src/broker/leaseStore.ts:249-258` |

Workspace filesystem storage: `STUDIO_WORKSPACE_STORAGE_ROOT` with `studio_workspace_repo_states.storage_path`
keyed by `(tenant_id, project_id, repo, workspace_key)`. Paths are built as
`{tenantId}/{projectId}/{workspaceId|default}/{repoId}` from validated segments (`requireSafeSegment`) and
checked for containment under the root (`src/studio/infrastructure/workspace-storage.ts:29-60`). Because the
organization id equals the tenant id (D-1), no path migration is needed.

## 8. Memory

- Single table `studio_memories`, PK `(tenant_id, id)`; `namespace_scope ∈ {agent, workflow, project, organization, user}`
  and `visibility ∈ {private, workflow, project, organization, shared}` already exist
  (`infrastructure/memory/migrations/001_memories.sql:4,7`; `packages/types/src/memory.ts:3-4`).
- Kinds semantic / episodic / procedural in-row; temporal validity and supersession (migration 003); optional
  pgvector embeddings (002); job queue `studio_memory_jobs` with tenant-qualified idempotency (004/005).
- Access is **not derived from the user principal**: `/memories` and memory-enabled runs require a static bearer
  token configured in `MEMORY_PRINCIPALS`, each token granting one `tenantId` and explicit readable/writable
  namespaces (`apps/server/src/memory/access.ts:10-37`). The BFF does not forward `Authorization`, so browser
  users cannot reach long-term memory; memory-enabled agents started via the BFF fail with 401
  (`runApiService.ts:60-61`). No check was found that the memory grant's `tenantId` equals the request
  principal's `tenantId` at run start (`runApiService.ts:52-62`, `runExecutor.ts:223-229`).
- Cross-tenant reads by design: `listNamespaces` (`postgres-memory-store.ts:121-123`) and job claim/complete by id
  (`postgres-memory-job-store.ts:22-31`).
- Offline eval/benchmark report 0 cross-tenant / cross-namespace leakage (see [test-baseline.md](./test-baseline.md) §4).

## 9. Frontend state relevant to organization context

- `OrganizationGate` gates all authenticated pages on `GET /api/organizations/current`
  (`apps/web/src/components/layout/OrganizationGate.tsx:21-36`); onboarding wizard at
  `app/(authenticated)/onboarding/organization/page.tsx`; agent chart/goals at `app/(authenticated)/organization/page.tsx`.
- No organization switcher; tenant never shown or sent by the client. Some response types include `tenantId`
  (`app/(authenticated)/budgets/page.tsx:5`, `lib/projectsWorkspaces.ts:24,38,64`) but it is display-only.
- TanStack Query keys are **not organization-qualified** (e.g. `["dashboard", timeFilter]`,
  `apps/web/src/hooks/useDashboardQuery.ts:23`; `["tool", toolId]`, `hooks/useToolDetail.ts:12`); zustand stores
  (`apps/web/src/store/*`) hold selected entities in memory; the only `localStorage` use is locale
  (`lib/useStudioLocale.ts:12,24`). An org switch therefore requires a full cache reset or org-qualified keys.
- Dashboard source of truth: server `/dashboard` router over run store + studio store + budgets
  (`apps/server/src/index.ts:143`), asserted by `tests/dashboardSourceOfTruth.test.ts`.

## 10. Security invariants currently enforced (to be preserved)

1. Every non-webhook, non-health server route requires a valid, unexpired HMAC principal assertion.
2. Clients never choose `tenantId`; it originates from the authenticated user record via the BFF.
3. Personal resources (workflows, runs) require owner **and** tenant match; ownerless/untenanted rows fail closed.
4. Tenant resources require tenant match; untenanted rows fail closed.
5. System agents/tools are read/execute-only for regular principals and cannot be modified or deleted.
6. Persisted runs carry the originating owner/tenant; resume, approval, recovery, and credential leasing use
   the persisted context, not the current request.
7. Credential broker leases bind tenant, principal, run, provider, alias; single-use consume; append-only audit chain.
8. Memory rows are keyed by tenant; retrieval requires a server-provisioned grant naming tenant and namespaces;
   request input never creates grants.
9. Inbound webhook payloads cannot set the execution principal.
10. Organization goal upserts and reporting-line writes are tenant-guarded; one CEO agent per tenant.
11. `company` budget scope is forced to the caller's tenant.
