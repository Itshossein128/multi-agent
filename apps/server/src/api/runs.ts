import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { migrateAgentRecord, type RunCreateRequest } from "@multi-agent/types";
import { RunExecutor } from "../runtime/runExecutor";
import { redact } from "../adapters/langGraphEventAdapter";

export function createRunsRouter(executor = new RunExecutor()) {
  const app = new Hono();
  app.get("/", (c) => c.json(executor.getStore().list(c.req.query("agentId")).map((run) => ({
    ...run, input: undefined, output: undefined,
    error: redact(run.error), metadata: redact(run.metadata),
  }))));
  app.get("/:runId/history", (c) => {
    const runId = c.req.param("runId");
    if (!executor.getStore().get(runId)) return c.json({ error: "Run not found" }, 404);
    const agentId = c.req.query("agentId");
    const events = executor.getStore().events(runId);
    const nodes = new Set(events.filter((event) => event.agentId === agentId).map((event) => event.nodeId).filter(Boolean));
    return c.json(events.filter((event) => !agentId || event.agentId === agentId ||
      (!event.agentId && event.nodeId && nodes.has(event.nodeId))));
  });
  app.post("/", async (c) => {
    const body = await c.req.json<Partial<RunCreateRequest>>();
    if (!body.workflow || !Array.isArray(body.workflow.nodes) || !Array.isArray(body.workflow.edges) || !Array.isArray(body.agents)) {
      return c.json({ error: "workflow, agents, nodes, and edges are required" }, 400);
    }
    try {
      const agents = body.agents.map((agent) => migrateAgentRecord(agent));
      return c.json({ runId: executor.start({ ...(body as RunCreateRequest), agents }) }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.get("/:runId", (c) => {
    const entry = executor.getStore().get(c.req.param("runId"));
    return entry ? c.json(entry.run) : c.json({ error: "Run not found" }, 404);
  });
  app.post("/:runId/cancel", (c) => {
    const runId = c.req.param("runId");
    const entry = executor.getStore().get(runId);
    if (!entry) return c.json({ error: "Run not found" }, 404);
    executor.cancel(runId);
    return c.json({ runId, status: "cancelling" }, 202);
  });
  app.get("/:runId/events", (c) => {
    const runId = c.req.param("runId");
    if (!executor.getStore().get(runId)) return c.json({ error: "Run not found" }, 404);
    const after = Number(c.req.query("sequence") ?? c.req.header("Last-Event-ID") ?? 0) || 0;
    return streamSSE(c, async (stream) => {
      const send = async (event: { id: string; sequence: number; type: string }) => {
        await stream.writeSSE({ id: String(event.sequence), event: "run-event", data: JSON.stringify(event) });
      };
      for (const event of executor.getStore().events(runId, after)) await send(event);
      let resolve: (() => void) | undefined;
      const wake = () => resolve?.();
      const unsubscribe = executor.getStore().subscribe(runId, (event) => { void send(event).then(wake); });
      try {
        while (!stream.aborted) {
          await new Promise<void>((done) => { resolve = done; });
          resolve = undefined;
          const status = executor.getStore().get(runId)?.run.status;
          if (status === "completed" || status === "failed" || status === "cancelled") break;
        }
      } finally { unsubscribe(); }
    });
  });
  return { app, executor };
}
