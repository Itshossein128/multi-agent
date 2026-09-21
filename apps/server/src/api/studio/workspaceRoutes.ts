import type { Hono } from "hono";
import type { PrincipalVariables } from "../shared/http";
import type { WorkspaceService, WorkspaceImport } from "./workspaceService";

/**
 * Register workspace import/export routes on the studio app.
 */
export function registerWorkspaceRoutes(app: Hono<{ Variables: PrincipalVariables }>, workspace: WorkspaceService) {
  app.post("/workspace/import", async (c) => { await workspace.import(await c.req.json<WorkspaceImport>(), c.get("principal")); return c.json({ ok: true }); });
  app.get("/workspace", async (c) => c.json(await workspace.export(c.get("principal"))));
}
