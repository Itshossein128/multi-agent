# Requirements Checklist: 005-event-routines-triggers

**Purpose**: Requirements quality and completeness review for durable event triggers, agent heartbeats, recurring routines, and webhook triggers  
**Created**: 2026-10-05  
**Feature**: [spec.md](../spec.md)  
**Review Ownership**: Reviewer-owned requirements-quality review artifact.  
**Marker Semantics**: `[x]` means the criterion has been reviewed and satisfied for requirements quality.

---

## 1. Event-Driven Outbox & Task Interactions

- [x] CHK001 Durable outbox entity and database table (`studio_trigger_events`) specified with idempotency, status lifecycle (`pending`, `processing`, `processed`, `failed`, `dead_letter`), retry count, and next retry timestamp.
- [x] CHK002 Task comments entity and database table (`studio_task_comments`) defined with author identity (`user` vs `agent`), content, mentions array, and task linkage.
- [x] CHK003 Automatic agent wakeup requirements specified for both task assignment and task comment `@mentions`.
- [x] CHK004 Self-comment suppression rule clearly specified: agent posting on its own task does not trigger recursive wakeup.
- [x] CHK005 Approval and clarification resolution integration explicitly requires resuming existing paused runs via `ApprovalManager.resolveApproval()` without duplicating runs.
- [x] CHK006 Multi-instance concurrency specified using PostgreSQL atomic row locking (`FOR UPDATE SKIP LOCKED`) for trigger workers.

## 2. Agent & Team Heartbeats

- [x] CHK007 Heartbeat configuration specified on agent records (`enabled`, `interval_seconds`, `last_heartbeat_at`, `next_heartbeat_at`), disabled by default.
- [x] CHK008 Durable lease claim mechanism specified to prevent duplicate heartbeat dispatches across multiple server instances.
- [x] CHK009 Concurrency and overlap prevention specified: heartbeat tick skips or defers if agent is actively running another execution.
- [x] CHK010 Honest at-least-once vs exactly-once boundaries documented; duplicate paid LLM calls prevented by skipping overdue stacked ticks.

## 3. Recurring Routines

- [x] CHK011 Routine entity specified with cron expressions or fixed intervals, timezone support, and next-run preview computation.
- [x] CHK012 Misfire policies specified (`skip`, `coalesce`, `enqueue`) for catching up missed executions after server downtime or pause.
- [x] CHK013 Operator management lifecycle specified: create, read, update, pause, resume, delete, and view execution history.
- [x] CHK014 Competing worker safety specified using atomic claim locks.

## 4. Authenticated Webhook Triggers

- [x] CHK015 Webhook trigger entity specified with tenant scoping, target workflow/agent, and secure signing secret.
- [x] CHK016 Inbound authentication requirement specified: HMAC-SHA256 signature verification over raw request body.
- [x] CHK017 Timestamp freshness (tolerance <= 300s) and replay protection specified via nonce/idempotency tracking.
- [x] CHK018 Payload ceiling (1MB) and rate limits specified with fail-closed rejection.
- [x] CHK019 Secret protection specified: secrets generated cryptographically, displayed once, redacted in logs and standard GET responses.
- [x] CHK020 Inbound delivery audit logging specified (`studio_webhook_deliveries`).

## 5. Architectural & UX Completeness

- [x] CHK021 PostgreSQL migration `012_event_routines_triggers.sql` specified and registered in migration ledger runner.
- [x] CHK022 In-memory and PostgreSQL `StudioStore` implementations specified with feature parity for tests and production.
- [x] CHK023 Web UI requirements specified for task comments/mentions, routines management, webhook triggers, and heartbeat settings in English and Persian (RTL).
- [x] CHK024 Backward compatibility preserved for existing manual workflows, runs, tasks, and approval flows.
- [x] CHK025 Integration tests against real PostgreSQL specified alongside focused unit test suites.
