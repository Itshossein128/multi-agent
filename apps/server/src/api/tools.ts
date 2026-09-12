import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ToolRuntime } from "../../../../src/tools";
import type { StudioStore } from "../../../../src/studio/contracts";
import { resolveRequestPrincipal, type PrincipalResolver } from "../auth/principal";
import { requirePrincipal, respondWithApiError, type PrincipalVariables } from "./shared/http";
import { ToolTestService, type ToolTestRequest } from "./tools/toolTestService";

export type { ToolTestRequest } from "./tools/toolTestService";

export function createToolsRouter(
  runtime: Pick<ToolRuntime, "execute"> = new ToolRuntime(),
  studioStore?: StudioStore,
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
) {
  const app = new Hono<{ Variables: PrincipalVariables }>();
  const service = new ToolTestService(runtime, studioStore);
  app.use("*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Tool request is too large." }, 413) }));
  app.use("*", requirePrincipal(resolvePrincipal));
  app.onError(respondWithApiError);
  app.post("/test", async (c) => c.json(await service.execute(await c.req.json<ToolTestRequest>(), c.get("principal"))));
  return app;
}
