CREATE TABLE studio_memories (
  tenant_id text NOT NULL CHECK (length(btrim(tenant_id)) > 0),
  id text NOT NULL CHECK (length(id) > 0),
  namespace_scope text NOT NULL CHECK (namespace_scope IN ('agent','workflow','project','organization','user')),
  namespace_id text NOT NULL CHECK (length(btrim(namespace_id)) > 0),
  kind text NOT NULL CHECK (kind IN ('semantic','episodic','procedural')),
  visibility text NOT NULL CHECK (visibility IN ('private','workflow','project','organization','shared')),
  content text NOT NULL, subject text, structured_data jsonb,
  situation text, action text, result text, lesson text, success boolean,
  title text, procedure text, trigger text,
  importance double precision NOT NULL CHECK (importance BETWEEN 0 AND 1),
  confidence double precision CHECK (confidence BETWEEN 0 AND 1),
  source jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active','superseded','archived')),
  supersedes_memory_id text, superseded_by_memory_id text,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, expires_at timestamptz,
  embedding double precision[], embedding_provider text, embedding_model text,
  embedding_dimensions integer, embedding_version text,
  metadata jsonb, idempotency_key text, content_hash text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  last_accessed_at timestamptz, access_count integer CHECK (access_count >= 0),
  reinforcement_count integer CHECK (reinforcement_count >= 0),
  PRIMARY KEY (tenant_id, id),
  CHECK (embedding IS NULL OR (embedding_provider IS NOT NULL AND embedding_model IS NOT NULL AND embedding_version IS NOT NULL AND embedding_dimensions > 0 AND cardinality(embedding) = embedding_dimensions))
);
CREATE UNIQUE INDEX studio_memories_idempotency ON studio_memories (tenant_id, namespace_scope, namespace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX studio_memories_scope ON studio_memories (tenant_id, namespace_scope, namespace_id, status, kind, updated_at DESC, id);
CREATE INDEX studio_memories_content_hash ON studio_memories (tenant_id, namespace_scope, namespace_id, content_hash);
CREATE INDEX studio_memories_subject ON studio_memories (tenant_id, namespace_scope, namespace_id, subject) WHERE subject IS NOT NULL;
CREATE INDEX studio_memories_expiration ON studio_memories (tenant_id, namespace_scope, namespace_id, expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX studio_memories_metadata ON studio_memories USING gin (metadata jsonb_path_ops);
CREATE INDEX studio_memories_source_agent ON studio_memories (tenant_id, (source->>'agentId'));
CREATE INDEX studio_memories_source_workflow ON studio_memories (tenant_id, (source->>'workflowId'));
