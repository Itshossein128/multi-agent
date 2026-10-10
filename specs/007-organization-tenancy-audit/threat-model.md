# Tenant Boundary & Threat Model

**Feature**: `007-organization-tenancy-audit` | **Phase**: 0 | **Date**: 2026-10-10

## 1. Assets

Organization data (tasks, projects, workspaces, repositories/working copies, goals, budgets), agent/tool
definitions (incl. prompts), workflow definitions, run inputs/outputs/events, long-term memories and
embeddings, credential material (broker/Vault, CLI auth files), audit logs, membership and role data.

## 2. Trust boundaries

```text
[Browser] ──(1) session cookie──► [Next.js BFF] ──(2) HMAC principal──► [Execution server]
                                                                   ├──(3) SQL (single role, no RLS)──► [PostgreSQL]
                                                                   ├──(4) service token + mTLS──► [Credential broker] ──► [Vault]
                                                                   ├──(5) process/container──► [CLI workers / workspaces FS]
                                                                   └──(6) LLM/tool providers (external)
[External webhook sender] ──(7) HMAC signature──► /api/webhooks/*
[Operators] ──(8) env/config (secrets, MEMORY_PRINCIPALS, AUTH_DEV_*)──► all services
```

| Boundary | What enforces it today | Weakness |
|----------|------------------------|----------|
| (1) | NextAuth JWT | tenant frozen at sign-in; no revocation |
| (2) | HMAC-SHA256 assertion, 60 s exp | no replay cache; shared secret; no membership check on server |
| (3) | application `WHERE tenant_id` | no RLS; optional principal → unscoped queries; global ids |
| (4) | broker service auth, lease binding, audit chain | mTLS proven only in code (see `CLAUDE.md`) |
| (5) | worker isolation, tenant/project-keyed paths | tenant prefix by convention |
| (7) | per-trigger encrypted secret, replay & rate limits | runs as synthetic `system-trigger` with owner-bypass |
| (8) | operator discipline | `system%` naming convention is security-relevant |

## 3. Threats (STRIDE-oriented) and required controls

| ID | Threat | Current exposure | Control required (phase) |
|----|--------|------------------|--------------------------|
| T-1 | **Cross-org read by id** (IDOR) — user of org A fetches resource of org B | Mitigated on user paths where principal is passed; risk where `principal` is omitted or id-only pre-checks leak existence ("Access denied" vs 404) | Required principal on user paths; uniform 404; route×foreign-org negative test matrix (P2) |
| T-2 | **Cross-org write via id collision/race** — upsert on global id overwrites/claims another org's row | Present: check-then-`ON CONFLICT (id) DO UPDATE` without tenant guard | Tenant-guarded upserts (P2) |
| T-3 | **Selected-org spoofing** — client asks BFF to act in an org it is not a member of | N/A today (single tenant); becomes critical with switcher | BFF validates selection against membership; server re-verifies membership (P1/P2) |
| T-4 | **Stale privilege** — removed/disabled member keeps access via live JWT/assertion | Present for disabled users today | Membership version check per request; short cache TTL (P1/P2) |
| T-5 | **Privilege escalation inside org** — member sets budgets, appoints CEO agent, approves goals, captures shared agents | Present (no roles; ownership capture on save) | Role/permission gates; preserve owner on update (P2) |
| T-6 | **Synthetic principal abuse** — an identity whose id starts with `system`/`internal:` gains owner bypass | Low today (UUID user ids; dev ids operator-set) | Typed service principals; reject such ids at user creation (P2/P3) |
| T-7 | **Execution context confusion** — run resumes/leases credentials under a different org or after initiator removed | Context preserved from persisted run (good); no membership re-check | D-5 policy checks at resume/lease/fire (P3) |
| T-8 | **Memory leakage across orgs** — grant for org X used with run of org A; vector search ranks foreign rows | Grant/principal tenant equality not checked; retrieval filters by tenant (eval: 0 leakage) | Equality check; tenant filter before ranking asserted in pgvector tests (P3/P4) |
| T-9 | **Background job cross-org mixing** — outbox/routine/heartbeat/memory job processes event with wrong org | Jobs carry tenant from row; claimers global | Per-job tenant assertions; tests with interleaved orgs (P3) |
| T-10 | **Dedupe collision DoS** — org A's trigger dispatch key blocks org B | Global unique `triggerDispatchKey` | Tenant-qualified unique index (P3) |
| T-11 | **Filesystem escape** — workspace path for org A resolves into org B's storage | Paths tenant/project keyed | Canonicalization + prefix assertion tests (P3) |
| T-12 | **Credential misuse** — lease for org A consumed by run of org B | Broker binds tenant+principal+run | Keep; add org-owned tool connections (P3) |
| T-13 | **Frontend stale data** — after switching org, cached data of previous org displayed or mutated | Query keys not org-qualified | Org-qualified keys / cache reset (P2) |
| T-14 | **Information disclosure via errors** — internal error messages returned as 400 | Present (`http.ts:38`) | Generic 500, typed errors (P2) |
| T-15 | **Legacy data survives the transition** — pre-reset rows (incl. 017 heuristics `_orphan`, `'system'` owner) become visible in the new model | Eliminated by D-7 if the reset is complete | Guarded reset; migration 018 refuses non-empty legacy data; post-reset emptiness verification across studio, memory, broker, filesystem (P1) |
| T-18 | **Incomplete or unauthorized organization deletion** — data left behind, or deletion triggered by non-owner / CSRF / mistyped name | New feature (D-12) | Owner-only permission; exact-name confirmation re-checked server-side; `deleting` status blocks access first; resumable purge; post-deletion verification across all stores (P2–P5) |
| T-19 | **URL organization confusion** — slug in URL for an org the user is not in, or stale slug after rename/deletion, leaks data or existence | New feature (D-8) | BFF resolves slug and checks membership before signing; server re-checks; uniform 404; query cache keyed by org (P2) |
| T-20 | **Accidental reset** — destructive reset run against the wrong database | New operator command (D-7) | explicit flag, printed row counts, refusal while runs are active, optional backup, environment banner (P1) |
| T-16 | **Audit gaps** — membership/role changes not attributable | No audit for org actions (broker has its own) | Append-only org audit log (P1/P2) |
| T-17 | **Assertion replay** — captured header replayed within 60 s | Present | Nonce cache or TTL reduction; keep BFF↔server on private network/mTLS (P5) |

## 4. Security invariants for the target (must hold after every phase)

- **INV-1** No request can read or mutate a row whose organization differs from the server-resolved
  OrganizationContext, except explicitly global `is_system` resources (read/execute only).
- **INV-2** The organization in context is selected by the user but authorized by the server from an active
  membership on every request; client-provided org ids are hints, never authority.
- **INV-3** A run's organization is fixed at creation and is the only organization used for its tools,
  credentials, memory, budgets, events, and workspaces for its whole lifetime.
- **INV-4** Removing a member or disabling a user takes effect for new requests within the cache TTL
  (target ≤ 60 s) and blocks new credential leases for runs they initiated (per D-5).
- **INV-5** No pre-reset data exists in the organization model; every organization-owned row has a
  non-null organization enforced by constraints, and child rows belong to the same organization as their parent.
- **INV-6** Memory retrieval filters by organization and namespace grant before ranking; grants for
  user-initiated runs derive from membership and must match the run's organization.
- **INV-7** Background workers may claim across organizations but must execute each item strictly within
  the organization recorded on the item.
- **INV-8** All existing invariants listed in [current-architecture.md](./current-architecture.md) §10 remain true.
- **INV-9** From Phase 5, the database rejects reads/writes of organization-owned rows whose organization
  differs from the transaction's `app.tenant_id` (RLS), independent of application code; only the dedicated
  worker role may claim work across organizations.
- **INV-10** After an organization is deleted, no data of it remains in any store (studio, memory,
  embeddings, jobs, broker leases, workspace files), except broker audit records if retained per plan §7 Q2.

## 5. Abuse-case tests required (summary)

1. For every authenticated route: same-org positive, foreign-org negative (expect 404/403, no side effects).
2. Concurrent create with colliding ids across two orgs → neither org's row changes owner/tenant.
3. Member removed while holding a live session → next request denied within TTL.
4. Org switch in UI → no requests or cached renders carry the previous org's data.
5. Run started in org A, initiator removed, approval resumed → policy D-5 outcome; no credential lease.
6. Memory grant for org B presented with a run in org A → rejected.
7. Two orgs enqueue identical trigger idempotency/dispatch keys → both processed independently.
8. Reset → all data stores empty; migration 018 refuses to run on a non-empty legacy data set.
9. Organization deletion by non-owner or with a wrong name → denied; by owner → all stores verified empty for that org; interrupted deletion resumes.
10. URL slug of a foreign/deleted org → 404 with no data requests succeeding.
11. Phase 5: raw SQL as `studio_app` without `app.tenant_id` → 0 rows; cross-org insert → rejected.
