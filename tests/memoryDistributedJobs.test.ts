import { randomUUID } from "node:crypto";
import { PostgresMemoryJobStore, runMemoryMigrations, type PgPool } from "../src/memory/infrastructure";

const databaseUrl = process.env.MEMORY_TEST_DATABASE_URL;
const describePg = databaseUrl ? describe : describe.skip;
describePg("durable PostgreSQL memory jobs", () => {
  let admin: any, pool: PgPool & { end(): Promise<void> };
  const schema = `memory_jobs_${randomUUID().replace(/-/g, "")}`;
  const namespace = { scope: "project" as const, id: "distributed" };
  beforeAll(async () => {
    const { Pool } = require("pg"); admin = new Pool({ connectionString: databaseUrl }); await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 8 }); await runMemoryMigrations(pool);
  }, 30000);
  afterAll(async () => { await pool?.end(); if(admin){try{await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await admin.end();}} });
  test("four workers claim 100 jobs once and duplicate submissions converge", async () => {
    const jobs = new PostgresMemoryJobStore(pool);
    const submissions = await Promise.all(Array.from({ length: 100 }, (_, index) => jobs.enqueue({ kind: "consolidation", idempotencyKey: `memory:${index}:v1`, tenantId: "tenant-a", namespace, memoryId: `m-${index}` })));
    expect(submissions.filter(x => !x.duplicate)).toHaveLength(100);
    const duplicate = await Promise.all(Array.from({ length: 8 }, () => jobs.enqueue({ kind: "consolidation", idempotencyKey: "memory:0:v1", tenantId: "tenant-a", namespace, memoryId: "m-0" })));
    expect(duplicate.every(x => x.duplicate)).toBe(true);
    const claims = await Promise.all(["a","b","c","d"].map(worker => jobs.claim(worker, 30, 10_000)));
    const all = claims.flat(); expect(all).toHaveLength(100); expect(new Set(all.map(job => job.id)).size).toBe(100);
    await Promise.all(all.map(job => jobs.complete(job.id, job.leasedBy!)));
    expect((await jobs.counts()).completed).toBe(100);
  }, 30000);
  test("expired lease is reclaimed and bounded failures become dead", async () => {
    const jobs = new PostgresMemoryJobStore(pool); const { job } = await jobs.enqueue({ kind: "procedural_learning", idempotencyKey: "reclaim:v1", tenantId: "tenant-a", namespace });
    const [claimed] = await jobs.claim("dead-worker", 1, 1000); await new Promise(resolve => setTimeout(resolve, 1050));
    const [reclaimed] = await jobs.claim("recovery-worker", 1, 10_000); expect(reclaimed.id).toBe(claimed.id); expect(reclaimed.attempts).toBe(2);
    expect(await jobs.fail(reclaimed.id, "recovery-worker", "permanent_error", false)).toBe("dead");
    expect(await jobs.retryDead(job.id)).toBe(true);
  }, 30000);
});
