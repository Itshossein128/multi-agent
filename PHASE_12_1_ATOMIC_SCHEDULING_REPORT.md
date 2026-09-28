# Phase 12.1 — Atomic Memory Job Scheduling

## Design

This phase uses direct transactional job insertion, not a generic outbox.
`PostgresMemoryStore` inserts consolidation and episode-to-procedure jobs through
the active memory transaction. `PostgresRunStore` inserts terminal-run episodic
work through the same PostgreSQL transaction as its terminal update when durable
memory jobs are enabled.

## Recovery

`PostgresMemoryJobStore.reconcileTerminalRuns(limit)` is a bounded, idempotent
legacy repair query. It selects only terminal runs with captured memory scope
which lack their deterministic episodic job identity. The tenant-local unique
job identity is the final multi-instance convergence boundary.

## Boundaries

This relies on the existing server composition contract: Studio and memory
persistence select `MEMORY_DATABASE_URL` first, so their durable paths use the
same PostgreSQL database. If a deployment deliberately separates those
databases, terminal-run atomicity is not available and requires a dedicated
transactional outbox in the Studio database.

## Operational notes

The reconciler is bounded by `MEMORY_JOB_RECONCILE_LIMIT` (default 100) and is
not a whole-database startup scan. Job leases remain fixed at 30 seconds; no
heartbeat was added because deterministic handlers are short. Existing job
events and `metrics()` remain the operational visibility surface.
