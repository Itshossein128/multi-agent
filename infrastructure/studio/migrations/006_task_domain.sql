-- Migration 006: Task Domain Expansion (Phase 2)
-- Expands studio_tasks to support Phase 2 domain statuses, workflow linkage,
-- multiple assigned agents, run linkage, hierarchy, timestamps, and metadata.

-- 1. Add new columns
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS workflow_id text;
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS assigned_agents jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS parent_task_id text;
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS run_id text;
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE studio_tasks ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Populate assigned_agents from existing assigned_agent column where empty
UPDATE studio_tasks
SET assigned_agents = jsonb_build_array(assigned_agent)
WHERE assigned_agent IS NOT NULL AND (assigned_agents IS NULL OR assigned_agents = '[]'::jsonb);

-- 3. Update status constraint to support both Phase 2 canonical statuses and legacy statuses
ALTER TABLE studio_tasks DROP CONSTRAINT IF EXISTS studio_tasks_status_check;
ALTER TABLE studio_tasks ADD CONSTRAINT studio_tasks_status_check
  CHECK (status IN (
    'backlog', 'ready', 'queued', 'running', 'blocked', 'waiting_for_human', 'completed', 'failed', 'cancelled',
    'todo', 'planning', 'in_progress', 'waiting_tool', 'review', 'done'
  ));

-- 4. Create indices for workflow, run, and parent lookup
CREATE INDEX IF NOT EXISTS studio_tasks_workflow ON studio_tasks (tenant_id, workflow_id);
CREATE INDEX IF NOT EXISTS studio_tasks_run ON studio_tasks (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS studio_tasks_parent ON studio_tasks (tenant_id, parent_task_id);
