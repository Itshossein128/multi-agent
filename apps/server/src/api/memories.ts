import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { MemoryRetrievalQuery, RememberMemoryInput } from "@multi-agent/types";
import { MemoryAccessDeniedError, MemoryConflictError, MemoryValidationError, type MemoryAccessContext, type MemoryService, type UpdateMemoryInput } from "../../../../src/memory/contracts";
import { MemoryFeedbackLedger, type MemoryFeedbackRecord, type MemoryFeedbackSummary, type MemoryUsefulnessLabel } from "../../../../src/memory/contracts";
import type { MemoryAccessResolver } from "../memory/access";
import { MemoryApiService } from "./memories/memoryApiService";

/**
 * Phase 8: usefulness feedback ledger. Shared per router instance; labels are
 * provenance-tracked and never mutate memory truth/confidence/reinforcement.
 */
const feedbackLedger = new MemoryFeedbackLedger();

export function createMemoriesRouter(service: MemoryService | undefined, resolveAccess: MemoryAccessResolver) {
  const app = new Hono<{ Variables: { memoryAccess: MemoryAccessContext } }>();
  const api = service ? new MemoryApiService(service) : undefined;
  app.use("*", bodyLimit({ maxSize: 128 * 1024, onError: (c) => c.json({ error: "Memory request is too large." }, 413) }));
  app.use("*", async (c, next) => {
    const access = await resolveAccess(c.req.raw);
    if (!access) return c.json({ error: "Memory authentication required." }, 401);
    if (!api) return c.json({ error: "Long-term memory persistence is not configured." }, 503);
    c.set("memoryAccess", access);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof MemoryAccessDeniedError) return c.json({ error: "Memory access denied." }, 403);
    if (error instanceof MemoryConflictError) return c.json({ error: "Memory changed; reload and retry." }, 409);
    if (error instanceof MemoryValidationError || error instanceof SyntaxError) return c.json({ error: error instanceof SyntaxError ? "Invalid JSON." : error.message }, 400);
    return c.json({ error: "Memory operation failed." }, 503);
  });
  app.get("/", async (c) => c.json(await api!.list(new URL(c.req.url), c.get("memoryAccess"))));
  app.post("/search", async (c) => c.json(await api!.search(await c.req.json<MemoryRetrievalQuery>(), c.get("memoryAccess"))));
  app.post("/", async (c) => {
    const result = await api!.remember(await c.req.json<RememberMemoryInput>(), c.get("memoryAccess"));
    return c.json(result.body, result.action === "inserted" ? 201 : 200);
  });
  app.get("/:memoryId", async (c) => {
    const result = await api!.get(c.req.param("memoryId"), c.get("memoryAccess"));
    return result ? c.json(result) : c.json({ error: "Memory not found." }, 404);
  });
  app.patch("/:memoryId", async (c) => c.json(await api!.update(c.req.param("memoryId"), await c.req.json<UpdateMemoryInput>(), c.get("memoryAccess"))));
  app.delete("/:memoryId", async (c) => { await api!.forget(c.req.param("memoryId"), c.get("memoryAccess")); return c.body(null, 204); });
  // Phase 8: usefulness feedback. Requires the same bearer authorization as every
  // other route; the memory must exist and be readable by the caller before a
  // label can be attached (no feedback on unauthorized memory).
  app.post("/:memoryId/feedback", async (c) => {
    const body = await c.req.json<{ label?: string; runId?: string; invocationId?: string; reason?: string }>();
    if (!body || !("label" in body)) throw new MemoryValidationError("Feedback label is required.");
    if (!["useful", "neutral", "irrelevant", "harmful", "unknown"].includes(body.label as string)) throw new MemoryValidationError("Invalid feedback label.");
    const memoryId = c.req.param("memoryId");
    const memory = await api!.get(memoryId, c.get("memoryAccess"));
    if (!memory) return c.json({ error: "Memory not found." }, 404);
    const record: MemoryFeedbackRecord = feedbackLedger.record({
      memoryId,
      label: body.label as MemoryUsefulnessLabel,
      providedBy: c.get("memoryAccess").principalId,
      ...(body.runId !== undefined ? { runId: body.runId } : {}),
      ...(body.invocationId !== undefined ? { invocationId: body.invocationId } : {}),
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
    });
    return c.json({ recorded: true, feedback: record }, 201);
  });
  app.get("/:memoryId/feedback", async (c) => {
    const memoryId = c.req.param("memoryId");
    const memory = await api!.get(memoryId, c.get("memoryAccess"));
    if (!memory) return c.json({ error: "Memory not found." }, 404);
    const summary: MemoryFeedbackSummary = feedbackLedger.summary(memoryId);
    return c.json(summary);
  });
  return app;
}
