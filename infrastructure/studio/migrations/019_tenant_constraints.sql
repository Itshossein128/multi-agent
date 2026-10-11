-- Migration 019: Strict tenant constraints on a clean (post-reset) database.

-- Backfill tenant_id onto run events / approvals / workspace repositories from parents when present.
ALTER TABLE studio_run_events ADD COLUMN IF NOT EXISTS tenant_id text;
UPDATE studio_run_events e
SET tenant_id = r.tenant_id
FROM studio_runs r
WHERE e.run_id = r.id AND e.tenant_id IS NULL AND r.tenant_id IS NOT NULL;

ALTER TABLE studio_approvals ADD COLUMN IF NOT EXISTS tenant_id text;
UPDATE studio_approvals a
SET tenant_id = r.tenant_id
FROM studio_runs r
WHERE a.run_id = r.id AND a.tenant_id IS NULL AND r.tenant_id IS NOT NULL;

ALTER TABLE studio_workspace_repositories ADD COLUMN IF NOT EXISTS tenant_id text;
UPDATE studio_workspace_repositories wr
SET tenant_id = w.tenant_id
FROM studio_workspaces w
WHERE wr.workspace_id = w.id AND wr.tenant_id IS NULL;

-- Org-owned tables: NOT NULL tenant_id (empty DB / reset assumed).
ALTER TABLE studio_workflows ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE studio_tasks ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE studio_runs ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE studio_run_events ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE studio_approvals ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE studio_workspace_repositories ALTER COLUMN tenant_id SET NOT NULL;

-- Agents/tools: system rows may have NULL tenant_id; non-system must have tenant_id.
ALTER TABLE studio_agents ALTER COLUMN is_system SET DEFAULT false;
ALTER TABLE studio_agents ALTER COLUMN is_system SET NOT NULL;
ALTER TABLE studio_tools ALTER COLUMN is_system SET DEFAULT false;
ALTER TABLE studio_tools ALTER COLUMN is_system SET NOT NULL;

ALTER TABLE studio_agents DROP CONSTRAINT IF EXISTS studio_agents_tenant_system_check;
ALTER TABLE studio_agents ADD CONSTRAINT studio_agents_tenant_system_check
  CHECK ((is_system AND tenant_id IS NULL) OR (NOT is_system AND tenant_id IS NOT NULL));

ALTER TABLE studio_tools DROP CONSTRAINT IF EXISTS studio_tools_tenant_system_check;
ALTER TABLE studio_tools ADD CONSTRAINT studio_tools_tenant_system_check
  CHECK ((is_system AND tenant_id IS NULL) OR (NOT is_system AND tenant_id IS NOT NULL));

-- Tenant-qualified uniqueness for FK targets (id remains PK).
CREATE UNIQUE INDEX IF NOT EXISTS studio_projects_tenant_id_uidx ON studio_projects (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS studio_workspaces_tenant_id_uidx ON studio_workspaces (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS studio_tasks_tenant_id_uidx ON studio_tasks (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS studio_organizations_tenant_id_uidx ON studio_organizations (id);
CREATE UNIQUE INDEX IF NOT EXISTS studio_runs_tenant_id_uidx ON studio_runs (tenant_id, id);

-- Composite parent/child consistency (idempotent drop/add).
ALTER TABLE studio_workspaces DROP CONSTRAINT IF EXISTS studio_workspaces_project_tenant_fk;
ALTER TABLE studio_workspaces
  ADD CONSTRAINT studio_workspaces_project_tenant_fk
  FOREIGN KEY (tenant_id, project_id) REFERENCES studio_projects (tenant_id, id);

ALTER TABLE studio_tasks DROP CONSTRAINT IF EXISTS studio_tasks_project_tenant_fk;
ALTER TABLE studio_tasks
  ADD CONSTRAINT studio_tasks_project_tenant_fk
  FOREIGN KEY (tenant_id, project_id) REFERENCES studio_projects (tenant_id, id);

ALTER TABLE studio_task_comments DROP CONSTRAINT IF EXISTS studio_task_comments_task_tenant_fk;
ALTER TABLE studio_task_comments
  ADD CONSTRAINT studio_task_comments_task_tenant_fk
  FOREIGN KEY (tenant_id, task_id) REFERENCES studio_tasks (tenant_id, id);

ALTER TABLE studio_organization_memberships DROP CONSTRAINT IF EXISTS studio_organization_memberships_org_fk;
-- PK already references organizations(id); keep organization_id aligned with org key.
ALTER TABLE studio_organization_memberships
  DROP CONSTRAINT IF EXISTS studio_organization_memberships_organization_id_fkey;
ALTER TABLE studio_organization_memberships
  ADD CONSTRAINT studio_organization_memberships_organization_id_fkey
  FOREIGN KEY (organization_id) REFERENCES studio_organizations (id) ON DELETE CASCADE;

ALTER TABLE studio_workspace_repo_states DROP CONSTRAINT IF EXISTS studio_workspace_repo_states_project_tenant_fk;
ALTER TABLE studio_workspace_repo_states
  ADD CONSTRAINT studio_workspace_repo_states_project_tenant_fk
  FOREIGN KEY (tenant_id, project_id) REFERENCES studio_projects (tenant_id, id);

-- Goals may have null project_id; only enforce when set via trigger-like CHECK is harder —
-- add composite FK only when project_id is NOT NULL using a partial approach is not supported
-- for FKs; leave goal→project to application validation (Phase 0.5 requireActiveProject).

-- Tenant-qualified trigger dispatch uniqueness (replace global unique index).
DROP INDEX IF EXISTS studio_runs_trigger_dispatch_key;
CREATE UNIQUE INDEX IF NOT EXISTS studio_runs_trigger_dispatch_key
  ON studio_runs (tenant_id, (metadata->>'triggerDispatchKey'))
  WHERE metadata->>'triggerDispatchKey' IS NOT NULL;
