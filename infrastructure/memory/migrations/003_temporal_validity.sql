-- Phase 11: record time (created_at/updated_at) remains separate from semantic valid time.
-- Intervals are half-open: valid_from is inclusive; valid_until is exclusive.
ALTER TABLE studio_memories
  ADD COLUMN IF NOT EXISTS replaces_memory_id text,
  ADD COLUMN IF NOT EXISTS replaced_by_memory_id text,
  ADD COLUMN IF NOT EXISTS valid_from timestamptz,
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS temporal_scope text,
  ADD COLUMN IF NOT EXISTS transition jsonb;

ALTER TABLE studio_memories
  DROP CONSTRAINT IF EXISTS studio_memories_valid_interval,
  ADD CONSTRAINT studio_memories_valid_interval CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
  DROP CONSTRAINT IF EXISTS studio_memories_temporal_scope,
  ADD CONSTRAINT studio_memories_temporal_scope CHECK (temporal_scope IS NULL OR temporal_scope IN ('current','historical','future','unknown'));

-- Scoped temporal access is the likely production pattern. This remains a B-tree
-- companion to, and does not alter, the pgvector index/search path.
CREATE INDEX IF NOT EXISTS studio_memories_temporal_scope_idx
  ON studio_memories (tenant_id, namespace_scope, namespace_id, kind, valid_from, valid_until)
  WHERE kind = 'semantic' AND status = 'active';

COMMENT ON COLUMN studio_memories.valid_from IS 'Inclusive semantic valid-time boundary; unrelated to created_at';
COMMENT ON COLUMN studio_memories.valid_until IS 'Exclusive semantic valid-time boundary; NULL means open-ended';
