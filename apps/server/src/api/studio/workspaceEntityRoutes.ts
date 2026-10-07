import type { Hono } from "hono";
import type { PrincipalVariables } from "../shared/http";
import type { WorkspaceEntityService } from "./projectService";

export function registerWorkspaceEntityRoutes(app: Hono<{ Variables: PrincipalVariables }>, workspaces: WorkspaceEntityService) {
  app.get("/workspaces", async (c) => c.json(await workspaces.list(c.get("principal"), c.req.query("status"))));
  app.post("/workspaces", async (c) => c.json(await workspaces.create(await c.req.json().catch(() => ({})), c.get("principal")), 201));
  app.put("/workspaces/:id/repositories", async (c) =>
    c.json(await workspaces.putRepositories(c.req.param("id"), await c.req.json().catch(() => ({})), c.get("principal"))));
  app.get("/workspaces/:id/dashboard", async (c) => c.json(await workspaces.dashboard(c.req.param("id"), c.get("principal"))));
  app.post("/workspaces/:id/retire", async (c) => c.json(await workspaces.retire(c.req.param("id"), c.get("principal"))));
  app.get("/workspaces/:id", async (c) => c.json(await workspaces.get(c.req.param("id"), c.get("principal"))));
  app.patch("/workspaces/:id", async (c) => c.json(await workspaces.patch(c.req.param("id"), await c.req.json().catch(() => ({})), c.get("principal"))));
}
