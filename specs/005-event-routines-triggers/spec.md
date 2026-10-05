# Feature Specification: 005-event-routines-triggers

**Feature Name**: Durable Event Triggers, Agent Heartbeat, Recurring Routines, and Authenticated Webhooks  
**Feature Branch**: `005-event-routines-triggers`  
**Created**: 2026-10-05  
**Status**: Ready for Planning & Implementation  
**Input**: Continuous automatic agent work (Paperclip comparison item 2): durable event outbox/intents for task assignment, comments/@mentions, and approval resolution; optional agent/team heartbeat with leased scheduling; recurring routines with timezone/misfire policies; and authenticated webhook triggers.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Event-Driven Agent Wakeup on Task Assignment, Comments/@Mentions, and Approval Resolution (Priority: P1)

As a team member or automated collaborator, when I assign a task to an agent, post a comment mentioning an agent (`@agent`), or resolve a pending human approval/clarification, the assigned or mentioned agent wakes up automatically and durably executes the next step without requiring manual start clicks or constant idle polling loops.

**Why this priority**: Core autonomous workflow execution. Eliminates human friction for standard handoffs, comment loops, and approval resumption while preventing runaway self-comment loops and cross-tenant leakage.

**Independent Test**:
- Create a task assigned to an agent; post a comment `@agent please inspect this`; verify a durable trigger event is recorded, atomically reconciled or dispatched, and the agent's single-agent workflow starts exactly once.
- Post a comment from the agent itself; verify self-comment suppression prevents an infinite wake loop.
- Resolve a pending approval for an existing paused run; verify the existing run resumes directly via LangGraph `Command({ resume })` without spawning a duplicate concurrent run.

**Acceptance Scenarios**:
1. **Given** a task in `backlog` or `ready` assigned to Agent A, **When** the assignment is saved, **Then** an assignment trigger intent is enqueued in the durable outbox and Agent A is dispatched with the task context exactly once per idempotency key.
2. **Given** an existing task, **When** a user posts a comment mentioning `@agent-b`, **Then** the comment is stored in `studio_task_comments` and a mention trigger event wakes Agent B; if the comment author is Agent B itself, no recursive wake event is triggered.
3. **Given** a workflow run paused in `waiting_for_human`, **When** the human approval or clarification is resolved, **Then** the existing run is resumed through `ApprovalManager` and no duplicate run is scheduled.
4. **Given** trigger events queued for Tenant 1, **When** a worker processes the outbox, **Then** only agents and workflows owned by Tenant 1 are executed.

---

### User Story 2 - Optional Agent & Team Heartbeat with Leased Multi-Instance Scheduling (Priority: P2)

As an operator, I can configure an optional heartbeat interval on specific agents or teams (disabled by default) so they periodically inspect their queue, verify system health, or perform background maintenance. Scheduling is durable and leased so restarts or multiple server replicas never produce duplicate or overlapping concurrent runs.

**Why this priority**: Enables background proactive agents (e.g., periodic queue sweeping, health monitoring) without uncontrolled polling or duplicate paid provider calls across clustered nodes.

**Independent Test**:
- Enable heartbeat on an agent with a 60-second interval; observe the computed `nextHeartbeatAt`.
- Simulate two competing worker loops; assert only one worker acquires the lease for that heartbeat slice using PostgreSQL row locks (`FOR UPDATE SKIP LOCKED`).
- If an agent is already currently running an active execution, the heartbeat tick skips or defers to prevent overlapping concurrency.

**Acceptance Scenarios**:
1. **Given** an agent with heartbeat disabled (default), **When** the scheduler runs, **Then** no heartbeat jobs are dispatched for that agent.
2. **Given** an agent with heartbeat interval set to 300s, **When** the interval elapses and no active run is in flight, **Then** exactly one worker claims the heartbeat lease, dispatches the heartbeat run, and updates `lastHeartbeatAt` and `nextHeartbeatAt`.
3. **Given** a server crash while a heartbeat lease is held, **When** the lease expiration elapses, **Then** the lease is recovered safely on the next cycle without running missed historical ticks multiple times (honest coalesce/skip policy).

> [!NOTE] Scoped Team Heartbeat Architectural Blocker
> In the current platform data model (migrations 001-013), agents are provisioned as individual entities in `studio_agents` with heartbeats keyed by `(tenant_id, agent_id)` in `studio_agent_heartbeats`. While migration 014 introduces managerial reporting edges (`studio_agent_reporting`), there is no first-class `studio_teams` entity or team membership mapping table in the core schema. Team-level heartbeat configuration is therefore architecturally blocked on the introduction of a canonical team entity and membership resolver; heartbeat scheduling currently operates per-agent.


---

### User Story 3 - Recurring Routines Tied to Agents, Tasks, or Workflows (Priority: P2)

As an operator, I can define recurring routines with cron expressions or fixed intervals, an assigned timezone (e.g., `UTC`, `America/New_York`, `Asia/Tehran`), next-run preview, and misfire policies (`skip`, `coalesce`, `enqueue`). Routines can be created, updated, paused, resumed, and deleted through the API and UI.

**Why this priority**: Provides cron/batch automation for periodic reports, sync jobs, and multi-agent pipeline executions with full audit history and daylight saving / timezone correctness.

**Independent Test**:
- Create a routine with a cron schedule (e.g. `0 9 * * 1-5`) and timezone `UTC`; verify next-run calculation preview.
- Pause the routine; advance clock past the scheduled time; verify no execution occurs.
- Resume routine with `skip` misfire policy; verify it schedules the next future occurrence without storming overdue runs.

**Acceptance Scenarios**:
1. **Given** an authorized operator, **When** creating a routine with name, schedule, target workflow/agent, and timezone, **Then** the routine is persisted in `studio_routines`, next run time is computed, and next run timestamp is visible in API and UI.
2. **Given** two competing server instances polling routines, **When** a routine is due, **Then** one instance atomically claims the routine execution lease, spawns the workflow run, and records the routine run history.
3. **Given** a routine paused by an operator, **When** the cron trigger window passes, **Then** the routine remains idle and its status indicates paused.

---

### User Story 4 - Authenticated Webhook Triggers with Signature Verification & Replay Protection (Priority: P2)

As an external system or webhook producer (e.g., GitHub, Stripe, internal microservice), I can invoke a tenant-scoped webhook trigger URL with an HMAC-SHA256 signature and timestamp header to trigger an agent or workflow run automatically, safely rejecting unauthorized, expired, or replayed requests.

**Why this priority**: Critical inbound integration boundary. Secures the system against spoofing, replay attacks, payload exhaustion, and unauthorized workflow dispatch.

**Independent Test**:
- Create a webhook trigger; receive generated secret once. Verify secret is never stored in plaintext in client-facing agent JSON or logs.
- Post a payload with valid `X-Signature-SHA256` (or `X-Webhook-Signature`) and fresh timestamp; assert run is scheduled.
- Post with an altered payload or invalid signature; assert HTTP 401/403 rejection.
- Replay the exact same signature and timestamp after 5 minutes; assert HTTP 400/401 replay rejection.

**Acceptance Scenarios**:
1. **Given** an operator managing webhooks, **When** a webhook trigger is created or secret rotated, **Then** a cryptographically secure signing secret is generated and returned to the operator once, while only a secure hash/encrypted secret is retained, and secret is redacted in logs and standard GET responses.
2. **Given** an incoming webhook request, **When** the payload is verified against the trigger's HMAC secret within the allowable timestamp tolerance window (e.g., 300 seconds), **Then** a durable trigger event is dispatched and a 202 Accepted response with delivery ID is returned.
3. **Given** an incoming webhook request exceeding the 1MB payload cap or exceeding rate limits, **Then** the request is rejected with 413 or 429 respectively and logged in the delivery audit log.

---

### User Story 5 - Web UI & Server API Management (Bilingual En/Fa, Configuration & Backward Compatibility) (Priority: P3)

As a user interacting with the platform via the web UI or REST API, I can view and post task comments, manage routines, configure webhook triggers, toggle agent heartbeats, and inspect trigger delivery history in English or Persian (RTL) without breaking any existing manual task/run workflows.

**Why this priority**: Completes the end-to-end user experience, matches existing internationalization patterns in the web workspace, and preserves existing manual task workflows without regressions.

**Independent Test**:
- Open the task board; click a task; view comments thread, post a comment with `@agent` tag; verify comment displays with author and timestamp.
- Navigate to Routines management; create and toggle a routine; verify Persian and English labels render correctly.
- Verify existing manual workflow runs, task creation, and approval flows continue to work unchanged.

---

## Edge Cases

- **Self-Comment Loop**: Agent posting a comment on its assigned task must NOT trigger another wakeup of the same agent.
- **Concurrent Multiple Workers**: Two or more server nodes polling the trigger outbox, heartbeat schedule, or routine table must use PostgreSQL atomic transactions (`FOR UPDATE SKIP LOCKED` or advisory locks) so that each task/routine tick is claimed exactly once.
- **Crash Recovery**: If a server crashes mid-dispatch, in-flight leases with expired heartbeats must be reclaimed after their lease timeout without creating orphaned runs.
- **Approval Resume vs New Run**: Resuming a run in `waiting_for_human` must invoke `ApprovalManager.resolveApproval()` on the existing run entry, never creating a new unlinked run.
- **Webhook Clock Skew & Replay**: Timestamp tolerance window of 300s prevents expired replay; duplicate deliveries with the same `Idempotency-Key` return idempotent responses.
- **Tenant Isolation**: All trigger events, comments, routines, and webhook triggers are strictly partitioned by `tenant_id` and verified against the caller's principal.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist task comments in a durable `studio_task_comments` table with `id`, `tenant_id`, `task_id`, `author_id`, `author_type` (`user` | `agent`), `content`, `mentions` (array of agent IDs/names), and timestamps.
- **FR-002**: System MUST provide an outbox table `studio_trigger_events` that atomically records trigger intents for: (a) task assignment, (b) task comment / mention, (c) routine trigger, (d) webhook trigger, and (e) approval resolution.
- **FR-003**: System MUST execute a background trigger processor that leases outbox events using PostgreSQL row locking (`FOR UPDATE SKIP LOCKED` / atomic state update), dispatches the workflow/agent run via `RunExecutor`, and marks events `processed`, `failed`, or `dead_letter` with retry backoff and error tracking.
- **FR-004**: System MUST suppress self-comment loops: if `author_type === "agent"` and the comment mentions the author agent or the task is assigned to that agent, the system MUST NOT generate a recursive wakeup trigger event.
- **FR-005**: When an approval or clarification is resolved for a task with an active paused run (`waiting_for_human`), the system MUST integrate directly with the existing run via `ApprovalManager.resolveApproval()` and MUST NOT schedule a duplicate run.
- **FR-006**: System MUST support an optional heartbeat configuration per agent (`enabled`, `interval_seconds`, `last_heartbeat_at`, `next_heartbeat_at`), disabled by default.
- **FR-007**: When an agent heartbeat is enabled, the scheduler MUST ensure only one worker claims the heartbeat execution per interval, check if the agent is already in an active run, and skip or defer rather than stacking concurrent runs.
- **FR-008**: System MUST persist recurring routines in `studio_routines` with `tenant_id`, `name`, `schedule_type` (`cron` | `interval`), `schedule_expr`, `timezone`, `target_type` (`workflow` | `agent` | `task`), `target_id`, `input_payload`, `misfire_policy` (`skip` | `coalesce` | `enqueue`), `enabled`, `next_run_at`, and `last_run_at`.
- **FR-009**: The routine scheduler MUST compute timezone-aware next run times, support pause/resume/edit/delete, and record execution history in `studio_routine_history`.
- **FR-010**: System MUST persist webhook triggers in `studio_webhook_triggers` with `tenant_id`, `name`, `token_id`, `secret_hash`, `target_type` (`workflow` | `agent`), `target_id`, `enabled`, and rate limits.
- **FR-011**: Inbound webhook requests (`POST /api/webhooks/triggers/:id`) MUST verify HMAC-SHA256 signatures (`X-Webhook-Signature` or `X-Signature-256`), check timestamp freshness (<= 300 seconds), enforce a 1MB payload ceiling, respect rate limits, and idempotently dispatch a trigger event.
- **FR-012**: Webhook signing secrets MUST be generated securely, shown to the operator only upon creation or rotation, and NEVER stored in plaintext in agent/task configurations or exposed in log outputs.
- **FR-013**: System MUST record webhook delivery attempts in `studio_webhook_deliveries` with timestamp, status, payload summary, run ID (if dispatched), and error reason.
- **FR-014**: All trigger entities, comments, routines, and webhooks MUST enforce strict tenant boundaries; no trigger may execute an agent or workflow belonging to a different tenant.
- **FR-015**: All migrations MUST be included in `infrastructure/studio/migrations/` (migration `012_event_routines_triggers.sql`) with ledger checksum verification in `src/studio/infrastructure/migrate.ts`.

---

## Success Criteria *(mandatory)*

- **SC-001**: Task assignment and new comments with `@mentions` automatically dispatch the assigned/mentioned agent within 2 seconds of persistence in a single-instance or multi-instance deployment.
- **SC-002**: Resolving an approval or clarification on a paused task resumes the existing workflow run with 100% fidelity without spawning any duplicate runs.
- **SC-003**: 100% of agent self-comments are detected and suppressed, preventing recursive execution loops.
- **SC-004**: Multi-instance concurrency test confirms zero duplicate executions for heartbeat intervals and routine schedules when two concurrent workers compete for claims.
- **SC-005**: Webhook trigger authentication rejects 100% of invalid signatures, tampered payloads, and expired (> 300s) timestamps.
- **SC-006**: Existing manual task board, workflow runs, agent configurations, and onboarding tests pass without regressions across root, server, and web suites.
