# Tasks: 005-event-routines-triggers

**Input**: Design documents from `/specs/005-event-routines-triggers/`  
**Prerequisites**: `spec.md`, `checklists/requirements.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/api.md`, `quickstart.md`  

---

## Phase 1: Setup & Data Layer

- [x] T001 Write PostgreSQL DDL migration in `infrastructure/studio/migrations/012_event_routines_triggers.sql` defining `studio_task_comments`, `studio_trigger_events`, `studio_routines`, `studio_routine_history`, `studio_webhook_triggers`, `studio_webhook_deliveries`, and `studio_agent_heartbeats`.
- [x] T002 Register `012_event_routines_triggers.sql` in `src/studio/infrastructure/migrate.ts` with SHA-256 ledger checksum tracking.
- [x] T003 Update `@multi-agent/types` in `packages/types/src/index.ts` with domain interfaces: `TaskComment`, `TriggerEvent`, `RoutineRecord`, `RoutineHistoryRecord`, `WebhookTriggerRecord`, `WebhookDeliveryRecord`, `AgentHeartbeatSettings`. Rebuild types.
- [x] T004 Update `StudioStore` interface in `src/studio/contracts.ts` with comment, trigger event outbox, routine, webhook, and heartbeat CRUD operations.

---

## Phase 2: Foundational Stores

- [x] T005 [P] Implement comment, trigger event outbox, routine, webhook, and heartbeat methods in `src/studio/infrastructure/in-memory-studio-store.ts`.
- [x] T006 [P] Implement comment, trigger event outbox (`FOR UPDATE SKIP LOCKED` claim query), routine, webhook, and heartbeat methods in `src/studio/infrastructure/postgres-studio-store.ts`.

---

## Phase 3: User Story 1 - Event-Driven Outbox & Task Interactions (P1)

- [x] T007 Implement durable outbox processor in `apps/server/src/triggers/triggerOutboxProcessor.ts` with row leasing, exponential backoff retries, dead-letter state, and run dispatch via `RunExecutor`.
- [x] T008 Implement task comment service & routes in `apps/server/src/api/studio/taskCommentRoutes.ts` with `@mentions` regex parsing (`@agent-id` / `@agent-name`) and authorization checks.
- [x] T009 Implement self-comment loop suppression in `taskCommentRoutes.ts`: prevent recursive wakeup when an agent posts comments on its assigned task.
- [x] T010 Wire task assignment trigger in `apps/server/src/api/studio/taskService.ts`: enqueue trigger event when task status transitions to `ready`/`backlog` with assigned agent.
- [x] T011 Wire approval & clarification resolution integration in `apps/server/src/api/studio/taskService.ts`: resume paused run directly through `ApprovalManager.resolveApproval()` without duplicating runs.

---

## Phase 4: User Story 2 - Agent & Team Heartbeat (P2)

- [x] T012 Implement heartbeat scheduler in `apps/server/src/triggers/heartbeatScheduler.ts` with interval calculation, multi-instance leased claims, and concurrency guards (skip tick if agent has an active run).
- [x] T013 Expose agent heartbeat configuration routes in `apps/server/src/api/studio/agentRoutes.ts` (`GET /agents/:id/heartbeat`, `PUT /agents/:id/heartbeat`).

---

## Phase 5: User Story 3 - Recurring Routines (P2)

- [x] T014 Implement cron and interval schedule parser with timezone calculation in `apps/server/src/triggers/routineScheduler.ts`.
- [x] T015 Implement routine worker loop in `routineScheduler.ts` with misfire policies (`skip`, `coalesce`, `enqueue`), execution history logging, and leased multi-instance dispatch.
- [x] T016 Implement routine management routes in `apps/server/src/api/studio/routineRoutes.ts` (CRUD, pause, resume, history).

---

## Phase 6: User Story 4 - Authenticated Webhook Triggers (P2)

- [x] T017 Implement HMAC-SHA256 signature verification, timestamp freshness (300s), replay cache, and 1MB payload bounding in `apps/server/src/triggers/webhookAuth.ts`.
- [x] T018 Implement inbound webhook receiver route in `apps/server/src/api/studio/webhookTriggerRoutes.ts` (`POST /api/webhooks/triggers/:id`) with delivery audit logging (`studio_webhook_deliveries`).
- [x] T019 Implement webhook trigger management routes in `webhookTriggerRoutes.ts` (CRUD, secret rotation, secret redaction).

---

## Phase 7: User Story 5 - Web UI & Bilingual UX (P3)

- [x] T020 [P] Implement `TaskCommentsPanel.tsx` in `apps/web/src/components/tasks/detail/` with comment history, mentions tagging, and bilingual (En/Fa) strings.
- [x] T021 [P] Implement `RoutineManager.tsx` in `apps/web/src/components/routines/` for viewing, creating, pausing, and deleting recurring routines.
- [x] T022 [P] Implement `WebhookTriggerManager.tsx` in `apps/web/src/components/webhooks/` for managing webhook endpoints and displaying one-time signing secrets.
- [x] T023 Wire background trigger processor and schedulers into server startup and graceful shutdown in `apps/server/src/composition.ts` and `apps/server/src/index.ts`.

---

## Phase 8: Verification & Hardening

- [x] T024 Write unit tests for HMAC signature verification, timestamp tolerance, and replay rejection in `tests/webhookAuth.test.ts`.
- [x] T025 Write unit tests for cron/timezone evaluation, misfire policies, and routine scheduling in `tests/routineScheduler.test.ts`.
- [x] T026 Write unit tests for self-comment suppression, mention parsing, and approval resumption in `tests/triggerOutbox.test.ts`.
- [x] T027 Write PostgreSQL integration tests against isolated database on port 55432 in `tests/eventRoutinesIntegration.test.ts` (multi-instance competing claims, restart recovery, cross-tenant isolation).
- [x] T028 Run root, server, and web typecheck (`tsc --noEmit`), application builds, full test suite (`pnpm test --runInBand`), and `git diff --check`.
