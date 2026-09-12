import { Hono } from "hono";
import type { RunStoreContract } from "../runtime/runStore";
import type { StudioStore } from "../../../../src/studio/contracts";
import type { RunExecutor } from "../runtime/runExecutor";
import { resolveRequestPrincipal, type PrincipalResolver } from "../auth/principal";
import { DashboardService } from "./dashboard/dashboardService";
import type { DashboardCommand } from "./dashboard/models";
import { requirePrincipal, respondWithApiError, type PrincipalVariables } from "./shared/http";

export * from "./dashboard/models";

export function createDashboardRouter(
  runStore: RunStoreContract,
  studioStore?: StudioStore,
  executor?: RunExecutor,
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
) {
  const app = new Hono<{ Variables: PrincipalVariables }>();
  const service = new DashboardService(runStore, studioStore, executor);

  app.use("/*", requirePrincipal(resolvePrincipal));
  app.onError(respondWithApiError);
  app.get("/", async (c) => c.json(await service.get(c.get("principal"))));
  app.post("/", async (c) => {
    let command: DashboardCommand;
    try { command = await c.req.json<DashboardCommand>(); }
    catch { return c.json({ error: "Invalid JSON body" }, 400); }
    const result = await service.execute(command, c.get("principal"));
    return c.json(result, command.action === "enqueue" ? 201 : 200);
  });

  return app;
}
