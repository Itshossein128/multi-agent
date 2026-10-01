-- A logical job identity is tenant-local.  Without tenant_id, two tenants
-- choosing the same external/run idempotency key could suppress each other.
DROP INDEX IF EXISTS studio_memory_jobs_identity;
CREATE UNIQUE INDEX IF NOT EXISTS studio_memory_jobs_identity
  ON studio_memory_jobs (tenant_id, job_kind, handler_version, idempotency_key);

-- Retention is an operator-scheduled bounded delete; this index makes it cheap
-- without coupling correctness to a local cleanup timer.
CREATE INDEX IF NOT EXISTS studio_memory_jobs_retention
  ON studio_memory_jobs (status, completed_at, updated_at)
  WHERE status IN ('completed', 'dead');
