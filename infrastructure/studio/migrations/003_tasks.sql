CREATE TABLE studio_tasks (
  id text PRIMARY KEY CHECK (length(id) > 0),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  priority text NOT NULL CHECK (priority IN ('high','medium','low')),
  status text NOT NULL CHECK (status IN ('todo','planning','in_progress','waiting_tool','review','done','failed')),
  assigned_agent text,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  output text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  paused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX studio_tasks_updated ON studio_tasks (updated_at DESC, id);
CREATE INDEX studio_tasks_status ON studio_tasks (status, updated_at DESC);
