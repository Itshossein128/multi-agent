# Implementation Plan: 005-event-routines-triggers

**Feature Name**: Durable Event Triggers, Agent Heartbeat, Recurring Routines, and Authenticated Webhooks  
**Date**: 2026-10-05  
**Spec**: [spec.md](./spec.md)  
**Status**: Ready for Implementation  

---

## Summary

Implement Paperclip comparison item 2: continuous automatic agent work across multi-instance and restartable deployments:
1. **Event-driven Trigger Outbox & Comments**:
   - Outbox table `studio_trigger_events` with atomic state transitions and row-level lease acquisition (`FOR UPDATE SKIP LOCKED`).
   - First-class task comments entity in `studio_task_comments` with `@mentions` parsing.
   - Automatic agent wake on task assignment and comment `@mentions`, with self-comment loop suppression.
   - Approval resolution integration with `ApprovalManager.resolveApproval()` to continue existing runs directly rather than duplicating runs.
2. **Optional Agent/Team Heartbeat**:
   - Durable periodic scheduling per agent, disabled by default.
   - Distributed lease locks to ensure exactly one node claims each heartbeat slice.
   - Concurrency checking to skip/defer heartbeat ticks if the agent is actively executing.
3. **Recurring Routines**:
   - Routine entity in `studio_routines` supporting cron and interval schedules, timezone awareness, next-run preview, and misfire policies (`skip`, `coalesce`, `enqueue`).
   - Routine execution audit log in `studio_routine_history`.
4. **Authenticated Webhook Triggers**:
   - Tenant-scoped webhook management in `studio_webhook_triggers`.
   - Inbound HMAC-SHA256 signature verification (`X-Webhook-Signature` / `X-Signature-256`), timestamp freshness (<= 300s), replay rejection via nonce/cache, 1MB payload cap, and delivery logging in `studio_webhook_deliveries`.
   - Secure secret generation and redaction.
5. **Full Server API, Web UX, Migrations & Testing**:
   - Migration `012_event_routines_triggers.sql` and registry in `src/studio/infrastructure/migrate.ts`.
   - Unified `StudioStore` interfaces for PostgreSQL and in-memory test stores.
   - Web task board comment panel, routines management view, and webhook trigger settings with bilingual (En/Fa) UX.

---

## Technical Context

**Language/Version**: TypeScript 5.7 (Node.js 20+ execution server and Next.js 16 web app)  
**Primary Dependencies**: `@multi-agent/types`, `RunExecutor`, `ApprovalManager`, `PostgresStudioStore`, `InMemoryStudioStore`, `croner` or standard cron parser for timezone support, `pg`  
**Storage**: PostgreSQL (`infrastructure/studio/migrations/012_event_routines_triggers.sql`) with in-memory store parity  
**Testing**: Jest (unit tests and isolated PostgreSQL integration tests on port 55432)  
**Constraints**:
- Outbox worker leases must be safe against competing server instances (`FOR UPDATE SKIP LOCKED`).
- In-flight/running agent checks must prevent duplicate concurrent runs.
- Webhook signing secrets must never leak into logs or task/agent JSON.
- Zero billable external LLM calls.
- Strict tenant isolation across all trigger events, routines, comments, and webhooks.

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| Tenant Isolation | PASS | All queries filter by `tenant_id`; cross-tenant delivery explicitly prevented and covered with denial tests. |
| Deduplication & Idempotency | PASS | Outbox uses unique idempotency keys; webhook triggers enforce replay windows and idempotency keys; approvals resume existing runs. |
| Concurrency Control | PASS | Multi-instance competing workers coordinate via Postgres `FOR UPDATE SKIP LOCKED` and lease timestamps; heartbeats skip if agent is currently active. |
| Non-paid Execution | PASS | Automated tests use offline/mock/stub agents; test runs avoid paid providers. |
| Backward Compatibility | PASS | Existing manual workflows, runs, tasks, and approval flows continue to work without regression. |

---

## Source Architecture

```text
infrastructure/studio/migrations/
└── 012_event_routines_triggers.sql     # DDL for comments, outbox, routines, webhooks, deliveries

packages/types/src/
├── index.ts                            # Routine, TriggerEvent, TaskComment, WebhookTrigger types

src/studio/
├── contracts.ts                        # Update StudioStore interface with comment, routine, webhook, trigger methods
└── infrastructure/
    ├── postgres-studio-store.ts        # Postgres implementations of new entities and queries
    ├── in-memory-studio-store.ts       # In-memory implementation of new entities and queries
    └── migrate.ts                      # Add 012_event_routines_triggers.sql to migration list

apps/server/src/
├── triggers/
│   ├── contracts.ts                    # Trigger event, routine, and webhook types
│   ├── triggerOutboxProcessor.ts       # Durable outbox worker (lease, dispatch, retry, dead-letter)
│   ├── heartbeatScheduler.ts           # Periodic agent heartbeat scheduler with lease claim
│   ├── routineScheduler.ts             # Cron/interval schedule calculator and runner
│   ├── webhookAuth.ts                  # HMAC-SHA256 signature verification & timestamp freshness
│   └── index.ts                        # Barrel export
├── api/
│   ├── studio/
│   │   ├── taskService.ts              # Wire assignment & comment events, self-comment suppression
│   │   ├── taskCommentRoutes.ts        # Task comment CRUD routes
│   │   ├── routineRoutes.ts            # Routines management API
│   │   └── webhookTriggerRoutes.ts     # Inbound webhook ingestion & trigger management API
│   └── index.ts                        # Register routes on server app
└── composition.ts                      # Wire trigger processor & schedulers into server lifecycle

apps/web/src/
├── components/tasks/
│   └── TaskCommentsPanel.tsx           # Task comments & mentions UI
├── components/routines/
│   └── RoutineManager.tsx              # Routine list, editor, pause/resume UI
└── components/webhooks/
    └── WebhookTriggerManager.tsx       # Webhook trigger management & secret generation UI
```
