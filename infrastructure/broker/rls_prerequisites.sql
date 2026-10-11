-- Broker lease RLS prerequisites (policies created; RLS not enabled).
-- Audit remains service-only (no tenant policies that expose rows to app roles).

CREATE OR REPLACE FUNCTION broker_current_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '');
$$;

DROP POLICY IF EXISTS credential_broker_leases_tenant_select ON credential_broker_leases;
DROP POLICY IF EXISTS credential_broker_leases_tenant_insert ON credential_broker_leases;
DROP POLICY IF EXISTS credential_broker_leases_tenant_update ON credential_broker_leases;
DROP POLICY IF EXISTS credential_broker_leases_tenant_delete ON credential_broker_leases;

CREATE POLICY credential_broker_leases_tenant_select ON credential_broker_leases
  FOR SELECT USING (tenant_id = broker_current_tenant_id());
CREATE POLICY credential_broker_leases_tenant_insert ON credential_broker_leases
  FOR INSERT WITH CHECK (tenant_id = broker_current_tenant_id());
CREATE POLICY credential_broker_leases_tenant_update ON credential_broker_leases
  FOR UPDATE USING (tenant_id = broker_current_tenant_id())
  WITH CHECK (tenant_id = broker_current_tenant_id());
CREATE POLICY credential_broker_leases_tenant_delete ON credential_broker_leases
  FOR DELETE USING (tenant_id = broker_current_tenant_id());

ALTER TABLE credential_broker_leases DISABLE ROW LEVEL SECURITY;
