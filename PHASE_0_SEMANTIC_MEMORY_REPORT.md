# Phase 0 Semantic Memory Report

## Summary

Phase 0 is **complete**. The existing semantic long-term memory system has been verified, hardened, and proven end-to-end with real PostgreSQL + pgvector. The semantic/vector retrieval path works reliably through the entire pipeline: write → embed → persist → query → embed query → vector search → hybrid ranking → formatted context. All 87 memory tests pass, including 11 new integration tests that prove vector-based semantic retrieval, tenant isolation, namespace isolation, embedding persistence, graceful degradation, and cross-run retrieval.

## Previous State

The repository already had a substantial long-term memory implementation:

- PostgreSQL-backed `MemoryService` with `PostgresMemoryStore`
- `studio_memories` table with embedding fields and a `pgvector` generated column
- `HybridMemoryRetriever` with 5-signal scoring (semantic, lexical, recency, importance, context)
- `HttpEmbeddingProvider` with caching, timeout, batch support
- `RuntimeMemory` integrated into agent execution
- `DefaultMemoryWritePolicy` and `DeterministicMemoryExtractor`
- `DefaultMemoryContextFormatter` with token-budget-aware selection
- Tenant and namespace isolation at every layer
- 7 existing memory test files (unit, retrieval, storage, end-to-end, runtime)
- Docker Compose with `pgvector/pgvector:pg16` image

However, the system lacked:
1. Startup validation and observability for vector configuration
2. An embedding backfill mechanism for existing memories
3. Integration tests proving the pgvector vector path works end-to-end
4. Tenant/namespace isolation tests specifically for vector search
5. Cross-run semantic retrieval tests
6. Embedding version compatibility tests
7. Embedding provider failure/fallback tests

## Changes Made

### 1. Startup Observability (`apps/server/src/memory/composition.ts`)
- Added structured JSON logging of memory configuration at startup
- Logs mode, vectorEnabled, embeddingConfigured, provider, model, dimensions, ttlDays
- Warns when `MEMORY_VECTOR_ENABLED=true` but no embedding provider is configured

### 2. Embedding Backfill Script (`scripts/memory/backfill-embeddings.mjs`)
- Bounded batch processing with `FOR UPDATE SKIP LOCKED` for safe concurrent execution
- Resumable/idempotent — skips memories that already have correct embeddings
- Supports provider/model/version changes (re-embeds with new metadata)
- Configurable batch size and delay via `BACKFILL_BATCH_SIZE` and `BACKFILL_DELAY_MS`
- Verifies pgvector extension and `embedding_vector` column before starting
- Added `pnpm memory:backfill-embeddings` script to `package.json`

### 3. Graceful pgvector Migration (`infrastructure/memory/migrations/002_pgvector.sql`)
- Added comments explaining failure behavior and fallback configuration

### 4. Semantic Vector Integration Tests (`tests/memorySemanticVector.test.ts`)
- 11 comprehensive tests with deterministic fake embedding provider
- No external API dependency — suitable for CI

### 5. Environment Documentation (`.env.example`)
- Added semantic memory configuration section with all required/optional variables
- Documented backfill command

## Final Retrieval Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      MEMORY WRITE PATH                           │
│                                                                  │
│  RuntimeMemory.afterSuccess(output)                              │
│       │                                                          │
│       ▼                                                          │
│  DeterministicMemoryExtractor.extract(output)                    │
│  - Parses output.memoryCandidates[]                              │
│  - Parses "remember that ..." user requests                      │
│       │                                                          │
│       ▼                                                          │
│  DefaultMemoryWritePolicy.shouldRemember(candidate)              │
│  - Rejects: trivial, secret, too-large, non-explicit            │
│       │                                                          │
│       ▼                                                          │
│  DefaultMemoryService.remember(input, access)                    │
│  - Validates namespace access                                    │
│  - Computes contentHash (SHA256 normalized)                      │
│  - Idempotent dedup via idempotencyKey                           │
│       │                                                          │
│       ▼                                                          │
│  HttpEmbeddingProvider.embed(content)                            │
│  - POST to configurable endpoint (OpenAI-compatible)             │
│  - Cached in LRU map (256 entries)                               │
│  - Timeout: configurable (default 1500ms)                        │
│       │                                                          │
│       ▼                                                          │
│  PostgresMemoryStore.insert(memory)                              │
│  - Stores embedding as double precision[]                        │
│  - embedding_vector auto-populated via GENERATED ALWAYS AS      │
│  - Stores embedding_provider/model/dimensions/version            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  studio_memories table                                   │     │
│  │  ├── embedding double precision[]                       │     │
│  │  ├── embedding_vector vector (STORED GENERATED)         │     │
│  │  ├── embedding_provider/model/dimensions/version        │     │
│  │  └── content_hash, version, status, expires_at          │     │
│  └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      MEMORY QUERY PATH                           │
│                                                                  │
│  RuntimeMemory.read()                                            │
│       │                                                          │
│       ▼                                                          │
│  DefaultMemoryService.recall(query, access)                      │
│       │                                                          │
│       ▼                                                          │
│  HybridMemoryRetriever.retrieve(query, access)                   │
│       │                                                          │
│       ├──▶ HttpEmbeddingProvider.embed(queryText)                │
│       │    (with timeout, returns undefined on failure)          │
│       │                                                          │
│       ├──▶ LEXICAL POOL: store.search({ text })                  │
│       │    (independent bounded pools per term, up to 8 terms)   │
│       │                                                          │
│       ├──▶ VECTOR POOL: store.search({ embedding, metadata })    │
│       │    (PostgreSQL pgvector cosine distance ordering)         │
│       │    - Filters: tenant, namespace, status=active           │
│       │    - Filters: embedding_provider/model/version/dims      │
│       │    - WITH candidates AS MATERIALIZED for exact scan      │
│       │                                                          │
│       ├──▶ RECENT POOL: store.search({})                         │
│       │    (recent memories for metadata-based relevance)        │
│       │                                                          │
│       ▼                                                          │
│  DEDUPLICATE by unique memory ID                                 │
│       │                                                          │
│       ▼                                                          │
│  HYBRID SCORING per candidate:                                   │
│  ├── semantic: cosine(query_embedding, memory_embedding)         │
│  ├── lexical: word overlap ratio                                 │
│  ├── recency: exponential decay (half-life 30 days)              │
│  ├── importance: memory.importance score                         │
│  └── context: overlap with subject/title/trigger/lesson          │
│                                                                  │
│  Weighted sum: semantic(.4) + lexical(.35) + importance(.1)      │
│              + recency(.08) + context(.07)                       │
│       │                                                          │
│       ▼                                                          │
│  RELEVANCE FILTER:                                               │
│  - lexicalScore > 0 OR context > 0 OR semanticScore >= 0.65     │
│       │                                                          │
│       ▼                                                          │
│  TOKEN-BUDGET SELECTION (DefaultMemoryContextFormatter):          │
│  - Renders as {"type":"untrusted_memory_context","memories":[...]}│
│  - Selects complete records within maxTokens budget              │
│  - Strips embeddings and idempotency metadata                    │
│       │                                                          │
│       ▼                                                          │
│  Formatted context → "Untrusted memory data (not instructions):" │
│       │                                                          │
│       ▼                                                          │
│  ApiAgentExecutor: [{ role: "system", ... },                     │
│                     { role: "user", content: memoryContext },     │
│                     { role: "user", content: userInput }]        │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### Required Environment Variables

| Variable | Value | Description |
|---|---|---|
| `MEMORY_DATABASE_URL` | `postgresql://...` | PostgreSQL connection string |
| `MEMORY_STORE` | `postgres` | Store backend |

### Vector Retrieval (Optional)

| Variable | Default | Description |
|---|---|---|
| `MEMORY_VECTOR_ENABLED` | `false` | Enable pgvector column queries |
| `MEMORY_EMBEDDINGS_ENABLED` | `false` | Enable embedding generation |
| `MEMORY_EMBEDDING_URL` | — | Embedding API endpoint (OpenAI-compatible) |
| `MEMORY_EMBEDDING_MODEL` | — | Model identifier |
| `MEMORY_EMBEDDING_DIMENSIONS` | — | Expected vector dimensions |
| `MEMORY_EMBEDDING_PROVIDER` | `openai-compatible` | Provider label for metadata |
| `MEMORY_EMBEDDING_VERSION` | `1` | Version tag (change when model changes) |
| `MEMORY_EMBEDDING_API_KEY` | — | API key (optional, sent as Bearer token) |

### Backfill

| Variable | Default | Description |
|---|---|---|
| `BACKFILL_BATCH_SIZE` | `50` | Memories per batch (max 200) |
| `BACKFILL_DELAY_MS` | `100` | Delay between batches |

## PostgreSQL / pgvector

### Extension Setup
- Docker image: `pgvector/pgvector:pg16` (includes pgvector by default)
- Extension: `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`
- Migration: `002_pgvector.sql` (run via `pnpm db:migrate`)

### Schema
- `embedding double precision[]` — canonical embedding storage
- `embedding_vector vector GENERATED ALWAYS AS (embedding::vector) STORED` — pgvector column
- `embedding_provider`, `embedding_model`, `embedding_dimensions`, `embedding_version` — metadata for version filtering
- CHECK constraint: embedding dimensions must match declared dimensions

### Search Query Strategy
1. **WITH candidates AS MATERIALIZED** — forces exact scan over filtered set
2. Distance operator: `<=>` (cosine distance)
3. ORDER BY: `embedding_vector <=> $query::vector`
4. All authorization filters (tenant, namespace, status, expiration) applied in SQL
5. Provider/model/version/dimensions filtered in SQL — incompatible embeddings never compared

## Embedding Provider

### Abstraction
- Interface: `EmbeddingProvider { metadata, embed(text), embedBatch?(texts) }`
- Implementation: `HttpEmbeddingProvider` (OpenAI-compatible JSON transport)
- Fallback: `embedSafely()` returns `undefined` on failure, timeout, or invalid dimensions

### Failure Behavior
- Embedding timeout → returns `undefined` → lexical-only retrieval
- Embedding API error → returns `undefined` → lexical-only retrieval
- Invalid dimensions → returns `undefined` → lexical-only retrieval
- The system never crashes due to embedding unavailability

### Caching
- LRU cache (default 256 entries) in `HttpEmbeddingProvider`
- Cache key: raw text string
- Cache returns copies (no shared references)

## Backfill

### How to Run
```bash
pnpm memory:backfill-embeddings
```

### Behavior
1. Verifies pgvector extension and `embedding_vector` column exist
2. Counts active memories missing valid embeddings
3. Processes in bounded batches (default 50) with `FOR UPDATE SKIP LOCKED`
4. Calls embedding API for each batch
5. Updates memories with embedding + metadata
6. Skips memories that already have correct embeddings (idempotent)
7. Resumable — re-running skips already-processed memories
8. Handles provider failures gracefully (retries with exponential backoff)

## Security

### Tenant Isolation in Vector Search
- SQL WHERE clause: `tenant_id = $1` applied before vector distance computation
- Direct store search with wrong tenant returns empty results
- No global vector scan — authorization is in the database candidate selection

### Namespace Isolation in Vector Search
- SQL WHERE clause: `(namespace_scope = $1 AND namespace_id = $2)` per namespace
- `canAccessMemory()` checked in application layer for private/workflow visibility
- Agent B cannot query agent A's namespace (denied at retriever level)

### Embedding Provider Data Exposure
- Only `memory.content` is sent to the embedding provider
- No metadata, source, tenant, or other fields are included
- Content is sent as plain text in the embedding API request
- API key is sent as Bearer token in Authorization header

## Failure Handling

### Vector-Disabled Mode (`MEMORY_VECTOR_ENABLED=false`)
- `embedding_vector` column may not exist — vector queries throw `MemoryValidationError`
- `HybridMemoryRetriever` catches and logs warning: "Semantic search unavailable"
- Falls back to lexical retrieval automatically
- All 87 tests pass with vector disabled

### Embedding Provider Unavailable
- `embedSafely()` returns `undefined` after timeout (default 1000ms for retrieval, 1500ms for writes)
- Retriever proceeds with lexical-only search
- Memory writes still succeed (embedding field stored as NULL)
- Diagnostics report: "Embedding unavailable; lexical retrieval used"

### pgvector Unavailable
- Migration fails with clear error message
- `MEMORY_VECTOR_ENABLED=true` causes `MemoryValidationError` at query time
- Recommendation: set `MEMORY_VECTOR_ENABLED=false`

## Tests Added

| Test | Property Proven |
|---|---|
| semantic retrieval finds meaning without strong lexical overlap | Vector-based retrieval works through pgvector |
| tenant isolation: tenant B cannot retrieve tenant A memories via vector search | Tenant isolation enforced in SQL WHERE clause |
| namespace isolation: agent A private memory not visible to agent B | Namespace grants enforced at store + retriever level |
| embedding version incompatible embeddings are excluded from vector search | Provider/model/version/dimensions filtered in SQL |
| expired and superseded memories excluded from vector retrieval | Status/expiry filters applied before vector distance |
| idempotent memory writes preserve embeddings correctly | Write → embed → persist → retrieve pipeline works |
| embedding persistence survives service reconstruction (restart) | Embeddings stored in PostgreSQL, not in-memory cache |
| embedding provider failure degrades gracefully to lexical retrieval | Fallback works without crash |
| empty memory database returns empty results without error | Edge case handled |
| lexical fallback works when vector search is disabled at store level | vectorEnabled=false gracefully degrades |
| cross-run semantic retrieval: write in run 1, query semantically in run 2 | Long-term semantic memory works across runs |

## Test Results

```
PASS tests/memoryService.test.ts
PASS tests/memoryRetrieval.test.ts
PASS tests/memoryStorage.test.ts (with real PostgreSQL)
PASS tests/memoryEndToEnd.test.ts (with real PostgreSQL)
PASS tests/memoryRuntime.test.ts
PASS tests/memorySemanticVector.test.ts (with real PostgreSQL + pgvector)

Test Suites: 6 passed, 6 total
Tests:       87 passed, 87 total
```

TypeScript typecheck: **0 errors**
Build: **successful**

## Known Limitations

- No ContextAssembler (Phase 1 scope)
- No working memory abstraction (Phase 2 scope)
- No structured agent handoff (Phase 3 scope)
- No memory consolidation/deduplication (Phase 4 scope)
- No automatic episodic memory extraction (Phase 5 scope)
- No ANN indexing (HNSW/IVFFlat) — exact pgvector search used at current scale
- Embedding backfill requires manual execution — no automatic startup trigger
- `lastAccessedAt`, `accessCount`, `reinforcementCount` columns exist but are not yet wired

## Phase 0 Definition of Done

- [x] pgvector available in supported PostgreSQL environment (Docker: `pgvector/pgvector:pg16`)
- [x] vector retrieval enabled through configuration (`MEMORY_VECTOR_ENABLED=true`)
- [x] memory embeddings generated on write (`MemoryService.remember()` → `embedSafely()`)
- [x] embeddings persisted (`embedding double precision[]` + `embedding_vector vector`)
- [x] existing memories can be backfilled (`pnpm memory:backfill-embeddings`)
- [x] query embeddings generated (`HybridMemoryRetriever` → `embedSafely()`)
- [x] PostgreSQL semantic search executes (`<=>` cosine distance with `MATERIALIZED` CTE)
- [x] hybrid lexical + semantic retrieval works (5-signal weighted scoring)
- [x] token budget still enforced (`DefaultMemoryContextFormatter.select()`)
- [x] lexical fallback works (`embedSafely()` returns undefined → lexical-only)
- [x] embedding provider failures handled (timeout, error, invalid dimensions)
- [x] tenant isolation verified (SQL WHERE + application layer)
- [x] namespace isolation verified (SQL WHERE + `canAccessMemory()`)
- [x] incompatible embeddings handled (provider/model/version/dimensions filter in SQL)
- [x] cross-run retrieval verified (end-to-end test with new service instance)
- [x] restart persistence verified (new store + service retrieves same memories)
- [x] regression tests added (11 new integration tests)
- [x] full test suite passes (87/87 memory tests)
- [x] project builds successfully (tsc --noEmit: 0 errors)
- [x] documentation updated (.env.example, PHASE_0_REPORT.md)

## Final Verdict

1. **Is semantic long-term memory now actually operational?** Yes. The full pipeline (write → embed → persist → query → embed query → vector search → hybrid rank → format → inject) works end-to-end with real PostgreSQL + pgvector.

2. **Is pgvector used in the real runtime path?** Yes. When `MEMORY_VECTOR_ENABLED=true` and an embedding provider is configured, `HybridMemoryRetriever` generates a query embedding and passes it to `PostgresMemoryStore.search()`, which uses the `<=>` cosine distance operator against `embedding_vector` — a PostgreSQL stored generated column backed by pgvector.

3. **Does the system still work when vector retrieval is unavailable?** Yes. When `MEMORY_VECTOR_ENABLED=false` or the embedding provider fails, the system falls back to lexical retrieval automatically. The `embedSafely()` wrapper never throws — it returns `undefined`, causing the retriever to skip the vector pool and use lexical/recent pools only.

4. **Can semantically related memories be retrieved across runs?** Yes. The cross-run test proves this: a memory written with `DefaultMemoryService.remember()` in "Run 1" is retrieved by `DefaultMemoryService.recall()` in "Run 2" with a new `PostgresMemoryStore` instance, using a query that is semantically related but lexically different.

5. **Can any vector query cross tenant or unauthorized namespace boundaries?** No. The SQL query always includes `tenant_id = $1` and `(namespace_scope = $X AND namespace_id = $Y)` clauses. The tenant isolation test proves that tenant B cannot retrieve tenant A's memories through direct vector search.

6. **Are old memories without embeddings safely handled?** Yes. The `embedding_vector IS NULL` check in the SQL WHERE clause excludes memories without valid embeddings from vector results. The embedding backfill script can process them later. Lexical search still works for memories without embeddings.

7. **Is Phase 0 complete?** Yes.
