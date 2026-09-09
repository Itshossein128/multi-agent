CREATE TABLE studio_workflows (
  id text PRIMARY KEY CHECK (length(id) > 0),
  name text NOT NULL,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX studio_workflows_updated ON studio_workflows (updated_at DESC, id);

CREATE TABLE studio_agents (
  id text PRIMARY KEY CHECK (length(id) > 0),
  name text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX studio_agents_updated ON studio_agents (updated_at DESC, id);

CREATE TABLE studio_tools (
  id text PRIMARY KEY CHECK (length(id) > 0),
  name text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX studio_tools_updated ON studio_tools (updated_at DESC, id);
