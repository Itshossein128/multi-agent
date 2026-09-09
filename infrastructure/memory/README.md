# Studio memory persistence

This Compose project owns a separate PostgreSQL 16/pgvector service, database,
network and named volume. It does not use or modify the Langfuse PostgreSQL service.
Port 55432 binds to loopback. Defaults are for local development; override
`STUDIO_MEMORY_POSTGRES_PASSWORD` and `STUDIO_MEMORY_POSTGRES_PORT` as needed.

From the repository root (PowerShell):

```powershell
docker compose -f infrastructure/memory/compose.yml --profile memory up -d
$env:MEMORY_DATABASE_URL = 'postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory'
node infrastructure/memory/migrate.cjs
# Optional vector extension and generated vector column:
node infrastructure/memory/migrate.cjs --vector
```

The CLI uses the root `pg` and `ts-node` dependencies. The exported
`runMemoryMigrations(pool, { vectorEnabled, directory })` can also be called by an
explicit deployment migration job. It never runs from the adapter constructor.
Migrations are transactional, serialized by an advisory lock, and tracked with
SHA-256 checksums. Changed applied migrations fail; add a new migration rather
than editing deployed SQL. The database user needs schema DDL privileges, and the
optional migration needs permission to create the installed `vector` extension.

```ts
import { PostgresMemoryStore, InMemoryMemoryStore } from "../../src/memory/infrastructure";
const durable = new PostgresMemoryStore(pool, { vectorEnabled: true });
const deterministic = new InMemoryMemoryStore(() => new Date("2026-01-01T00:00:00Z"));
```

`pool` structurally implements `PgPool` (`query`, `connect`; connected clients also
provide `release`). The caller owns pool shutdown. No driver types are imported.
The adapter never silently falls back to volatile storage. Without `vectorEnabled`,
embeddings still round-trip as arrays; an embedding search fails explicitly.

All searches require a tenant and exact `{ scope, id }` namespaces, return at most
500 candidates, default to active/unexpired records, and support kind, metadata
JSONB containment, literal case-insensitive content search and offset. Empty
namespaces return no rows. Vector search requires matching provider, model,
dimensions and version. When an embedding is supplied, text is not an additional
filter: the retrieval layer can union vector and lexical candidates.

Updates require `memory.version === expectedVersion + 1` and match tenant, ID,
namespace and old version. Namespace reassignment is disallowed. The shared
`get(tenantId, id)` / `delete(tenantId, id)` contracts have no namespace parameter;
the service must authorize the fetched namespace before returning/deleting a row.
Store access is a trusted backend boundary, not a browser API.

Use `transaction(JSON.stringify([tenantId, namespace.scope, namespace.id]), callback)`
for deduplication, idempotency and superseding. **Use the callback's store** for all
transaction operations; do not call the parent store from the callback. PostgreSQL
holds a connection and transaction-scoped advisory lock through commit/rollback.
Use the same canonical key for every writer to the namespace. Unique scoped
idempotency keys and optimistic versions also protect nontransactional writes.
Content hashes are indexed, not globally unique: application policy decides when
to merge/reject duplicates. In-memory operations use a global mutex and isolated
copy-on-write state, so rollback cannot erase concurrent writes on other keys and
readers cannot see partial writes. Both adapters reject nested transactions and
callback stores cannot be reused after completion.

`deleteNamespace(tenantId, namespace)` supports explicit project/user/agent cleanup.
`deleteExpired(tenantId, namespace, before?, limit?)` deletes a bounded batch (max
500); repeat until it returns zero. PostgreSQL retention uses `SKIP LOCKED` to
support multiple sweepers. Embeddings are columns on the same row, so deletion
cannot orphan them. These utilities are independent of execution/RunStore retention.

## Verification

```powershell
node node_modules/jest/bin/jest.js tests/memoryStorage.test.ts --runInBand
$env:MEMORY_TEST_DATABASE_URL = $env:MEMORY_DATABASE_URL
node node_modules/jest/bin/jest.js tests/memoryStorage.test.ts --runInBand
```

Live tests use a random `memory_test_<uuid>` schema and drop only that schema at
completion. Use the isolated Studio database, never the Langfuse database. The
optional migration may install `vector` in `public`; tests deliberately do not
drop a database-wide extension. Set `MEMORY_TEST_VECTOR=0` for plain PostgreSQL.
Absent a database URL, live tests explicitly skip. No embedding/network AI calls
are made. Stop the local service with `docker compose -f infrastructure/memory/compose.yml
--profile memory stop`; the data volume is retained.

## Optional HNSW index

Exact cosine search uses a materialized, tenant/namespace/model/version-filtered
CTE before ordering; it remains exact even when an ANN index exists. This does
scan all eligible vectors inside PostgreSQL, while returned candidates are bounded.
Keep this path for relevance evaluation. For large deployments, an operator can
add a separate, reviewed migration with an index for one specific model/version
and fixed dimensions, for example:

```sql
CREATE INDEX CONCURRENTLY studio_memories_hnsw_example
ON studio_memories USING hnsw ((embedding_vector::vector(1536)) vector_cosine_ops)
WHERE embedding_provider = 'example' AND embedding_model = 'example-model'
  AND embedding_dimensions = 1536 AND embedding_version = '1'
  AND status = 'active';
```

Run `CREATE INDEX CONCURRENTLY` outside a transaction, after substituting actual
model identifiers/dimensions. Using it requires a separately implemented ANN query
that repeats the partial-index predicates and cast; the current exact query does
not use this index. Measure recall under namespace filters before selecting ANN.
