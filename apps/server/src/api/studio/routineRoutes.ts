import { nowIso, uid, type RoutineRecord, type RoutineScheduleType, type RoutineMisfirePolicy } from "@multi-agent/types";
import type { Hono } from "hono";
import type { StudioStore } from "../../../../../src/studio/contracts";
import { computeNextRun, previewNextRuns } from "../../triggers/routineScheduler";
import type { PrincipalVariables } from "../shared/http";
import { ApiError } from "../shared/http";

export function registerRoutineRoutes(
  app: Hono<{ Variables: PrincipalVariables }>,
  store: StudioStore,
) {
  // List routines
  app.get("/routines", async (c) => {
    const principal = c.get("principal");
    const routines = await store.listRoutines(principal);
    return c.json(routines);
  });

  // Get single routine
  app.get("/routines/:id", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const routine = await store.getRoutine(id, principal);
    if (!routine) throw new ApiError(404, `Routine "${id}" not found`);
    return c.json(routine);
  });

  // Create routine
  app.post("/routines", async (c) => {
    const principal = c.get("principal");
    const body = await c.req.json().catch(() => ({}));

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new ApiError(400, "Routine name is required");

    const scheduleType: RoutineScheduleType = body.scheduleType === "interval" ? "interval" : "cron";
    const scheduleExpr = typeof body.scheduleExpr === "string" ? body.scheduleExpr.trim() : "";
    if (!scheduleExpr) throw new ApiError(400, "Schedule expression is required");

    const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "UTC";
    const targetType = body.targetType === "agent" ? "agent" : body.targetType === "task" ? "task" : "workflow";
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    if (!targetId) throw new ApiError(400, "Target ID is required");

    const misfirePolicy: RoutineMisfirePolicy =
      body.misfirePolicy === "coalesce" ? "coalesce" : body.misfirePolicy === "enqueue" ? "enqueue" : "skip";
    const enabled = body.enabled !== false;

    // Calculate initial nextRunAt
    let nextRunAt: string | null = null;
    if (enabled) {
      try {
        nextRunAt = computeNextRun(scheduleType, scheduleExpr, timezone, new Date()).toISOString();
      } catch (err) {
        throw new ApiError(400, `Invalid schedule expression or timezone: ${(err as Error).message}`);
      }
    }

    const routine: RoutineRecord = {
      id: uid("routine"),
      tenantId: principal.tenantId,
      name,
      description: typeof body.description === "string" ? body.description.trim() : "",
      scheduleType,
      scheduleExpr,
      timezone,
      targetType,
      targetId,
      inputPayload: body.inputPayload && typeof body.inputPayload === "object" ? body.inputPayload : {},
      misfirePolicy,
      enabled,
      nextRunAt,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      ownerId: principal.userId,
    };

    const saved = await store.saveRoutine(routine, principal);
    return c.json(saved, 201);
  });

  // Update routine
  app.put("/routines/:id", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const existing = await store.getRoutine(id, principal);
    if (!existing) throw new ApiError(404, `Routine "${id}" not found`);

    const body = await c.req.json().catch(() => ({}));
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : existing.name;
    const description = typeof body.description === "string" ? body.description.trim() : existing.description;
    const scheduleType: RoutineScheduleType =
      body.scheduleType === "interval" || body.scheduleType === "cron" ? body.scheduleType : existing.scheduleType;
    const scheduleExpr =
      typeof body.scheduleExpr === "string" && body.scheduleExpr.trim() ? body.scheduleExpr.trim() : existing.scheduleExpr;
    const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : existing.timezone;
    const targetType =
      body.targetType === "workflow" || body.targetType === "agent" || body.targetType === "task"
        ? body.targetType
        : existing.targetType;
    const targetId = typeof body.targetId === "string" && body.targetId.trim() ? body.targetId.trim() : existing.targetId;
    const misfirePolicy: RoutineMisfirePolicy =
      body.misfirePolicy === "skip" || body.misfirePolicy === "coalesce" || body.misfirePolicy === "enqueue"
        ? body.misfirePolicy
        : existing.misfirePolicy;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : existing.enabled;

    let nextRunAt = existing.nextRunAt;
    if (
      enabled &&
      (scheduleExpr !== existing.scheduleExpr ||
        scheduleType !== existing.scheduleType ||
        timezone !== existing.timezone ||
        !existing.enabled)
    ) {
      try {
        nextRunAt = computeNextRun(scheduleType, scheduleExpr, timezone, new Date()).toISOString();
      } catch (err) {
        throw new ApiError(400, `Invalid schedule expression or timezone: ${(err as Error).message}`);
      }
    } else if (!enabled) {
      nextRunAt = null;
    }

    const updated: RoutineRecord = {
      ...existing,
      name,
      description,
      scheduleType,
      scheduleExpr,
      timezone,
      targetType,
      targetId,
      inputPayload: body.inputPayload && typeof body.inputPayload === "object" ? body.inputPayload : existing.inputPayload,
      misfirePolicy,
      enabled,
      nextRunAt,
      updatedAt: nowIso(),
    };

    const saved = await store.saveRoutine(updated, principal);
    return c.json(saved);
  });

  // Pause routine
  app.post("/routines/:id/pause", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const existing = await store.getRoutine(id, principal);
    if (!existing) throw new ApiError(404, `Routine "${id}" not found`);

    const updated: RoutineRecord = {
      ...existing,
      enabled: false,
      nextRunAt: null,
      updatedAt: nowIso(),
    };
    await store.saveRoutine(updated, principal);
    return c.json({ ok: true, enabled: false });
  });

  // Resume routine
  app.post("/routines/:id/resume", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const existing = await store.getRoutine(id, principal);
    if (!existing) throw new ApiError(404, `Routine "${id}" not found`);

    let nextRunAt: string | null = null;
    try {
      nextRunAt = computeNextRun(existing.scheduleType, existing.scheduleExpr, existing.timezone, new Date()).toISOString();
    } catch (err) {
      throw new ApiError(400, `Failed to compute next run: ${(err as Error).message}`);
    }

    const updated: RoutineRecord = {
      ...existing,
      enabled: true,
      nextRunAt,
      updatedAt: nowIso(),
    };
    await store.saveRoutine(updated, principal);
    return c.json({ ok: true, enabled: true, nextRunAt });
  });

  // Delete routine
  app.delete("/routines/:id", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const existing = await store.getRoutine(id, principal);
    if (!existing) throw new ApiError(404, `Routine "${id}" not found`);
    await store.deleteRoutine(id, principal);
    return c.json({ ok: true });
  });

  // Routine execution history
  app.get("/routines/:id/history", async (c) => {
    const principal = c.get("principal");
    const id = c.req.param("id");
    const existing = await store.getRoutine(id, principal);
    if (!existing) throw new ApiError(404, `Routine "${id}" not found`);
    const history = await store.listRoutineHistory(id, principal);
    return c.json(history);
  });

  // Preview routine schedule
  app.post("/routines/preview", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const scheduleType: RoutineScheduleType = body.scheduleType === "interval" ? "interval" : "cron";
    const scheduleExpr = typeof body.scheduleExpr === "string" ? body.scheduleExpr.trim() : "";
    if (!scheduleExpr) throw new ApiError(400, "Schedule expression is required");
    const timezone = typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : "UTC";
    const count = typeof body.count === "number" && body.count > 0 && body.count <= 20 ? body.count : 5;

    try {
      const previews = previewNextRuns(scheduleType, scheduleExpr, timezone, count);
      return c.json({ previews });
    } catch (err) {
      throw new ApiError(400, `Invalid schedule expression or timezone: ${(err as Error).message}`);
    }
  });
}
