-- Worker discovery returns only tenant identities. Every recovery read/write is
-- subsequently executed with that tenant's RLS context on the application pool.
DO $migration$
BEGIN
  EXECUTE format($ddl$
    CREATE OR REPLACE FUNCTION studio_recovery_organizations() RETURNS TABLE(tenant_id text)
    LANGUAGE sql SECURITY DEFINER SET search_path = %I, pg_catalog
    AS $body$
      SELECT DISTINCT tenant_id FROM studio_runs WHERE tenant_id IS NOT NULL
      UNION SELECT DISTINCT tenant_id FROM studio_budget_reservations WHERE settled_at IS NULL
    $body$
  $ddl$, current_schema());
  REVOKE ALL ON FUNCTION studio_recovery_organizations() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION studio_recovery_organizations() TO studio_worker;
END
$migration$;
