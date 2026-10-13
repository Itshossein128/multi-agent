-- Migration 024: Enable and force Row Level Security across all organization-owned policy tables.
-- Activates RLS (T065 / T096 / F19 / D-10 / FR-114).

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
    'studio_organization_audit',
    'studio_organizations',
    'studio_agents',
    'studio_tools',
    'studio_agent_reporting',
    'studio_organization_goals',
    'studio_budgets',
    'studio_budget_reservations',
    'studio_budget_alerts',
    'studio_webhook_deliveries',
    'studio_agent_heartbeats'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- Cross-organization claims: ensure multi-row claim works cleanly with LIMIT > 1
CREATE OR REPLACE FUNCTION studio_claim_trigger_events(p_limit integer, p_worker text, p_lock_seconds integer)
RETURNS SETOF studio_trigger_events
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM studio_trigger_events
    WHERE (
        status IN ('pending', 'failed')
        OR (status = 'processing' AND locked_until IS NOT NULL AND locked_until <= now())
      )
      AND retry_count < max_retries
      AND (next_retry_at IS NULL OR next_retry_at <= now())
      AND (locked_until IS NULL OR locked_until <= now())
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

-- Role grants for studio_app and studio_worker
DO $$
DECLARE
  cur_usr text := current_user;
BEGIN
  -- Ensure roles exist
  BEGIN
    CREATE ROLE studio_app NOLOGIN NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    CREATE ROLE studio_worker NOLOGIN NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN insufficient_privilege THEN NULL;
  END;

  -- Grant roles to current user so connections/pools can SET ROLE
  BEGIN
    EXECUTE format('GRANT studio_app TO %I', cur_usr);
    EXECUTE format('GRANT studio_worker TO %I', cur_usr);
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Schema usage
  BEGIN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO studio_app, studio_worker';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Table permissions
  BEGIN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO studio_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO studio_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO studio_worker';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO studio_worker';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Function execution permissions for worker claims
  BEGIN
    EXECUTE 'GRANT EXECUTE ON FUNCTION studio_claim_trigger_events(integer, text, integer) TO studio_worker';
    EXECUTE 'GRANT EXECUTE ON FUNCTION studio_claim_routines(integer, text) TO studio_worker';
    EXECUTE 'GRANT EXECUTE ON FUNCTION studio_claim_heartbeats(integer, text) TO studio_worker';
  EXCEPTION WHEN undefined_function THEN NULL;
            WHEN insufficient_privilege THEN NULL;
  END;
END $$;
