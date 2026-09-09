# Phase 6 — Memory

Scope is `.cursor/plans/6.md`, whose numbering differs from the original visual-editor roadmap. This extends Phase 5 and keeps CLI/local executors and a full Memory Explorer outside the implementation.

## Architecture

- Shared memory records, kinds, namespaces, sources, embedding identity, and retrieval results live in `packages/types/src/memory.ts`.
- Backend contracts live in `src/memory/contracts.ts`: MemoryStore, MemoryService, MemoryRetriever, EmbeddingProvider, extractor, write policy, formatter, consolidator and bounded background jobs.
- Application services implement selective writing, hybrid retrieval, deduplication, idempotency, superseding, expiration filtering and diagnostics. They do not import a database driver.
- Infrastructure implements PostgreSQL and in-memory stores, explicit migrations and scoped retention/namespace cleanup.
- AgentRuntime receives services and a trusted access context. Executors receive memory as contextual data and own no persistence.
- LangGraph stores short-term histories in a state channel with a merge reducer and injectable checkpointer. Stable run/thread IDs isolate history. MemorySaver restores checkpoints within one process; durable checkpoint adapters can be injected separately from long-term persistence.

The default formatter emits a marked JSON data block in a separate user/context message. It never rewrites the system prompt. Budget selection includes framing overhead and uses conservative UTF-8 byte accounting; a model tokenizer can be injected for tighter accounting.

## Setup

Use the isolated database and explicit migrations documented in [memory infrastructure](../infrastructure/memory/README.md). The existing Langfuse database is not modified.

| Server variable | Purpose |
| --- | --- |
| MEMORY_DATABASE_URL | Studio PostgreSQL connection string |
| MEMORY_STORE | postgres, disabled, or explicitly in-memory for development/tests |
| MEMORY_VECTOR_ENABLED | true only after applying the optional vector migration |
| MEMORY_DEFAULT_TTL_DAYS | Default 90 days; 0 opts into no default expiration; explicit record expiry takes precedence |
| MEMORY_PRINCIPALS | Server-only JSON array of bearer principals and exact namespace grants |
| MEMORY_EMBEDDINGS_ENABLED | Opt-in independent embedding transport |
| MEMORY_EMBEDDING_URL | Full OpenAI-compatible embedding endpoint, including /embeddings |
| MEMORY_EMBEDDING_PROVIDER / MEMORY_EMBEDDING_MODEL | Identity independent of AgentBackend |
| MEMORY_EMBEDDING_DIMENSIONS / MEMORY_EMBEDDING_VERSION | Vector compatibility identity |
| MEMORY_EMBEDDING_API_KEY | Optional server-side embedding credential |

Without a database URL, long-term storage is disabled unless volatile storage is explicitly selected. A configured PostgreSQL outage never switches to a Map. Startup does not create tables or install extensions. Shutdown drains accepted background jobs and closes the pool.

The embedding adapter supports batching, bounded caching, metadata validation and deadlines. Embedding outages or incompatible vectors degrade to lexical retrieval. Scoring combines semantic/lexical relevance, recency, importance and context in one configurable retriever. High importance alone cannot make an unrelated record relevant.

## Authorization

Each MEMORY_PRINCIPALS entry has token (at least 24 characters), principalId, tenantId, readableNamespaces and writableNamespaces. Optional agentId/workflowId bind the principal to an actor. A namespace is an exact object such as `{ "scope": "agent", "id": "agent-id" }`. Wildcards are rejected.

Provision secrets and grants on the server. Authenticated callers send `Authorization: Bearer <token>`. MemoryAccessResolver is injectable for an existing identity system. Credentials are never AgentRecord fields or workflow data.

Agent settings request access; they do not grant it. Runtime intersects requests with server grants and narrows actor-private access. Every row and query is tenant-scoped. Shared workflow memory requires the matching workflow execution and an explicit grant. Project/organization namespace types support future domain integration without inventing those entities.

Long-term-enabled run creation requires authentication. Its list entry, output, history, cancellation and event stream are restricted to the same principal and tenant. Ownership belongs to RunStore and survives router reconstruction. Runs with memory disabled retain their previous local-development behavior. Runs, ownership and default checkpoints remain process-local.

The browser UI edits configuration only. Until browser identity integration supplies credentials, use an authenticated API caller for long-term-enabled execution. Turning on a setting never bypasses server authorization.

## API and lifecycle

Routes follow the existing server convention:

```text
GET    /memories?scope=agent&namespaceId=<id>&limit=50&offset=0
POST   /memories
GET    /memories/:id
PATCH  /memories/:id
DELETE /memories/:id
POST   /memories/search
```

Search accepts text, explicit namespaces, optional kinds, filters, limit, minScore and maxTokens. Patches cannot move a memory between tenants/namespaces or rewrite provenance. Use expectedVersion to detect stale edits. Management responses omit vectors.

The initial extractor accepts an explicit structured memoryCandidates output channel or a user input beginning with “Remember …”, including the normal input envelope. It does not mine arbitrary output prose or copy RunEvents. Trivial and credential-bearing candidates are rejected. Semantic, episodic and procedural records preserve distinct fields and provenance.

Writing is selective; retries carry stable identities and superseding retires stale facts transactionally. Default background writing uses a bounded application queue, not a durable distributed queue. Required writes finish before success even when background mode was requested.

Existing memory.read/memory.write events carry counts, IDs, timings and outcomes rather than complete content or vectors. Deferred writes can emit events after a run's terminal event; those remain available in history on refresh. Optional memory failures normally preserve agent execution; required-memory failures fail it.

Expired/superseded records are excluded from active retrieval. Both stores expose bounded expiration cleanup and namespace deletion for scheduled retention and trusted entity-lifecycle hooks. Browser-local entity deletion does not automatically delete backend memory: browser IDs are not deletion authority. Integrations must invoke scoped cleanup from their authenticated lifecycle operation.

## Verification

Focused suites: memoryStorage, memoryRetrieval, memoryService, memoryRuntime, memoryApi, memoryEmbedding and memoryEndToEnd. They cover relevance fixtures, isolation, budgets, retries, transactions, expiration/superseding, authenticated APIs, checkpoints, failures and RunEvents.

Set MEMORY_TEST_DATABASE_URL to an isolated test database for live PostgreSQL/pgvector and cross-run persistence tests. Tests use random schemas and drop only those schemas. They require no paid embedding/model calls. See [implementation progress](phase-6-memory-implementation-plan.md) and [independent review](phase-6-memory-review.md) for verification results and remaining limits.
