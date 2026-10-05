import type { Hono } from "hono";
import type { PrincipalVariables } from "../shared/http";
import type { ProjectService } from "./projectService";

export function registerProjectRoutes(app: Hono<{ Variables: PrincipalVariables }>, projects: ProjectService) {
  app.get("/projects", async (c) => c.json(await projects.list(c.get("principal"), c.req.query("status"))));
  app.post("/projects", async (c) => c.json(await projects.create(await c.req.json().catch(() => ({})), c.get("principal")), 201));
  app.get("/projects/:id/dashboard", async (c) => c.json(await projects.dashboard(c.req.param("id"), c.get("principal"))));
  app.post("/projects/:id/retire", async (c) => c.json(await projects.retire(c.req.param("id"), c.get("principal"))));
  app.get("/projects/:id", async (c) => c.json(await projects.get(c.req.param("id"), c.get("principal"))));
  app.patch("/projects/:id", async (c) => c.json(await projects.patch(c.req.param("id"), await c.req.json().catch(() => ({})), c.get("principal"))));
}
