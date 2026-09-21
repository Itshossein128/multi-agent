ALTER TABLE studio_runs
  ADD COLUMN IF NOT EXISTS tools_snapshot jsonb;
