import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AgentTestRequest, RunCreateRequest, RunStatus } from "@multi-agent/types";
import type { StudioStore } from "../../../../src/studio/contracts";
import { RunExecutor } from "../runtime/runExecutor";
import type { MemoryAccessResolver } from "../memory/access";
import { resolveRequestPrincipal, type PrincipalResolver, type RequestPrincipal } from "../auth/principal";
import { respondWithApiError } from "./shared/http";
import { streamRunEvents } from "./runs/eventStream";
import { RunApiService } from "./runs/runApiService";

interface RunVariables { principal: RequestPrincipal | undefined }

export function createRunsRouter(
  executor = new RunExecutor(),
  resolveMemoryAccess: MemoryAccessResolver = async () => null,
  studioStore?: StudioStore,
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
) {
  const app = new Hono<{ Variables: RunVariables }>();
  const service = new RunApiService(executor, resolveMemoryAccess, studioStore, resolvePrincipal);
  app.use("*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Run request is too large." }, 413) }));
  app.use("*", async (c, next) => { const principal = await service.principalFor(c.req.raw); if (principal) c.set("principal", principal); await next(); });
  app.onError(respondWithApiError);

  app.post("/agent-test", async (c) => c.json({ runId: await service.startAgentTest(await c.req.json<AgentTestRequest>(), c.req.raw, c.get("principal")) }, 202));
  const authorizeRun: MiddlewareHandler<{ Variables: RunVariables }> = async (c, next) => {
    const runId = c.req.param("runId")!;
    if (runId === "agent-test") return next();
    if (!service.canAccess(c.get("principal"), runId)) return c.json({ error: "Run not found" }, 404);
    await next();
  };
  app.use("/:runId", authorizeRun);
  app.use("/:runId/*", authorizeRun);

  app.get("/", (c) => c.json(service.list({ agentId: c.req.query("agentId") || undefined, workflowId: c.req.query("workflowId") || undefined,
    taskId: c.req.query("taskId") || undefined, status: c.req.query("status") as RunStatus | undefined, from: c.req.query("from") || undefined, to: c.req.query("to") || undefined }, c.get("principal"))));
  app.post("/", async (c) => c.json({ runId: await service.startRun(await c.req.json<Partial<RunCreateRequest>>(), c.req.raw, c.get("principal")) }, 202));
  app.get("/:runId/definition", (c) => c.json(service.definition(c.req.param("runId"))));
  app.get("/:runId/approvals", (c) => c.json(service.approvals(c.req.param("runId"))));
  app.post("/:runId/approvals/:approvalId/resolve", async (c) => { service.resolveApproval(c.req.param("runId"), c.req.param("approvalId"), await c.req.json().catch(() => ({}))); return c.json({ ok: true }, 202); });
  app.get("/:runId/history", (c) => c.json(service.history(c.req.param("runId"), c.req.query("agentId"))));
  app.get("/:runId", (c) => c.json(service.get(c.req.param("runId"))));
  app.post("/:runId/cancel", (c) => c.json(service.cancel(c.req.param("runId")), 202));
  app.post("/:runId/retry", async (c) => c.json(await service.retry(c.req.param("runId"), c.req.raw, c.get("principal")), 202));
  app.get("/:runId/events", (c) => streamRunEvents(c, service.store, c.req.param("runId"), Number(c.req.query("sequence") ?? c.req.header("Last-Event-ID") ?? 0) || 0));
  return { app, executor };
}
