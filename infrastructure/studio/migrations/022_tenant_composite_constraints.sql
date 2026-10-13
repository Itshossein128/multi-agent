-- Migration 022: Tenant-qualified parent/child composite foreign keys (T086 / F6).
-- Completes composite FK coverage omitted from 019: goal→project, goal→parent_goal,
-- repository→project, workspace_repo→workspace, workspace_repo→repo, repo_state→repo/workspace.

-- 1. Organization goals: goal→project and goal→parent_goal (nullable FKs via MATCH SIMPLE).
CREATE UNIQUE INDEX IF NOT EXISTS studio_organization_goals_tenant_id_uidx
  ON studio_organization_goals (tenant_id, id);

ALTER TABLE studio_organization_goals DROP CONSTRAINT IF EXISTS studio_organization_goals_project_tenant_fk;
ALTER TABLE studio_organization_goals
  ADD CONSTRAINT studio_organization_goals_project_tenant_fk
  FOREIGN KEY (tenant_id, project_id) REFERENCES studio_projects (tenant_id, id);

ALTER TABLE studio_organization_goals DROP CONSTRAINT IF EXISTS studio_organization_goals_parent_tenant_fk;
ALTER TABLE studio_organization_goals
  ADD CONSTRAINT studio_organization_goals_parent_tenant_fk
  FOREIGN KEY (tenant_id, parent_goal_id) REFERENCES studio_organization_goals (tenant_id, id);

-- 2. Project repositories: repo→project.
CREATE UNIQUE INDEX IF NOT EXISTS studio_project_repositories_tenant_id_uidx
  ON studio_project_repositories (tenant_id, id);

ALTER TABLE studio_project_repositories DROP CONSTRAINT IF EXISTS studio_project_repositories_project_tenant_fk;
ALTER TABLE studio_project_repositories
  ADD CONSTRAINT studio_project_repositories_project_tenant_fk
  FOREIGN KEY (tenant_id, project_id) REFERENCES studio_projects (tenant_id, id);

-- 3. Workspace repositories: workspace_repo→workspace and workspace_repo→project_repository.
ALTER TABLE studio_workspace_repositories DROP CONSTRAINT IF EXISTS studio_workspace_repositories_workspace_tenant_fk;
ALTER TABLE studio_workspace_repositories
  ADD CONSTRAINT studio_workspace_repositories_workspace_tenant_fk
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES studio_workspaces (tenant_id, id);

ALTER TABLE studio_workspace_repositories DROP CONSTRAINT IF EXISTS studio_workspace_repositories_project_repo_tenant_fk;
ALTER TABLE studio_workspace_repositories
  ADD CONSTRAINT studio_workspace_repositories_project_repo_tenant_fk
  FOREIGN KEY (tenant_id, project_repository_id) REFERENCES studio_project_repositories (tenant_id, id);

-- 4. Workspace repository states: repo_state→project_repository and repo_state→workspace (nullable).
ALTER TABLE studio_workspace_repo_states DROP CONSTRAINT IF EXISTS studio_workspace_repo_states_repo_tenant_fk;
ALTER TABLE studio_workspace_repo_states
  ADD CONSTRAINT studio_workspace_repo_states_repo_tenant_fk
  FOREIGN KEY (tenant_id, project_repository_id) REFERENCES studio_project_repositories (tenant_id, id);

ALTER TABLE studio_workspace_repo_states DROP CONSTRAINT IF EXISTS studio_workspace_repo_states_workspace_tenant_fk;
ALTER TABLE studio_workspace_repo_states
  ADD CONSTRAINT studio_workspace_repo_states_workspace_tenant_fk
  FOREIGN KEY (tenant_id, workspace_id) REFERENCES studio_workspaces (tenant_id, id);
