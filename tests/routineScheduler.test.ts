import {
  parseIntervalSeconds,
  computeNextRun,
  previewNextRuns,
  RoutineScheduler,
} from "../apps/server/src/triggers/routineScheduler";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import type { RoutineRecord } from "@multi-agent/types";

describe("Routine Scheduler & Cron Engine", () => {
  describe("Interval Parsing", () => {
    it("parses interval expressions accurately", () => {
      expect(parseIntervalSeconds("every:30s")).toBe(30);
      expect(parseIntervalSeconds("every:5m")).toBe(300);
      expect(parseIntervalSeconds("every:2h")).toBe(7200);
      expect(parseIntervalSeconds("every:1d")).toBe(86400);
      expect(parseIntervalSeconds("every:120")).toBe(120);
    });

    it("throws for invalid interval expressions", () => {
      expect(() => parseIntervalSeconds("invalid")).toThrow(/Invalid interval schedule expression/);
      expect(() => parseIntervalSeconds("every:0s")).toThrow(/at least 1 second/);
    });
  });

  describe("Next Run Computation", () => {
    it("computes next run for interval schedule", () => {
      const from = new Date("2026-10-05T10:00:00.000Z");
      const next = computeNextRun("interval", "every:5m", "UTC", from);
      expect(next.toISOString()).toBe("2026-10-05T10:05:00.000Z");
    });

    it("computes next run for cron schedule (every 15 minutes)", () => {
      const from = new Date("2026-10-05T10:07:00.000Z");
      const next = computeNextRun("cron", "*/15 * * * *", "UTC", from);
      expect(next.toISOString()).toBe("2026-10-05T10:15:00.000Z");
    });

    it("computes next run across hourly boundary", () => {
      const from = new Date("2026-10-05T10:55:00.000Z");
      const next = computeNextRun("cron", "*/15 * * * *", "UTC", from);
      expect(next.toISOString()).toBe("2026-10-05T11:00:00.000Z");
    });

    it("respects timezone in cron calculation", () => {
      // 09:00 in America/New_York (EDT is UTC-4 in October) -> 13:00 UTC
      const from = new Date("2026-10-05T00:00:00.000Z");
      const next = computeNextRun("cron", "0 9 * * *", "America/New_York", from);
      expect(next.getUTCHours()).toBe(13);
      expect(next.getUTCMinutes()).toBe(0);
    });

    it("generates preview sequence of next runs", () => {
      const from = new Date("2026-10-05T12:00:00.000Z");
      const previews = previewNextRuns("interval", "every:10m", "UTC", 3, from);
      expect(previews).toHaveLength(3);
      expect(previews[0]).toBe("2026-10-05T12:10:00.000Z");
      expect(previews[1]).toBe("2026-10-05T12:20:00.000Z");
      expect(previews[2]).toBe("2026-10-05T12:30:00.000Z");
    });
  });

  describe("RoutineScheduler Lifecycle & Misfire Policies", () => {
    let store: InMemoryStudioStore;

    beforeEach(() => {
      store = new InMemoryStudioStore();
    });

    it("claims and executes due routine and updates nextRunAt", async () => {
      const principal = { tenantId: "tenant-test", userId: "user-test" };
      const pastDue = new Date(Date.now() - 1000).toISOString();

      const routine: RoutineRecord = {
        id: "routine-1",
        tenantId: "tenant-test",
        name: "Test Routine",
        description: "",
        scheduleType: "interval",
        scheduleExpr: "every:60s",
        timezone: "UTC",
        targetType: "workflow",
        targetId: "wf-1",
        inputPayload: { foo: "bar" },
        misfirePolicy: "coalesce",
        enabled: true,
        nextRunAt: pastDue,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ownerId: "user-test",
      };

      await store.saveRoutine(routine, principal);

      const scheduler = new RoutineScheduler(store, { pollIntervalMs: 10000 });
      const processed = await scheduler.tick();

      expect(processed).toHaveLength(1);
      const updated = await store.getRoutine("routine-1", principal);
      expect(updated?.lastStatus).toBe("success");
      expect(updated?.nextRunAt).not.toBe(pastDue);

      // Verify trigger event was enqueued into outbox
      const events = await store.listTriggerEvents({ tenantId: "tenant-test" });
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("routine_tick");
      expect(events[0].targetId).toBe("wf-1");

      // Verify routine execution history was recorded
      const history = await store.listRoutineHistory("routine-1", principal);
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe("success");
    });

    it("applies misfirePolicy: skip when routine is severely overdue", async () => {
      const principal = { tenantId: "tenant-test", userId: "user-test" };
      // 10 minutes overdue (> 60s threshold)
      const tenMinutesAgo = new Date(Date.now() - 600_000).toISOString();

      const routine: RoutineRecord = {
        id: "routine-misfire",
        tenantId: "tenant-test",
        name: "Misfire Routine",
        description: "",
        scheduleType: "interval",
        scheduleExpr: "every:60s",
        timezone: "UTC",
        targetType: "agent",
        targetId: "agent-1",
        inputPayload: {},
        misfirePolicy: "skip",
        enabled: true,
        nextRunAt: tenMinutesAgo,
        lastRunAt: null,
        lastStatus: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ownerId: "user-test",
      };

      await store.saveRoutine(routine, principal);

      const scheduler = new RoutineScheduler(store);
      const processed = await scheduler.tick();

      expect(processed).toHaveLength(1);
      const updated = await store.getRoutine("routine-misfire", principal);
      expect(updated?.lastStatus).toBe("skipped");
      expect(updated?.lastError).toBe("misfire_skip");

      // Verify no trigger run was enqueued for skipped misfire
      const events = await store.listTriggerEvents({ tenantId: "tenant-test" });
      expect(events).toHaveLength(0);

      // History logs the skipped execution
      const history = await store.listRoutineHistory("routine-misfire", principal);
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe("skipped");
    });
  });
});
