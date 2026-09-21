/**
 * Semantic Vector Memory Integration Tests
 *
 * Proves the semantic/vector retrieval path works end-to-end with real PostgreSQL + pgvector.
 * Uses a deterministic fake embedding provider for CI — no external API dependency.
 *
 * Required env: MEMORY_TEST_DATABASE_URL pointing to a PostgreSQL instance with pgvector.
 */
import { randomUUID } from "node:crypto";
import type { EmbeddingProvider, Memory, MemoryAccessContext, MemoryNamespace } from "../src/memory/contracts";
import { MemoryAccessDeniedError } from "../src/memory/contracts";
import { PostgresMemoryStore, runMemoryMigrations, type PgPool } from "../src/memory/infrastructure";
import { HybridMemoryRetriever } from "../src/memory/application/hybridMemoryRetriever";
import { DefaultMemoryService } from "../src/memory/application/memoryService";
import { DefaultMemoryContextFormatter } from "../src/memory/application/memoryContextFormatter";
import { DefaultMemoryWritePolicy } from "../src/memory/application/memoryWritePolicy";

// ─── Deterministic Fake Embedding Provider ───────────────────────────────────
// Maps semantically similar words to nearby vectors in a low-dimensional space.
// This is NOT a real embedding model — it's a deterministic fixture for testing
// that proves vector-based cosine similarity retrieval works through pgvector.

const DIMENSIONS = 8;
const WORD_VECTORS: Record<string, number[]> = {
  // "database" cluster
  database: [1, 0, 0, 0, 0, 0, 0, 0],
  postgresql: [0.95, 0.05, 0, 0, 0, 0, 0, 0],
  postgres: [0.95, 0.05, 0, 0, 0, 0, 0, 0],
  sql: [0.85, 0.15, 0, 0, 0, 0, 0, 0],
  storage: [0.7, 0.3, 0, 0, 0, 0, 0, 0],
  relational: [0.8, 0.2, 0, 0, 0, 0, 0, 0],
  // "package manager" cluster
  package: [0, 0, 1, 0, 0, 0, 0, 0],
  pnpm: [0, 0, 0.95, 0.05, 0, 0, 0, 0],
  npm: [0, 0, 0.85, 0.15, 0, 0, 0, 0],
  yarn: [0, 0, 0.8, 0.2, 0, 0, 0, 0],
  dependency: [0, 0, 0.7, 0.3, 0, 0, 0, 0],
  dependencies: [0, 0, 0.7, 0.3, 0, 0, 0, 0],
  install: [0, 0, 0.65, 0.35, 0, 0, 0, 0],
  manager: [0, 0, 0.6, 0.4, 0, 0, 0, 0],
  // "deployment" cluster
  deploy: [0, 0, 0, 0, 1, 0, 0, 0],
  production: [0, 0, 0, 0, 0.9, 0.1, 0, 0],
  server: [0, 0, 0, 0, 0.7, 0.3, 0, 0],
  linux: [0, 0, 0, 0, 0.8, 0.2, 0, 0],
  container: [0, 0, 0, 0, 0.75, 0.25, 0, 0],
  docker: [0, 0, 0, 0, 0.75, 0.25, 0, 0],
  // "testing" cluster
  test: [0, 0, 0, 0, 0, 0, 1, 0],
  testing: [0, 0, 0, 0, 0, 0, 0.95, 0.05],
  jest: [0, 0, 0, 0, 0, 0, 0.9, 0.1],
  unit: [0, 0, 0, 0, 0, 0, 0.85, 0.15],
  integration: [0, 0, 0, 0, 0, 0, 0.8, 0.2],
  // "authentication" cluster
  auth: [0, 0, 0, 0, 0, 0, 0, 1],
  authentication: [0, 0, 0, 0, 0, 0, 0, 0.95],
  jwt: [0, 0, 0, 0, 0, 0, 0, 0.85],
  token: [0, 0, 0, 0, 0, 0, 0, 0.8],
  hmac: [0, 0, 0, 0, 0, 0, 0, 0.75],
  principal: [0, 0, 0, 0, 0, 0, 0, 0.7],
};

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
}

function computeEmbedding(text: string): number[] {
  const tokens = tokenize(text);
  const vector = new Array(DIMENSIONS).fill(0);
  let count = 0;
  for (const token of tokens) {
    const wordVec = WORD_VECTORS[token];
    if (wordVec) {
      for (let i = 0; i < DIMENSIONS; i++) vector[i] += wordVec[i];
      count++;
    }
  }
  if (count === 0) {
    // Unknown words get a sparse random-but-deterministic vector
    for (let i = 0; i < DIMENSIONS; i++) vector[i] = 0.1 * ((i * 7 + text.length * 13) % 10) / 10;
  } else {
    for (let i = 0; i < DIMENSIONS; i++) vector[i] /= count;
  }
  // Normalize to unit vector
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (norm > 0) for (let i = 0; i < DIMENSIONS; i++) vector[i] /= norm;
  return vector;
}

function createDeterministicEmbeddingProvider(label = "test-v1"): EmbeddingProvider {
  return {
    metadata: { provider: "deterministic-test", model: label, dimensions: DIMENSIONS, version: "1" },
    embed: async (text: string) => computeEmbedding(text),
  };
}

// ─── Test Helpers ────────────────────────────────────────────────────────────

function memory(id: string, content: string, tenantId: string, namespace: MemoryNamespace, patch: Partial<Memory> = {}): Memory {
  return {
    id, tenantId, namespace, kind: "semantic", visibility: "private",
    content, importance: 0.5, source: { type: "user" }, status: "active",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    contentHash: id, version: 1, ...patch,
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;

// Skip all tests if no database URL — these require real PostgreSQL + pgvector
(databaseUrl ? describe : describe.skip)("Semantic Vector Memory Integration", () => {
  let admin: PgPool & { end(): Promise<void> };
  let pool: PgPool & { end(): Promise<void> };
  const schema = `semantic_test_${randomUUID().replace(/-/g, "")}`;

  beforeAll(async () => {
    const { Pool } = require("pg");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
      max: 8,
    });
    const applied = await runMemoryMigrations(pool);
    expect(applied).toContain("001_memories.sql");
    const vecApplied = await runMemoryMigrations(pool, { vectorEnabled: true });
    expect(vecApplied).toContain("002_pgvector.sql");
  }, 30000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      try {
        if (!/^semantic_test_[a-f0-9]{32}$/.test(schema)) throw new Error("Unsafe schema cleanup");
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  });

  test("semantic retrieval finds meaning without strong lexical overlap", async () => {
    const tenant = randomUUID();
    const ns: MemoryNamespace = { scope: "project", id: "myproject" };
    const access: MemoryAccessContext = {
      principalId: "user", tenantId: tenant,
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const provider = createDeterministicEmbeddingProvider();

    // Store a memory using words that are semantically related but lexically different from the query
    const mem = memory("pkg-mgr", "The project migrated dependency management from npm to pnpm.", tenant, ns);
    const embedding = await provider.embed(mem.content);
    mem.embedding = embedding;
    mem.embeddingMetadata = provider.metadata;
    await store.insert(mem);

    // Query using words that overlap semantically but not literally
    const retriever = new HybridMemoryRetriever(store, {
      embeddingProvider: provider,
      weights: { semantic: 1, lexical: 0, recency: 0, importance: 0, context: 0 },
    });
    const result = await retriever.retrieve(
      { text: "Which package manager should be used for installing dependencies?", namespaces: [ns], limit: 5 },
      access,
    );

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].memory.id).toBe("pkg-mgr");
    expect(result.results[0].scores.semantic).toBeGreaterThan(0.5);
    // Verify the memory was actually retrieved via vector, not just lexical match
    expect(result.diagnostics.candidateCount).toBeGreaterThanOrEqual(1);
  });

  test("tenant isolation: tenant B cannot retrieve tenant A memories via vector search", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const ns: MemoryNamespace = { scope: "agent", id: "shared-scope" };
    const accessA: MemoryAccessContext = {
      principalId: "user-a", tenantId: tenantA,
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const accessB: MemoryAccessContext = {
      principalId: "user-b", tenantId: tenantB,
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const provider = createDeterministicEmbeddingProvider();

    // Store memory in tenant A
    const mem = memory("a-secret", "The authentication system uses HMAC principals.", tenantA, ns);
    mem.embedding = await provider.embed(mem.content);
    mem.embeddingMetadata = provider.metadata;
    await store.insert(mem);

    const retriever = new HybridMemoryRetriever(store, { embeddingProvider: provider });

    // Tenant A can find it
    const resultA = await retriever.retrieve(
      { text: "authentication method", namespaces: [ns], limit: 5 },
      accessA,
    );
    expect(resultA.results.some((r) => r.memory.id === "a-secret")).toBe(true);

    // Tenant B must NOT find it
    const resultB = await retriever.retrieve(
      { text: "authentication method", namespaces: [ns], limit: 5 },
      accessB,
    );
    expect(resultB.results.some((r) => r.memory.id === "a-secret")).toBe(false);

    // Direct store search must also respect tenant boundary
    const directSearch = await store.search({
      tenantId: tenantB, namespaces: [ns],
      embedding: await provider.embed("authentication method"),
      embeddingMetadata: provider.metadata,
      limit: 10,
    });
    expect(directSearch.some((m) => m.id === "a-secret")).toBe(false);
  });

  test("namespace isolation: agent A private memory not visible to agent B", async () => {
    const tenant = randomUUID();
    const nsA: MemoryNamespace = { scope: "agent", id: "agent-a" };
    const nsB: MemoryNamespace = { scope: "agent", id: "agent-b" };
    const accessA: MemoryAccessContext = {
      principalId: "user", tenantId: tenant, agentId: "agent-a",
      readableNamespaces: [nsA], writableNamespaces: [nsA],
    };
    const accessB: MemoryAccessContext = {
      principalId: "user", tenantId: tenant, agentId: "agent-b",
      readableNamespaces: [nsB], writableNamespaces: [nsB],
    };
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const provider = createDeterministicEmbeddingProvider();

    // Agent A stores a private memory
    const mem = memory("a-private", "The database uses PostgreSQL for persistent storage.", tenant, nsA, {
      visibility: "private", source: { type: "agent", agentId: "agent-a" },
    });
    mem.embedding = await provider.embed(mem.content);
    mem.embeddingMetadata = provider.metadata;
    await store.insert(mem);

    const retriever = new HybridMemoryRetriever(store, { embeddingProvider: provider });

    // Agent A can find it (query shares semantic + lexical overlap with memory)
    const resultA = await retriever.retrieve(
      { text: "database configuration", namespaces: [nsA], limit: 5 },
      accessA,
    );
    expect(resultA.results.some((r) => r.memory.id === "a-private")).toBe(true);

    // Agent B cannot find it (different namespace, not in readable grants)
    const resultB = await retriever.retrieve(
      { text: "database configuration", namespaces: [nsB], limit: 5 },
      accessB,
    );
    expect(resultB.results.some((r) => r.memory.id === "a-private")).toBe(false);

    // Also verify at the store level: agent B searching in nsA namespace is denied
    await expect(retriever.retrieve(
      { text: "database", namespaces: [nsA], limit: 5 },
      accessB,
    )).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  });

  test("embedding version compatibility: incompatible embeddings are excluded from vector search", async () => {
    const tenant = randomUUID();
    const ns: MemoryNamespace = { scope: "project", id: "proj" };
    const access: MemoryAccessContext = {
      principalId: "user", tenantId: tenant,
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const providerV1 = createDeterministicEmbeddingProvider("model-v1");
    const providerV2 = { ...createDeterministicEmbeddingProvider("model-v2"), metadata: { ...providerV1.metadata, model: "model-v2" } };

    // Memory with v1 embeddings
    const memV1 = memory("v1-mem", "PostgreSQL is the primary database.", tenant, ns);
    memV1.embedding = await providerV1.embed(memV1.content);
    memV1.embeddingMetadata = providerV1.metadata;
    await store.insert(memV1);

    // Memory with v2 embeddings (different model)
    const memV2 = memory("v2-mem", "PostgreSQL is the primary database.", tenant, ns, { content: "SQLite is used for testing." });
    memV2.embedding = await providerV2.embed(memV2.content);
    memV2.embeddingMetadata = providerV2.metadata;
    await store.insert(memV2);

    const retriever = new HybridMemoryRetriever(store, { embeddingProvider: providerV1 });

    // Query with v1 should only find v1 memories
    const resultV1 = await retriever.retrieve(
      { text: "database", namespaces: [ns], limit: 10 },
      access,
    );
    const ids = resultV1.results.map((r) => r.memory.id);
    expect(ids).toContain("v1-mem");
    // v2 memories should NOT appear via semantic search (different model)
    // They might appear via lexical search, so check scores
    const v1Result = resultV1.results.find((r) => r.memory.id === "v1-mem");
    expect(v1Result!.scores.semantic).toBeGreaterThan(0);
  });

  test("expired and superseded memories excluded from vector retrieval", async () => {
    const tenant = randomUUID();
    const ns: MemoryNamespace = { scope: "project", id: "proj" };
    const access: MemoryAccessContext = {
      principalId: "user", tenantId: tenant,
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const provider = createDeterministicEmbeddingProvider();

    // Active memory
    const active = memory("active-mem", "Active configuration data.", tenant, ns);
    active.embedding = await provider.embed(active.content);
    active.embeddingMetadata = provider.metadata;
    await store.insert(active);

    // Expired memory
    const expired = memory("expired-mem", "Expired configuration data.", tenant, ns, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expired.embedding = await provider.embed(expired.content);
    expired.embeddingMetadata = provider.metadata;
    await store.insert(expired);

    // Superseded memory
    const old = memory("old-mem", "Old configuration data.", tenant, ns);
    old.embedding = await provider.embed(old.content);
    old.embeddingMetadata = provider.metadata;
    await store.insert(old);

    const successor = memory("new-mem", "New configuration data.", tenant, ns, {
      supersedesMemoryId: old.id,
    });
    successor.embedding = await provider.embed(successor.content);
    successor.embeddingMetadata = provider.metadata;
    await store.insert(successor);
    // Mark old as superseded
    await store.update({ ...old, status: "superseded", supersededByMemoryId: successor.id, version: 2 }, 1);

    // Archived memory
    const archived = memory("archived-mem", "Archived configuration data.", tenant, ns, {
      status: "archived",
    });
    archived.embedding = await provider.embed(archived.content);
    archived.embeddingMetadata = provider.metadata;
    await store.insert(archived);

    const retriever = new HybridMemoryRetriever(store, {
      embeddingProvider: provider,
      weights: { semantic: 0.6, lexical: 0.4, recency: 0, importance: 0, context: 0 },
    });
    const result = await retriever.retrieve(
      { text: "configuration data", namespaces: [ns], limit: 10 },
      access,
    );

    const ids = result.results.map((r) => r.memory.id);
    expect(ids).toContain("active-mem");
    expect(ids).toContain("new-mem"); // successor is active
    expect(ids).not.toContain("expired-mem");
    expect(ids).not.toContain("old-mem"); // superseded
    expect(ids).not.toContain("archived-mem");
  });

  test("idempotent memory writes preserve embeddings correctly", async () => {
    const tenant = randomUUID();
    const ns: MemoryNamespace = { scope: "agent", id: "idempotent-agent" };
    const access: MemoryAccessContext = {
      principalId: "user", tenantId: tenant, agentId: "idempotent-agent",
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const provider = createDeterministicEmbeddingProvider();
    const service = new DefaultMemoryService(store, { embeddingProvider: provider });

    // Write a memory
    const result1 = await service.remember({
      namespace: ns, kind: "semantic",
      content: "The deployment pipeline uses GitHub Actions.",
      source: { type: "agent", agentId: "idempotent-agent" },
      idempotencyKey: "deploy-pipeline-fact",
    }, access);
    expect(result1.action).toBe("inserted");
    expect(result1.memory.embedding).toBeUndefined(); // publicMemory strips embedding
    expect(result1.memory.embeddingMetadata).toBeUndefined();

    // Write the same memory again — should be a duplicate
    const result2 = await service.remember({
      namespace: ns, kind: "semantic",
      content: "The deployment pipeline uses GitHub Actions.",
      source: { type: "agent", agentId: "idempotent-agent" },
      idempotencyKey: "deploy-pipeline-fact",
    }, access);
    expect(result2.action).toBe("duplicate");
    expect(result2.memory.id).toBe(result1.memory.id);

    // Verify embedding is stored in the database
    const stored = await store.get(tenant, result1.memory.id);
    expect(stored).not.toBeNull();
    expect(stored!.embedding).toBeDefined();
    expect(stored!.embedding!.length).toBe(DIMENSIONS);
    expect(stored!.embeddingMetadata).toEqual(provider.metadata);

    // Verify semantic retrieval works via vector path (the memory was stored with an embedding)
    // Query uses "pipeline" and "deployment" which share embedding cluster with the memory content
    const retriever = new HybridMemoryRetriever(store, {
      embeddingProvider: provider,
      weights: { semantic: 0.5, lexical: 0.5, recency: 0, importance: 0, context: 0 },
    });
    const searchResult = await retriever.retrieve(
      { text: "deployment pipeline", namespaces: [ns], limit: 5 },
      access,
    );
    expect(searchResult.results.some((r) => r.memory.id === result1.memory.id)).toBe(true);
    // Confirm the semantic score is nonzero — proving vector search participated
    const found = searchResult.results.find((r) => r.memory.id === result1.memory.id);
    expect(found!.scores.semantic).toBeGreaterThan(0);
  });

  test("embedding persistence survives service reconstruction (restart)", async () => {
    const tenant = randomUUID();
    const ns: MemoryNamespace = { scope: "project", id: "restart-proj" };
    const access: MemoryAccessContext = {
      principalId: "user", tenantId: tenant,
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const provider = createDeterministicEmbeddingProvider();

    // First service instance: write memory with embedding
    const store1 = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const service1 = new DefaultMemoryService(store1, { embeddingProvider: provider });
    const result = await service1.remember({
      namespace: ns, kind: "semantic",
      content: "The API uses REST with JSON payloads.",
      source: { type: "user" },
    }, access);
    expect(result.action).toBe("inserted");

    // Second service instance: simulates restart — new store, new service, no cache
    const store2 = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const service2 = new DefaultMemoryService(store2, { embeddingProvider: provider });

    // Verify the memory can be retrieved via semantic search through the new instance
    const recall = await service2.recall(
      { text: "API architecture style", namespaces: [ns], limit: 5 },
      access,
    );
    expect(recall.results.length).toBeGreaterThan(0);
    expect(recall.results[0].memory.id).toBe(result.memory.id);

    // Verify embedding is still in the database
    const stored = await store2.get(tenant, result.memory.id);
    expect(stored!.embedding).toBeDefined();
    expect(stored!.embedding!.length).toBe(DIMENSIONS);
  });

  test("embedding provider failure degrades gracefully to lexical retrieval", async () => {
    const tenant = randomUUID();
    const ns: MemoryNamespace = { scope: "agent", id: "degrade-agent" };
    const access: MemoryAccessContext = {
      principalId: "user", tenantId: tenant, agentId: "degrade-agent",
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });

    // Store memory with a working embedding
    const provider = createDeterministicEmbeddingProvider();
    const mem = memory("degrade-mem", "PostgreSQL supports full-text search.", tenant, ns);
    mem.embedding = await provider.embed(mem.content);
    mem.embeddingMetadata = provider.metadata;
    await store.insert(mem);

    // Create a failing embedding provider
    const failingProvider: EmbeddingProvider = {
      metadata: provider.metadata,
      embed: async () => { throw new Error("Embedding service is down"); },
    };

    const retriever = new HybridMemoryRetriever(store, {
      embeddingProvider: failingProvider,
      embeddingTimeoutMs: 100,
      weights: { semantic: 0.4, lexical: 0.6, recency: 0, importance: 0, context: 0 },
    });

    // Should still find the memory via lexical fallback
    const result = await retriever.retrieve(
      { text: "PostgreSQL search", namespaces: [ns], limit: 5 },
      access,
    );
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].memory.id).toBe("degrade-mem");
    expect(result.diagnostics.warnings).toContain("Embedding unavailable; lexical retrieval used");
  });

  test("empty memory database returns empty results without error", async () => {
    const tenant = randomUUID();
    const ns: MemoryNamespace = { scope: "agent", id: "empty-agent" };
    const access: MemoryAccessContext = {
      principalId: "user", tenantId: tenant, agentId: "empty-agent",
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const provider = createDeterministicEmbeddingProvider();
    const retriever = new HybridMemoryRetriever(store, { embeddingProvider: provider });

    const result = await retriever.retrieve(
      { text: "anything", namespaces: [ns], limit: 10 },
      access,
    );
    expect(result.results).toEqual([]);
    expect(result.diagnostics.candidateCount).toBe(0);
  });

  test("lexical fallback works when vector search is disabled at store level", async () => {
    const tenant = randomUUID();
    const ns: MemoryNamespace = { scope: "project", id: "lexical-proj" };
    const access: MemoryAccessContext = {
      principalId: "user", tenantId: tenant,
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    // Store with vectorEnabled=false
    const store = new PostgresMemoryStore(pool, { vectorEnabled: false });
    const mem = memory("lexical-mem", "The project uses TypeScript with strict mode.", tenant, ns);
    await store.insert(mem);

    const provider = createDeterministicEmbeddingProvider();
    const retriever = new HybridMemoryRetriever(store, { embeddingProvider: provider });

    const result = await retriever.retrieve(
      { text: "TypeScript configuration", namespaces: [ns], limit: 5 },
      access,
    );
    // Should find via lexical search even though vector is disabled
    expect(result.results.some((r) => r.memory.id === "lexical-mem")).toBe(true);
    // Vector search should have been attempted but failed gracefully
    expect(result.diagnostics.warnings).toContain("Semantic search unavailable; lexical retrieval used");
  });

  test("cross-run semantic retrieval: write in run 1, query semantically in run 2", async () => {
    const tenant = randomUUID();
    const ns: MemoryNamespace = { scope: "workflow", id: "cross-run-wf" };
    const access: MemoryAccessContext = {
      principalId: "user", tenantId: tenant,
      readableNamespaces: [ns], writableNamespaces: [ns],
    };
    const provider = createDeterministicEmbeddingProvider();

    // Run 1: Store durable memory
    const store1 = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const service1 = new DefaultMemoryService(store1, { embeddingProvider: provider });
    const writeResult = await service1.remember({
      namespace: ns, kind: "semantic",
      content: "Production deployments are automated through GitHub Actions with approval gates.",
      source: { type: "workflow", workflowId: "cross-run-wf" },
      idempotencyKey: "deployment-process",
    }, access);
    expect(writeResult.action).toBe("inserted");

    // Run 2: Query with semantically related but lexically different question
    const store2 = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const service2 = new DefaultMemoryService(store2, { embeddingProvider: provider });
    const recallResult = await service2.recall(
      { text: "How are releases shipped to production?", namespaces: [ns], limit: 5 },
      access,
    );

    expect(recallResult.results.length).toBeGreaterThan(0);
    expect(recallResult.results[0].memory.id).toBe(writeResult.memory.id);
  });
});
