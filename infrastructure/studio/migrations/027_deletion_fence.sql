-- Retained denial survives profile removal and rejects delayed tenant upserts.
CREATE TABLE IF NOT EXISTS studio_deleted_organizations (id text PRIMARY KEY, deleted_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE studio_deleted_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_deleted_organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deleted_organization_scope ON studio_deleted_organizations;
CREATE POLICY deleted_organization_scope ON studio_deleted_organizations USING (id=studio_current_tenant_id()) WITH CHECK (id=studio_current_tenant_id());
GRANT SELECT, INSERT ON studio_deleted_organizations TO studio_app, studio_worker;

CREATE OR REPLACE FUNCTION studio_record_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='deleting' THEN
    INSERT INTO studio_deleted_organizations(id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS studio_record_deletion ON studio_organizations;
CREATE TRIGGER studio_record_deletion BEFORE UPDATE ON studio_organizations FOR EACH ROW EXECUTE FUNCTION studio_record_deletion();

CREATE OR REPLACE FUNCTION studio_fence_tenant_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_status text;
BEGIN
  SELECT status INTO org_status FROM studio_organizations WHERE id=NEW.tenant_id FOR SHARE;
  IF org_status IS NOT NULL AND org_status <> 'active' OR EXISTS(SELECT 1 FROM studio_deleted_organizations WHERE id=NEW.tenant_id) THEN
    RAISE EXCEPTION 'Organization is deleting or has been deleted';
  END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='tenant_id' AND table_name LIKE 'studio_%' AND table_name <> 'studio_users'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS studio_fence_tenant_insert ON %I', t);
    EXECUTE format('CREATE TRIGGER studio_fence_tenant_insert BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION studio_fence_tenant_insert()', t);
  END LOOP;
END;
$$;
