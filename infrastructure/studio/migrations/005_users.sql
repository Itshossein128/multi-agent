-- Migration 005: Create Users table for production authentication

CREATE TABLE IF NOT EXISTS studio_users (
  id text PRIMARY KEY CHECK (length(id) > 0),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text,
  tenant_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Email must be unique
CREATE UNIQUE INDEX IF NOT EXISTS studio_users_email_idx ON studio_users (email);

-- Index for tenant lookup
CREATE INDEX IF NOT EXISTS studio_users_tenant_idx ON studio_users (tenant_id, id);
