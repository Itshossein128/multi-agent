ALTER TABLE studio_runs
  ADD COLUMN IF NOT EXISTS procedural_memory_status text
    CHECK (procedural_memory_status IN ('pending', 'processed', 'failed'));

CREATE INDEX IF NOT EXISTS studio_runs_procedural_memory_pending
  ON studio_runs (updated_at DESC)
  WHERE procedural_memory_status IN ('pending', 'failed');
