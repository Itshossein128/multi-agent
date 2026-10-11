# Feature Specification: Organization-Centric Tenancy — Phase 0 Audit and Migration Plan

**Feature Branch**: `007-organization-tenancy-audit` (spec directory; no branch created)

**Created**: 2026-10-10

**Status**: Draft — Phase 0 complete; decisions recorded in [plan.md](./plan.md) §6; four minor confirmations open (§7)

**Input**: User description: "Phase 0: Organization-Centric Architecture Audit and Migration Plan — prepare the existing multi-agent platform for an incremental migration toward an organization-centric, multi-tenant architecture. Analysis and planning only; do not change production behavior. Prioritize extending the existing organization architecture instead of introducing duplicate models."

## Scope

Phase 0 produces analysis and plans only. It defines the target behavior that Phases 1–5 must deliver
and the evidence each phase must provide. No production code, schema, test, or runtime behavior is
changed by Phase 0.

Phase 0 deliverables: [current-architecture.md](./current-architecture.md),
[organization-inventory.md](./organization-inventory.md), [data-model.md](./data-model.md),
[gap-analysis.md](./gap-analysis.md), [threat-model.md](./threat-model.md),
[migration-plan.md](./migration-plan.md), [risk-register.md](./risk-register.md),
[test-baseline.md](./test-baseline.md), [plan.md](./plan.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Belong to and switch between organizations (Priority: P1)

A person has one account and is a member of several organizations (for example their own company and a
client's). After signing in they choose which organization to work in; everything they see and do
(projects, tasks, agents, runs, budgets, memory) belongs to that organization only.

**Why this priority**: This is the core of the organization-centric model; every other story depends on
a trustworthy organization context.

**Independent Test**: Create two organizations with different data, add one user to both, switch
between them, and confirm that no screen, list, search, or action ever shows or affects the other
organization's data.

**Acceptance Scenarios**:

1. **Given** a user who is a member of organizations A and B, **When** they select A, **Then** only A's projects, tasks, agents, runs, budgets, and memories are visible.
2. **Given** a user viewing A, **When** they switch to B, **Then** no data from A remains on screen or is reused in B.
3. **Given** a user who is not a member of organization C, **When** they try to select C or open a link to C's resource, **Then** access is denied without revealing whether the resource exists.
4. **Given** a user who copies the address of a page in A, **When** another member of A opens it, **Then** it opens in A; **When** a non-member opens it, **Then** they see "not found".

---

### User Story 2 - Administer organization membership and roles (Priority: P1)

An organization owner invites colleagues, assigns roles (owner, admin, member, viewer), changes roles,
and removes people. Sensitive controls (budgets, the agent organization chart and goal approval,
credentials, membership) are limited to appropriate roles.

**Why this priority**: Today any user in a tenant can change budgets, appoint the CEO agent, and approve
goals; multi-member organizations are unsafe without roles.

**Independent Test**: In one organization with one user per role, attempt every sensitive action with
every role and confirm allowed/denied outcomes match the permission matrix.

**Acceptance Scenarios**:

1. **Given** a member (non-admin), **When** they try to change the company budget or appoint the CEO agent, **Then** the action is denied and nothing changes.
2. **Given** an admin, **When** they try to grant the owner role, **Then** the action is denied (cannot grant above own role).
3. **Given** the last owner, **When** anyone tries to remove or demote them, **Then** the action is denied.
4. **Given** a removed member with an open session, **When** they make their next request after removal, **Then** it is denied within one minute.

---

### User Story 3 - Executions keep their original organization (Priority: P2)

Runs, scheduled routines, triggers, and background jobs always execute within the organization in which
they were started, including after restarts, approvals, and retries, and never use another
organization's credentials, memory, budgets, or workspaces.

**Why this priority**: Long-running and background work is where context is most easily lost.

**Independent Test**: Start runs in two organizations, interleave approvals, restarts, and scheduled
triggers, and confirm every event, credential use, memory access, budget charge, and workspace file
belongs to the originating organization.

**Acceptance Scenarios**:

1. **Given** a run started in A that pauses for approval, **When** it is resumed, **Then** it continues only with A's resources.
2. **Given** a run whose initiator is removed from A while it is paused, **When** someone tries to resume it, **Then** the configured policy applies and no new credentials are issued.
3. **Given** two organizations using identical trigger identifiers, **When** both fire, **Then** both are processed independently.

---

### User Story 4 - Organization memory (Priority: P3)

Members of an organization benefit from shared, organization-wide knowledge (conventions, decisions,
policies) in addition to existing project, agent, and run memory, without that knowledge ever reaching
another organization.

**Why this priority**: Valuable but depends on stories 1–3.

**Independent Test**: Store an organization-level fact in A, run agents in A and in B, and confirm it is
used in A only and ranked below conflicting project-level knowledge.

**Acceptance Scenarios**:

1. **Given** an organization fact in A, **When** an agent in A retrieves context, **Then** the fact is available.
2. **Given** the same query in B, **When** retrieval runs, **Then** A's fact is never returned, even with identical wording.
3. **Given** a viewer in A, **When** they try to write or delete organization memory, **Then** the action is denied.

---

### User Story 5 - Clean start without legacy tenants (Priority: P1)

An operator moves an installation to the organization model by deliberately clearing all existing
application data in one maintenance window, so that no legacy tenant, user, or record survives into the
new model. Later phases then evolve the schema without downtime.

**Why this priority**: Decided by the product owner (no legacy tenants should remain); it removes all risk
of legacy data becoming visible to the wrong organization.

**Independent Test**: Populate an installation with data, run the reset, apply the new schema, and confirm
that no data remains, that the new schema cannot be applied while old data exists, and that the first
registered user can create an organization and use the product.

**Acceptance Scenarios**:

1. **Given** an installation with existing data, **When** the operator runs the reset without the explicit destruction confirmation, **Then** nothing is deleted.
2. **Given** existing data that was not cleared, **When** the new organization schema is applied, **Then** it refuses to proceed.
3. **Given** a completed reset, **When** a new user registers and creates an organization, **Then** they become its owner and no pre-reset data is visible anywhere.
4. **Given** a later phase after the reset, **When** recovery is rehearsed, **Then** a security-compatible rollback build preserves authorization on current data, or the service remains unavailable until a forward-fix is verified.

---

### User Story 6 - Delete an organization (Priority: P2)

An organization owner permanently deletes their organization from the organization settings by typing
the organization's name to confirm. All organization-owned application data is removed; member accounts and the service-only broker audit exception remain.

**Why this priority**: Required lifecycle control; data must not be kept after deletion.

**Independent Test**: Create an organization with members, projects, runs, memories, and workspace files,
delete it, and confirm no application data remains (verify retained broker audit separately) and members can still sign in to their other organizations.

**Acceptance Scenarios**:

1. **Given** an owner in organization settings, **When** they type a name that does not exactly match, **Then** deletion is not possible.
2. **Given** an admin or member, **When** they attempt deletion, **Then** it is denied.
3. **Given** a confirmed deletion, **When** it completes, **Then** no application records, memories, secrets, files, leases or running executions remain, its URL shows "not found", and only the service-only broker audit exception remains.
4. **Given** a deletion interrupted midway, **When** the system recovers, **Then** the organization stays inaccessible and the deletion completes.

### Edge Cases

- A user with zero active memberships signs in (all removed) → sees an empty state / onboarding, no data.
- An organization is suspended while members are active → all access denied; scheduled work does not fire.
- A member is removed while their task is running → the task stays in the organization; the run stops at its next checkpoint and can be re-run by others.
- A user opens a bookmarked address of an organization they were removed from or that was deleted → "not found".
- An owner is the last owner and tries to leave → denied until ownership is transferred or the organization is deleted.
- Org-level work (strategy proposals, goal delegation) when the organization has no project yet → clear, non-destructive error; no partial records.
- Shared (organization-owned) agents edited by a member → remain organization-owned.
- Identical identifiers created concurrently in two organizations → neither organization's record is affected by the other.
- Background jobs processing items from many organizations in one batch → each item executes within its own organization.

## Requirements *(mandatory)*

### Functional Requirements — Phase 0 (this deliverable)

- **FR-001**: Phase 0 MUST document current authentication, principal propagation, authorization, ownership semantics, persistence scoping, execution/background context, memory scoping, and organization-relevant frontend state, with file references.
- **FR-002**: Phase 0 MUST inventory existing organization capabilities and distinguish implemented from documented behavior.
- **FR-003**: Phase 0 MUST define the target domain model (User, Organization, OrganizationMembership, roles/permissions, resource ownership classes, OrganizationContext, organization memory scope) reusing existing concepts where compatible.
- **FR-004**: Phase 0 MUST provide a current-vs-target gap analysis, threat model with security invariants, incremental migration plan (schema, legacy data, memory, executions, API compatibility, rollback, deployment order, feature flags), and risk register.
- **FR-005**: Phase 0 MUST record a test baseline with exact commands and results, distinguishing passing, known-failing, environment-dependent, skipped, and not-performed verification.
- **FR-006**: Phase 0 MUST define independently verifiable acceptance gates for Phases 1–5 and a Phase 1 recommendation.
- **FR-007**: Phase 0 MUST NOT change production code, schemas, tests, or runtime behavior.

### Functional Requirements — Target program (Phases 1–5)

- **FR-101**: Users MUST be able to belong to multiple organizations, each membership having exactly one role.
- **FR-102**: The system MUST verify on every request, independently of the client, that the user has an active membership in the selected organization.
- **FR-103**: Every non-global resource MUST belong to exactly one organization; global system resources MUST be read/execute-only for organizations.
- **FR-104**: Sensitive actions (organization settings, membership, budgets, agent organization chart and goal approval, credentials, organization memory writes) MUST require the corresponding permission.
- **FR-105**: Executions and background work MUST run exclusively within the organization recorded when they were created.
- **FR-106**: Membership removal or account disablement MUST take effect for new requests within 60 seconds.
- **FR-107**: Organization memory MUST be retrievable only by members of that organization and MUST complement, not replace, project, agent, and run memory.
- **FR-108**: The transition MUST start from an empty data set: an explicit, confirmed reset clears all existing application data, and the new organization schema MUST refuse to apply while legacy data exists.
- **FR-109**: After the reset, schema changes SHOULD remain additive until final cleanup; serving a previous application version is allowed only if it preserves current authorization guarantees, as required by SC-006.
- **FR-112**: The selected organization MUST be part of every organization-scoped page address; global authentication, account settings and organization creation/listing remain available without an active organization; opening an address for an organization the user is not a member of MUST show "not found" without revealing whether it exists.
- **FR-113**: Owners MUST be able to delete their organization from organization settings after typing its exact name; deletion MUST remove all organization-owned application data and leave member accounts intact; only secret-free, service-only broker audit records are retained to preserve the audit chain. The feature remains disabled until complete cross-store cleanup is verified.
- **FR-114**: The data store MUST independently enforce organization isolation (defense in depth) by the final phase, with its prerequisites in place from the first phase.
- **FR-110**: Organization membership and role changes MUST be recorded in an append-only audit trail.
- **FR-111**: Organization-level operations that create tasks MUST NOT leave partial records when they fail.

### Key Entities *(include if feature involves data)*

- **User**: an account that authenticates; may belong to many organizations; has a default organization.
- **Organization**: the tenant and security boundary; has a lifecycle status; identified by the existing tenant identifier.
- **Organization Membership**: links a user to an organization with a role and status; versioned for revocation.
- **Organization Role / Permission**: fixed roles (owner, admin, member, viewer) mapped to permissions.
- **Organization Context**: the server-verified organization, user, role, and permissions for a request or execution.
- **Agent Organization (existing)**: the AI-agent reporting chart and goals within an organization; unrelated to human membership.
- **Organization Memory**: shared knowledge scoped to one organization alongside project, agent, workflow, and user memory.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of authenticated routes pass a same-organization/foreign-organization test matrix with zero cross-organization reads or writes.
- **SC-002**: After the reset, 0 pre-existing records remain, and applying the new schema to a non-empty legacy data set fails in 100% of attempts.
- **SC-008**: After completed deletion, 0 application records, memories, secrets, leases, jobs or files of that organization remain, verified across every store; retained service-only broker audit records are the explicit exception and cannot restore access.
- **SC-009**: In the final phase, direct data-store queries without an organization context return 0 organization-owned rows.
- **SC-003**: Removed members lose access within 60 seconds in 100% of tested cases.
- **SC-004**: Memory evaluation and benchmark report 0 cross-organization leakage before and after organization memory is enabled.
- **SC-005**: All existing end-to-end journeys (adapted to organization addresses) pass after each phase.
- **SC-006**: Each phase documents and rehearses safe recovery: Phase 1 reset is irreversible without an operator backup; subsequent phases use only a rollback build preserving current authorization guarantees, or maintenance mode plus forward-fix. Schema compatibility alone does not prove safe rollback.
- **SC-007**: Switching organizations displays no data from the previously selected organization in 100% of end-to-end runs.

## Assumptions

- Decisions D-1…D-12 are recorded in `plan.md` §6 (answered by the product owner on 2026-10-10).
- The existing tenant identifier is retained as the organization identifier (D-1).
- Roles are a fixed set; custom roles are out of scope for this program.
- Organizations are addressed in the URL (D-8); the last-used organization is remembered only for redirects.
- Existing data is cleared rather than migrated (D-7); a one-time maintenance window is acceptable.
- Organization deletion keeps no application data (D-12); secret-free, service-only broker audit records are the explicit retention exception (plan §7 Q2).
- When a member loses access, their tasks remain in the organization (D-5).
- Single sign-on, billing, and cross-organization sharing of resources are out of scope.
- The current AI-agent organization chart and goals keep their meaning and are not merged with human membership.
- PostgreSQL remains the system of record; RLS prerequisites are required in Phase 1 and enforcement is required by Phase 5 (D-10).
- The three baseline regressions are repaired in a prerequisite change before Phase 1 and are not attributed to this migration.
