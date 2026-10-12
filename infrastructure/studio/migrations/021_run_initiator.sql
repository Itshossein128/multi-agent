-- Migration 021: US3 execution & background isolation (plan Phase 3 / tasks T048, T052).
-- Additive only: initiator audit columns on runs + SECURITY DEFINER worker claim
-- functions so a least-privileged role can claim work across organizations while
-- handlers execute inside one organization scope (INV-7).

ALTER TABLE studio_runs ADD COLUMN IF NOT EXISTS initiator_kind text;
ALTER TABLE studio_runs ADD COLUMN IF NOT EXISTS membership_version_at_start integer;

DO $$
BEGIN
  ALTER TABLE studio_runs DROP CONSTRAINT IF EXISTS studio_runs_initiator_kind_check;
  ALTER TABLE studio_runs ADD CONSTRAINT studio_runs_initiator_kind_check
    CHECK (initiator_kind IS NULL OR initiator_kind IN ('user', 'service', 'schedule', 'trigger'));
EXCEPTION
  WHEN invalid_parameter_value THEN NULL;
  WHEN insufficient_privilege THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS studio_runs_initiator
  ON studio_runs (tenant_id, initiator_kind)
  WHERE initiator_kind IS NOT NULL;

-- Cross-organization claims (INV-7): workers claim without a tenant GUC and
-- handlers then execute each item strictly within the item's organization.

CREATE OR REPLACE FUNCTION studio_claim_trigger_events(p_limit integer, p_worker text, p_lock_seconds integer)
RETURNS SETOF studio_trigger_events
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE studio_trigger_events e
  SET status = 'processing',
      locked_by = p_worker,
      locked_until = now() + make_interval(secs => GREATEST(1, COALESCE(p_lock_seconds, 30))),
      updated_at = now()
  WHERE e.id = (
    SELECT id FROM studio_trigger_events
    WHERE (
        status IN ('pending', 'failed')
        OR (status = 'processing' AND locked_until IS NOT NULL AND locked_until <= now())
      )
      AND retry_count < max_retries
      AND (next_retry_at IS NULL OR next_retry_at <= now())
      AND (locked_until IS NULL OR locked_until <= now())
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1), 100))
  )
  RETURNING e.*;
END;
$$;

CREATE OR REPLACE FUNCTION studio_claim_routines(p_limit integer, p_worker text)
RETURNS SETOF studio_routines
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- p_worker is part of the claim contract for parity with the other claim
  -- functions; routine dispatch is idempotent by (tenant_id, idempotency_key).
  RETURN QUERY
    SELECT * FROM studio_routines
    WHERE enabled = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= now()
    ORDER BY next_run_at ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 100));
END;
$$;

CREATE OR REPLACE FUNCTION studio_claim_heartbeats(p_limit integer, p_worker text)
RETURNS SETOF studio_agent_heartbeats
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE studio_agent_heartbeats h
  SET locked_by = p_worker,
      locked_until = now() + interval '60 seconds'
  WHERE (h.tenant_id, h.agent_id) IN (
    SELECT tenant_id, agent_id
    FROM studio_agent_heartbeats
    WHERE enabled = true
      AND next_heartbeat_at IS NOT NULL
      AND next_heartbeat_at <= now()
      AND (locked_until IS NULL OR locked_until <= now())
    ORDER BY next_heartbeat_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
  )
  RETURNING h.*;
END;
$$;

DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION studio_claim_trigger_events(integer, text, integer) TO studio_worker;
  GRANT EXECUTE ON FUNCTION studio_claim_routines(integer, text) TO studio_worker;
  GRANT EXECUTE ON FUNCTION studio_claim_heartbeats(integer, text) TO studio_worker;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'studio_worker role missing; create it and grant claim execute manually (see 020_rls_prerequisites.sql)';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to grant claim functions to studio_worker; grant manually';
END $$;
