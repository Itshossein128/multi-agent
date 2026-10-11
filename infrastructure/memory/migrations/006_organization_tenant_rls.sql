-- Memory: organization-tenant RLS prerequisites + optional scope index.
-- tenant_id is already NOT NULL on studio_memories / jobs from earlier migrations.

CREATE INDEX IF NOT EXISTS studio_memories_org_namespace
  ON studio_memories (tenant_id, namespace_scope, namespace_id);

CREATE OR REPLACE FUNCTION studio_memory_current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '');
$$;

DROP POLICY IF EXISTS studio_memories_tenant_select ON studio_memories;
DROP POLICY IF EXISTS studio_memories_tenant_insert ON studio_memories;
DROP POLICY IF EXISTS studio_memories_tenant_update ON studio_memories;
DROP POLICY IF EXISTS studio_memories_tenant_delete ON studio_memories;
CREATE POLICY studio_memories_tenant_select ON studio_memories
  FOR SELECT USING (tenant_id = studio_memory_current_tenant_id());
CREATE POLICY studio_memories_tenant_insert ON studio_memories
  FOR INSERT WITH CHECK (tenant_id = studio_memory_current_tenant_id());
CREATE POLICY studio_memories_tenant_update ON studio_memories
  FOR UPDATE USING (tenant_id = studio_memory_current_tenant_id())
  WITH CHECK (tenant_id = studio_memory_current_tenant_id());
CREATE POLICY studio_memories_tenant_delete ON studio_memories
  FOR DELETE USING (tenant_id = studio_memory_current_tenant_id());

DROP POLICY IF EXISTS studio_memory_jobs_tenant_select ON studio_memory_jobs;
DROP POLICY IF EXISTS studio_memory_jobs_tenant_insert ON studio_memory_jobs;
DROP POLICY IF EXISTS studio_memory_jobs_tenant_update ON studio_memory_jobs;
DROP POLICY IF EXISTS studio_memory_jobs_tenant_delete ON studio_memory_jobs;
CREATE POLICY studio_memory_jobs_tenant_select ON studio_memory_jobs
  FOR SELECT USING (tenant_id = studio_memory_current_tenant_id());
CREATE POLICY studio_memory_jobs_tenant_insert ON studio_memory_jobs
  FOR INSERT WITH CHECK (tenant_id = studio_memory_current_tenant_id());
CREATE POLICY studio_memory_jobs_tenant_update ON studio_memory_jobs
  FOR UPDATE USING (tenant_id = studio_memory_current_tenant_id())
  WITH CHECK (tenant_id = studio_memory_current_tenant_id());
CREATE POLICY studio_memory_jobs_tenant_delete ON studio_memory_jobs
  FOR DELETE USING (tenant_id = studio_memory_current_tenant_id());

ALTER TABLE studio_memories DISABLE ROW LEVEL SECURITY;
ALTER TABLE studio_memory_jobs DISABLE ROW LEVEL SECURITY;
