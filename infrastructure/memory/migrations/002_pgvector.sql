-- Optional: requires pgvector installed on the server and extension creation privileges.
-- If this migration fails, the pgvector extension is not available in this PostgreSQL instance.
-- Memory will still work with lexical-only retrieval; set MEMORY_VECTOR_ENABLED=false.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
-- Unconstrained dimensions allow embedding model migrations to coexist.
-- Generated projection cannot diverge from the canonical array on update/delete.
ALTER TABLE studio_memories ADD COLUMN embedding_vector vector GENERATED ALWAYS AS (embedding::vector) STORED;
CREATE INDEX studio_memories_embedding_metadata ON studio_memories (tenant_id, namespace_scope, namespace_id, embedding_provider, embedding_model, embedding_dimensions, embedding_version) WHERE embedding IS NOT NULL;
