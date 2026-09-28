# Phase 12 — Distributed Production Hardening

## Previous limitation

Consolidation was coalesced in a process-local bounded queue and restart recovery re-enqueued discovered namespaces. Episodic extraction and procedural learning also ran from that process-local queue. A restart could therefore lose accepted post-run work.

## Durable architecture

`run/memory state change -> durable job -> PostgreSQL claim -> database-time lease -> trusted handler -> completed / failed retry / dead`.

`studio_memory_jobs` is additive. Its tenant-local unique identity index `(tenant_id, job_kind, handler_version, idempotency_key)` converges duplicate submissions without cross-tenant suppression. Claiming is a single transaction: select eligible pending/failed or expired leased rows with `FOR UPDATE SKIP LOCKED`, then update them to `leased` with an owner and expiration using PostgreSQL `now()`. Completion and failure updates are lease-owner guarded.

## Retry, recovery, and operations

Transient database/network failures use bounded exponential backoff and become `dead` after the configured attempt limit. Validation/access/unsupported-handler errors are permanent. `retryDead(id)` is the minimal operator recovery API. `metrics()` exposes counts by kind/status and `purgeTerminal()` is a retention hook that never deletes active work. A dead worker's lease expires and another worker can reclaim the row. Worker events contain identifiers, scope, attempt, worker, duration and error code—not memory content.

## Safety and rollout

The schema is additive and readable by old servers. Deploy migrations 004 then 005 before new workers. Semantic validity timestamps are separate from lease timestamps; lease comparisons use PostgreSQL time. Workers construct trusted internal scope from job columns and verify it against the persisted run's server-resolved memory scope before episodic/procedural work. The worker starts after run-store hydration and stops claiming before pool shutdown.

## Evidence

`memoryDistributedJobs.test.ts` uses real PostgreSQL and four concurrent claimers for 100 jobs: every job was claimed once, duplicate submission was deduplicated, all completed, an abandoned lease was reclaimed then moved to dead/retried deterministically, tenant-local identity was verified, and terminal retention did not remove pending work.

## Remaining boundary

This phase establishes durable coordination for consolidation, episodic extraction, and procedural learning. The run-store write and job enqueue are not one shared database transaction: an enqueue failure after a terminal run is persisted marks the memory status failed and logs the failure rather than hiding it. A future reconciliation/outbox should resubmit failed/pending terminal work. Lease heartbeats are intentionally absent because handlers are short and use a 30-second fixed lease; an embedding/LLM handler that can exceed it must add renewal.
