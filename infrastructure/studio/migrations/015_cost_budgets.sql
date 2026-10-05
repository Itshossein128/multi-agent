CREATE TABLE IF NOT EXISTS studio_budgets (
  tenant_id text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('company','agent','project')),
  scope_id text NOT NULL,
  limit_usd numeric(14,6) NOT NULL CHECK (limit_usd > 0),
  threshold_percent integer NOT NULL DEFAULT 80 CHECK (threshold_percent BETWEEN 1 AND 100),
  spent_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  reserved_usd numeric(14,6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,scope,scope_id)
);
CREATE TABLE IF NOT EXISTS studio_budget_reservations (
  run_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  amount_usd numeric(14,6) NOT NULL CHECK (amount_usd >= 0),
  scopes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  actual_usd numeric(14,6)
);
CREATE INDEX IF NOT EXISTS studio_budget_reservations_open ON studio_budget_reservations (tenant_id,created_at) WHERE settled_at IS NULL;
CREATE TABLE IF NOT EXISTS studio_budget_alerts (
  id bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  scope text NOT NULL,
  scope_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('threshold','limit')),
  spent_usd numeric(14,6) NOT NULL,
  limit_usd numeric(14,6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_budget_alerts_tenant_created ON studio_budget_alerts (tenant_id,created_at DESC);
