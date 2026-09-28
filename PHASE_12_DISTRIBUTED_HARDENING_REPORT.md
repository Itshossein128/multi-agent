# Phase 12 — Distributed Production Hardening

## Previous limitation

Consolidation was coalesced in a process-local bounded queue and restart recovery re-enqueued discovered namespaces. That was single-instance maintenance coordination, not durable work ownership. Runtime episodic writes and procedural learning retain their existing idempotency boundaries.

## Durable architecture

`memory mutation -> stable durable job identity -> PostgreSQL claim -> database-time lease -> handler -> completed / failed retry / dead`.

`studio_memory_jobs` is additive. Its unique identity index converges duplicate submissions. Claiming is a single transaction: select eligible pending/failed or expired leased rows with `FOR UPDATE SKIP LOCKED`, then update them to `leased` with an owner and expiration using `now()`. Completion and failure updates are lease-owner guarded.

## Retry, recovery, and operations

Transient failures use bounded exponential backoff and become `dead` after the configured attempt limit. Validation/access/unsupported-handler errors are permanent. `retryDead(id)` is the minimal operator recovery API. A dead worker's lease expires and another worker can reclaim the row. Worker events are bounded and contain identifiers, scope, attempt, worker, duration and error code—not memory content.

## Safety and rollout

The schema is additive and readable by old servers. Deploy migration 004 before new workers. Semantic validity timestamps are separate from lease timestamps; lease comparisons use PostgreSQL time. Workers construct trusted internal scope from stored tenant/namespace columns rather than untrusted payload data.

## Evidence

`memoryDistributedJobs.test.ts` uses real PostgreSQL and four concurrent claimers for 100 jobs: every job was claimed once, duplicate submission was deduplicated, all completed, and an abandoned lease was reclaimed then moved to dead/retried deterministically.

## Remaining boundary

This phase establishes durable coordination and moves PostgreSQL consolidation scheduling onto it. Episodic extraction and procedural learning retain their existing effectively-once write identities; wiring their full run inputs into the same durable record requires a durable run-input snapshot/outbox boundary, which this repository does not currently expose.
