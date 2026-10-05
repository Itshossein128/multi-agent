# Data Model: 005-event-routines-triggers

**Feature**: 005-event-routines-triggers  
**Date**: 2026-10-05  

---

## 1. PostgreSQL Schema: Migration `012_event_routines_triggers.sql`

### `studio_task_comments`
Persists comments and discussions on tasks.

```sql
CREATE TABLE IF NOT EXISTS studio_task_comments (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  task_id text NOT NULL REFERENCES studio_tasks(id) ON DELETE CASCADE,
  author_id text NOT NULL,
  author_type text NOT NULL CHECK (author_type IN ('user', 'agent', 'system')),
  content text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_task_comments_task ON studio_task_comments(tenant_id, task_id, created_at ASC);
```

### `studio_trigger_events`
Durable outbox for asynchronous agent/workflow trigger intents.

```sql
CREATE TABLE IF NOT EXISTS studio_trigger_events (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('task_assignment', 'task_comment', 'task_mention', 'routine_tick', 'webhook_inbound', 'approval_resolved')),
  target_type text NOT NULL CHECK (target_type IN ('agent', 'workflow', 'task')),
  target_id text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'dead_letter')),
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  next_retry_at timestamptz,
  locked_by text,
  locked_until timestamptz,
  last_error text,
  dispatched_run_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_trigger_events_idempotency UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS studio_trigger_events_claim ON studio_trigger_events(status, next_retry_at, locked_until, created_at ASC);
CREATE INDEX IF NOT EXISTS studio_trigger_events_tenant ON studio_trigger_events(tenant_id, event_type);
```

### `studio_routines`
Recurring schedules and cron definitions.

```sql
CREATE TABLE IF NOT EXISTS studio_routines (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  schedule_type text NOT NULL CHECK (schedule_type IN ('cron', 'interval')),
  schedule_expr text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  target_type text NOT NULL CHECK (target_type IN ('workflow', 'agent', 'task')),
  target_id text NOT NULL,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  misfire_policy text NOT NULL DEFAULT 'skip' CHECK (misfire_policy IN ('skip', 'coalesce', 'enqueue')),
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_id text NOT NULL
);

CREATE INDEX IF NOT EXISTS studio_routines_due ON studio_routines(enabled, next_run_at ASC);
CREATE INDEX IF NOT EXISTS studio_routines_tenant ON studio_routines(tenant_id, target_type, target_id);
```

### `studio_routine_history`
Audit records of routine executions.

```sql
CREATE TABLE IF NOT EXISTS studio_routine_history (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  routine_id text NOT NULL REFERENCES studio_routines(id) ON DELETE CASCADE,
  scheduled_at timestamptz NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  run_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_routine_history_lookup ON studio_routine_history(tenant_id, routine_id, created_at DESC);
```

### `studio_webhook_triggers`
Tenant-scoped inbound webhook configurations.

```sql
CREATE TABLE IF NOT EXISTS studio_webhook_triggers (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  secret_hash text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('workflow', 'agent')),
  target_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  rate_limit_per_minute integer NOT NULL DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_id text NOT NULL
);

CREATE INDEX IF NOT EXISTS studio_webhook_triggers_lookup ON studio_webhook_triggers(tenant_id, id);
```

### `studio_webhook_deliveries`
Audit log of inbound webhook invocations.

```sql
CREATE TABLE IF NOT EXISTS studio_webhook_deliveries (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  trigger_id text NOT NULL REFERENCES studio_webhook_triggers(id) ON DELETE CASCADE,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('accepted', 'rejected', 'failed')),
  http_status integer NOT NULL,
  error_reason text,
  run_id text,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS studio_webhook_deliveries_lookup ON studio_webhook_deliveries(tenant_id, trigger_id, delivered_at DESC);
```

### `studio_agent_heartbeats`
Leased heartbeat tracking per agent.

```sql
CREATE TABLE IF NOT EXISTS studio_agent_heartbeats (
  agent_id text NOT NULL,
  tenant_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  interval_seconds integer NOT NULL DEFAULT 300,
  last_heartbeat_at timestamptz,
  next_heartbeat_at timestamptz,
  locked_by text,
  locked_until timestamptz,
  PRIMARY KEY (tenant_id, agent_id)
);

CREATE INDEX IF NOT EXISTS studio_agent_heartbeats_due ON studio_agent_heartbeats(enabled, next_heartbeat_at ASC);
```

---

## 2. TypeScript Contract Definitions

The domain models will be exported from `@multi-agent/types` and `src/studio/contracts.ts`:
- `TaskComment`: author, content, mentions, timestamps.
- `TriggerEvent`: type, target, idempotencyKey, payload, status.
- `Routine`: scheduleType, scheduleExpr, timezone, misfirePolicy, enabled, nextRunAt.
- `RoutineHistory`: routineId, scheduledAt, executedAt, status, runId, error.
- `WebhookTrigger`: name, targetType, targetId, enabled, rateLimitPerMinute.
- `WebhookDelivery`: triggerId, status, httpStatus, errorReason, runId, durationMs.
- `AgentHeartbeat`: agentId, enabled, intervalSeconds, lastHeartbeatAt, nextHeartbeatAt.
