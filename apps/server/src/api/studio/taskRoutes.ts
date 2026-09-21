import type { Hono } from "hono";
import type { StudioTask } from "../../../../../src/studio/contracts";
import type { PrincipalVariables } from "../shared/http";
import type { TaskService } from "./taskService";

/**
 * Register task CRUD + lifecycle routes on the studio app.
 */
export function registerTaskRoutes(app: Hono<{ Variables: PrincipalVariables }>, tasks: TaskService) {
  app.get("/tasks", async (c) => c.json(await tasks.list(c.get("principal"))));
  app.get("/tasks/:id", async (c) => c.json(await tasks.get(c.req.param("id"), c.get("principal"))));
  app.put("/tasks/:id", async (c) => c.json(await tasks.save(c.req.param("id"), await c.req.json<StudioTask>(), c.get("principal"))));
  app.patch("/tasks/:id", async (c) => c.json(await tasks.patch(c.req.param("id"), await c.req.json<Partial<StudioTask>>(), c.get("principal"))));
  app.post("/tasks", async (c) => c.json(await tasks.create(await c.req.json<Partial<StudioTask>>(), c.get("principal")), 201));
  app.delete("/tasks/:id", async (c) => { await tasks.delete(c.req.param("id"), c.get("principal")); return c.json({ ok: true }); });
  app.put("/tasks", async (c) => c.json(await tasks.replace(await c.req.json<StudioTask[]>(), c.get("principal"))));
  app.post("/tasks/:id/start", async (c) => c.json(await tasks.start(c.req.param("id"), c.get("principal")), 200));
  app.post("/tasks/:id/cancel", async (c) => c.json(await tasks.cancel(c.req.param("id"), c.get("principal")), 200));
  app.post("/tasks/:id/retry", async (c) => c.json(await tasks.retry(c.req.param("id"), c.get("principal")), 200));
  app.post("/tasks/:id/pause", async (c) => c.json(await tasks.pause(c.req.param("id"), c.get("principal")), 200));
  app.post("/tasks/:id/resume", async (c) => c.json(await tasks.resume(c.req.param("id"), c.get("principal")), 200));
}
