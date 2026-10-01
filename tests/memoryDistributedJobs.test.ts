import { randomUUID } from "node:crypto";
import { PostgresMemoryJobStore, PostgresMemoryStore, runMemoryMigrations, type PgPool } from "../src/memory/infrastructure";
import { DefaultMemoryService } from "../src/memory/application/memoryService";
import { PostgresRunStore } from "../apps/server/src/runtime/runStore";
import type { MemoryAccessContext } from "../src/memory/contracts";

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
  const access = (id: string): MemoryAccessContext => {
    const namespace = { scope: "project" as const, id };
    return { principalId: "phase-12-tester", tenantId: "tenant-phase-12", readableNamespaces: [namespace], writableNamespaces: [namespace] };
  };
  async function rejectLifecycleJob(kind: "episodic_extraction" | "procedural_learning" | "consolidation") {
    await pool.query(`CREATE OR REPLACE FUNCTION reject_phase_12_job() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.job_kind = '${kind}' THEN RAISE EXCEPTION 'phase_12_injected_${kind}_failure'; END IF;
        RETURN NEW;
      END;
    $$`);
    await pool.query("CREATE TRIGGER phase_12_reject_job BEFORE INSERT ON studio_memory_jobs FOR EACH ROW EXECUTE FUNCTION reject_phase_12_job()");
  }
  async function clearLifecycleJobRejection() {
    await pool.query("DROP TRIGGER IF EXISTS phase_12_reject_job ON studio_memory_jobs");
    await pool.query("DROP FUNCTION IF EXISTS reject_phase_12_job()");
  }
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
  test("idempotency is tenant-isolated and terminal retention never touches active work", async () => {
    const jobs = new PostgresMemoryJobStore(pool);
    const a = await jobs.enqueue({ kind: "episodic_extraction", idempotencyKey: "same-external-run:v1", tenantId: "tenant-a", namespace, runId: "same" });
    const b = await jobs.enqueue({ kind: "episodic_extraction", idempotencyKey: "same-external-run:v1", tenantId: "tenant-b", namespace: { ...namespace, id: "other" }, runId: "same" });
    expect(a.duplicate).toBe(false); expect(b.duplicate).toBe(false);
    const metrics = await jobs.metrics();
    expect(metrics.some(metric => metric.kind === "episodic_extraction" && metric.status === "pending" && metric.count >= 2)).toBe(true);
    expect(await jobs.purgeTerminal(0, 0)).toBeGreaterThanOrEqual(100);
    expect((await jobs.metrics()).some(metric => metric.kind === "episodic_extraction" && metric.status === "pending" && metric.count >= 2)).toBe(true);
  });
  test("three bounded reconcilers recover 100 missing terminal-run intents exactly once", async () => {
    await pool.query(`CREATE TABLE studio_runs (id text PRIMARY KEY, tenant_id text NOT NULL, status text NOT NULL, memory_access jsonb, updated_at timestamptz NOT NULL DEFAULT now())`);
    const access = JSON.stringify({ tenantId: "tenant-reconcile", writableNamespaces: [{ scope: "project", id: "reconcile" }] });
    await pool.query(`INSERT INTO studio_runs (id, tenant_id, status, memory_access)
      SELECT 'reconcile-' || n, 'tenant-reconcile', 'completed', $1::jsonb FROM generate_series(1, 100) n`, [access]);
    const jobs = new PostgresMemoryJobStore(pool);
    // Multiple instances repeatedly run a bounded repair loop; uniqueness is
    // enforced in PostgreSQL rather than by an application-side pre-check.
    await Promise.all(["a", "b", "c"].map(async () => {
      for (let i = 0; i < 10; i++) await jobs.reconcileTerminalRuns(17);
    }));
    const count = await pool.query(`SELECT count(*)::int count FROM studio_memory_jobs WHERE tenant_id='tenant-reconcile' AND job_kind='episodic_extraction'`);
    const missing = await pool.query(`SELECT count(*)::int count FROM studio_runs r WHERE r.tenant_id='tenant-reconcile' AND NOT EXISTS (
      SELECT 1 FROM studio_memory_jobs j WHERE j.tenant_id=r.tenant_id AND j.job_kind='episodic_extraction' AND j.idempotency_key=('episodic:'||r.id||':v1'))`);
    expect(count.rows[0].count).toBe(100);
    expect(missing.rows[0].count).toBe(0);
  }, 30000);
  test("injected episodic job insertion failure rolls back the terminal run, then retry commits both", async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS studio_runs (
      id text PRIMARY KEY, workflow_id text NOT NULL, task_id text, status text NOT NULL, started_at timestamptz NOT NULL,
      completed_at timestamptz, input jsonb, output jsonb, result jsonb, error text, current_node_id text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      memory_owner_principal_id text, memory_owner_tenant_id text, workflow_snapshot jsonb, agents_snapshot jsonb, tools_snapshot jsonb,
      owner_id text, tenant_id text, memory_access jsonb, updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`ALTER TABLE studio_runs
      ADD COLUMN IF NOT EXISTS workflow_id text,
      ADD COLUMN IF NOT EXISTS task_id text,
      ADD COLUMN IF NOT EXISTS started_at timestamptz,
      ADD COLUMN IF NOT EXISTS completed_at timestamptz,
      ADD COLUMN IF NOT EXISTS input jsonb,
      ADD COLUMN IF NOT EXISTS output jsonb,
      ADD COLUMN IF NOT EXISTS result jsonb,
      ADD COLUMN IF NOT EXISTS error text,
      ADD COLUMN IF NOT EXISTS current_node_id text,
      ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS memory_owner_principal_id text,
      ADD COLUMN IF NOT EXISTS memory_owner_tenant_id text,
      ADD COLUMN IF NOT EXISTS workflow_snapshot jsonb,
      ADD COLUMN IF NOT EXISTS agents_snapshot jsonb,
      ADD COLUMN IF NOT EXISTS tools_snapshot jsonb,
      ADD COLUMN IF NOT EXISTS owner_id text`);
    const runId = `atomic-run-${randomUUID()}`, runAccess = access("atomic-run");
    const run = { id: runId, workflowId: "workflow", status: "running" as const, startedAt: "2026-01-01T00:00:00.000Z", metadata: {}, ownerId: runAccess.principalId, tenantId: runAccess.tenantId };
    const failing = new PostgresRunStore(pool, { durableMemoryJobs: true });
    failing.create(run, undefined, undefined, undefined, runAccess); await failing.flush();
    await rejectLifecycleJob("episodic_extraction");
    failing.update(runId, { status: "completed", completedAt: "2026-01-02T00:00:00.000Z" });
    await expect(failing.flush()).rejects.toThrow("phase_12_injected_episodic_extraction_failure");
    expect((await pool.query("SELECT status FROM studio_runs WHERE id=$1", [runId])).rows[0].status).toBe("running");
    expect((await pool.query("SELECT count(*)::int count FROM studio_memory_jobs WHERE run_id=$1", [runId])).rows[0].count).toBe(0);
    await clearLifecycleJobRejection();
    const retry = new PostgresRunStore(pool, { durableMemoryJobs: true }); await retry.hydrate();
    retry.update(runId, { status: "completed", completedAt: "2026-01-02T00:00:00.000Z" }); await retry.flush();
    expect((await pool.query("SELECT status FROM studio_runs WHERE id=$1", [runId])).rows[0].status).toBe("completed");
    expect((await pool.query("SELECT count(*)::int count FROM studio_memory_jobs WHERE run_id=$1 AND job_kind='episodic_extraction'", [runId])).rows[0].count).toBe(1);
  }, 30000);
  test("injected procedural job insertion failure rolls back the episodic memory and all lifecycle intents", async () => {
    const service = new DefaultMemoryService(new PostgresMemoryStore(pool));
    const episodeAccess = access(`episode-${randomUUID()}`), runId = `episode-run-${randomUUID()}`;
    await rejectLifecycleJob("procedural_learning");
    await expect(service.remember({ namespace: episodeAccess.writableNamespaces[0], kind: "episodic", content: "A completed deployment exposed a useful lesson.", source: { type: "workflow", runId } }, episodeAccess)).rejects.toThrow("phase_12_injected_procedural_learning_failure");
    expect((await pool.query("SELECT count(*)::int count FROM studio_memories WHERE tenant_id=$1 AND namespace_id=$2", [episodeAccess.tenantId, episodeAccess.writableNamespaces[0].id])).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int count FROM studio_memory_jobs WHERE run_id=$1", [runId])).rows[0].count).toBe(0);
    await clearLifecycleJobRejection();
    await service.remember({ namespace: episodeAccess.writableNamespaces[0], kind: "episodic", content: "A completed deployment exposed a useful lesson.", source: { type: "workflow", runId } }, episodeAccess);
    expect((await pool.query("SELECT count(*)::int count FROM studio_memories WHERE tenant_id=$1 AND namespace_id=$2", [episodeAccess.tenantId, episodeAccess.writableNamespaces[0].id])).rows[0].count).toBe(1);
    expect((await pool.query("SELECT count(*)::int count FROM studio_memory_jobs WHERE run_id=$1 AND job_kind='procedural_learning'", [runId])).rows[0].count).toBe(1);
  }, 30000);
  test("injected consolidation job insertion failure rolls back the memory mutation, then retry commits both", async () => {
    const service = new DefaultMemoryService(new PostgresMemoryStore(pool));
    const memoryAccess = access(`consolidation-${randomUUID()}`);
    const input = { namespace: memoryAccess.writableNamespaces[0], kind: "semantic" as const, content: "The repository uses a documented package manager.", subject: "repository package manager", source: { type: "user" as const } };
    await rejectLifecycleJob("consolidation");
    await expect(service.remember(input, memoryAccess)).rejects.toThrow("phase_12_injected_consolidation_failure");
    expect((await pool.query("SELECT count(*)::int count FROM studio_memories WHERE tenant_id=$1 AND namespace_id=$2", [memoryAccess.tenantId, memoryAccess.writableNamespaces[0].id])).rows[0].count).toBe(0);
    await clearLifecycleJobRejection();
    await service.remember(input, memoryAccess);
    expect((await pool.query("SELECT count(*)::int count FROM studio_memories WHERE tenant_id=$1 AND namespace_id=$2", [memoryAccess.tenantId, memoryAccess.writableNamespaces[0].id])).rows[0].count).toBe(1);
    expect((await pool.query("SELECT count(*)::int count FROM studio_memory_jobs WHERE tenant_id=$1 AND namespace_id=$2 AND job_kind='consolidation'", [memoryAccess.tenantId, memoryAccess.writableNamespaces[0].id])).rows[0].count).toBe(1);
  }, 30000);
  test("four PostgreSQL-backed instances serialize ordered temporal transitions without duplicate effective writes", async () => {
    const temporalAccess = access(`temporal-${randomUUID()}`), temporalNamespace = temporalAccess.writableNamespaces[0];
    const workers = Array.from({ length: 4 }, () => new DefaultMemoryService(new PostgresMemoryStore(pool), { now: () => Date.parse("2026-10-01T00:00:00.000Z") }));
    const stages = [
      { value: "npm", at: "2024-01-01T00:00:00.000Z" }, { value: "pnpm", at: "2025-01-01T00:00:00.000Z" },
      { value: "bun", at: "2026-01-01T00:00:00.000Z" }, { value: "yarn", at: "2026-06-01T00:00:00.000Z" },
    ];
    let previousId: string | undefined;
    for (const [index, stage] of stages.entries()) {
      const input = { namespace: temporalNamespace, kind: "semantic" as const, content: `The repository package manager is ${stage.value}.`, subject: "repository package manager", validFrom: stage.at, source: { type: "user" as const }, idempotencyKey: `temporal-stage-${index}`,
        ...(previousId ? { replacesMemoryId: previousId } : {}) };
      const writes = await Promise.all(workers.map(worker => worker.remember(input, temporalAccess)));
      expect(writes.filter(write => write.action === "inserted")).toHaveLength(1);
      previousId = writes[0].memory.id;
    }
    const facts = await new PostgresMemoryStore(pool).search({ tenantId: temporalAccess.tenantId, namespaces: [temporalNamespace], kinds: ["semantic"], limit: 20 });
    const ordered = facts.filter(fact => fact.subject === "repository package manager").sort((a, b) => Date.parse(a.validFrom!) - Date.parse(b.validFrom!));
    expect(ordered).toHaveLength(4);
    expect(ordered.map(fact => fact.validUntil ?? null)).toEqual([stages[1].at, stages[2].at, stages[3].at, null]);
    expect(ordered.filter(fact => !fact.validUntil)).toHaveLength(1);
    for (let index = 1; index < ordered.length; index++) expect(ordered[index - 1].validUntil).toBe(ordered[index].validFrom);
    const reader = new DefaultMemoryService(new PostgresMemoryStore(pool), { now: () => Date.parse("2026-10-01T00:00:00.000Z") });
    expect((await reader.recall({ text: "What package manager does the repository use now?", namespaces: [temporalNamespace] }, temporalAccess)).results.map(result => result.memory.content)).toEqual(["The repository package manager is yarn."]);
    expect((await reader.recall({ text: "What package manager did the repository use as of 2025-06-01?", namespaces: [temporalNamespace] }, temporalAccess)).results.map(result => result.memory.content)).toEqual(["The repository package manager is pnpm."]);
    const history = await reader.recall({ text: "Show the package manager history.", namespaces: [temporalNamespace] }, temporalAccess);
    expect(history.results.map(result => result.memory.content)).toEqual(stages.map(stage => `The repository package manager is ${stage.value}.`));
    expect(history.diagnostics.securityViolations).toBe(0);
    expect((await pool.query("SELECT count(*)::int count FROM studio_memories WHERE tenant_id=$1 AND namespace_id=$2", [temporalAccess.tenantId, temporalNamespace.id])).rows[0].count).toBe(4);
  }, 30000);
});
