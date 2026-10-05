# Research & Technical Decisions: 005-event-routines-triggers

**Date**: 2026-10-05  
**Feature**: 005-event-routines-triggers  

---

## 1. Durable Event Outbox & PostgreSQL Row Locking

### Problem
In a multi-instance execution server deployment, when tasks are assigned or comments with mentions are posted, multiple instances must not process the same trigger event twice or miss events on restart.

### Investigation
- Existing `PostgresRunStore` handles run snapshots and stream persistence.
- `studio_trigger_events` can be designed with:
  - Columns: `id`, `tenant_id`, `event_type`, `target_type`, `target_id`, `idempotency_key`, `payload`, `status` (`pending`, `processing`, `processed`, `failed`, `dead_letter`), `retry_count`, `max_retries`, `next_retry_at`, `locked_by`, `locked_until`, `created_at`, `updated_at`.
  - Claim query:
    ```sql
    UPDATE studio_trigger_events
    SET status = 'processing',
        locked_by = $1,
        locked_until = now() + interval '60 seconds',
        updated_at = now()
    WHERE id = (
      SELECT id FROM studio_trigger_events
      WHERE status IN ('pending', 'failed')
        AND (next_retry_at IS NULL OR next_retry_at <= now())
        AND (locked_until IS NULL OR locked_until <= now())
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
    ```
- `FOR UPDATE SKIP LOCKED` guarantees non-blocking, conflict-free concurrency across competing server processes. If an instance crashes while holding the lease, `locked_until <= now()` ensures automatic lease recovery on the subsequent poll cycle.

---

## 2. Self-Comment Loop Suppression & Mentions Extraction

### Problem
An autonomous agent working on a task may post a comment describing its progress. If posting a comment unconditionally triggers an agent wakeup event, the agent will wake up, post another comment, and loop infinitely.

### Solution
- When a comment is created (`POST /tasks/:id/comments`), inspect `author_type` and `author_id`.
- Extract `@mentions` via regular expression: `/(?:^|\s)@([a-zA-Z0-9_-]+)/g`.
- Target agents to wake:
  1. If mentions are present: all agents matched by ID or name in the same workspace.
  2. If no mentions are present: the task's assigned agent(s).
- **Suppression Filter**:
  ```typescript
  const agentsToWake = candidateAgents.filter((agent) => {
    if (comment.authorType === "agent" && (comment.authorId === agent.id || comment.authorId === agent.name)) {
      // Suppress self-wakeup
      return false;
    }
    return true;
  });
  ```
- If all candidates are suppressed, no trigger event is enqueued.

---

## 3. Approval Resolution: Resuming vs Duplicating

### Problem
When an approval or clarification is resolved for a paused task, a naive event system might create a new workflow run from scratch, losing prior node states and creating duplicate concurrent executions.

### Solution
- Inspect the task's linked `runId`.
- Query `store.get(runId)`.
- If `run.status === "waiting_for_human"` and `RunExecutor.isRunResumable(runId)`:
  - Call `RunExecutor.resolveApproval(runId, approvalId, decision)`.
  - This resumes the existing LangGraph graph via `new Command({ resume: decision })`.
  - Mark trigger event as `processed` with `resumedRunId = runId`.
- Only if the run has completely finished or never existed does the system dispatch a fresh run.

---

## 4. Cron Expressions & Timezone Calculation

### Problem
Recurring routines require robust cron evaluation with support for standard timezones (e.g. `UTC`, `America/New_York`, `Asia/Tehran`) and daylight saving time (DST) shifts without pulling heavy external daemon dependencies.

### Solution
- Implement or use standard lightweight cron parsing with standard 5-part expressions (`minute hour day-of-month month day-of-week`).
- Use Node.js built-in `Intl.DateTimeFormat` with `timeZone` option to resolve local dates and compute next run timestamps reliably across all IANA timezones.
- Support fixed interval format as well: e.g. `every:60s`, `every:5m`, `every:1h`.
- Next run computation function: `computeNextRunAt(scheduleType, scheduleExpr, timezone, fromDate)`.

---

## 5. Webhook Security: HMAC-SHA256, Freshness & Replay

### Problem
Public webhook endpoints are exposed to forgery, replay attacks, and denial of service.

### Solution
- Webhook trigger endpoint: `POST /api/webhooks/triggers/:id`.
- Headers:
  - `X-Webhook-Signature`: `sha256=<hex>` or `t=<timestamp>,v1=<hex>`.
  - `X-Webhook-Timestamp`: ISO timestamp or Unix epoch seconds.
- Signature verification:
  - Compute `crypto.createHmac("sha256", secret).update(rawBody).digest("hex")`.
  - Compare using constant-time `crypto.timingSafeEqual`.
- Timestamp freshness:
  - `Math.abs(Date.now() - timestampMs) <= 300_000` (5 minutes).
- Replay prevention:
  - In-memory sliding cache of recent delivery IDs / signatures within the 5-minute window; duplicate deliveries return 409 or 200 idempotent replay.
- Payload limit:
  - Stream reading limited to 1MB; requests exceeding 1MB are rejected with 413.
- Secret safety:
  - Secrets stored hashed (SHA-256) in `studio_webhook_triggers` or encrypted; raw secret shown once upon creation/rotation.
