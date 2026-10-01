# Phase 11 — Advanced Temporal Semantics and Evolution Tracking

## 1. Previous Temporal Limitations

Before Phase 11, semantic facts had record timestamps and optional reliability metadata, but no first-class valid-time interval. Historical queries used prose heuristics, current queries depended on conflict suppression/newness, an as-of query could inject both the past and current values, and timelines, future-effective facts, gaps, and overlaps had no production semantics. Generic supersession also erased the distinction between an obsolete-but-historically-correct value and a correction of a false value.

## 2. Temporal Data Model

- `createdAt` / `updatedAt`: record time only.
- `observedAt`: when the source observed the fact; nullable.
- `validFrom`: inclusive valid-time boundary; nullable means unknown start.
- `validUntil`: exclusive valid-time boundary; nullable means open-ended.
- `temporalScope`: `current | historical | future | unknown`; descriptive, not a substitute for interval checks.
- `transition`: optional `{ oldValue, newValue, effectiveAt }` evidence.
- `replacesMemoryId` / `replacedByMemoryId`: normal evolution that preserves historical authority.
- `supersedesMemoryId` / `supersededByMemoryId`: correction/invalidation semantics.

No far-future sentinel dates are used. Legacy reliability metadata dates remain readable, but new writes persist dedicated columns.

## 3. Query Model

`MemoryTemporalQuery` supports `current`, `as_of`, `history`, and `range`. `memoryTemporal.ts` derives it once using bounded deterministic patterns for current words, `in YYYY`, `as of YYYY-MM-DD`, `before`, `after`, history/timeline wording, and change questions. Ambiguous semantic queries default to current-state behavior. No LLM parser is involved.

## 4. Retrieval Integration

The production path is:

1. validate requested namespaces and build the authorized lexical/vector candidate pools;
2. repeat tenant, namespace, expiry, status, kind, and metadata checks;
3. apply semantic temporal selection;
4. score reliability and relevance;
5. run temporal-aware conflict handling;
6. timeline-order history results or rank current/as-of results;
7. enforce the existing context budget and format compact validity metadata only for temporal queries;
8. pass the formatted untrusted context through `RuntimeMemory` and `ContextAssembler`.

Vocabulary expansion and pgvector retrieval remain upstream candidate channels; temporal selection composes with both.

## 5. Consolidation Integration

When a deterministic consolidation decision is `temporal_replacement` and the incoming fact has an explicit effective time, the predecessor remains `active` for history, receives `validUntil = effectiveAt`, `temporalScope = historical`, and `replacedByMemoryId`. The successor receives `replacesMemoryId` and remains open-ended. If no effective time is available, consolidation does not fabricate one from `createdAt` and leaves the pair visible for resolution.

## 6. Corrections vs Evolution

- Evolution: npm was valid until 2026-03-01; pnpm became valid then. Both facts remain authoritative inside their intervals.
- Correction: “The 2025 database was MySQL” is superseded by “The 2025 database was PostgreSQL.” The corrected record is excluded from authoritative retrieval.

## 7. Historical Retrieval

With npm valid `[2024-01-01, 2026-03-01)` and pnpm valid `[2026-03-01, ∞)`, `What package manager did the project use in 2025?` selects only npm.

## 8. Timeline Retrieval

`Show the package-manager history` returns the relevant semantic facts ordered by `validFrom`: npm → pnpm. History mode does not canonicalize a legitimate evolution into only its newest value.

## 9. Future Facts

PostgreSQL with `validFrom = 2026-10-01` is dropped as `not_yet_valid` on 2026-09-28 and becomes current on 2026-10-02. Retrieval and tests use an injectable clock.

## 10. Overlaps and Gaps

Overlapping explicit intervals for competing single-valued facts are retained and diagnosed as `temporal_overlap_unresolved`; neither is silently discarded. Multi-valued properties are exempt from exclusivity. An as-of time in a validity gap returns no semantic fact rather than the nearest record.

## 11. Backward Compatibility and Migration

Migration `003_temporal_validity.sql` adds nullable columns, interval/scope checks, and a scoped partial B-tree index without changing pgvector columns or indexes. Existing rows remain untouched. Legacy active semantic facts with unknown validity remain eligible for ordinary current queries, while precise as-of/range queries exclude them unless explicit historical prose matches the requested year. Backfill must only populate values from strong structured evidence.

Recovery is non-destructive: application rollback can ignore the nullable columns. A database rollback may drop the Phase 11 index/constraints/columns only after confirming no rollback consumer needs the new data; the forward migration intentionally includes no destructive down step.

## 12. Diagnostics

Retrieval exposes `temporalMode`, `queryTime`, `validFrom`, `validUntil`, `temporalMatch`, and `temporalDropReason`. Bounded reason codes include `not_yet_valid`, `no_longer_current`, `outside_as_of_time`, `outside_requested_range`, `unknown_validity_for_historical_query`, and `temporal_overlap_unresolved`; historical matches are counted separately. Structured telemetry records counts and mode, not full memory content.

Benchmark metrics: `currentFactAccuracy`, `historicalFactAccuracy`, `timelineAccuracy`, `futureFactLeakage`, `temporalFalseSuppression`, and `temporalConflictRate`.

## 13. Benchmark Delta

The pre-change benchmark's historical scenario selected both npm and pnpm (precision `0.5`, noise `0.5`). Phase 11 benchmark v2 reports:

- current fact accuracy: `1`
- historical fact accuracy: `1`
- timeline accuracy: `1`
- future fact leakage: `0`
- temporal false suppression: `0`
- full-memory recall / precision: `1 / 1`
- full-memory noise: `0`
- memory tokens / total context tokens: `8674 / 22544` (`0.384759`)
- deterministic retrieval latency p50/p95/max: `1 / 8 / 9 ms` (run-specific)

## 14. Real Embedding Regression

The local PostgreSQL 16 + pgvector suite validates migration 003, 768-dimensional vector search, hard-negative exclusion, mixed embedding versions, fallback, backfill, and temporal current/as-of selection through the same hybrid path. External provider validation requires provider credentials and is reported separately when unavailable.

## 15. Security

Temporal filtering runs only inside already authorized tenant/namespace candidate pools and repeats authorization before temporal evaluation. Historical mode does not broaden tenant, namespace, agent, workflow, or visibility grants. Deterministic benchmark security violations remain zero.

## 16. Tests

Final verification:

- `pnpm test --runInBand` with `MEMORY_TEST_DATABASE_URL` set: 82 suites, 1069 tests passed.
- `pnpm memory:benchmark`: benchmark v2 passed all deterministic and security gates.
- `pnpm memory:eval -- --baseline`: 7 scenarios passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm exec tsc --noEmit -p apps/server/tsconfig.json`: passed.
- `pnpm --filter server build`: passed.
- `pnpm --filter web build`: passed.
- `git diff --check`: passed.
- `tests/memoryLiveEmbedding.test.ts`: passed against local PostgreSQL 16 + pgvector; external provider execution was skipped because no provider credential was available.

## 17. Remaining Weaknesses

- Named dates without a year use the injected clock's UTC year; more ambiguous natural-language dates remain unknown.
- Procedural memories are deliberately not interval-filtered; full procedural version orchestration is deferred.
- Episodic event filtering continues to rely on event/run timestamps and is not redesigned as semantic validity.
- Interval exclusion is currently applied after bounded authorized retrieval. The new index prepares PostgreSQL access patterns, but pushing interval predicates into every candidate query should follow production `EXPLAIN` evidence.
- Overlaps are diagnosed, not automatically repaired without clear transition evidence.
- Unknown-validity legacy memories cannot answer precise historical queries reliably without explicit historical prose.

## 18. Recommended Next Phase

Choose **distributed production hardening** next. Temporal correctness now depends on consistent clocks, concurrent consolidation, and shared coordination across instances; those risks are more immediate than provider abstraction, dashboards, or richer procedural evolution. This recommendation is not implemented in Phase 11.
