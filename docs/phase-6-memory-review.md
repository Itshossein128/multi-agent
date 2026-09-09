# Phase 6 Memory independent review

Review date: 2026-09-09. M6 owns only this report and `tests/memoryApi.test.ts`. No implementation edits or commits. This is an integration review of a changing working tree, not an immutable release sign-off.

## Scope and evidence

Read `.cursor/plans/6.md`, `docs/phase-6-memory-implementation-plan.md`, shared memory types/contracts, management routes, bearer resolver, run routes/executor/store, compiler, runtime memory, application service/retriever/formatter/extractor/background queue, PostgreSQL/in-memory stores, migrations, server composition and embedding adapter. The existing graph predates memory implementation; direct current-source inspection supplies the evidence.

The new API suite exercises Hono requests using the actual `DefaultMemoryService`, `HybridMemoryRetriever` and one shared `InMemoryMemoryStore`, with deterministic embedding vectors. Tenant tests use identical namespace IDs across tenants and distinct agent namespaces within a tenant. Isolation claims do not rely on a fake service. Tests verify stored foreign records remain unchanged after denied mutations and exclude foreign IDs/content from retrieval diagnostics.

Run-route tests use actual `RunExecutor`, `RunStore` and workflow compiler with a gated runtime for deterministic active/completed states. Separate integration tests use actual `AgentRuntime`, service, extractor, write policy, formatter and background queue; only the executor backend and embedding provider are deterministic substitutes. They inspect untrusted context, byte budgets, unchanged system instructions, sanitized events, and replayed node identity without duplicate storage.

## Findings for coordinator

### M6-01 — Medium — runtime query bound exceeds the service contract (fixed, regression verified)

Originally confirmed by a failing real-runtime/service regression: `RuntimeMemory.read` clipped input to 16,384 bytes, while `HybridMemoryRetriever.retrieve` rejected text above 16,000 characters. Long ASCII input caused optional degradation or failed required-memory runs despite healthy infrastructure and valid authority.

The runtime owner changed clipping to 16,000 bytes. Authenticated `/agent-test` with required long-term memory and `{ message: "PostgreSQL ".repeat(1700) }` now completes and receives the expected stored context within its byte budget. Both short-input and long-input cases passed the final focused run.

### M6-02 — Low — privacy depends on a single router instance (fixed, regression verified)

Previously ownership existed only in a router-local map. Recreating a router over an existing executor, or exposing a trusted directly started memory run through it, lost the privacy policy. The current `RunExecutor.start` and `startAgentTest` pass trusted access into `RunStore.create` before execution/events; run routes consult `getMemoryOwner` on the store.

Six passing lifecycle cases cover workflow and agent-test starts through the original router, a recreated router over the same executor, and direct executor starts followed by a new executor/router sharing the store. Anonymous, invalid-token, different-tenant/same-principal and same-tenant/different-principal callers cannot read snapshots/history/SSE, cancel, or see list entries, both during execution and after completion. Owner-positive reads and completed SSE/history still succeed. Mutating the original direct-start access object or a returned owner copy does not change the stored owner. This verifies binding independence at those interfaces, not deep immutability of all internal `RunStore` objects.

### M6-03 — Medium — full namespace scans during serialized writes (resolved in source)

Initially `DefaultMemoryService.existing` walked active, superseded and archived records in 200-row pages while holding the namespace transaction lock. Work grew with all historical records for every write, including expiration history; small pages did not bound total work. Reported during review.

The current identity lookup implementation replaces this with capped exact `contentHash`/`idempotencyKey` lookups and scoped metadata lookup for retry aliases. Both stores implement the filters and PostgreSQL binds them as parameters. Static removal of the application pagination scan and focused service regressions are verified, including bounded retry queries across archived/expired records and alias retries after update/superseding. The later alias predicate/index mismatch is tracked separately as M6-04; database query plans/load behavior have not been independently benchmarked by M6.

### M6-04 — Low — alias metadata predicate does not match the declared index (closed; source reviewed, storage-worker live verification)

The original PostgreSQL search predicate used `COALESCE(metadata, '{}'::jsonb) @> $n::jsonb`, while `studio_memories_metadata` indexed plain `metadata jsonb_path_ops`. This expression mismatch affected metadata-index eligibility, not tenant isolation or SQL parameterization.

Storage remediation is present: nonempty filters now use `metadata @> $n::jsonb`; empty object filters retain `COALESCE` so NULL metadata still matches the empty filter. Alias lookup uses a nonempty filter and therefore follows the indexed-column path. M6 independently verified this source change.

The added storage test `real search SQL uses the metadata GIN index for selective nonempty containment` inserts 2,000 rows, executes the real adapter query, validates its result, then runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on that captured parameterized SQL and asserts the metadata index appears. It uses a generic nonempty nested filter, not an alias-shaped fixture. The transaction-local `enable_seqscan = off` setting tests index eligibility with other indexes still enabled; it does not establish the production planner's preferred plan or latency. M6 inspected the final source and regression and considers the fix sound. Storage worker Mendel reports **24/24 storage tests passed with live PostgreSQL 17**, including the EXPLAIN regression, as relayed by the coordinator. M6-04 is closed on that attributed live evidence plus independent source review; M6 did not rerun the live suite.

### Open findings

No open M6 findings remain. M6-01 and M6-02 are fixed and regression verified; M6-03's application scan is removed and verified; M6-04 is closed with independent source review and storage-worker-attributed live PostgreSQL index-eligibility verification. Production-scale planner choice and latency remain unmeasured by this review.

## Security, budget, retry and failure observations

- Bearer resolver compares hashed server-provisioned tokens and returns cloned grants. Request tenant/agent/grant fields do not create authority. Missing/invalid authentication is denied before memory service calls.
- CRUD/search apply service-side namespace and tenant checks. Patch allowlisting excludes tenant, namespace, vector and authority mutation. Read-only grants cannot write. Public API responses omit vectors, tenant IDs and content hashes.
- Search performs tenant/namespace filtering before diagnostics and repeats checks in the retriever. SQL identifiers are static and values are parameterized. Vector search materializes the filtered candidate set before exact distance ordering; this is scoped but not a proven bounded-cost ANN search.
- Namespace advisory locks, optimistic versions, tenant-scoped primary keys and unique idempotency indexes support atomic retries/superseding. Real in-memory retry verification does not prove PostgreSQL concurrency behavior; live adapter tests belong to the storage worker.
- Runtime narrows server grants to current agent/workflow and intersects configured namespaces. Compiler forwards the injected runtime and trusted access without deriving grants from workflow data. AgentRuntime overwrites caller `memoryContext` and keeps retrieved data separate from system instructions; API executor uses a separate user message.
- Default formatter counts UTF-8 bytes conservatively, including its wrapper. Runtime reserves bytes for its untrusted-data prefix before retrieval/whole-record selection, preserving serialized records rather than truncating them. Default-runtime/service budget regression passes. Custom injected formatters remain responsible for honoring their budget contract. Semantic/lexical pools and result counts are capped. This bounds default memory context, not the total prompt length or semantic immunity to prompt injection.
- Required memory operations delay success until completion. Optional errors are sanitized as memory failure events. Embedding timeout/error fallback preserves lexical retrieval. Required background writes take the synchronous path; optional background events are emitted via the existing run event sink.
- Retry aliases are hashed and stored under reserved `__memory_idempotency` metadata, capped at 128 identities per canonical record. New aliases beyond capacity produce conflict rather than evicting previous retry identity. `remember` and `update` reject an own reserved key; metadata replacement preserves existing aliases under the transaction. Public memory projection removes the reserved field. New API regressions reject forged/empty/null reserved values, verify unchanged stored state, replace ordinary metadata, reconstruct the service, and resolve an old alias to corrected canonical content without resurrection. Conflicting reuse returns 409.
- SQL alias lookup binds `{ "__memory_idempotency": [{ "key": "<sha256>" }] }` as JSONB containment with tenant, namespace, status and result-limit predicates. This supports partial-object matching against stored `{ key, fingerprint }` entries. Its semantics are source-reviewed. The coordinator reports the final live PostgreSQL end-to-end test passed, including alias replay after correction/reconstruction; Mendel reports the live index-eligibility regression passed. These live results are attributed to their owners, not claimed as M6 executions.
- Final runtime source preserves extractor `source.type` while overriding run/node/agent/workflow provenance from execution. Omitted `writeMode` uses the background queue when a sink/dependencies exist; explicit hot-path and required writes remain synchronous. Corresponding runtime tests passed.

## Verification and limits

Final command after source remediation and lifecycle regression additions:

```text
pnpm test --runInBand tests/memoryApi.test.ts tests/memoryRuntime.test.ts tests/memoryService.test.ts tests/memoryRetrieval.test.ts
```

**4 suites passed; 74 tests passed; no failures.** API suite contains 24 tests, including two reserved-alias HTTP regressions; runtime/service/retrieval contribute 50. All regressions are ordinary acceptance tests, without skips or expected-failure markers. This supersedes the earlier 17-pass/1-failure API result that established M6-01 and the 72-test intermediate lifecycle run.

The subsequent M6-04 closeout was limited to source and targeted regression inspection. M6 did not duplicate the storage worker's live EXPLAIN run or the coordinator's final builds/tests. The coordinator's reported UI default alignment was outside this targeted closeout.

Final evidence supplied by the coordinator, separate from M6's 74-test run:

- Mendel: **24/24 storage tests passed with live PostgreSQL 17**, including actual adapter SQL EXPLAIN ANALYZE confirming metadata GIN eligibility.
- Coordinator: **10 suites / 102 tests passed**, covering memory except storage plus Phase 5, agent detail, executor and registry; includes live PostgreSQL end-to-end alias correction/reconstruction.
- Coordinator: shared/root/server builds, web typecheck/lint and Next production build passed.

Final coordinator confirmation: independently reran the storage suite against the live test database, **24/24 passed including 12 real PostgreSQL tests**. Combined final result is **126 passing tests across 11 suites**. Root/server builds were repeated successfully after the metadata predicate change. This supersedes any pending live-verification/build status; no live work remains for M6, and the isolated test container may be stopped.

No actual external embedding-service test or browser UI functional test was performed, per coordinator confirmation. Production-scale query plans/load, full production lifecycle and restart persistence are outside M6's verified scope. Live PostgreSQL results and final builds above were performed by their respective owners, not independently rerun by M6. Focused runtime tests passed checkpoint restoration and graceful/required failure cases; deterministic retrieval fixtures passed. M6's assigned review is complete with all four findings closed and verification ownership explicitly recorded.
