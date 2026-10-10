import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { PostgresRunStore } from "../apps/server/src/runtime/store/postgresRunStore";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { OfflineTestAgentExecutor } from "../src/agents/runtime/offlineTestAgentExecutor";
import { recoverInterruptedRuns } from "../apps/server/src/runtime/recovery";
import { PostgresBudgetStore } from "../apps/server/src/budgets/budgetStore";
import { RunBudgetController } from "../apps/server/src/budgets/runBudgetController";
import { MemorySaver } from "@langchain/langgraph";
import {
  createSingleAgentWorkflow,
  createAgentRecord,
  nowIso,
  type Run,
  type WorkflowDefinition,
} from "@multi-agent/types";

const databaseUrl =
  process.env.MEMORY_TEST_DATABASE_URL ||
  process.env.STUDIO_DATABASE_URL;

const describeDb = databaseUrl ? describe : describe.skip;

describeDb("PostgreSQL Multi-Instance Run Recovery & Lease Management", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schema: string;

  const tenantId = "tenant-multi-replica";
  const agent = createAgentRecord({ name: "WorkerAgent" });
  const workflow = createSingleAgentWorkflow(agent, "MultiReplicaWorkflow");

  beforeAll(async () => {
    schema = `multi_inst_${randomUUID().replace(/-/g, "")}`;
    adminPool = new Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);

    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
      max: 10,
    });

    const applied = await runStudioMigrations(pool);
    expect(applied).toContain("016_run_execution_leases.sql");
  });

  afterAll(async () => {
    try {
      if (pool) await pool.end();
      if (adminPool) {
        await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await adminPool.end();
      }
    } catch (err) {
      console.error("Cleanup failed:", err);
    }
  });

  test("startup on Replica B does NOT fail, cancel, or steal an active live run on Replica A", async () => {
    const storeA = new PostgresRunStore(pool, {
      instanceId: "replica-A",
      leaseDurationMs: 30_000,
      leaseRenewalIntervalMs: 0,
    });
    const executorA = new RunExecutor(storeA, new OfflineTestAgentExecutor());

    // Replica A starts a run
    const runIdA = "run-active-replica-a";
    storeA.create(
      {
        id: runIdA,
        workflowId: workflow.id,
        status: "running",
        startedAt: nowIso(),
        metadata: {},
        tenantId,
        ownerId: "user-a",
      },
      undefined,
      { workflow, agents: [agent] }
    );
    await storeA.flush();

    // Verify initial lease on Replica A in PostgreSQL
    const resA = await pool.query(
      "SELECT execution_owner_id, execution_lease_expires_at, status FROM studio_runs WHERE id = $1",
      [runIdA]
    );
    expect(resA.rows[0].execution_owner_id).toBe("replica-A");
    expect(resA.rows[0].status).toBe("running");
    expect(new Date(resA.rows[0].execution_lease_expires_at).getTime()).toBeGreaterThan(Date.now());

    // Create a budget reservation on the live run
    const budgetStore = new PostgresBudgetStore(pool);
    await budgetStore.setBudget({
      tenantId,
      scope: "company",
      scopeId: tenantId,
      limitUsd: 100,
      thresholdPercent: 80,
    });
    const reserved = await budgetStore.reserve(runIdA, tenantId, [{ scope: "company", scopeId: tenantId }], 10.0);
    expect(reserved).toBe(true);

    // Now simulate Replica B starting up
    const storeB = new PostgresRunStore(pool, {
      instanceId: "replica-B",
      leaseDurationMs: 30_000,
      leaseRenewalIntervalMs: 0,
    });
    await storeB.hydrate();
    const executorB = new RunExecutor(storeB, new OfflineTestAgentExecutor());

    // Replica B runs recovery
    const recoveryResultB = await recoverInterruptedRuns(executorB, storeB, new MemorySaver(), {
      instanceId: "replica-B",
    });

    // Replica B MUST NOT touch or fail Replica A's live run!
    expect(recoveryResultB.failed).not.toContain(runIdA);
    expect(recoveryResultB.restored).not.toContain(runIdA);

    // Verify DB state remains intact
    const afterRecovery = await pool.query(
      "SELECT execution_owner_id, status, error FROM studio_runs WHERE id = $1",
      [runIdA]
    );
    expect(afterRecovery.rows[0].execution_owner_id).toBe("replica-A");
    expect(afterRecovery.rows[0].status).toBe("running");
    expect(afterRecovery.rows[0].error).toBeNull();

    // Simulate budget recovery on Replica B
    const budgetControllerB = new RunBudgetController(budgetStore);
    await budgetControllerB.recover(await budgetStore.openReservations(), (runId) => {
      const status = storeB.get(runId)?.run.status;
      return !status || status === "completed" || status === "failed" || status === "cancelled";
    });

    // Reservation MUST still be open and not prematurely settled!
    const openReservations = await budgetStore.openReservations();
    expect(openReservations.includes(runIdA)).toBe(true);

    storeA.close();
    storeB.close();
  });

  test("a former owner cannot overwrite a run after another replica claims its expired lease", async () => {
    const runId = `run-fenced-${randomUUID()}`;
    const storeA = new PostgresRunStore(pool, { instanceId: "fence-A", leaseDurationMs: 30_000, leaseRenewalIntervalMs: 0 });
    storeA.create({ id: runId, workflowId: workflow.id, status: "running", startedAt: nowIso(), metadata: {}, tenantId, ownerId: "user-a" });
    await storeA.flush();
    const storeB = new PostgresRunStore(pool, { instanceId: "fence-B", leaseDurationMs: 30_000, leaseRenewalIntervalMs: 0 });
    await storeB.hydrate();
    await pool.query("UPDATE studio_runs SET execution_lease_expires_at = now() - interval '1 second' WHERE id = $1", [runId]);
    expect(await storeB.claimOrphanedRuns({ statuses: ["running"] })).toContainEqual({ id: runId, status: "running" });

    storeA.append(runId, { id: `event-${runId}`, runId, type: "run.started", timestamp: nowIso(), sequence: 0, payload: {} });
    await storeA.flush();
    expect((await pool.query("SELECT count(*)::int AS count FROM studio_run_events WHERE run_id=$1", [runId])).rows[0].count).toBe(0);
    storeA.update(runId, { status: "completed", completedAt: nowIso(), output: { result: "stale" } });
    await storeA.flush();
    const afterStaleWrite = (await pool.query("SELECT status, execution_owner_id, output FROM studio_runs WHERE id=$1", [runId])).rows[0];
    expect(afterStaleWrite.status).toBe("running");
    expect(afterStaleWrite.execution_owner_id).toBe("fence-B");
    expect(afterStaleWrite.output).toBeNull();
    expect(storeA.signal(runId)?.aborted).toBe(true);

    storeB.update(runId, { status: "completed", completedAt: nowIso(), output: { result: "winner" } });
    storeB.append(runId, { id: `event-winner-${runId}`, runId, type: "run.completed", timestamp: nowIso(), sequence: 0, payload: {} });
    await storeB.flush();
    const final = (await pool.query("SELECT status, execution_owner_id, output FROM studio_runs WHERE id=$1", [runId])).rows[0];
    expect(final.status).toBe("completed");
    expect(final.execution_owner_id).toBe("fence-B");
    expect(final.output).toEqual({ result: "winner" });
    expect((await pool.query("SELECT count(*)::int AS count FROM studio_run_events WHERE run_id=$1", [runId])).rows[0].count).toBe(1);
    storeA.close();
    storeB.close();
  });

  test("budget recovery reads a run created after the replica hydrated", async () => {
    const runId = `late-run-${randomUUID()}`;
    const storeB = new PostgresRunStore(pool, { instanceId: "late-B", leaseRenewalIntervalMs: 0 });
    await storeB.hydrate();
    const storeA = new PostgresRunStore(pool, { instanceId: "late-A", leaseRenewalIntervalMs: 0 });
    storeA.create({ id: runId, workflowId: workflow.id, status: "running", startedAt: nowIso(), metadata: {}, tenantId, ownerId: "user-a" });
    await storeA.flush();
    expect(storeB.get(runId)).toBeUndefined();
    const budgetStore = new PostgresBudgetStore(pool);
    expect(await budgetStore.reserve(runId, tenantId, [{ scope: "company", scopeId: tenantId }], 1)).toBe(true);
    const controllerB = new RunBudgetController(budgetStore);
    await controllerB.recover(await budgetStore.openReservations(), async id => {
      const status = await storeB.getDurableStatus(id);
      return !status || status === "completed" || status === "failed" || status === "cancelled";
    });
    expect(await budgetStore.openReservations()).toContain(runId);
    storeA.close();
    storeB.close();
  });

  test("startup on Replica B recovers genuinely orphaned runs safely after lease expiry and settles budget", async () => {
    const runIdOrphaned = "run-orphaned-crashed";
    const pastStamp = new Date(Date.now() - 60_000).toISOString();

    // Insert an orphaned run with an expired lease directly into PostgreSQL
    await pool.query(
      `INSERT INTO studio_runs (
         id, workflow_id, status, started_at, metadata, tenant_id, owner_id,
         execution_owner_id, execution_lease_expires_at, execution_heartbeat_at
       ) VALUES ($1, $2, 'running', $3::timestamptz, '{}'::jsonb, $4, 'user-dead', 'replica-dead', $3::timestamptz, $3::timestamptz)`,
      [runIdOrphaned, workflow.id, pastStamp, tenantId]
    );

    // Insert an open budget reservation for the orphaned run
    const budgetStore = new PostgresBudgetStore(pool);
    await budgetStore.reserve(
      runIdOrphaned,
      tenantId,
      [{ scope: "company", scopeId: tenantId }],
      15.0
    );
    expect((await budgetStore.openReservations()).includes(runIdOrphaned)).toBe(true);

    // Replica B starts up
    const storeB = new PostgresRunStore(pool, {
      instanceId: "replica-B",
      leaseDurationMs: 30_000,
      leaseRenewalIntervalMs: 0,
    });
    await storeB.hydrate();
    const executorB = new RunExecutor(storeB, new OfflineTestAgentExecutor());

    // Run recovery on Replica B
    const recoveryResultB = await recoverInterruptedRuns(executorB, storeB, new MemorySaver(), {
      instanceId: "replica-B",
    });

    // Orphaned run whose lease expired MUST be claimed and failed honestly
    expect(recoveryResultB.failed).toContain(runIdOrphaned);
    await storeB.flush();

    // Verify DB state in PostgreSQL: marked failed, error recorded, and fenced to the recovering owner.
    const row = (await pool.query("SELECT status, error, execution_owner_id FROM studio_runs WHERE id = $1", [runIdOrphaned])).rows[0];
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/lease expired|restart/i);
    expect(row.execution_owner_id).toBe("replica-B");

    // Now run budget recovery on Replica B
    const budgetControllerB = new RunBudgetController(budgetStore);
    await budgetControllerB.recover(await budgetStore.openReservations(), (runId) => {
      const status = storeB.get(runId)?.run.status;
      return !status || status === "completed" || status === "failed" || status === "cancelled";
    });

    // Budget reservation for genuinely terminal run IS now settled!
    const openAfter = await budgetStore.openReservations();
    expect(openAfter.includes(runIdOrphaned)).toBe(false);

    storeB.close();
  });

  test("recovers orphaned queued runs and waiting_for_human runs, while preserving active ones", async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const pastDate = new Date(Date.now() - 60_000).toISOString();

    const queuedActive = "queued-active-a";
    const queuedOrphan = "queued-orphan-dead";
    const waitingActive = "waiting-active-a";
    const waitingOrphan = "waiting-orphan-dead";

    // 1. Queued with active lease on Replica A
    await pool.query(
      `INSERT INTO studio_runs (
         id, workflow_id, status, started_at, metadata, tenant_id,
         workflow_snapshot, agents_snapshot, execution_owner_id, execution_lease_expires_at
       ) VALUES ($1, $2, 'queued', now(), '{}'::jsonb, $3, $4::jsonb, $5::jsonb, 'replica-A', $6::timestamptz)`,
      [queuedActive, workflow.id, tenantId, JSON.stringify(workflow), JSON.stringify([agent]), futureDate]
    );

    // 2. Queued with expired lease from dead replica
    await pool.query(
      `INSERT INTO studio_runs (
         id, workflow_id, status, started_at, metadata, tenant_id,
         workflow_snapshot, agents_snapshot, execution_owner_id, execution_lease_expires_at
       ) VALUES ($1, $2, 'queued', now(), '{}'::jsonb, $3, $4::jsonb, $5::jsonb, 'replica-dead', $6::timestamptz)`,
      [queuedOrphan, workflow.id, tenantId, JSON.stringify(workflow), JSON.stringify([agent]), pastDate]
    );

    // 3. Waiting for human with active lease on Replica A
    await pool.query(
      `INSERT INTO studio_runs (
         id, workflow_id, status, started_at, metadata, tenant_id,
         workflow_snapshot, agents_snapshot, paused_context, execution_owner_id, execution_lease_expires_at
       ) VALUES ($1, $2, 'waiting_for_human', now(), '{}'::jsonb, $3, $4::jsonb, $5::jsonb, $6::jsonb, 'replica-A', $7::timestamptz)`,
      [
        waitingActive,
        workflow.id,
        tenantId,
        JSON.stringify(workflow),
        JSON.stringify([agent]),
        JSON.stringify({ workflow, agents: [agent] }),
        futureDate,
      ]
    );

    // 4. Waiting for human with expired lease from dead replica
    await pool.query(
      `INSERT INTO studio_runs (
         id, workflow_id, status, started_at, metadata, tenant_id,
         workflow_snapshot, agents_snapshot, paused_context, execution_owner_id, execution_lease_expires_at
       ) VALUES ($1, $2, 'waiting_for_human', now(), '{}'::jsonb, $3, $4::jsonb, $5::jsonb, $6::jsonb, 'replica-dead', $7::timestamptz)`,
      [
        waitingOrphan,
        workflow.id,
        tenantId,
        JSON.stringify(workflow),
        JSON.stringify([agent]),
        JSON.stringify({ workflow, agents: [agent] }),
        pastDate,
      ]
    );

    // Replica B starts up
    const storeB = new PostgresRunStore(pool, {
      instanceId: "replica-B",
      leaseDurationMs: 30_000,
      leaseRenewalIntervalMs: 0,
    });
    await storeB.hydrate();
    const executorB = new RunExecutor(storeB, new OfflineTestAgentExecutor());

    const recovery = await recoverInterruptedRuns(executorB, storeB, new MemorySaver(), {
      instanceId: "replica-B",
    });

    // Active runs on Replica A must NOT be claimed or restored by Replica B
    expect(recovery.restored).not.toContain(queuedActive);
    expect(recovery.restored).not.toContain(waitingActive);
    expect(recovery.failed).not.toContain(queuedActive);
    expect(recovery.failed).not.toContain(waitingActive);

    // Orphaned runs with expired leases MUST be claimed and restored by Replica B
    expect(recovery.restored).toContain(queuedOrphan);
    expect(recovery.restored).toContain(waitingOrphan);

    // Verify owner was transferred to Replica B in PostgreSQL
    const checkOrphans = await pool.query(
      "SELECT id, execution_owner_id FROM studio_runs WHERE id = ANY($1::text[])",
      [[queuedOrphan, waitingOrphan]]
    );
    for (const r of checkOrphans.rows) {
      expect(r.execution_owner_id).toBe("replica-B");
    }

    // Wait for the resumed background workflow to reach terminal status
    for (let i = 0; i < 50; i++) {
      const s = storeB.get(queuedOrphan)?.run.status;
      if (s === "completed" || s === "failed" || s === "cancelled") break;
      await new Promise(r => setTimeout(r, 50));
    }
    await storeB.flush();
    storeB.close();
  });

  test("concurrent recovery race between Replica B and Replica C claims disjoint sets without duplicates", async () => {
    const pastDate = new Date(Date.now() - 30_000).toISOString();
    const orphanIds: string[] = [];

    for (let i = 0; i < 6; i++) {
      const id = `race-orphan-${i}-${randomUUID().slice(0, 8)}`;
      orphanIds.push(id);
      await pool.query(
        `INSERT INTO studio_runs (
           id, workflow_id, status, started_at, metadata, tenant_id, execution_owner_id, execution_lease_expires_at
         ) VALUES ($1, $2, 'running', now(), '{}'::jsonb, $3, 'dead-worker', $4::timestamptz)`,
        [id, workflow.id, tenantId, pastDate]
      );
    }

    const storeB = new PostgresRunStore(pool, {
      instanceId: "replica-B-race",
      leaseDurationMs: 30_000,
      leaseRenewalIntervalMs: 0,
    });
    const storeC = new PostgresRunStore(pool, {
      instanceId: "replica-C-race",
      leaseDurationMs: 30_000,
      leaseRenewalIntervalMs: 0,
    });

    await Promise.all([storeB.hydrate(), storeC.hydrate()]);

    const executorB = new RunExecutor(storeB, new OfflineTestAgentExecutor());
    const executorC = new RunExecutor(storeC, new OfflineTestAgentExecutor());

    // Execute concurrent recovery
    const [recB, recC] = await Promise.all([
      recoverInterruptedRuns(executorB, storeB, undefined, { instanceId: "replica-B-race" }),
      recoverInterruptedRuns(executorC, storeC, undefined, { instanceId: "replica-C-race" }),
    ]);

    const failedB = recB.failed.filter((id) => orphanIds.includes(id));
    const failedC = recC.failed.filter((id) => orphanIds.includes(id));

    // Every orphaned run must be claimed exactly once
    expect(failedB.length + failedC.length).toBe(orphanIds.length);

    // Sets must be completely disjoint (no duplicate recovery)
    for (const id of failedB) {
      expect(failedC).not.toContain(id);
    }

    storeB.close();
    storeC.close();
  });
});
