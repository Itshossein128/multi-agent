import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { Pool } from "pg";
import { runStudioMigrations } from "../src/studio/infrastructure/migrate";
import { PostgresStudioStore } from "../src/studio/infrastructure/postgres-studio-store";
import { createInboundWebhookRouter } from "../apps/server/src/api/studio/webhookTriggerRoutes";
import { encryptWebhookSecret, defaultReplayProtector } from "../apps/server/src/triggers/webhookAuth";
import type {
  TaskComment,
  RoutineRecord,
  WebhookTriggerRecord,
  WebhookDeliveryRecord,
  AgentHeartbeatSettings,
} from "@multi-agent/types";
import { nowIso, uid } from "@multi-agent/types";

const databaseUrl =
  process.env.STUDIO_DATABASE_URL ||
  process.env.MEMORY_TEST_DATABASE_URL ||
  "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory";

describe("Event Routines, Triggers & Outbox PostgreSQL Integration", () => {
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
});
