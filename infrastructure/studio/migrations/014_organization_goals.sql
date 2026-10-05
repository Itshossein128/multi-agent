CREATE TABLE IF NOT EXISTS studio_agent_reporting (
  tenant_id text NOT NULL,
  agent_id text NOT NULL,
  manager_agent_id text,
  role text NOT NULL CHECK (role IN ('ceo','manager','member')),
  PRIMARY KEY (tenant_id, agent_id),
  CHECK (agent_id IS DISTINCT FROM manager_agent_id),
  CHECK ((role = 'ceo' AND manager_agent_id IS NULL) OR (role <> 'ceo' AND manager_agent_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_agent_reporting_one_ceo ON studio_agent_reporting (tenant_id) WHERE role='ceo';
CREATE INDEX IF NOT EXISTS studio_agent_reporting_manager ON studio_agent_reporting (tenant_id, manager_agent_id);

CREATE TABLE IF NOT EXISTS studio_organization_goals (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('proposed','active','completed','cancelled')),
  parent_goal_id text,
  project_id text,
  owner_agent_id text,
  proposed_by_agent_id text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_organization_goals_tenant ON studio_organization_goals (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS studio_organization_goals_parent ON studio_organization_goals (tenant_id, parent_goal_id);
