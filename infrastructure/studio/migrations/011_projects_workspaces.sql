-- Migration 011: First-class Projects & Workspaces
-- Adds studio_projects, studio_workspaces, task associations, and backfills defaults.

CREATE TABLE IF NOT EXISTS studio_projects (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_id text NOT NULL
);

CREATE INDEX IF NOT EXISTS studio_projects_tenant_status
  ON studio_projects (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS studio_projects_tenant_name
  ON studio_projects (tenant_id, name);

CREATE TABLE IF NOT EXISTS studio_workspaces (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_id text NOT NULL
);

CREATE INDEX IF NOT EXISTS studio_workspaces_tenant_status
  ON studio_workspaces (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS studio_workspaces_tenant_name
  ON studio_workspaces (tenant_id, name);

-- Backfill default project/workspace for every tenant that already has tasks or users.
WITH tenants AS (
  SELECT DISTINCT tenant_id FROM studio_tasks WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM studio_users WHERE tenant_id IS NOT NULL
),
ins_projects AS (
  INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id)
  SELECT
    'project-default-' || tenant_id,
    tenant_id,
    'Default Project',
    '',
    'active',
    '{}'::jsonb,
    now(),
    now(),
    COALESCE(
      (SELECT owner_id FROM studio_tasks t WHERE t.tenant_id = tenants.tenant_id AND t.owner_id IS NOT NULL LIMIT 1),
      (SELECT id FROM studio_users u WHERE u.tenant_id = tenants.tenant_id LIMIT 1),
      'system'
    )
  FROM tenants
  ON CONFLICT (id) DO NOTHING
  RETURNING tenant_id
),
ins_workspaces AS (
  INSERT INTO studio_workspaces (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id)
  SELECT
    'workspace-default-' || tenant_id,
    tenant_id,
    'Default Workspace',
    '',
    'active',
    '{}'::jsonb,
    now(),
    now(),
    COALESCE(
      (SELECT owner_id FROM studio_tasks t WHERE t.tenant_id = tenants.tenant_id AND t.owner_id IS NOT NULL LIMIT 1),
      (SELECT id FROM studio_users u WHERE u.tenant_id = tenants.tenant_id LIMIT 1),
      'system'
    )
  FROM tenants
  ON CONFLICT (id) DO NOTHING
  RETURNING tenant_id
)
SELECT 1;

ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS workspace_id text;

UPDATE studio_tasks
SET workspace_id = 'workspace-default-' || tenant_id
WHERE workspace_id IS NULL AND tenant_id IS NOT NULL;

-- Tasks without tenant get a synthetic shared default workspace row if needed.
INSERT INTO studio_workspaces (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id)
SELECT 'workspace-default-orphan', '_orphan', 'Default Workspace', '', 'active', '{}'::jsonb, now(), now(), 'system'
WHERE EXISTS (SELECT 1 FROM studio_tasks WHERE workspace_id IS NULL)
ON CONFLICT (id) DO NOTHING;

UPDATE studio_tasks
SET workspace_id = 'workspace-default-orphan'
WHERE workspace_id IS NULL;

ALTER TABLE studio_tasks ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS studio_tasks_workspace
  ON studio_tasks (tenant_id, workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS studio_task_projects (
  tenant_id text NOT NULL,
  task_id text NOT NULL REFERENCES studio_tasks(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  PRIMARY KEY (task_id, project_id)
);

CREATE INDEX IF NOT EXISTS studio_task_projects_project
  ON studio_task_projects (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS studio_task_projects_task
  ON studio_task_projects (tenant_id, task_id);

INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id)
SELECT 'project-default-orphan', '_orphan', 'Default Project', '', 'active', '{}'::jsonb, now(), now(), 'system'
WHERE EXISTS (
  SELECT 1 FROM studio_tasks t
  WHERE NOT EXISTS (SELECT 1 FROM studio_task_projects tp WHERE tp.task_id = t.id)
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO studio_task_projects (tenant_id, task_id, project_id)
SELECT
  COALESCE(t.tenant_id, '_orphan'),
  t.id,
  CASE
    WHEN t.tenant_id IS NOT NULL THEN 'project-default-' || t.tenant_id
    ELSE 'project-default-orphan'
  END
FROM studio_tasks t
WHERE NOT EXISTS (SELECT 1 FROM studio_task_projects tp WHERE tp.task_id = t.id)
ON CONFLICT DO NOTHING;
