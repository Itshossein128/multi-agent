import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { MemoryRetrievalQuery, RememberMemoryInput } from "@multi-agent/types";
import { MemoryAccessDeniedError, MemoryConflictError, MemoryValidationError, type MemoryAccessContext, type MemoryService, type UpdateMemoryInput } from "../../../../src/memory/contracts";
import type { MemoryAccessResolver } from "../memory/access";
import { MemoryApiService } from "./memories/memoryApiService";

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
  return app;
}
