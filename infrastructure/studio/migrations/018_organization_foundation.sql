-- Migration 018: Organization foundation (membership, status, slug, audit).
-- Guard: refuse while legacy tenant-owned rows exist before memberships exist.

DO $$
DECLARE
  legacy_count bigint := 0;
  memberships_exist boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'studio_organization_memberships'
  ) INTO memberships_exist;

  IF NOT memberships_exist THEN
    SELECT COALESCE((
      SELECT SUM(cnt) FROM (
        SELECT COUNT(*)::bigint AS cnt FROM studio_organizations
        UNION ALL SELECT COUNT(*)::bigint FROM studio_projects
        UNION ALL SELECT COUNT(*)::bigint FROM studio_tasks
        UNION ALL SELECT COUNT(*)::bigint FROM studio_runs
        UNION ALL SELECT COUNT(*)::bigint FROM studio_workflows
        UNION ALL SELECT COUNT(*)::bigint FROM studio_agents WHERE COALESCE(is_system, false) = false
        UNION ALL SELECT COUNT(*)::bigint FROM studio_tools WHERE COALESCE(is_system, false) = false
        UNION ALL SELECT COUNT(*)::bigint FROM studio_users WHERE tenant_id IS NOT NULL
      ) s
    ), 0) INTO legacy_count;

    IF legacy_count > 0 THEN
      RAISE EXCEPTION
        'Migration 018 refused: % legacy organization-owned row(s) exist before studio_organization_memberships. Run pnpm db:reset -- --confirm-destroy-all-data first.',
        legacy_count;
    END IF;
  END IF;
END $$;

ALTER TABLE studio_organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS created_by text;

UPDATE studio_organizations
SET slug = lower(regexp_replace(btrim(id), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL OR btrim(slug) = '';

ALTER TABLE studio_organizations
  ALTER COLUMN slug SET NOT NULL;

ALTER TABLE studio_organizations
  DROP CONSTRAINT IF EXISTS studio_organizations_status_check;
ALTER TABLE studio_organizations
  ADD CONSTRAINT studio_organizations_status_check
  CHECK (status IN ('active', 'suspended', 'deleting'));

ALTER TABLE studio_organizations
  DROP CONSTRAINT IF EXISTS studio_organizations_slug_format;
ALTER TABLE studio_organizations
  ADD CONSTRAINT studio_organizations_slug_format
  CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 1 AND 80);

CREATE UNIQUE INDEX IF NOT EXISTS studio_organizations_slug_uidx
  ON studio_organizations (slug);

CREATE TABLE IF NOT EXISTS studio_organization_memberships (
  organization_id text NOT NULL REFERENCES studio_organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES studio_users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status text NOT NULL CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
  invited_by text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS studio_organization_memberships_user
  ON studio_organization_memberships (user_id, status);

CREATE TABLE IF NOT EXISTS studio_organization_audit (
  id bigserial PRIMARY KEY,
  organization_id text NOT NULL,
  actor_user_id text,
  action text NOT NULL,
  target_user_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_organization_audit_org
  ON studio_organization_audit (organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION studio_organization_audit_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'studio_organization_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS studio_organization_audit_no_update ON studio_organization_audit;
CREATE TRIGGER studio_organization_audit_no_update
  BEFORE UPDATE OR DELETE ON studio_organization_audit
  FOR EACH ROW EXECUTE PROCEDURE studio_organization_audit_append_only();

-- tenant_id on users is last-used organization only (nullable; not an authority).
ALTER TABLE studio_users ALTER COLUMN tenant_id DROP NOT NULL;
