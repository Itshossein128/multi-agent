-- Narrow cross-organization discovery. Callers pass the authenticated account id,
-- never a user id from a browser body. Ordinary table access stays tenant-scoped.
DO $migration$
BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION studio_user_organizations(p_user text) RETURNS SETOF studio_organizations
    LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $body$
      SELECT o.* FROM studio_organizations o
      JOIN studio_organization_memberships m ON m.organization_id=o.id
      JOIN studio_users u ON u.id=m.user_id
      WHERE m.user_id=p_user AND m.status='active' AND u.status='active' AND o.status='active'
      ORDER BY o.name,o.id
    $body$
  $ddl$, current_schema());
  EXECUTE format($ddl$
    CREATE FUNCTION studio_user_invitations(p_user text) RETURNS SETOF studio_organization_memberships
    LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $body$
      SELECT m.* FROM studio_organization_memberships m
      JOIN studio_organizations o ON o.id=m.organization_id
      JOIN studio_users u ON u.id=m.user_id
      WHERE m.user_id=p_user AND m.status='invited' AND u.status='active' AND o.status='active'
      ORDER BY m.created_at,m.organization_id
    $body$
  $ddl$, current_schema());
  EXECUTE format($ddl$
    CREATE FUNCTION studio_pending_organization_purges() RETURNS TABLE(organization_id text)
    LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $body$
      SELECT id FROM studio_organizations WHERE status='deleting' ORDER BY id
    $body$
  $ddl$, current_schema());
  -- LangGraph persists outside the tenant-aware stores. Its thread id is the
  -- durable run id; lock the parent so deletion and late checkpoint writes
  -- cannot pass each other. Installed on checkpoint tables at saver setup.
  EXECUTE format($ddl$
    CREATE FUNCTION studio_fence_checkpoint_write() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, %I, pg_temp AS $body$
    DECLARE tenant text; org_status text;
    BEGIN
      SELECT tenant_id INTO tenant FROM studio_runs WHERE id=NEW.thread_id FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Checkpoint run does not exist'; END IF;
      SELECT status INTO org_status FROM studio_organizations WHERE id=tenant FOR SHARE;
      IF org_status IS NOT NULL AND org_status <> 'active'
         OR EXISTS(SELECT 1 FROM studio_deleted_organizations WHERE id=tenant) THEN
        RAISE EXCEPTION 'Checkpoint organization is deleting or deleted';
      END IF;
      RETURN NEW;
    END;
    $body$
  $ddl$, current_schema());
  REVOKE ALL ON FUNCTION studio_user_organizations(text),studio_user_invitations(text),studio_pending_organization_purges() FROM PUBLIC;
  REVOKE ALL ON FUNCTION studio_fence_checkpoint_write() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION studio_user_organizations(text),studio_user_invitations(text) TO studio_app;
  GRANT EXECUTE ON FUNCTION studio_pending_organization_purges() TO studio_worker;
  GRANT EXECUTE ON FUNCTION studio_fence_checkpoint_write() TO studio_worker;
END
$migration$;
