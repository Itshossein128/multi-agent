-- Migration 017: Organization → Project → Workspace hierarchy
-- Adds org profiles, project-owned workspaces, single project_id on tasks,
-- name_source, settings overrides, and repository / durable-state tables.

-- ---------------------------------------------------------------------------
-- 1. Organization profiles (id = tenant_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS studio_organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_organizations_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 120)
);

-- Backfill so existing tenants skip the first-run wizard.
INSERT INTO studio_organizations (id, name, description, config, owner_id, created_at, updated_at)
SELECT
  t.tenant_id,
  'Organization',
  '',
  '{}'::jsonb,
  COALESCE(
    (SELECT u.id FROM studio_users u WHERE u.tenant_id = t.tenant_id ORDER BY u.created_at ASC NULLS LAST, u.id LIMIT 1),
    (SELECT p.owner_id FROM studio_projects p WHERE p.tenant_id = t.tenant_id ORDER BY p.created_at ASC, p.id LIMIT 1),
    'system'
  ),
  now(),
  now()
FROM (
  SELECT DISTINCT tenant_id FROM studio_users WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM studio_projects WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM studio_tasks WHERE tenant_id IS NOT NULL
  UNION
  SELECT DISTINCT tenant_id FROM studio_workspaces WHERE tenant_id IS NOT NULL
) t
WHERE t.tenant_id IS NOT NULL
  AND t.tenant_id <> '_orphan'
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Project / workspace naming + workspace overrides
-- ---------------------------------------------------------------------------
ALTER TABLE studio_projects
  ADD COLUMN IF NOT EXISTS name_source text NOT NULL DEFAULT 'manual';

ALTER TABLE studio_projects
  DROP CONSTRAINT IF EXISTS studio_projects_name_source_check;
ALTER TABLE studio_projects
  ADD CONSTRAINT studio_projects_name_source_check
  CHECK (name_source IN ('placeholder', 'derived', 'manual'));

ALTER TABLE studio_workspaces
  ADD COLUMN IF NOT EXISTS name_source text NOT NULL DEFAULT 'manual';

ALTER TABLE studio_workspaces
  DROP CONSTRAINT IF EXISTS studio_workspaces_name_source_check;
ALTER TABLE studio_workspaces
  ADD CONSTRAINT studio_workspaces_name_source_check
  CHECK (name_source IN ('placeholder', 'derived', 'manual'));

ALTER TABLE studio_workspaces
  ADD COLUMN IF NOT EXISTS settings_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE studio_workspaces
  ADD COLUMN IF NOT EXISTS project_id text;

-- ---------------------------------------------------------------------------
-- 3. Task single project_id; backfill from junction; drop junction
-- ---------------------------------------------------------------------------
ALTER TABLE studio_tasks
  ADD COLUMN IF NOT EXISTS project_id text;

UPDATE studio_tasks t
SET project_id = sub.project_id
FROM (
  SELECT DISTINCT ON (tp.task_id) tp.task_id, tp.project_id
  FROM studio_task_projects tp
  ORDER BY tp.task_id, tp.project_id
) sub
WHERE t.id = sub.task_id
  AND t.project_id IS NULL;

-- Tasks still missing a project: attach to tenant default project or create Migrated.
INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id, name_source)
SELECT
  'project-migrated-' || COALESCE(t.tenant_id, '_orphan'),
  COALESCE(t.tenant_id, '_orphan'),
  'Migrated',
  'Created during hierarchy migration for tasks without a project',
  'active',
  '{}'::jsonb,
  now(),
  now(),
  COALESCE(
    (SELECT u.id FROM studio_users u WHERE u.tenant_id = t.tenant_id LIMIT 1),
    'system'
  ),
  'manual'
FROM studio_tasks t
WHERE t.project_id IS NULL
GROUP BY t.tenant_id
ON CONFLICT (id) DO NOTHING;

UPDATE studio_tasks t
SET project_id = 'project-migrated-' || COALESCE(t.tenant_id, '_orphan')
WHERE t.project_id IS NULL;

ALTER TABLE studio_tasks ALTER COLUMN project_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS studio_tasks_project
  ON studio_tasks (tenant_id, project_id, updated_at DESC);

DROP TABLE IF EXISTS studio_task_projects;

-- ---------------------------------------------------------------------------
-- 4. Backfill workspace.project_id from task usage (majority / first)
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    t.workspace_id,
    t.project_id,
    COUNT(*) AS cnt,
    ROW_NUMBER() OVER (
      PARTITION BY t.workspace_id
      ORDER BY COUNT(*) DESC, t.project_id ASC
    ) AS rn
  FROM studio_tasks t
  WHERE t.workspace_id IS NOT NULL
  GROUP BY t.workspace_id, t.project_id
)
UPDATE studio_workspaces w
SET project_id = ranked.project_id
FROM ranked
WHERE w.id = ranked.workspace_id
  AND ranked.rn = 1
  AND w.project_id IS NULL;

-- Remaining workspaces: first active project in tenant, or Migrated project.
UPDATE studio_workspaces w
SET project_id = COALESCE(
  (
    SELECT p.id FROM studio_projects p
    WHERE p.tenant_id = w.tenant_id AND p.status = 'active'
    ORDER BY p.created_at ASC, p.id
    LIMIT 1
  ),
  'project-migrated-' || w.tenant_id
)
WHERE w.project_id IS NULL;

INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id, name_source)
SELECT
  'project-migrated-' || w.tenant_id,
  w.tenant_id,
  'Migrated',
  'Created during hierarchy migration for orphan workspaces',
  'active',
  '{}'::jsonb,
  now(),
  now(),
  COALESCE(
    (SELECT u.id FROM studio_users u WHERE u.tenant_id = w.tenant_id LIMIT 1),
    'system'
  ),
  'manual'
FROM studio_workspaces w
WHERE w.project_id IS NULL
   OR (
     w.project_id = 'project-migrated-' || w.tenant_id
     AND NOT EXISTS (SELECT 1 FROM studio_projects p WHERE p.id = w.project_id)
   )
GROUP BY w.tenant_id
ON CONFLICT (id) DO NOTHING;

UPDATE studio_workspaces w
SET project_id = 'project-migrated-' || w.tenant_id
WHERE w.project_id IS NULL;

ALTER TABLE studio_workspaces ALTER COLUMN project_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS studio_workspaces_project
  ON studio_workspaces (tenant_id, project_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Default-workspace cutover: nullable workspace_id for seeded defaults
-- ---------------------------------------------------------------------------
-- Drop NOT NULL before nulling workspace_id (implicit default workspace).
ALTER TABLE studio_tasks ALTER COLUMN workspace_id DROP NOT NULL;

-- When a project only has the seeded "Default Workspace" (id workspace-default-*),
-- move its tasks to implicit default (NULL) and retire that workspace row.
UPDATE studio_tasks t
SET workspace_id = NULL
WHERE t.workspace_id LIKE 'workspace-default-%'
  AND EXISTS (
    SELECT 1 FROM studio_workspaces w
    WHERE w.id = t.workspace_id
      AND w.name = 'Default Workspace'
  )
  AND (
    SELECT COUNT(*) FROM studio_workspaces w2
    WHERE w2.project_id = t.project_id
      AND w2.status = 'active'
  ) = 1;

UPDATE studio_workspaces w
SET status = 'retired', updated_at = now()
WHERE w.id LIKE 'workspace-default-%'
  AND w.name = 'Default Workspace'
  AND NOT EXISTS (
    SELECT 1 FROM studio_tasks t WHERE t.workspace_id = w.id
  );

-- ---------------------------------------------------------------------------
-- 6. Repository + durable state tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS studio_project_repositories (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  source text NOT NULL,
  default_branch text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unavailable', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_project_repositories_project
  ON studio_project_repositories (tenant_id, project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS studio_workspace_repositories (
  workspace_id text NOT NULL,
  project_repository_id text NOT NULL,
  branch text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_repository_id)
);

CREATE INDEX IF NOT EXISTS studio_workspace_repositories_repo
  ON studio_workspace_repositories (project_repository_id);

CREATE TABLE IF NOT EXISTS studio_workspace_repo_states (
  tenant_id text NOT NULL,
  project_id text NOT NULL,
  workspace_id text,
  -- Empty string when workspace_id is null (implicit default workspace).
  workspace_key text NOT NULL DEFAULT '',
  project_repository_id text NOT NULL,
  branch text NOT NULL,
  storage_path text NOT NULL,
  has_uncommitted_changes boolean NOT NULL DEFAULT false,
  availability text NOT NULL DEFAULT 'ready'
    CHECK (availability IN ('ready', 'unavailable', 'branch_missing')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, project_id, project_repository_id, workspace_key)
);

CREATE INDEX IF NOT EXISTS studio_workspace_repo_states_project
  ON studio_workspace_repo_states (tenant_id, project_id, updated_at DESC);
