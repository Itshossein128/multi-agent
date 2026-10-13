-- Migration 023: Complete RLS prerequisites for omitted organization tables (T087 / F7).
-- Adds command-specific policies for:
--   studio_agent_reporting
--   studio_organization_goals
--   studio_budgets
--   studio_budget_reservations
--   studio_budget_alerts
--   studio_webhook_deliveries
--   studio_agent_heartbeats
--   studio_task_projects
-- RLS remains disabled until Phase 5 (T065/T069).

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'studio_agent_reporting',
    'studio_organization_goals',
    'studio_budgets',
    'studio_budget_reservations',
    'studio_budget_alerts',
    'studio_webhook_deliveries',
    'studio_agent_heartbeats',
    'studio_task_projects'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_select', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_insert', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_update', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_tenant_delete', tbl);

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

    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- Explicit worker claim privileges:
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION studio_claim_trigger_events(integer, text, integer) TO studio_worker;
  GRANT EXECUTE ON FUNCTION studio_claim_routines(integer, text) TO studio_worker;
  GRANT EXECUTE ON FUNCTION studio_claim_heartbeats(integer, text) TO studio_worker;
EXCEPTION
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN insufficient_privilege THEN NULL;
END $$;
