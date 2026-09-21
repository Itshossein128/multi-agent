import type { Hono } from "hono";
import type { AgentRecord } from "@multi-agent/types";
import type { PrincipalVariables } from "../shared/http";
import type { AgentService } from "./agentService";

/**
 * Register agent CRUD + diagnostics routes on the studio app.
 */
export function registerAgentRoutes(app: Hono<{ Variables: PrincipalVariables }>, agents: AgentService) {
  app.get("/agents", async (c) => c.json(await agents.list(c.get("principal"))));
  app.get("/agents/:id", async (c) => c.json(await agents.get(c.req.param("id"), c.get("principal"))));
  app.get("/agents/:id/diagnostics", async (c) => c.json(await agents.diagnostics(c.req.param("id"), c.get("principal"))));
  app.post("/agents", async (c) => c.json(await agents.create(await c.req.json<Partial<AgentRecord> & { name?: string }>().catch(() => ({})), c.get("principal")), 201));
  app.post("/agents/:id/duplicate", async (c) => c.json(await agents.duplicate(c.req.param("id"), c.get("principal")), 201));
  app.patch("/agents/:id", async (c) => c.json(await agents.update(c.req.param("id"), await c.req.json<Partial<Omit<AgentRecord, "id" | "createdAt">>>(), c.get("principal"))));
  app.delete("/agents/:id", async (c) => { await agents.delete(c.req.param("id"), c.req.query("removeReferences") === "true", c.get("principal")); return c.json({ ok: true }); });
}
