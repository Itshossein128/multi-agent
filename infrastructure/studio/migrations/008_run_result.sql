ALTER TABLE studio_runs
  ADD COLUMN IF NOT EXISTS result jsonb;
