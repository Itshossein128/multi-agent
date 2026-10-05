# Quickstart Guide: 005-event-routines-triggers

This guide demonstrates setting up continuous automatic agent work with durable event triggers, agent heartbeats, recurring routines, and authenticated webhooks.

---

## 1. Apply Database Migrations

Run Studio migrations to create the required tables:
```bash
STUDIO_DATABASE_URL="postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory" node infrastructure/studio/migrate.cjs
```
This applies `012_event_routines_triggers.sql` creating `studio_task_comments`, `studio_trigger_events`, `studio_routines`, `studio_routine_history`, `studio_webhook_triggers`, `studio_webhook_deliveries`, and `studio_agent_heartbeats`.

---

## 2. Event-Driven Agent Wakeup

### Assign a Task
When you assign a task to an agent via API or task board:
```bash
curl -X PATCH http://localhost:4000/api/studio/tasks/task-1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assignedAgent": "agent-researcher", "status": "ready"}'
```
The durable outbox enqueues an assignment trigger event. The background processor leases the event and starts the single-agent workflow automatically.

### Post a Comment with Mentions
Post a comment mentioning an agent:
```bash
curl -X POST http://localhost:4000/api/studio/tasks/task-1/comments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Please verify findings @agent-reviewer"}'
```
Agent `agent-reviewer` wakes up. If `agent-reviewer` replies with another comment, self-comment loop suppression prevents recursive execution.

---

## 3. Configure Recurring Routines

Create a routine that triggers an agent workflow every morning at 09:00 UTC:
```bash
curl -X POST http://localhost:4000/api/studio/routines \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Morning Summary",
    "scheduleType": "cron",
    "scheduleExpr": "0 9 * * *",
    "timezone": "UTC",
    "targetType": "workflow",
    "targetId": "wf-daily-digest",
    "misfirePolicy": "skip"
  }'
```

---

## 4. Inbound Webhook Triggers

Create a webhook trigger and obtain its signing secret:
```bash
curl -X POST http://localhost:4000/api/studio/webhooks/triggers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "GitHub CI Hook", "targetType": "workflow", "targetId": "wf-ci-eval"}'
```
Save the returned `signingSecret`.

Sign and post a payload to the trigger:
```bash
PAYLOAD='{"commit": "a1b2c3d", "branch": "main"}'
TIMESTAMP=$(date +%s)
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -X POST http://localhost:4000/api/webhooks/triggers/$TRIGGER_ID \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: sha256=$SIGNATURE" \
  -H "X-Webhook-Timestamp: $TIMESTAMP" \
  -d "$PAYLOAD"
```
The endpoint verifies HMAC authenticity and timestamp freshness before enqueuing a trigger event.
