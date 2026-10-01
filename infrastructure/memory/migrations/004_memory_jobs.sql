-- Phase 12: durable, additive coordination for memory maintenance work.
CREATE TABLE IF NOT EXISTS studio_memory_jobs (
  id uuid PRIMARY KEY,
  job_kind text NOT NULL CHECK (job_kind IN ('episodic_extraction','procedural_learning','consolidation')),
  handler_version integer NOT NULL DEFAULT 1 CHECK (handler_version > 0),
  idempotency_key text NOT NULL,
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  namespace_scope text NOT NULL CHECK (namespace_scope IN ('agent','workflow','project','organization','user')),
  namespace_id text NOT NULL CHECK (length(btrim(namespace_id)) > 0),
  run_id text, memory_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','completed','failed','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), available_at timestamptz NOT NULL DEFAULT now(),
  leased_by text, lease_expires_at timestamptz, last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  CHECK ((status = 'leased') = (leased_by IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_memory_jobs_identity ON studio_memory_jobs (job_kind, handler_version, idempotency_key);
CREATE INDEX IF NOT EXISTS studio_memory_jobs_claim ON studio_memory_jobs (status, available_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS studio_memory_jobs_scope ON studio_memory_jobs (tenant_id, namespace_scope, namespace_id, job_kind, status);
