-- Migration 013: Event Routines Hardening
-- Adds webhook delivery idempotency for safe replay protection and unique trigger dispatch constraint for runs.

ALTER TABLE studio_webhook_deliveries ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS studio_webhook_deliveries_accepted_replay
  ON studio_webhook_deliveries (trigger_id, idempotency_key)
  WHERE status = 'accepted' AND idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS studio_runs_trigger_dispatch_key
  ON studio_runs ((metadata->>'triggerDispatchKey'))
  WHERE metadata->>'triggerDispatchKey' IS NOT NULL;
