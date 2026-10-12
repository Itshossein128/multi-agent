-- Migration 007 (memory): worker claim function (US3 / T052, INV-7).
-- Durable memory jobs are claimed across organizations by the worker role and
-- executed strictly inside the job's own organization scope by the handler.

CREATE OR REPLACE FUNCTION studio_claim_memory_jobs(p_limit integer, p_worker text, p_lease_ms integer)
RETURNS SETOF studio_memory_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT id FROM studio_memory_jobs
    WHERE (status IN ('pending', 'failed') AND available_at <= now())
       OR (status = 'leased' AND lease_expires_at <= now())
    ORDER BY available_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 1), 100))
  )
  UPDATE studio_memory_jobs j
  SET status = 'leased',
      attempts = j.attempts + 1,
      leased_by = p_worker,
      lease_expires_at = now() + make_interval(secs => GREATEST(1, COALESCE(p_lease_ms, 30000)) / 1000.0),
      updated_at = now()
  FROM eligible
  WHERE j.id = eligible.id
  RETURNING j.*;
END;
$$;

DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION studio_claim_memory_jobs(integer, text, integer) TO studio_worker;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'studio_worker role missing; create it and grant claim execute manually (see 020_rls_prerequisites.sql)';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Insufficient privilege to grant claim function to studio_worker; grant manually';
END $$;
