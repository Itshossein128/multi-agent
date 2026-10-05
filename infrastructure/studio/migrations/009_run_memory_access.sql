ALTER TABLE studio_runs
  ADD COLUMN IF NOT EXISTS memory_access jsonb;

ALTER TABLE studio_runs
  ADD COLUMN IF NOT EXISTS episodic_memory_status text
    CHECK (episodic_memory_status IN ('pending', 'processed', 'failed'));

CREATE INDEX IF NOT EXISTS studio_runs_episodic_memory_pending
  ON studio_runs (updated_at DESC)
  WHERE episodic_memory_status IN ('pending', 'failed');
