import { randomUUID } from "node:crypto";
import { MemoryConflictError, MemoryValidationError, type Memory, type MemoryStore } from "../src/memory/contracts";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import { PostgresMemoryStore, type PgPool } from "../src/memory/infrastructure/postgres-memory-store";
import { runMemoryMigrations } from "../src/memory/infrastructure/migrate";

const namespace = { scope: "agent" as const, id: "agent-a" };
const embeddingMetadata = { provider: "test", model: "local", dimensions: 3, version: "1" };
function memory(tenantId: string, patch: Partial<Memory> = {}): Memory {
  return { id: randomUUID(), tenantId, namespace, kind: "semantic", visibility: "private", content: "Prefer TypeScript", importance: 0.7, source: { type: "user" }, status: "active", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", contentHash: "hash", version: 1, ...patch };
}
type Adapter = InMemoryMemoryStore | PostgresMemoryStore;
function storageTests(makeStore: () => Adapter, vectors = true) {
  let store: Adapter, tenant: string;
  beforeEach(() => { store = makeStore(); tenant = randomUUID(); });
  test("CRUD round-trips relational and JSON fields and isolates tenants", async () => {
    const record = memory(tenant, { structuredData: { a: [1, true] }, metadata: { project: "p" }, source: { type: "workflow", runId: "r" }, confidence: 0.9, success: false, procedure: "test", embedding: [1, 0, 0], embeddingMetadata });
    await store.insert(record);
    expect(await store.get(tenant, record.id)).toEqual(record);
    expect(await store.get("other", record.id)).toBeNull();
    await store.delete("other", record.id);
    await store.update({ ...record, content: "updated", version: 2 }, 1);
    expect((await store.get(tenant, record.id))?.content).toBe("updated");
    await expect(store.update({ ...record, version: 2 }, 1)).rejects.toBeInstanceOf(MemoryConflictError);
    await expect(store.update({ ...record, namespace: { ...namespace, id: "other" }, version: 3 }, 2)).rejects.toBeInstanceOf(MemoryConflictError);
    await store.delete(tenant, record.id);
    expect(await store.get(tenant, record.id)).toBeNull();
  });
  test("search scopes, metadata containment, expiry, status, kind, paging and literal SQL text", async () => {
    const first = memory(tenant, { id: "a", metadata: { labels: ["a", "b"], nested: { flag: true } } });
    await store.insert(first);
    await store.insert(memory(tenant, { id: "b", content: "literal %_' OR 1=1 --" }));
    await store.insert(memory(tenant, { namespace: { scope: "workflow", id: namespace.id } }));
    await store.insert(memory("other"));
    await store.insert(memory(tenant, { status: "superseded" }));
    await store.insert(memory(tenant, { expiresAt: "2020-01-01T00:00:00.000Z" }));
    const query = { tenantId: tenant, namespaces: [namespace], limit: 10 };
    expect((await store.search(query)).map(m => m.id)).toEqual(["a", "b"]);
    expect(await store.search({ ...query, namespaces: [] })).toEqual([]);
    expect(await store.search({ ...query, filters: { labels: ["b"], nested: { flag: true } } })).toEqual([first]);
    expect((await store.search({ ...query, text: "%_' OR 1=1 --" })).map(m => m.id)).toEqual(["b"]);
    expect((await store.search({ ...query, offset: 1, limit: 1 })).map(m => m.id)).toEqual(["b"]);
    expect(await store.search({ ...query, kinds: ["episodic"] })).toEqual([]);
    expect(await store.search({ ...query, includeExpired: true })).toHaveLength(3);
    expect(await store.search({ ...query, status: "superseded" })).toHaveLength(1);
    await expect(store.search({ ...query, limit: -1 })).rejects.toBeInstanceOf(MemoryValidationError);
    await expect(store.search({ ...query, tenantId: "" })).rejects.toBeInstanceOf(MemoryValidationError);
  });
  test("transaction rolls back insert, update and deletion together", async () => {
    const a = memory(tenant), b = memory(tenant), c = memory(tenant);
    await store.insert(a); await store.insert(b);
    let escaped!: MemoryStore;
    await expect(store.transaction(tenant, async tx => {
      escaped = tx; await tx.update({ ...a, version: 2 }, 1); await tx.delete(tenant, b.id); await tx.insert(c); throw new Error("abort");
    })).rejects.toThrow("abort");
    expect(await store.get(tenant, a.id)).toEqual(a);
    expect(await store.get(tenant, b.id)).toEqual(b);
    expect(await store.get(tenant, c.id)).toBeNull();
    await expect(escaped.insert(c)).rejects.toThrow("closed");
  });
  test("empty metadata filters include absent, empty and populated metadata", async () => {
    const records = [memory(tenant, { id: "absent" }), memory(tenant, { id: "empty", metadata: {} }), memory(tenant, { id: "populated", metadata: { flag: true } })];
    for (const record of records) await store.insert(record);
    const query = { tenantId: tenant, namespaces: [namespace], limit: 10 };
    expect(await store.search({ ...query, filters: {} })).toEqual(records);
    expect(await store.search({ ...query, filters: { flag: true } })).toEqual([records[2]]);
  });
  test("same namespace transactions serialize dedup/idempotency across concurrent retries", async () => {
    const candidate = memory(tenant, { idempotencyKey: "run-node-event" });
    await Promise.all(Array.from({ length: 12 }, () => store.transaction(JSON.stringify([tenant, namespace]), async tx => {
      const prior = await tx.search({ tenantId: tenant, namespaces: [namespace], limit: 100 });
      await new Promise(resolve => setImmediate(resolve));
      if (!prior.length) await tx.insert({ ...candidate, id: randomUUID() });
    })));
    expect(await store.search({ tenantId: tenant, namespaces: [namespace], limit: 100 })).toHaveLength(1);
    await expect(store.insert(candidate)).rejects.toBeInstanceOf(MemoryConflictError);
    await store.insert({ ...candidate, namespace: { scope: "agent", id: "other" } });
  });
  test("optimistic concurrent writers cannot lose updates", async () => {
    const a = memory(tenant); await store.insert(a);
    const writes = await Promise.allSettled([store.update({ ...a, version: 2, content: "one" }, 1), store.update({ ...a, version: 2, content: "two" }, 1)]);
    expect(writes.filter(w => w.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter(w => w.status === "rejected")).toHaveLength(1);
  });
  test("identity and subject filters are exact and namespace scoped", async () => {
    const target = memory(tenant, { contentHash: "exact-hash", idempotencyKey: "exact-key", subject: "theme" });
    await store.insert(target); await store.insert(memory(tenant, { contentHash: "exact-hash-prefix", idempotencyKey: "exact-key-prefix", subject: "theme-prefix" }));
    await store.insert(memory(tenant, { ...target, id: randomUUID(), namespace: { scope: "agent", id: "other" } }));
    const query = { tenantId: tenant, namespaces: [namespace], limit: 10 };
    for (const filter of [{ contentHash: "exact-hash" }, { idempotencyKey: "exact-key" }, { subject: "theme" }]) expect(await store.search({ ...query, ...filter })).toEqual([target]);
  });
  test("candidate output is capped even for an oversized request", async () => {
    await store.transaction(tenant, async tx => {
      for (let i = 0; i < 503; i++) await tx.insert(memory(tenant, { id: `item-${String(i).padStart(4, "0")}` }));
    });
    const rows = await store.search({ tenantId: tenant, namespaces: [namespace], limit: 100000 });
    expect(rows).toHaveLength(500);
    expect((await store.search({ tenantId: tenant, namespaces: [namespace], limit: 100000, offset: 500 })).map(m => m.id)).toEqual(["item-0500", "item-0501", "item-0502"]);
  }, 30000);
  test("superseding is atomic and hides old records", async () => {
    const old = memory(tenant), next = memory(tenant, { supersedesMemoryId: old.id }); await store.insert(old);
    await store.transaction(tenant, async tx => { await tx.insert(next); await tx.update({ ...old, version: 2, status: "superseded", supersededByMemoryId: next.id }, 1); });
    expect(await store.search({ tenantId: tenant, namespaces: [namespace], limit: 10 })).toEqual([next]);
  });
  test("bounded retention and namespace deletion preserve neighboring scopes", async () => {
    const expired = memory(tenant, { expiresAt: "2020-01-01T00:00:00.000Z" });
    await store.insert(expired); await store.insert(memory(tenant, { expiresAt: expired.expiresAt }));
    const neighbor = memory(tenant, { namespace: { scope: "workflow", id: namespace.id } }); await store.insert(neighbor);
    expect(await store.deleteExpired(tenant, namespace, new Date(), 1)).toBe(1);
    expect(await store.deleteNamespace(tenant, namespace)).toBe(1);
    expect(await store.get(tenant, neighbor.id)).toEqual(neighbor);
  });
  (vectors ? test : test.skip)("exact vector ordering excludes other model/version/dimension and namespace", async () => {
    const a = memory(tenant, { id: "near", embedding: [1, 0, 0], embeddingMetadata });
    const b = memory(tenant, { id: "far", embedding: [0, 1, 0], embeddingMetadata });
    await store.insert(b); await store.insert(a);
    for (const patch of [{ version: "2" }, { model: "other" }, { provider: "other" }]) await store.insert(memory(tenant, { embedding: [1, 0, 0], embeddingMetadata: { ...embeddingMetadata, ...patch } }));
    await store.insert(memory(tenant, { embedding: [1, 0], embeddingMetadata: { ...embeddingMetadata, dimensions: 2 } }));
    await store.insert(memory(tenant, { namespace: { scope: "user", id: "other" }, embedding: [1, 0, 0], embeddingMetadata }));
    expect((await store.search({ tenantId: tenant, namespaces: [namespace], embedding: [1, 0, 0], embeddingMetadata, text: "unmatched lexical query", limit: 10 })).map(m => m.id)).toEqual(["near", "far"]);
  });
}
describe("InMemoryMemoryStore", () => {
  storageTests(() => new InMemoryMemoryStore());
  test("rollback cannot erase an unrelated concurrent write; returned data is detached", async () => {
    const store = new InMemoryMemoryStore(), a = memory("a"), b = memory("b");
    const rollback = store.transaction("a", async tx => { await tx.insert(a); await new Promise(resolve => setImmediate(resolve)); throw new Error("abort"); });
    const write = store.insert(b);
    await expect(rollback).rejects.toThrow("abort"); await write;
    b.content = "mutated input";
    const returned = (await store.get("b", b.id))!; returned.content = "mutated output";
    expect((await store.get("b", b.id))?.content).toBe("Prefer TypeScript");
  });
});

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("PostgresMemoryStore (isolated real schema)", () => {
  let admin: PgPool & { end(): Promise<void> }, pool: PgPool & { end(): Promise<void> };
  const schema = `memory_test_${randomUUID().replace(/-/g, "")}`;
  const vectorEnabled = process.env.MEMORY_TEST_VECTOR !== "0";
  beforeAll(async () => {
    // Runtime require avoids a dependency on pg's type package.
    const { Pool } = require("pg");
    admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 16 });
    expect(await runMemoryMigrations(pool)).toEqual(["001_memories.sql"]);
    if (vectorEnabled) expect(await runMemoryMigrations(pool, { vectorEnabled })).toEqual(["002_pgvector.sql"]);
    expect(await runMemoryMigrations(pool, { vectorEnabled })).toEqual([]);
  }, 30000);
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); } }
  });
  storageTests(() => new PostgresMemoryStore(pool, { vectorEnabled }), vectorEnabled);
  test("real search SQL uses the metadata GIN index for selective nonempty containment", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tenantId = randomUUID();
      await client.query(`INSERT INTO studio_memories
        (tenant_id, id, namespace_scope, namespace_id, kind, visibility, content, importance, source, status, created_at, updated_at, content_hash, version, metadata)
        SELECT $1, 'explain-' || n, $2, $3, 'semantic', 'private', 'Index fixture', 0.5, '{"type":"system"}'::jsonb, 'active', now(), now(), 'fixture', 1,
          jsonb_build_object('marker', CASE WHEN n = 1 THEN 'rare' ELSE 'common' END, 'nested', jsonb_build_object('flag', n = 1))
        FROM generate_series(1, 2000) AS n`, [tenantId, namespace.scope, namespace.id]);
      await client.query("ANALYZE studio_memories");
      // Small test tables may favor sequential scans. This transaction-local
      // setting verifies index eligibility, not the production planner's choice.
      // Other indexes remain enabled, so the selective metadata GIN must compete.
      await client.query("SET LOCAL enable_seqscan = off");
      let searchSql = "", searchValues: any[] | undefined;
      const recordingPool: PgPool = {
        query: async (sql, values) => { searchSql = sql; searchValues = values; return client.query(sql, values); },
        connect: async () => { throw new Error("Unexpected connection in search"); },
      };
      const store = new PostgresMemoryStore(recordingPool);
      const result = await store.search({ tenantId, namespaces: [namespace], filters: { marker: "rare", nested: { flag: true } }, limit: 10 });
      expect(result.map(row => row.id)).toEqual(["explain-1"]);
      // Explain the adapter's actual parameterized query, not a hand-written proxy.
      const plan = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${searchSql}`, searchValues);
      expect(JSON.stringify(plan.rows)).toContain('"Index Name":"studio_memories_metadata"');
    } finally {
      try { await client.query("ROLLBACK"); } finally { client.release(); }
    }
  });
});
