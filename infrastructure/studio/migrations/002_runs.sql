CREATE TABLE studio_runs (
  id text PRIMARY KEY CHECK (length(id) > 0),
  workflow_id text NOT NULL,
  task_id text,
  status text NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled','waiting_for_human')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  input jsonb,
  output jsonb,
  error text,
  current_node_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  memory_owner_principal_id text,
  memory_owner_tenant_id text,
  workflow_snapshot jsonb,
  agents_snapshot jsonb,
  paused_context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_runs_started ON studio_runs (started_at DESC, id);
CREATE INDEX studio_runs_workflow ON studio_runs (workflow_id, started_at DESC);
CREATE INDEX studio_runs_task ON studio_runs (task_id, started_at DESC) WHERE task_id IS NOT NULL;
CREATE INDEX studio_runs_status ON studio_runs (status, started_at DESC);

CREATE TABLE studio_run_events (
  run_id text NOT NULL REFERENCES studio_runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, sequence)
);
CREATE INDEX studio_run_events_run ON studio_run_events (run_id, sequence);

CREATE TABLE studio_approvals (
  id text PRIMARY KEY CHECK (length(id) > 0),
  run_id text NOT NULL REFERENCES studio_runs(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','approved','rejected','expired','cancelled')),
  message text NOT NULL,
  requested_at timestamptz NOT NULL,
  resolved_at timestamptz,
  context jsonb,
  response text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_seconds integer,
  UNIQUE (run_id, id)
);
CREATE INDEX studio_approvals_run ON studio_approvals (run_id, requested_at);
CREATE INDEX studio_approvals_pending ON studio_approvals (status) WHERE status = 'requested';
