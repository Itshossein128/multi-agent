-- Migration 016: Run Execution Leases for Multi-Instance Recovery
-- Adds execution ownership and heartbeat/lease expiry to prevent cross-replica recovery collisions.

ALTER TABLE studio_runs
  ADD COLUMN IF NOT EXISTS execution_owner_id text,
  ADD COLUMN IF NOT EXISTS execution_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS execution_heartbeat_at timestamptz;

CREATE INDEX IF NOT EXISTS studio_runs_active_leases
  ON studio_runs (status, execution_lease_expires_at)
  WHERE status IN ('queued', 'running', 'waiting_for_human');

CREATE INDEX IF NOT EXISTS studio_runs_execution_owner
  ON studio_runs (execution_owner_id)
  WHERE execution_owner_id IS NOT NULL;
