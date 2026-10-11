# Feature Specification: Phase 0.5 — Baseline Repair

**Scope**: recheck of the completed Phase 0.5 only, confirmed by the user on 2026-10-10.
**Source of intent**: [program specification](../spec.md) FR-111 and edge case for
organization-level task creation; [existing phase plan](./plan.md), gates G1–G7;
[research](./research.md) R-1–R-11; [contract](./contracts/organization-operations.md).

This document makes the already approved phase intent available beside its plan and
tasks for Spec Kit. It adds no organization migration, schema, reset, membership,
permission, or deletion work. The existing plan remains the technical authority.
TDD applies to behavior fixes; executed tests, including PostgreSQL tests, are required.

## User Stories and Acceptance Scenarios

### US1 — Repaired fixtures (P1)

As a developer, I can execute the task-board and PostgreSQL event fixtures against
the project hierarchy rather than encountering stale fixture errors.

**Independent test**: `taskBoardView.test.ts` and `eventRoutinesIntegration.test.ts`.

1. The task-board fixture supplies required `projectId` and nullable `workspaceId`.
2. The event fixture seeds an authorized active project and inserts its `project_id`;
   both suites execute and pass, with no skipped PostgreSQL tests.

### US2 — Explicit project and atomic strategy (P1)

As an organization user, I select an authorized active project and receive a strategy
goal, CEO task, and assignment event together, or no new records on failure.

**Independent test**: organization service, budget route, unit-of-work, project-validation,
and real-PostgreSQL strategy-atomicity suites; organization page browser check.

1. Missing or blank strategy project returns 400; unknown and foreign projects return
   the identical 404; retired projects return 409, all without writes.
2. Title, brief, CEO, agent, and project validation completes before any strategy write.
3. Strategy persists the proposed goal, assigned task, and `task_assignment` event
   together. Goal and task use the selected project; task metadata links the goal.
4. Task-insert, event-insert, and deferred-COMMIT failures leave zero new goals, tasks,
   or events; the client is released and a subsequent request can succeed.
5. In-memory failures restore both stores. Unsupported mixed stores return 503 before writes.
6. Post-commit placeholder naming is best effort: failure is logged and the committed
   strategy still succeeds.
7. The UI requires a project for strategy and offers project creation when none exist.
8. Optional goal project validation uses the same 404/409 rule; projectless goals remain allowed.

### US3 — Explicit project for delegation (P2)

As an organization user, I delegate a goal into its explicit authorized project,
selecting one when the goal has no project.

**Independent test**: organization service delegation cases and organization page check.

1. Projectless goal plus absent request project returns 400 without a task or event.
2. The goal project wins; an omitted body project is allowed, a differing one returns 400.
3. Unknown/foreign projects return 404 and retired projects return 409 without writes.
4. Delegation's write set is the task plus assignment event, in one transaction;
   a failed organization task-creation operation leaves no partial records (FR-111).
5. The UI shows and submits a project picker for projectless goals. No first-active-project fallback remains.

### US4 — Effective test typecheck (P2)

As a developer, I get a real strict TypeScript gate for test files, shared with Jest.

**Independent test**: `pnpm typecheck:tests`, configuration inspection, and the recorded
negative fixture check (repeat if the configuration changes).

1. The test config includes test files under root `.` with strict checking and no emit.
2. Jest uses that same config; the obsolete config that excludes tests is absent.
3. The gate passes valid fixtures and detects a fixture missing required `projectId`.

## Functional Requirements

- **FR-111**: Organization-level operations that create tasks MUST NOT leave partial records when they fail. (Inherited verbatim from the parent.)
- **FR-001**: The three historical baseline fixture/route regressions MUST be repaired (G1, plan scopes 1–2).
- **FR-002**: Strategy MUST require an explicit authorized active project and validate before writes (G2, R-4).
- **FR-003**: Strategy goal, task, and assignment event MUST commit atomically, with PostgreSQL failure injection and in-memory parity (G3, R-1/R-8/R-9).
- **FR-004**: Delegation MUST resolve and validate the explicit project per the goal-project-wins rule, without a fallback (G2, R-5).
- **FR-005**: Goal creation MUST validate a supplied project and MUST continue to allow projectless goals (R-6).
- **FR-006**: Strategy placeholder naming MUST be best effort after commit (R-3).
- **FR-007**: Test files MUST have an effective strict typecheck shared with ts-jest (G5, R-10).
- **FR-008**: Normal task-creation behavior MUST remain unchanged; no migrations, data reset, or Phase 1 work is permitted (G4/G7).
- **FR-009**: A complete successful full-suite baseline MUST be recorded on a clean committed SHA with explicit PostgreSQL environment and all named gates; evidence is committed separately and historical baseline sections remain unchanged (G6, R-11).

## Success Criteria

- **SC-001**: All four story checks execute and pass; required PostgreSQL suites have zero skips.
- **SC-002**: Every project-validation and transactional failure scenario above has no new partial records.
- **SC-003**: One complete clean-SHA full run has zero failed suites/tests and zero skipped PostgreSQL tests; root/server/web typechecks, test typecheck, server/web builds, and whitespace check exit 0.
- **SC-004**: The final scope has no migration/reset/Phase 1 changes and retains normal task behavior.

## Explicit deferrals

CI alignment (R-12/T040) remains optional and unapproved. Existing web lint failures,
global unexpected-error mapping, and unrelated fallback callers remain non-gating,
as stated in the plan. No full-program convergence is claimed by this phase.
