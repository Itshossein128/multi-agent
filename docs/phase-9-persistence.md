# Phase 9 — Persistence, Runs, History & Recovery

Studio entities, runs, approvals, and tasks are durable in the isolated Studio PostgreSQL database (same instance as long-term memory). Redis is not used; SSE listeners, abort controllers, and approval timers remain in-process.

## Operator setup

```bash
docker compose -f infrastructure/memory/compose.yml --profile memory up -d
export MEMORY_DATABASE_URL='postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory'
node infrastructure/memory/migrate.cjs
node infrastructure/studio/migrate.cjs
export STUDIO_STORE=postgres
pnpm --filter server dev
```

`STUDIO_STORE` defaults to `postgres` when `MEMORY_DATABASE_URL` (or `STUDIO_DATABASE_URL`) is set, otherwise `in-memory`. Production rejects volatile studio storage.

Migrations are **never** applied at server startup. Changed applied SQL fails checksum validation — add a new migration instead of editing deployed files.

## What is persisted

| Entity | Table / mechanism |
| --- | --- |
| Workflows / agents / tools | `studio_workflows`, `studio_agents`, `studio_tools` via `/studio/*` |
| Tasks | `studio_tasks` via `/studio/tasks` (web task board proxies through Next `/api/tasks`) |
| Runs + events | `studio_runs`, `studio_run_events` |
| Approvals | `studio_approvals` |
| LangGraph checkpoints | `@langchain/langgraph-checkpoint-postgres` (shared saver when postgres mode is on) |
| Paused resume context | `studio_runs.paused_context` JSONB |

## Browser migration

On first successful connect, [`workflowService`](../apps/web/src/services/workflowService.ts) imports `agent-studio.workspace.v3` (and legacy keys) into `POST /studio/workspace/import`, then clears those localStorage keys. Only `agent-studio.active-workflow.v1` remains local.

## Run history UI

`/runs` lists runs with filters: workflowId, taskId, status, from, to. Run detail loads the workflow snapshot from `GET /runs/:id/definition` (no longer depends solely on sessionStorage).

## Recovery behavior

On boot with a durable run store:

1. Hydrate runs/events/approvals into the in-memory hot cache.
2. For each `waiting_for_human` run with a workflow snapshot + Postgres checkpointer: restore pause maps and re-arm timeout approvals.
3. Otherwise mark the wait as failed with a clear error.
4. Any `queued` / `running` run interrupted mid-flight is marked failed (cannot safely continue without an active worker).

## Tests

```bash
node node_modules/jest/bin/jest.js tests/phase9Persistence.test.ts --runInBand
```

Optional live Postgres coverage can reuse `MEMORY_TEST_DATABASE_URL` / `MEMORY_DATABASE_URL` with `runStudioMigrations` against a random schema (same pattern as memory storage tests).
