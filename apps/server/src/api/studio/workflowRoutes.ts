import type { Hono } from "hono";
import type { WorkflowDefinition } from "@multi-agent/types";
import type { PrincipalVariables } from "../shared/http";
import type { WorkflowService } from "./workflowService";

/**
 * Register workflow CRUD routes on the studio app.
 */
export function registerWorkflowRoutes(app: Hono<{ Variables: PrincipalVariables }>, workflows: WorkflowService) {
  app.get("/workflows", async (c) => c.json(await workflows.list(c.get("principal"))));
  app.get("/workflows/:id", async (c) => c.json(await workflows.get(c.req.param("id"), c.get("principal"))));
  app.put("/workflows/:id", async (c) => c.json(await workflows.save(c.req.param("id"), await c.req.json<WorkflowDefinition>(), c.get("principal"))));
  app.post("/workflows", async (c) => c.json(await workflows.create(await c.req.json<{ name?: string; workflow?: WorkflowDefinition }>().catch(() => ({})), c.get("principal")), 201));
  app.delete("/workflows/:id", async (c) => { await workflows.delete(c.req.param("id"), c.get("principal")); return c.json({ ok: true }); });
}
