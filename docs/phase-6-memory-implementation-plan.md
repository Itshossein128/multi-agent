# Phase 6 Memory implementation plan

Source of scope: `.cursor/plans/6.md` (Memory). This is distinct from the original roadmap's Phase 6 Tool Management numbering.

## Existing architecture and decisions

- Extend shared AgentRecord, AgentRuntime, Hono routes, RunStore and LangGraph compiler. Retain existing API/CLI/local executor boundaries.
- Replace the compiler's run-local conversation Map with checkpointed LangGraph state. Keep the legacy runtime input compatible for standalone consumers.
- PostgreSQL currently belongs to Langfuse infrastructure, not Studio application persistence. Add an isolated Studio memory database service/profile and explicit migrations; never change Langfuse's schema or auto-migrate on startup.
- Implement PostgreSQL relational storage and optional pgvector migration, with an in-memory test adapter. No silent volatile fallback when durable storage was configured.
- Memory namespaces and authorization grants are separate: browser-supplied IDs never establish authority. Server-resolved access contexts are mandatory for long-term operations.
- Preserve Phase 5 memory configuration and add optional short-term/long-term settings. Embedding configuration belongs to server composition, independently of AgentBackend.

## Child tasks and ownership

| Task | Owner | Write scope | Acceptance criteria |
| --- | --- | --- | --- |
| M1 Contracts and configuration compatibility | Coordinator | packages/types/src, src/memory/contracts.ts | Typed memory kinds, namespaces, access contexts, store/service/retrieval/extraction interfaces; old agents remain valid |
| M2 Persistence and migrations | Mendel (storage subagent) | src/memory/infrastructure, infrastructure/memory, tests/memoryStorage* | PostgreSQL + in-memory adapters, explicit migrations, scoped bounded search, atomic dedup/idempotency/superseding, expiration/deletion, persistence tests |
| M3 Retrieval and selective writing | Hegel (retrieval subagent) | src/memory/application, tests/memoryRetrieval*, tests/memoryService* | Hybrid scoring, budgets, dedup, selective extraction/write policy, source tracking, diagnostics and deterministic relevance evaluation |
| M4 Runtime and checkpoint integration | Sagan (runtime subagent) | src/agents/runtime, apps/server/src/compiler/workflowCompiler.ts, apps/server/src/runtime/runExecutor.ts, tests/memoryRuntime* | Context before execution, selective hot/background writes, normalized events, graceful/required failures, checkpoint restoration and run isolation |
| M5 Backend composition/API and thin configuration UI | Coordinator | apps/server/src/api/memories.ts, server composition/index/runs routes, AgentMemoryPanel, docs, dependency manifests | Trusted access resolution, CRUD/search routes, durable store composition, minimal settings UI, no frontend storage |
| M6 Independent review and integration verification | Cicero (review subagent) + coordinator | Review report; coordinator owns corrective integration | Inspect authorization, namespace leakage, concurrency/retry behavior, budget enforcement, failure paths, SQL and regression tests |

M1 defines contracts first. M2–M4 then run concurrently while the coordinator completes M5. Each worker edits only its assigned files and reports changed paths, tests and limitations. Review starts against integrated changes, findings are fixed and relevant checks rerun before completion.

## Verification and completion gate

- Storage CRUD/filter/transaction/idempotency tests plus real PostgreSQL/pgvector integration when infrastructure is available.
- Deterministic retrieval fixtures: relevant top-K, unrelated exclusion, metadata/scope filtering, superseded/expired exclusion, scoring and formatted-context budget.
- Runtime tests: restored short-term state, separate runs, retrieved context delivery, selective writes, background completion, denied namespaces, optional/required failures, memory events.
- API tests: missing/invalid authority denied, browser IDs cannot widen grants, CRUD/search/deletion scope, validation and sanitized diagnostics.
- Existing Phase 5 tests, shared/server/root/web TypeScript checks, focused lint and build checks.
- Document actual infrastructure verification separately from mocked tests; do not claim a live database test when none ran.

## Progress

- M1–M6 implemented and reviewed. Workers edited separate owned areas; the coordinator integrated contracts, authenticated APIs, composition, UI and end-to-end tests.
- Review corrections: align runtime query length with retrieval validation; bind private-run ownership to RunStore across router/executor reconstruction; replace historical namespace scans with exact bounded retry lookups; align JSONB predicates with their GIN index.
- Coordinator regression run: **102 tests passed across 10 suites** (memoryApi, memoryEmbedding, memoryEndToEnd, memoryRetrieval, memoryRuntime, memoryService, phase5Runtime, agentDetail, agentExecutor, agentRegistry). Includes live PostgreSQL reconstruction, cross-run recall and retries after correcting canonical content.
- Storage worker and coordinator final runs: **24 tests passed**, including 12 real PostgreSQL/pgvector cases and EXPLAIN ANALYZE. Combined final verification: **126 passing tests across 11 suites, with no skips**. The plan check disables sequential scans only within its transaction to demonstrate index eligibility on small fixtures; it is not a production load benchmark.
- Shared-types, root and server TypeScript builds passed. Web TypeScript, focused component ESLint and Next.js production build passed. Whitespace checks passed.
- Live tests used an isolated disposable pgvector/pg17 container on localhost:55433 with random test schemas; the test container was stopped and removed afterward. Existing application/Langfuse databases were untouched. No paid model or embedding calls were made.
- See [independent review](phase-6-memory-review.md) for regression evidence and [setup and operational limits](phase-6-memory.md) for configuration. Default short-term checkpoints, runs and background jobs remain process-local; long-term records use PostgreSQL. Durable checkpoint adapters are injectable. Consolidation is an authorized no-op extension point, and reinforcement remains modeled rather than learned automatically. Browser identity integration, a full Memory Explorer and authenticated entity-deletion wiring remain outside this backend-first delivery. Browser interaction and production-scale load were not verified.
