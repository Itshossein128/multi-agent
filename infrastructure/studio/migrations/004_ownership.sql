-- Migration 004: Persisted ownership and tenant scope across all Studio entities and runs

-- Studio Workflows: personal resource
ALTER TABLE studio_workflows ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE studio_workflows ADD COLUMN IF NOT EXISTS tenant_id text;
CREATE INDEX IF NOT EXISTS studio_workflows_owner ON studio_workflows (tenant_id, owner_id, updated_at DESC);

-- Studio Agents: personal by default, tenant-scoped or system template
ALTER TABLE studio_agents ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE studio_agents ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE studio_agents ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS studio_agents_owner ON studio_agents (tenant_id, owner_id, updated_at DESC);

-- Studio Tools: personal by default, tenant-scoped or system tool
ALTER TABLE studio_tools ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE studio_tools ADD COLUMN IF NOT EXISTS tenant_id text;
ALTER TABLE studio_tools ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS studio_tools_owner ON studio_tools (tenant_id, owner_id, updated_at DESC);

-- Studio Tasks: tenant-scoped resource
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS tenant_id text;
CREATE INDEX IF NOT EXISTS studio_tasks_owner ON studio_tasks (tenant_id, owner_id, updated_at DESC);

-- Studio Runs: personal resource
ALTER TABLE studio_runs ADD COLUMN IF NOT EXISTS owner_id text;
ALTER TABLE studio_runs ADD COLUMN IF NOT EXISTS tenant_id text;
CREATE INDEX IF NOT EXISTS studio_runs_owner ON studio_runs (tenant_id, owner_id, started_at DESC);

-- Deterministic migration: populate owner_id and tenant_id from trustworthy persisted memory_owner metadata
UPDATE studio_runs
SET owner_id = memory_owner_principal_id, tenant_id = memory_owner_tenant_id
WHERE owner_id IS NULL AND memory_owner_principal_id IS NOT NULL AND memory_owner_tenant_id IS NOT NULL;
