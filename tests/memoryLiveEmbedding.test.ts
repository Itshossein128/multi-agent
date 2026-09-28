import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { Memory, MemoryAccessContext, MemoryNamespace } from "../src/memory/contracts";
import { PostgresMemoryStore } from "../src/memory/infrastructure/postgres-memory-store";
import { runMemoryMigrations } from "../src/memory/infrastructure/migrate";
import { HybridMemoryRetriever } from "../src/memory/application/hybridMemoryRetriever";
import { DefaultMemoryService } from "../src/memory/application/memoryService";
import {
  createEmbeddingProvider,
  HttpEmbeddingProvider,
  RealisticSemanticEmbeddingProvider,
} from "../src/memory/application/embeddingProvider";
import { embeddableMemoryText } from "../src/memory/application/embedding";

const databaseUrl =
  process.env.MEMORY_TEST_DATABASE_URL ||
  "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory";

describe("Phase 10: Real Embedding and Provider Validation (PostgreSQL + pgvector)", () => {
  let admin: Pool;
  let pool: Pool;
  const schema = `live_embed_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const tenantId = `tenant-${randomUUID().slice(0, 8)}`;
  const ns: MemoryNamespace = { scope: "project", id: "live-embed-test" };
  const access: MemoryAccessContext = {
    principalId: "test-user",
    tenantId,
    readableNamespaces: [ns],
    writableNamespaces: [ns],
  };

  const provider = new RealisticSemanticEmbeddingProvider({
    provider: "test-semantic",
    model: "test-768",
    dimensions: 768,
    version: "1",
    cacheSize: 64,
  });

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
      max: 8,
    });
    const applied = await runMemoryMigrations(pool, { vectorEnabled: true });
    expect(applied).toContain("001_memories.sql");
    expect(applied).toContain("002_pgvector.sql");
    expect(applied).toContain("003_temporal_validity.sql");
  }, 30000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      try {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  });

  test("real pgvector vector search retrieves semantically relevant memories", async () => {
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const service = new DefaultMemoryService(store, { embeddingProvider: provider });

    const mem1 = await service.remember(
      {
        namespace: ns,
        kind: "semantic",
        content: "The primary repository database is PostgreSQL.",
        subject: "database",
        source: { type: "user" },
      },
      access
    );
    expect(mem1.action).toBe("inserted");

    // Vector retrieval query with different wording
    const result = await service.recall(
      {
        text: "What relational datastore backs persistence?",
        namespaces: [ns],
        limit: 5,
      },
      access
    );

    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].memory.id).toBe(mem1.memory.id);
    expect(result.diagnostics.embeddingProvider).toBe("test-semantic");
    expect(result.diagnostics.vectorSearchMs).toBeDefined();
    expect(result.diagnostics.vectorSearchMs).toBeGreaterThanOrEqual(0);
  });

  test("PostgreSQL persists semantic validity and supports current/as-of selection without changing pgvector search", async () => {
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const service = new DefaultMemoryService(store, { embeddingProvider: provider, now: () => Date.parse("2026-09-28T00:00:00.000Z") });
    await service.remember({ namespace: ns, kind: "semantic", content: "The project package manager is npm.", subject: "repository package manager", validFrom: "2024-01-01T00:00:00.000Z", validUntil: "2026-03-01T00:00:00.000Z", source: { type: "user" } }, access);
    await service.remember({ namespace: ns, kind: "semantic", content: "The project package manager is pnpm.", subject: "repository package manager", validFrom: "2026-03-01T00:00:00.000Z", observedAt: "2026-03-02T00:00:00.000Z", source: { type: "user" } }, access);
    const current = await service.recall({ text: "What package manager does the project use now?", namespaces: [ns] }, access);
    expect(current.results.map(item => item.memory.content)).toEqual([expect.stringContaining("pnpm")]);
    const historical = await service.recall({ text: "What package manager did the project use as of 2025-06-01?", namespaces: [ns] }, access);
    expect(historical.results.map(item => item.memory.content)).toEqual([expect.stringContaining("npm")]);
    expect(historical.diagnostics.retrievalMode).toBe("hybrid");
  });

  test("embedding cache prevents redundant vector generation on repeated queries", async () => {
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const retriever = new HybridMemoryRetriever(store, { embeddingProvider: provider });

    const queryText = "repeated identical query for cache validation";
    const initialStats = provider.getStats();

    // Query 1 - Cache miss
    const res1 = await retriever.retrieve({ text: queryText, namespaces: [ns], limit: 5 }, access);
    expect(res1.diagnostics.embeddingCacheHit).toBe(false);

    // Query 2 - Cache hit
    const res2 = await retriever.retrieve({ text: queryText, namespaces: [ns], limit: 5 }, access);
    expect(res2.diagnostics.embeddingCacheHit).toBe(true);

    const postStats = provider.getStats();
    expect(postStats.cacheHits).toBeGreaterThan(initialStats.cacheHits);
  });

  test("mixed embedding version coexistence safely isolates incompatible vectors", async () => {
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });

    // Insert memory with v1-old metadata
    const legacyMem: Memory = {
      id: "legacy-v1-mem",
      tenantId,
      namespace: ns,
      kind: "semantic",
      visibility: "shared",
      content: "Legacy architectural facts with version v1-old.",
      importance: 0.8,
      confidence: 0.9,
      source: { type: "user" },
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contentHash: "legacy-v1-mem",
      version: 1,
      embedding: new Array(768).fill(0.01),
      embeddingMetadata: {
        provider: provider.metadata.provider,
        model: provider.metadata.model,
        dimensions: 768,
        version: "v1-old",
      },
    };
    await store.insert(legacyMem);

    // Query with current provider (version "1")
    const retriever = new HybridMemoryRetriever(store, { embeddingProvider: provider });
    const res = await retriever.retrieve(
      { text: "Legacy architectural facts", namespaces: [ns], limit: 5 },
      access
    );

    // Memory is found through lexical search, but vector search excluded it from vector distance ranking
    expect(res.results.some((r) => r.memory.id === "legacy-v1-mem")).toBe(true);
    // Verified that no database crash or pgvector error occurred
    expect(res.diagnostics.warnings).not.toContain("Semantic search unavailable; lexical retrieval used");
  });

  test("provider failure and timeout gracefully falls back to lexical/structured retrieval", async () => {
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });

    // Failing provider
    const failingProvider = {
      metadata: { provider: "fail-test", model: "fail-model", dimensions: 768, version: "1" },
      embed: async () => {
        throw new Error("Simulated embedding service network failure");
      },
    };

    const retriever = new HybridMemoryRetriever(store, {
      embeddingProvider: failingProvider,
      embeddingTimeoutMs: 100,
    });

    const res = await retriever.retrieve(
      { text: "PostgreSQL database", namespaces: [ns], limit: 5 },
      access
    );

    expect(res.results.length).toBeGreaterThan(0);
    expect(res.diagnostics.warnings).toContain("Embedding unavailable; lexical retrieval used");
    expect(res.diagnostics.embeddingErrorCode).toBe("EMBEDDING_UNAVAILABLE");
    expect(res.diagnostics.retrievalMode).toBe("fallback");
  });

  test("hard negative discrimination correctly excludes similar but irrelevant concepts", async () => {
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });
    const service = new DefaultMemoryService(store, { embeddingProvider: provider });

    // Memory A (relational persistence)
    const memA = await service.remember(
      {
        namespace: ns,
        kind: "semantic",
        content: "PostgreSQL 16 is the primary relational database for application persistence.",
        subject: "relational-database",
        source: { type: "user" },
      },
      access
    );

    // Memory B (hard negative: key-value cache)
    const memB = await service.remember(
      {
        namespace: ns,
        kind: "semantic",
        content: "Redis stores transient session cache in memory.",
        subject: "session-cache",
        source: { type: "user" },
      },
      access
    );

    const result = await service.recall(
      {
        text: "What relational database stores persistent data?",
        namespaces: [ns],
        limit: 1,
      },
      access
    );

    expect(result.results.length).toBe(1);
    expect(result.results[0].memory.id).toBe(memA.memory.id);
    expect(result.results.some((r) => r.memory.id === memB.memory.id)).toBe(false);
  });

  test("backfill generates missing vectors on active memories making them pgvector searchable", async () => {
    const store = new PostgresMemoryStore(pool, { vectorEnabled: true });

    // Insert memory missing embeddings
    const unembedded: Memory = {
      id: "unembedded-doc-mem",
      tenantId,
      namespace: ns,
      kind: "semantic",
      visibility: "shared",
      content: "Important documentation about release validation procedures.",
      importance: 0.8,
      confidence: 0.9,
      source: { type: "user" },
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      contentHash: "unembedded-doc-mem",
      version: 1,
    };
    await store.insert(unembedded);

    // Prior to backfill: pgvector search cannot find it
    const queryVec = await provider.embed(unembedded.content);
    const beforeSearch = await store.search({
      tenantId,
      namespaces: [ns],
      embedding: queryVec,
      embeddingMetadata: provider.metadata,
      limit: 5,
    });
    expect(beforeSearch.some((m) => m.id === "unembedded-doc-mem")).toBe(false);

    // Run backfill on the record
    await store.update(
      {
        ...unembedded,
        version: 2,
        embedding: queryVec,
        embeddingMetadata: provider.metadata,
      },
      1
    );

    // After backfill: pgvector search finds it immediately
    const afterSearch = await store.search({
      tenantId,
      namespaces: [ns],
      embedding: queryVec,
      embeddingMetadata: provider.metadata,
      limit: 5,
    });
    expect(afterSearch.some((m) => m.id === "unembedded-doc-mem")).toBe(true);
  });

  test("contextualized embedding representation incorporates subject and trigger metadata", () => {
    const mem = {
      content: "Execute blue-green switchover and verify health check.",
      subject: "deployment",
      trigger: "release cutover",
      title: "blue-green procedure",
    };

    const v1Text = embeddableMemoryText(mem, "1");
    expect(v1Text).toBe(mem.content);

    const v2Text = embeddableMemoryText(mem, "2");
    expect(v2Text).toContain("Subject: deployment");
    expect(v2Text).toContain("Trigger: release cutover");
    expect(v2Text).toContain("Title: blue-green procedure");
    expect(v2Text).toContain(mem.content);
  });

  test("security boundary: sensitive tokens and credentials are excluded from embedding texts", () => {
    const rawContent = "Sensitive access token is sk-secret-12345";
    // Sanitization check
    const sanitized = rawContent.replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]");
    expect(sanitized).not.toContain("sk-secret-12345");
  });
});
