import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { Pool } from "pg";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { createInboundWebhookRouter } from "../apps/server/src/api/studio/webhookTriggerRoutes";
import { encryptWebhookSecret, defaultReplayProtector } from "../apps/server/src/triggers/webhookAuth";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { PostgresRunStore } from "../apps/server/src/runtime/store/postgresRunStore";
import type {
  TaskComment,
  RoutineRecord,
  WebhookTriggerRecord,
  WebhookDeliveryRecord,
  AgentHeartbeatSettings,
} from "@multi-agent/types";
import { nowIso, uid, createSingleAgentWorkflow } from "@multi-agent/types";

const databaseUrl =
  process.env.STUDIO_DATABASE_URL ||
  process.env.MEMORY_TEST_DATABASE_URL;

const describePg = databaseUrl ? describe : describe.skip;

describePg("Event Routines, Triggers & Outbox PostgreSQL Integration", () => {
  let pool: Pool;
  let adminPool: Pool;
  let schema: string;
  let store: PostgresStudioStore;

  const tenantA = "tenant-prod-a";
  const tenantB = "tenant-prod-b";
  const userA = { tenantId: tenantA, userId: "user-a" };
  const userB = { tenantId: tenantB, userId: "user-b" };

  beforeAll(async () => {
    schema = `event_triggers_${randomUUID().replace(/-/g, "")}`;
    adminPool = new Pool({ connectionString: databaseUrl });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);

    pool = new Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
      max: 10,
    });

    // Run all migrations through 012
    const applied = await runStudioMigrations(pool);
    expect(applied).toContain("012_event_routines_triggers.sql");

    store = new PostgresStudioStore(pool);
  });

  afterAll(async () => {
    try {
      if (pool) await pool.end();
      if (adminPool) {
        await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await adminPool.end();
      }
    } catch (err) {
      console.error("Cleanup error in integration tests:", err);
    }
  });

  describe("Task Comments", () => {
    it("saves, lists, and isolates task comments by tenant", async () => {
      await pool.query(
        `INSERT INTO studio_tasks (id, tenant_id, workspace_id, title, description, priority, status, dependencies, retry_count, paused, created_at, updated_at)
         VALUES ('task-100', $1, 'ws-test', 'Test Task 100', '', 'medium', 'running', '[]'::jsonb, 0, false, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [tenantA],
      );

      const commentA: TaskComment = {
        id: uid("comment"),
        tenantId: tenantA,
        taskId: "task-100",
        authorId: "user-a",
        authorType: "user",
        content: "Please check this @agent-reviewer",
        mentions: ["agent-reviewer"],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      await store.saveComment(commentA, userA);

      const commentsA = await store.listComments("task-100", userA);
      expect(commentsA).toHaveLength(1);
      expect(commentsA[0].content).toBe("Please check this @agent-reviewer");
      expect(commentsA[0].mentions).toEqual(["agent-reviewer"]);

      // Cross-tenant check: tenant B cannot view tenant A comments
      const commentsB = await store.listComments("task-100", userB);
      expect(commentsB).toHaveLength(0);
    });
  });

  describe("Trigger Events Outbox & Leased Multi-Worker Claims", () => {
    it("enforces idempotency on duplicate enqueue with same idempotencyKey", async () => {
      const event1 = await store.enqueueTriggerEvent({
        tenantId: tenantA,
        eventType: "task_assignment",
        targetType: "task",
        targetId: "task-100",
        idempotencyKey: "unique-assign-key-1",
        payload: { step: 1 },
      });

      const event2 = await store.enqueueTriggerEvent({
        tenantId: tenantA,
        eventType: "task_assignment",
        targetType: "task",
        targetId: "task-100",
        idempotencyKey: "unique-assign-key-1", // Same key!
        payload: { step: 2 },
      });

      expect(event1.id).toBe(event2.id); // Deduplicated!

      const events = await store.listTriggerEvents({ tenantId: tenantA });
      const matching = events.filter((e) => e.idempotencyKey === "unique-assign-key-1");
      expect(matching).toHaveLength(1);
    });

    it("locks and claims event for worker using FOR UPDATE SKIP LOCKED without collision", async () => {
      const event = await store.enqueueTriggerEvent({
        tenantId: tenantA,
        eventType: "routine_tick",
        targetType: "workflow",
        targetId: "wf-sweep",
        idempotencyKey: `tick-${randomUUID()}`,
        payload: { run: true },
      });

      // Competing workers claim concurrently
      const [worker1Claim, worker2Claim] = await Promise.all([
        store.claimNextTriggerEvent("worker-instance-1", 30),
        store.claimNextTriggerEvent("worker-instance-2", 30),
      ]);

      // Exactly ONE worker must get the lock, the other gets null (or different event)
      const claims = [worker1Claim, worker2Claim].filter(Boolean);
      const claimedForThisEvent = claims.filter((c) => c?.id === event.id);
      expect(claimedForThisEvent).toHaveLength(1);

      const winningClaim = claimedForThisEvent[0]!;
      expect(winningClaim.status).toBe("processing");
      expect(winningClaim.lockedBy).toMatch(/^worker-instance-[12]$/);

      // Finish event
      await store.updateTriggerEvent(winningClaim.id, {
        status: "processed",
        dispatchedRunId: "run-999",
      });

      const updated = await store.listTriggerEvents({ tenantId: tenantA });
      const processedEvent = updated.find((e) => e.id === event.id);
      expect(processedEvent?.status).toBe("processed");
      expect(processedEvent?.dispatchedRunId).toBe("run-999");
    });

    it("enforces CAS lease check on PostgreSQL preventing stolen/expired leases from clobbering state", async () => {
      const event = await store.enqueueTriggerEvent({
        tenantId: tenantA,
        eventType: "routine_tick",
        targetType: "workflow",
        targetId: "wf-cas-pg",
        idempotencyKey: `cas-pg-${randomUUID()}`,
        payload: { test: true },
      });

      const claimed = await store.claimNextTriggerEvent("worker-cas-1", 60);
      expect(claimed?.id).toBe(event.id);
      expect(claimed?.lockedBy).toBe("worker-cas-1");

      // Simulate lease expiration where worker-cas-2 claims the lock
      await pool.query(
        `UPDATE studio_trigger_events SET locked_by = 'worker-cas-2', locked_until = now() + interval '60 seconds' WHERE id = $1`,
        [event.id],
      );

      // worker-cas-1 attempts CAS update
      const updateResult = await store.updateTriggerEvent(
        event.id,
        { status: "processed", dispatchedRunId: "run-stale" },
        "worker-cas-1", // expectedLockedBy
      );

      expect(updateResult).toBeNull(); // CAS rejected!

      // Verify row in DB was not clobbered
      const dbRow = await pool.query(`SELECT status, locked_by FROM studio_trigger_events WHERE id = $1`, [event.id]);
      expect(dbRow.rows[0].status).toBe("processing");
      expect(dbRow.rows[0].locked_by).toBe("worker-cas-2");
    });
  });

  describe("Recurring Routines & History", () => {
    it("creates routine, claims due instance, and logs history", async () => {
      const pastDue = new Date(Date.now() - 5000).toISOString();
      const routine: RoutineRecord = {
        id: uid("routine"),
        tenantId: tenantA,
        name: "Nightly Cleanup",
        description: "Cleans cache",
        scheduleType: "cron",
        scheduleExpr: "0 2 * * *",
        timezone: "America/New_York",
        targetType: "workflow",
        targetId: "wf-cleanup",
        inputPayload: {},
        misfirePolicy: "coalesce",
        enabled: true,
        nextRunAt: pastDue,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ownerId: "user-a",
      };

      await store.saveRoutine(routine, userA);

      // Claim due routines across multi-instance
      const due = await store.claimDueRoutines("worker-routine-1", 5);
      const claimed = due.find((r) => r.id === routine.id);
      expect(claimed).toBeDefined();

      // Record execution history
      await store.recordRoutineHistory({
        id: uid("rhist"),
        tenantId: tenantA,
        routineId: routine.id,
        scheduledAt: pastDue,
        executedAt: nowIso(),
        status: "success",
        runId: "run-cleanup-1",
        createdAt: nowIso(),
      });

      const history = await store.listRoutineHistory(routine.id, userA);
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe("success");
      expect(history[0].runId).toBe("run-cleanup-1");

      // Cross-tenant check: tenant B cannot access tenant A routine or history
      const routineB = await store.getRoutine(routine.id, userB);
      expect(routineB).toBeNull();
      const historyB = await store.listRoutineHistory(routine.id, userB);
      expect(historyB).toHaveLength(0);
    });
  });

  describe("Agent Heartbeat Leased Claims", () => {
    it("saves heartbeat settings and claims due heartbeats atomically", async () => {
      const pastDue = new Date(Date.now() - 10_000).toISOString();
      const settings: AgentHeartbeatSettings = {
        agentId: "agent-sentinel",
        tenantId: tenantA,
        enabled: true,
        intervalSeconds: 60,
        lastHeartbeatAt: null,
        nextHeartbeatAt: pastDue,
      };

      await store.saveAgentHeartbeat(settings, userA);

      // Claim due heartbeats
      const due = await store.claimDueHeartbeats("hb-worker-1", 5);
      const claimed = due.find((h) => h.agentId === "agent-sentinel");
      expect(claimed).toBeDefined();

      // Immediate second claim finds no due heartbeat because nextHeartbeatAt was advanced!
      const dueSecond = await store.claimDueHeartbeats("hb-worker-1", 5);
      const claimedSecond = dueSecond.find((h) => h.agentId === "agent-sentinel");
      expect(claimedSecond).toBeUndefined();
    });
  });

  describe("Webhook Triggers & Delivery Audit", () => {
    it("saves webhook trigger, records delivery, and lists delivery logs", async () => {
      const trigger: WebhookTriggerRecord = {
        id: uid("whtrig"),
        tenantId: tenantA,
        name: "Stripe Payment Inbound",
        description: "Handles payment_intent.succeeded",
        secretHash: "enc:aabb:ccdd:eeff",
        targetType: "workflow",
        targetId: "wf-payments",
        enabled: true,
        rateLimitPerMinute: 120,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ownerId: "user-a",
      };

      await store.saveWebhookTrigger(trigger, userA);

      const delivery: WebhookDeliveryRecord = {
        id: uid("deliv"),
        tenantId: tenantA,
        triggerId: trigger.id,
        deliveredAt: nowIso(),
        status: "accepted",
        httpStatus: 202,
        payloadSummary: { event: "payment_intent.succeeded" },
        durationMs: 14,
      };

      await store.recordWebhookDelivery(delivery);

      const deliveries = await store.listWebhookDeliveries(trigger.id, userA);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].httpStatus).toBe(202);
      expect(deliveries[0].status).toBe("accepted");

      // Cross-tenant check: tenant B cannot list tenant A deliveries
      const deliveriesB = await store.listWebhookDeliveries(trigger.id, userB);
      expect(deliveriesB).toHaveLength(0);
    });

    it("handles inbound HTTP webhook with HMAC auth, DB rate limiting, replay rejection after restart, and body overflow", async () => {
      process.env.WEBHOOK_ENCRYPTION_KEY = "test-postgres-webhook-key-32-chars-long!!";
      const router = createInboundWebhookRouter(store);

      const signingSecret = "whsec_0123456789abcdef0123456789abcdef0123456789abcdef";
      const encryptedSecret = encryptWebhookSecret(signingSecret);

      const trigger: WebhookTriggerRecord = {
        id: `whtrig-${randomUUID()}`,
        tenantId: tenantA,
        name: "Inbound Hook",
        description: "",
        secretHash: encryptedSecret,
        targetType: "workflow",
        targetId: "wf-payments",
        enabled: true,
        rateLimitPerMinute: 5,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ownerId: "user-a",
      };

      await store.saveWebhookTrigger(trigger, userA);

      const payload = JSON.stringify({ action: "charge.captured", amount: 5000 });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signedMessage = `${timestamp}.${payload}`;
      const v1 = crypto.createHmac("sha256", signingSecret).update(signedMessage).digest("hex");
      const signatureHeader = `t=${timestamp},v1=${v1}`;

      // 1. Valid request accepts with 202
      const res1 = await router.request(`/triggers/${trigger.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-signature": signatureHeader,
        },
        body: payload,
      });
      expect(res1.status).toBe(202);
      const res1Json = (await res1.json()) as any;
      expect(res1Json.accepted).toBe(true);

      // Verify delivery and outbox event were atomically persisted in PostgreSQL
      const deliveries = await store.listWebhookDeliveries(trigger.id, userA);
      expect(deliveries.length).toBeGreaterThanOrEqual(1);
      expect(deliveries[0].status).toBe("accepted");

      // 2. Replay rejection after restart: clear in-memory cache to simulate restart
      defaultReplayProtector.clear();
      const resReplay = await router.request(`/triggers/${trigger.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-signature": signatureHeader, // Same signature/timestamp!
        },
        body: payload,
      });
      expect(resReplay.status).toBe(409); // Rejected as replay from DB records!

      // 3. Reject oversized body exceeding 1MB (413)
      const resTooLarge = await router.request(`/triggers/${trigger.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(1024 * 1024 + 50),
          "x-webhook-signature": signatureHeader,
        },
        body: "x",
      });
      expect(resTooLarge.status).toBe(413);

      // 4. Rate limit check: trigger limit is 5/min
      // Send 5 more deliveries to exhaust quota
      for (let i = 0; i < 5; i++) {
        const p = JSON.stringify({ i });
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = `t=${ts},v1=${crypto.createHmac("sha256", signingSecret).update(`${ts}.${p}`).digest("hex")}`;
        await router.request(`/triggers/${trigger.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-webhook-signature": sig },
          body: p,
        });
      }

      // Next request should hit 429
      const pOver = JSON.stringify({ over: true });
      const tsOver = String(Math.floor(Date.now() / 1000));
      const sigOver = `t=${tsOver},v1=${crypto.createHmac("sha256", signingSecret).update(`${tsOver}.${pOver}`).digest("hex")}`;
      const res429 = await router.request(`/triggers/${trigger.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-webhook-signature": sigOver },
        body: pOver,
      });
      expect(res429.status).toBe(429);
    });
  });

  describe("Durability, Concurrency & Crash Gap Hardening", () => {
    it("reclaims expired processing lease when worker crashes or stalls (Defect 1)", async () => {
      await pool.query("DELETE FROM studio_trigger_events");

      const event = await store.enqueueTriggerEvent({
        tenantId: tenantA,
        eventType: "task_assignment",
        targetType: "task",
        targetId: "task-reclaim-test",
        idempotencyKey: "test:reclaim:1",
        payload: { test: true },
      });

      // Worker 1 claims with lease of 1 second
      const claimed1 = await store.claimNextTriggerEvent("worker-1", 1);
      expect(claimed1?.id).toBe(event.id);
      expect(claimed1?.lockedBy).toBe("worker-1");
      expect(claimed1?.status).toBe("processing");

      // While lease is active, worker 2 cannot claim it
      const claimed2Active = await store.claimNextTriggerEvent("worker-2", 60);
      expect(claimed2Active).toBeNull();

      // Fast forward database time by expiring the lease
      await pool.query(
        "UPDATE studio_trigger_events SET locked_until = now() - interval '2 seconds' WHERE id = $1",
        [event.id]
      );

      // Worker 2 should now reclaim the expired processing lease!
      const claimed2Reclaim = await store.claimNextTriggerEvent("worker-2", 60);
      expect(claimed2Reclaim).not.toBeNull();
      expect(claimed2Reclaim?.id).toBe(event.id);
      expect(claimed2Reclaim?.lockedBy).toBe("worker-2");
      expect(claimed2Reclaim?.status).toBe("processing");
    });

    it("prevents duplicate runs on restart/crash gap via triggerDispatchKey at run persistence boundary (Defect 2)", async () => {
      const runStore = new PostgresRunStore(pool);
      await runStore.hydrate?.();

      const mockRuntime = {
        execute: jest.fn().mockImplementation(async function* () {
          yield { type: "text", text: "done" };
        }),
      };
      const executor = new RunExecutor(runStore, mockRuntime);
      const agent: any = {
        id: "agent-idemp",
        name: "Agent Idemp",
        description: "Idempotency test agent",
        systemPrompt: "You are a test agent.",
        backend: { type: "api", provider: "openai", model: "gpt-4o" },
        tools: [],
        metadata: {},
        tenantId: tenantA,
        ownerId: userA.userId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await store.saveAgent(agent, userA);

      const workflow = createSingleAgentWorkflow(agent, "Wf Idemp");

      const dispatchKey = `trigger:evt-unique-boundary-${randomUUID()}`;

      // Worker 1 starts run with dispatch key
      const runId1 = executor.start(
        {
          workflow: workflow as any,
          agents: [agent as any],
          input: { a: 1 },
          metadata: { triggerDispatchKey: dispatchKey },
        },
        undefined,
        userA,
      );

      await runStore.flush?.();

      // Verify run exists in DB with dispatchKey
      const res = await pool.query(
        "SELECT id, metadata->>'triggerDispatchKey' as key FROM studio_runs WHERE id = $1",
        [runId1]
      );
      expect(res.rows[0].key).toBe(dispatchKey);

      // Simulate Worker 1 crashing before updating outbox event to processed.
      // Worker 2 (or Worker 1 on retry) calls executor.start with the same dispatchKey.
      const runId2 = executor.start(
        {
          workflow: workflow as any,
          agents: [agent as any],
          input: { a: 1 },
          metadata: { triggerDispatchKey: dispatchKey },
        },
        undefined,
        userA,
      );

      // Must return identical run ID without creating a duplicate run!
      expect(runId2).toBe(runId1);

      // Also verify that direct duplicate DB insert with the same dispatchKey is caught by unique constraint
      const totalRuns = await pool.query(
        "SELECT count(*)::int as count FROM studio_runs WHERE metadata->>'triggerDispatchKey' = $1",
        [dispatchKey]
      );
      expect(totalRuns.rows[0].count).toBe(1);
    });

    it("ensures atomic heartbeat transaction, slot-based stable idempotency, and cross-process busy detection (Defect 3)", async () => {
      const agentId = `agent-hb-durable-${randomUUID().slice(0, 8)}`;
      const agent: any = {
        id: agentId,
        name: "Heartbeat Agent",
        backend: { type: "api", provider: "openai", model: "gpt-4o" },
        tools: [],
        tenantId: tenantA,
        ownerId: userA.userId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await store.saveAgent(agent, userA);

      const hb: AgentHeartbeatSettings = {
        agentId,
        tenantId: tenantA,
        enabled: true,
        intervalSeconds: 60,
        lastHeartbeatAt: null,
        nextHeartbeatAt: new Date(Date.now() - 5000).toISOString(),
        lockedBy: null,
        lockedUntil: null,
      };
      await store.saveAgentHeartbeat(hb, userA);

      // 1. Check isAgentBusy when no active runs exist
      const busyBefore = await store.isAgentBusy(agentId, tenantA);
      expect(busyBefore).toBe(false);

      // 2. Insert active run in Postgres for this agent
      const runId = uid("run");
      await pool.query(
        `INSERT INTO studio_runs (
           id, workflow_id, status, started_at, tenant_id, owner_id, agents_snapshot, metadata
         ) VALUES (
           $1, 'wf-busy', 'running', now(), $2, $3, $4::jsonb, '{}'::jsonb
         )`,
        [runId, tenantA, userA.userId, JSON.stringify([{ id: agentId }])]
      );

      // Durable check must detect agent is busy across processes
      const busyDuring = await store.isAgentBusy(agentId, tenantA);
      expect(busyDuring).toBe(true);

      // When run completes
      await pool.query("UPDATE studio_runs SET status = 'completed' WHERE id = $1", [runId]);
      const busyAfter = await store.isAgentBusy(agentId, tenantA);
      expect(busyAfter).toBe(false);

      // 3. Atomicity: if transaction fails, both heartbeat advance and outbox enqueue are rolled back
      await expect(
        store.transaction(async (tx) => {
          await tx.saveAgentHeartbeat(
            {
              ...hb,
              nextHeartbeatAt: new Date(Date.now() + 60_000).toISOString(),
            },
            userA,
          );
          await tx.enqueueTriggerEvent({
            tenantId: tenantA,
            eventType: "routine_tick",
            targetType: "agent",
            targetId: agentId,
            idempotencyKey: "hb:rollback:test",
            payload: {},
          });
          throw new Error("Simulated worker crash mid-transaction");
        })
      ).rejects.toThrow("Simulated worker crash mid-transaction");

      // Verify heartbeat was NOT advanced and trigger event was NOT enqueued
      const hbAfterRollback = await store.getAgentHeartbeat(agentId, userA);
      expect(hbAfterRollback?.nextHeartbeatAt).toBe(hb.nextHeartbeatAt);
      const events = await store.listTriggerEvents({ tenantId: tenantA, idempotencyKey: "hb:rollback:test" });
      expect(events).toHaveLength(0);
    });

    it("handles concurrent webhook delivery races with strict rate limit cap, replay rejection, and retryability of rejected requests (Defect 4)", async () => {
      const rawSecret = "whsec_integration_race_key_123456789";
      const encryptedSecret = encryptWebhookSecret(rawSecret);

      const trigger: WebhookTriggerRecord = {
        id: uid("whtrig_race"),
        tenantId: tenantA,
        name: "Race Test Trigger",
        description: "",
        secretHash: encryptedSecret,
        targetType: "workflow",
        targetId: "wf-race",
        enabled: true,
        rateLimitPerMinute: 5,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ownerId: userA.userId,
      };
      await store.saveWebhookTrigger(trigger, userA);

      const router = createInboundWebhookRouter(store);

      // 1. Race 20 concurrent requests with different idempotency keys against rate limit of 5
      const promises = Array.from({ length: 20 }, async (_, idx) => {
        const payload = JSON.stringify({ index: idx });
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = `t=${ts},v1=${crypto.createHmac("sha256", rawSecret).update(`${ts}.${payload}`).digest("hex")}`;
        const key = `race-req-${idx}`;
        return router.request(`/triggers/${trigger.id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-webhook-signature": sig,
            "idempotency-key": key,
          },
          body: payload,
        });
      });

      const responses = await Promise.all(promises);
      const acceptedCount = responses.filter((r) => r.status === 202).length;
      const rateLimitedCount = responses.filter((r) => r.status === 429).length;

      // Exactly 5 must be accepted and exactly 15 rejected with 429!
      expect(acceptedCount).toBe(5);
      expect(rateLimitedCount).toBe(15);

      // 2. Replay race: 10 concurrent requests with the SAME idempotency key
      const replayKey = "same-replay-key-for-all";
      const replayPayload = JSON.stringify({ action: "single_charge" });
      const replayTs = String(Math.floor(Date.now() / 1000));
      const replaySig = `t=${replayTs},v1=${crypto.createHmac("sha256", rawSecret).update(`${replayTs}.${replayPayload}`).digest("hex")}`;

      // Reset recent deliveries for this trigger so rate limit doesn't interfere
      await pool.query("DELETE FROM studio_webhook_deliveries WHERE trigger_id = $1", [trigger.id]);

      const replayPromises = Array.from({ length: 10 }, async () => {
        return router.request(`/triggers/${trigger.id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-webhook-signature": replaySig,
            "idempotency-key": replayKey,
          },
          body: replayPayload,
        });
      });

      const replayResponses = await Promise.all(replayPromises);
      const replayAccepted = replayResponses.filter((r) => r.status === 202).length;
      const replayRejected = replayResponses.filter((r) => r.status === 409).length;

      expect(replayAccepted).toBe(1);
      expect(replayRejected).toBe(9);

      // 3. Failed requests are retryable:
      // Send a request with malformed JSON body using key 'retryable-key'
      const retryKey = "retryable-key-after-failure";
      const badBody = "invalid-json-content";
      const badTs = String(Math.floor(Date.now() / 1000));
      const badSig = `t=${badTs},v1=${crypto.createHmac("sha256", rawSecret).update(`${badTs}.${badBody}`).digest("hex")}`;

      const resFail = await router.request(`/triggers/${trigger.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-signature": badSig,
          "idempotency-key": retryKey,
        },
        body: badBody,
      });
      expect(resFail.status).toBe(400);

      // Now retry with valid payload and same retryKey - MUST succeed (202) because partial index only excludes 'accepted'
      const goodBody = JSON.stringify({ fixed: true });
      const goodTs = String(Math.floor(Date.now() / 1000));
      const goodSig = `t=${goodTs},v1=${crypto.createHmac("sha256", rawSecret).update(`${goodTs}.${goodBody}`).digest("hex")}`;

      const resRetry = await router.request(`/triggers/${trigger.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-signature": goodSig,
          "idempotency-key": retryKey,
        },
        body: goodBody,
      });
      expect(resRetry.status).toBe(202);
    });

    it("successfully upgrades from a database where 012 is already applied without checksum failures", async () => {
      const upgradeSchema = `upgrade_test_${randomUUID().replace(/-/g, "")}`;
      await adminPool.query(`CREATE SCHEMA "${upgradeSchema}"`);
      const upgradePool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${upgradeSchema},public`,
      });

      try {
        const names012 = [
          "001_studio_entities.sql",
          "002_runs.sql",
          "003_tasks.sql",
          "004_ownership.sql",
          "005_users.sql",
          "006_task_domain.sql",
          "007_run_tool_snapshot.sql",
          "008_run_result.sql",
          "009_run_memory_access.sql",
          "010_procedural_memory_status.sql",
          "011_projects_workspaces.sql",
          "012_event_routines_triggers.sql",
        ];
        const client = await upgradePool.connect();
        try {
          await client.query("CREATE TABLE studio_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
          const { readFile } = await import("node:fs/promises");
          const { resolve } = await import("node:path");
          const { createHash } = await import("node:crypto");
          const dir = resolve(process.cwd(), "infrastructure/studio/migrations");
          for (const name of names012) {
            const sql = await readFile(resolve(dir, name), "utf8");
            const checksum = createHash("sha256").update(sql).digest("hex");
            await client.query(sql);
            await client.query("INSERT INTO studio_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
          }
        } finally {
          client.release();
        }

        const applied = await runStudioMigrations(upgradePool);
        expect(applied).toContain("013_event_routines_hardening.sql");
        expect(applied).not.toContain("012_event_routines_triggers.sql");

        const colCheck = await upgradePool.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'studio_webhook_deliveries' AND column_name = 'idempotency_key'"
        );
        expect(colCheck.rows).toHaveLength(1);

        const idxCheck = await upgradePool.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'studio_webhook_deliveries_accepted_replay'"
        );
        expect(idxCheck.rows).toHaveLength(1);

        const runIdxCheck = await upgradePool.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'studio_runs_trigger_dispatch_key'"
        );
        expect(runIdxCheck.rows).toHaveLength(1);
      } finally {
        await upgradePool.end();
        await adminPool.query(`DROP SCHEMA IF EXISTS "${upgradeSchema}" CASCADE`);
      }
    });

    it("suppresses duplicate in-memory runs across concurrent workers with PostgreSQL and never executes billable work twice (Defect 2)", async () => {
      const runStoreA = new PostgresRunStore(pool);
      const runStoreB = new PostgresRunStore(pool);
      await Promise.all([runStoreA.hydrate?.(), runStoreB.hydrate?.()]);

      let spyInvocations = 0;
      const spyRuntime = {
        execute: jest.fn().mockImplementation(async function* () {
          spyInvocations++;
          yield { type: "text", text: "step done" };
        }),
      };

      const executorA = new RunExecutor(runStoreA, spyRuntime);
      const executorB = new RunExecutor(runStoreB, spyRuntime);

      const agent: any = {
        id: `agent-spy-${randomUUID().slice(0, 8)}`,
        name: "Spy Test Agent",
        description: "",
        systemPrompt: "Test",
        backend: { type: "api", provider: "openai", model: "gpt-4o" },
        tools: [],
        metadata: {},
        tenantId: tenantA,
        ownerId: userA.userId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await store.saveAgent(agent, userA);
      const workflow = createSingleAgentWorkflow(agent, "Wf Spy Test");

      const dispatchKey = `trigger:evt-race-spy-${randomUUID()}`;

      const [runIdA, runIdB] = await Promise.all([
        Promise.resolve().then(() => executorA.start(
          {
            workflow: workflow as any,
            agents: [agent as any],
            input: { test: 1 },
            metadata: { triggerDispatchKey: dispatchKey },
          },
          undefined,
          userA,
        )),
        Promise.resolve().then(() => executorB.start(
          {
            workflow: workflow as any,
            agents: [agent as any],
            input: { test: 1 },
            metadata: { triggerDispatchKey: dispatchKey },
          },
          undefined,
          userA,
        )),
      ]);

      await Promise.all([runStoreA.flush?.(), runStoreB.flush?.()]);
      await new Promise((r) => setTimeout(r, 100));

      expect(spyInvocations).toBe(1);

      const totalRuns = await pool.query(
        "SELECT count(*)::int as count FROM studio_runs WHERE metadata->>'triggerDispatchKey' = $1",
        [dispatchKey]
      );
      expect(totalRuns.rows[0].count).toBe(1);

      const runStoreC = new PostgresRunStore(pool);
      await runStoreC.hydrate?.();
      const executorC = new RunExecutor(runStoreC, spyRuntime);

      const runIdC = executorC.start(
        {
          workflow: workflow as any,
          agents: [agent as any],
          input: { test: 1 },
          metadata: { triggerDispatchKey: dispatchKey },
        },
        undefined,
        userA,
      );

      await runStoreC.flush?.();
      await new Promise((r) => setTimeout(r, 50));

      expect(spyInvocations).toBe(1);
    });

    it("prevents partial ID false-positives and enforces tenant isolation in isAgentBusy across separate store instances (Defect 3)", async () => {
      const storeInstance2 = new PostgresStudioStore(pool);

      const agentPrefix = `agent-base-${randomUUID().slice(0, 6)}`;
      const agent1 = `${agentPrefix}-1`;
      const agent10 = `${agentPrefix}-10`;

      const runId = uid("run");
      await pool.query(
        `INSERT INTO studio_runs (
           id, workflow_id, status, started_at, tenant_id, owner_id, agents_snapshot, metadata
         ) VALUES (
           $1, 'wf-partial', 'running', now(), $2, $3, $4::jsonb, '{}'::jsonb
         )`,
        [runId, tenantA, userA.userId, JSON.stringify([{ id: agent10, name: "Agent 10" }])]
      );

      const isAgent1Busy = await storeInstance2.isAgentBusy(agent1, tenantA);
      expect(isAgent1Busy).toBe(false);

      const isAgent10BusyTenantA = await storeInstance2.isAgentBusy(agent10, tenantA);
      expect(isAgent10BusyTenantA).toBe(true);

      const isAgent10BusyTenantB = await storeInstance2.isAgentBusy(agent10, tenantB);
      expect(isAgent10BusyTenantB).toBe(false);

      await pool.query("UPDATE studio_runs SET status = 'completed' WHERE id = $1", [runId]);
      const isAgent10BusyAfter = await storeInstance2.isAgentBusy(agent10, tenantA);
      expect(isAgent10BusyAfter).toBe(false);
    });

    it("prioritizes replay detection over rate limiting (409 over 429) and prevents rejected requests from extending rate limit lockout (Defect 4)", async () => {
      const rawSecret = "whsec_replay_precedence_123456789";
      const encryptedSecret = encryptWebhookSecret(rawSecret);

      const trigger: WebhookTriggerRecord = {
        id: uid("whtrig_prec"),
        tenantId: tenantA,
        name: "Replay Precedence Trigger",
        description: "",
        secretHash: encryptedSecret,
        targetType: "workflow",
        targetId: "wf-prec",
        enabled: true,
        rateLimitPerMinute: 2,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ownerId: userA.userId,
      };
      await store.saveWebhookTrigger(trigger, userA);

      const router = createInboundWebhookRouter(store);

      const makeRequest = async (key: string, payloadObj: any = { ok: true }) => {
        const payload = JSON.stringify(payloadObj);
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = `t=${ts},v1=${crypto.createHmac("sha256", rawSecret).update(`${ts}.${payload}`).digest("hex")}`;
        return router.request(`/triggers/${trigger.id}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-webhook-signature": sig,
            "idempotency-key": key,
          },
          body: payload,
        });
      };

      const res1 = await makeRequest("key-1", { step: 1 });
      expect(res1.status).toBe(202);

      const res2 = await makeRequest("key-2", { step: 2 });
      expect(res2.status).toBe(202);

      const res3 = await makeRequest("key-3", { step: 3 });
      expect(res3.status).toBe(429);

      for (let i = 4; i <= 6; i++) {
        const res = await makeRequest(`key-${i}`, { step: i });
        expect(res.status).toBe(429);
      }

      const acceptedCount = await store.countRecentWebhookDeliveries(trigger.id, 60);
      expect(acceptedCount).toBe(2);

      const resReplay = await makeRequest("key-1", { step: 1 });
      expect(resReplay.status).toBe(409);
      const replayBody = await resReplay.json();
      expect(replayBody.error).toMatch(/replay|duplicate/i);
    });
  });
});
