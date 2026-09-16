import type { Hono } from "hono";
import type { ToolRecord } from "@multi-agent/types";
import type { PrincipalVariables } from "../shared/http";
import type { StudioToolService } from "./toolService";

/**
 * Register tool CRUD routes on the studio app.
 */
export function registerToolRoutes(app: Hono<{ Variables: PrincipalVariables }>, tools: StudioToolService) {
  app.get("/tools", async (c) => c.json(await tools.list(c.get("principal"))));
  app.get("/tools/:id", async (c) => c.json(await tools.get(c.req.param("id"), c.get("principal"))));
  app.post("/tools", async (c) => c.json(await tools.create(await c.req.json<Parameters<StudioToolService["create"]>[0]>().catch(() => undefined), c.get("principal")), 201));
  app.post("/tools/:id/duplicate", async (c) => c.json(await tools.duplicate(c.req.param("id"), c.get("principal")), 201));
  app.patch("/tools/:id", async (c) => c.json(await tools.update(c.req.param("id"), await c.req.json<Partial<Omit<ToolRecord, "id" | "createdAt">>>(), c.get("principal"))));
  app.delete("/tools/:id", async (c) => { await tools.delete(c.req.param("id"), c.req.query("removeReferences") === "true", c.get("principal")); return c.json({ ok: true }); });
}
