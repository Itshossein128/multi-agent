# API Contracts: 005-event-routines-triggers

**Feature**: 005-event-routines-triggers  
**Date**: 2026-10-05  

---

## 1. Task Comments API

### `GET /tasks/:id/comments`
List comments for a task.
- **Headers**: `Authorization: Bearer <token>`
- **Response 200 OK**:
  ```json
  [
    {
      "id": "comment-1",
      "tenantId": "tenant-default",
      "taskId": "task-1",
      "authorId": "user-1",
      "authorType": "user",
      "content": "Please review this requirement @code-reviewer",
      "mentions": ["code-reviewer"],
      "createdAt": "2026-10-05T00:00:00.000Z",
      "updatedAt": "2026-10-05T00:00:00.000Z"
    }
  ]
  ```

### `POST /tasks/:id/comments`
Post a new comment on a task. Automatically parses `@mentions` and enqueues a trigger intent unless suppressed by self-comment rules.
- **Headers**: `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "content": "Updated code is ready for verification @tester",
    "authorType": "user"
  }
  ```
- **Response 201 Created**: Returns created `TaskComment`.

---

## 2. Routines API

### `GET /routines`
List recurring routines for tenant.
- **Response 200 OK**: Array of `RoutineRecord`.

### `POST /routines`
Create a new routine.
- **Request Body**:
  ```json
  {
    "name": "Daily Queue Sweeper",
    "description": "Inspects overdue tasks and alerts steward",
    "scheduleType": "cron",
    "scheduleExpr": "0 9 * * 1-5",
    "timezone": "America/New_York",
    "targetType": "workflow",
    "targetId": "wf-queue-sweep",
    "inputPayload": { "dryRun": false },
    "misfirePolicy": "skip",
    "enabled": true
  }
  ```
- **Response 201 Created**: Returns created `RoutineRecord` with calculated `nextRunAt`.

### `PUT /routines/:id`
Update routine configuration.
- **Response 200 OK**: Returns updated `RoutineRecord`.

### `POST /routines/:id/pause`
Pause routine.
- **Response 200 OK**: `{ "ok": true, "enabled": false }`

### `POST /routines/:id/resume`
Resume routine and recalculate next run.
- **Response 200 OK**: `{ "ok": true, "enabled": true, "nextRunAt": "..." }`

### `DELETE /routines/:id`
Delete routine.
- **Response 200 OK**: `{ "ok": true }`

### `GET /routines/:id/history`
Get execution history for a routine.
- **Response 200 OK**: Array of `RoutineHistoryRecord`.

---

## 3. Webhook Triggers API

### `GET /webhooks/triggers`
List webhook triggers for tenant (secrets redacted).
- **Response 200 OK**: Array of `WebhookTriggerRecord`.

### `POST /webhooks/triggers`
Create a webhook trigger. Generates cryptographically secure signing secret and returns raw secret once.
- **Request Body**:
  ```json
  {
    "name": "GitHub CI Webhook",
    "targetType": "workflow",
    "targetId": "wf-ci-eval",
    "rateLimitPerMinute": 60
  }
  ```
- **Response 201 Created**:
  ```json
  {
    "trigger": {
      "id": "wh-trigger-1",
      "name": "GitHub CI Webhook",
      "targetType": "workflow",
      "targetId": "wf-ci-eval",
      "enabled": true,
      "createdAt": "..."
    },
    "signingSecret": "whsec_9f83b284e917416..."
  }
  ```

### `POST /webhooks/triggers/:id/rotate-secret`
Rotates signing secret.
- **Response 200 OK**: Returns new `signingSecret`.

### `POST /api/webhooks/triggers/:id` (Inbound Receiver)
Receives inbound webhook from external producer.
- **Headers**:
  - `X-Webhook-Signature`: `sha256=<hex>` (or `t=<timestamp>,v1=<hex>`)
  - `X-Webhook-Timestamp`: `<timestamp>`
  - `Content-Type`: `application/json`
  - `Idempotency-Key`: `<optional uuid>`
- **Response 202 Accepted**:
  ```json
  {
    "accepted": true,
    "deliveryId": "deliv-1234",
    "runId": "run-5678"
  }
  ```
- **Error Responses**:
  - `401 Unauthorized`: Invalid or missing signature
  - `400 Bad Request`: Expired timestamp (> 300s window) or replay
  - `413 Payload Too Large`: Payload exceeds 1MB limit
  - `429 Too Many Requests`: Rate limit exceeded

---

## 4. Agent Heartbeat API

### `GET /agents/:id/heartbeat`
Inspect agent heartbeat settings.
- **Response 200 OK**:
  ```json
  {
    "agentId": "agent-1",
    "enabled": false,
    "intervalSeconds": 300,
    "lastHeartbeatAt": null,
    "nextHeartbeatAt": null
  }
  ```

### `PUT /agents/:id/heartbeat`
Configure agent heartbeat settings.
- **Request Body**:
  ```json
  {
    "enabled": true,
    "intervalSeconds": 60
  }
  ```
- **Response 200 OK**: Updated heartbeat configuration.
