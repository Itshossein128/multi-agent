-- Migration 020: RLS prerequisites (policies created, RLS NOT enabled).
-- Roles: create when the migrator has CREATEROLE; otherwise document manual creation.

DO $$
BEGIN
  BEGIN
    CREATE ROLE studio_migrator NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN insufficient_privilege THEN
              RAISE NOTICE 'Skipping CREATE ROLE studio_migrator (insufficient privilege); create manually if needed';
  END;
  BEGIN
    CREATE ROLE studio_app NOLOGIN NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN insufficient_privilege THEN
              RAISE NOTICE 'Skipping CREATE ROLE studio_app (insufficient privilege); create manually if needed';
  END;
  BEGIN
    CREATE ROLE studio_worker NOLOGIN NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN insufficient_privilege THEN
              RAISE NOTICE 'Skipping CREATE ROLE studio_worker (insufficient privilege); create manually if needed';
  END;
END $$;

-- Helper predicate: current tenant from session GUC.
-- Policies use current_setting('app.tenant_id', true).

CREATE OR REPLACE FUNCTION studio_current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '');
$$;

CREATE OR REPLACE FUNCTION studio_claim_trigger_events(p_limit integer, p_worker text, p_lock_seconds integer)
RETURNS SETOF studio_trigger_events
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM studio_trigger_events
    WHERE status = 'pending'
      AND (locked_until IS NULL OR locked_until < now())
      AND (next_retry_at IS NULL OR next_retry_at <= now())
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
  )
  UPDATE studio_trigger_events e
  SET status = 'processing',
      locked_by = p_worker,
      locked_until = now() + make_interval(secs => GREATEST(1, COALESCE(p_lock_seconds, 30))),
      updated_at = now()
  FROM picked
  WHERE e.id = picked.id
  RETURNING e.*;
END;
$$;

-- Tenant-owned tables: command-specific policies (RLS remains disabled until Phase 5).
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'studio_projects',
    'studio_workspaces',
    'studio_tasks',
    'studio_workflows',
    'studio_runs',
    'studio_run_events',
    'studio_approvals',
    'studio_task_comments',
    'studio_routines',
    'studio_routine_history',
    'studio_webhook_triggers',
    'studio_trigger_events',
    'studio_project_repositories',
    'studio_workspace_repositories',
    'studio_workspace_repo_states',
    'studio_organization_memberships',
    'studio_organization_audit'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_select', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_insert', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_update', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_delete', tbl);

    IF tbl = 'studio_organization_memberships' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT USING (organization_id = studio_current_tenant_id())',
        tbl || '_tenant_select', tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (organization_id = studio_current_tenant_id())',
        tbl || '_tenant_insert', tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR UPDATE USING (organization_id = studio_current_tenant_id()) WITH CHECK (organization_id = studio_current_tenant_id())',
        tbl || '_tenant_update', tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR DELETE USING (organization_id = studio_current_tenant_id())',
        tbl || '_tenant_delete', tbl
      );
    ELSIF tbl = 'studio_organization_audit' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT USING (organization_id = studio_current_tenant_id())',
        tbl || '_tenant_select', tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (organization_id = studio_current_tenant_id())',
        tbl || '_tenant_insert', tbl
      );
      -- no update/delete policies (append-only)
    ELSE
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = studio_current_tenant_id())',
        tbl || '_tenant_select', tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = studio_current_tenant_id())',
        tbl || '_tenant_insert', tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = studio_current_tenant_id()) WITH CHECK (tenant_id = studio_current_tenant_id())',
        tbl || '_tenant_update', tbl
      );
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR DELETE USING (tenant_id = studio_current_tenant_id())',
        tbl || '_tenant_delete', tbl
      );
    END IF;
  END LOOP;
END $$;

-- Organizations: id is the tenant key.
DROP POLICY IF EXISTS studio_organizations_tenant_select ON studio_organizations;
DROP POLICY IF EXISTS studio_organizations_tenant_insert ON studio_organizations;
DROP POLICY IF EXISTS studio_organizations_tenant_update ON studio_organizations;
DROP POLICY IF EXISTS studio_organizations_tenant_delete ON studio_organizations;
CREATE POLICY studio_organizations_tenant_select ON studio_organizations
  FOR SELECT USING (id = studio_current_tenant_id());
CREATE POLICY studio_organizations_tenant_insert ON studio_organizations
  FOR INSERT WITH CHECK (id = studio_current_tenant_id());
CREATE POLICY studio_organizations_tenant_update ON studio_organizations
  FOR UPDATE USING (id = studio_current_tenant_id()) WITH CHECK (id = studio_current_tenant_id());
CREATE POLICY studio_organizations_tenant_delete ON studio_organizations
  FOR DELETE USING (id = studio_current_tenant_id());

-- Agents/tools: SELECT allows system rows; mutations require non-system + tenant match.
DROP POLICY IF EXISTS studio_agents_tenant_select ON studio_agents;
DROP POLICY IF EXISTS studio_agents_tenant_insert ON studio_agents;
DROP POLICY IF EXISTS studio_agents_tenant_update ON studio_agents;
DROP POLICY IF EXISTS studio_agents_tenant_delete ON studio_agents;
CREATE POLICY studio_agents_tenant_select ON studio_agents
  FOR SELECT USING (is_system OR tenant_id = studio_current_tenant_id());
CREATE POLICY studio_agents_tenant_insert ON studio_agents
  FOR INSERT WITH CHECK (NOT is_system AND tenant_id = studio_current_tenant_id());
CREATE POLICY studio_agents_tenant_update ON studio_agents
  FOR UPDATE USING (NOT is_system AND tenant_id = studio_current_tenant_id())
  WITH CHECK (NOT is_system AND tenant_id = studio_current_tenant_id());
CREATE POLICY studio_agents_tenant_delete ON studio_agents
  FOR DELETE USING (NOT is_system AND tenant_id = studio_current_tenant_id());

DROP POLICY IF EXISTS studio_tools_tenant_select ON studio_tools;
DROP POLICY IF EXISTS studio_tools_tenant_insert ON studio_tools;
DROP POLICY IF EXISTS studio_tools_tenant_update ON studio_tools;
DROP POLICY IF EXISTS studio_tools_tenant_delete ON studio_tools;
CREATE POLICY studio_tools_tenant_select ON studio_tools
  FOR SELECT USING (is_system OR tenant_id = studio_current_tenant_id());
CREATE POLICY studio_tools_tenant_insert ON studio_tools
  FOR INSERT WITH CHECK (NOT is_system AND tenant_id = studio_current_tenant_id());
CREATE POLICY studio_tools_tenant_update ON studio_tools
  FOR UPDATE USING (NOT is_system AND tenant_id = studio_current_tenant_id())
  WITH CHECK (NOT is_system AND tenant_id = studio_current_tenant_id());
CREATE POLICY studio_tools_tenant_delete ON studio_tools
  FOR DELETE USING (NOT is_system AND tenant_id = studio_current_tenant_id());

-- Explicitly leave RLS disabled (Phase 5 enables FORCE).
ALTER TABLE studio_organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE studio_organization_memberships DISABLE ROW LEVEL SECURITY;
ALTER TABLE studio_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE studio_agents DISABLE ROW LEVEL SECURITY;
ALTER TABLE studio_tools DISABLE ROW LEVEL SECURITY;
