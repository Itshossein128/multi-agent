import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { assertNoCredentials, migrateAgentRecord, validateAgent, type AgentTestRequest, type RunCreateRequest } from "@multi-agent/types";
import { RunExecutor } from "../runtime/runExecutor";
import { redact } from "../adapters/langGraphEventAdapter";
import type { MemoryAccessResolver } from "../memory/access";
import { bodyLimit } from "hono/body-limit";
import type { StudioStore } from "../../../../src/studio/contracts";
import { resolveRequestPrincipal, type PrincipalResolver, type RequestPrincipal } from "../auth/principal";

export function createRunsRouter(
  executor = new RunExecutor(),
  resolveMemoryAccess: MemoryAccessResolver = async () => null,
  studioStore?: StudioStore,
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
) {
  const app = new Hono<{ Variables: { principal: RequestPrincipal } }>();

  const hasLongTermMemory = (agents: RunCreateRequest["agents"]) =>
    agents.some((agent) => agent.memory?.enabled && agent.memory.longTerm?.enabled);

  const getPrincipal = async (request: Request): Promise<RequestPrincipal | null> => {
    const principal = await resolvePrincipal(request);
    if (principal) return principal;
    const access = await resolveMemoryAccess(request);
    if (access?.principalId && access?.tenantId) {
      return { userId: access.principalId, tenantId: access.tenantId };
    }
    return null;
  };

  const canAccessRun = (principal: RequestPrincipal | null, runId: string): boolean => {
    if (!principal) return false;
    const entry = executor.getStore().get(runId);
    if (!entry) return false;
    const ownerId = entry.run.ownerId ?? entry.memoryOwner?.principalId;
    const tenantId = entry.run.tenantId ?? entry.memoryOwner?.tenantId;
    if (!ownerId || !tenantId) return false;
    return tenantId === principal.tenantId && ownerId === principal.userId;
  };

  app.use("*", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Run request is too large." }, 413) }));

  app.use("*", async (c, next) => {
    const principal = await getPrincipal(c.req.raw);
    if (principal) c.set("principal", principal);
    await next();
  });

  app.post("/agent-test", async (c) => {
    const principal = c.get("principal");
    if (!principal) return c.json({ error: "Authentication required." }, 401);
    try {
      const body = await c.req.json<AgentTestRequest>();
      if (!body.agent || !body.input || typeof body.input !== "object" || Array.isArray(body.input)) {
        return c.json({ error: "agent and sample input object are required" }, 400);
      }
      assertNoCredentials(body.agent);
      const errors = validateAgent(body.agent);
      if (errors.length) return c.json({ error: errors.join(" ") }, 400);

      if (body.agent.id && studioStore) {
        const storedAgent = await studioStore.getAgent(body.agent.id);
        if (storedAgent && !storedAgent.isSystem) {
          if (storedAgent.tenantId !== principal.tenantId || (storedAgent.ownerId && storedAgent.ownerId !== principal.userId)) {
            return c.json({ error: "Access denied to agent." }, 404);
          }
        }
      }

      const access = hasLongTermMemory([body.agent]) ? await resolveMemoryAccess(c.req.raw) : null;
      if (hasLongTermMemory([body.agent]) && !access) {
        return c.json({ error: "Authenticated memory access is required for this agent." }, 401);
      }
      const runId = executor.startAgentTest({ agent: migrateAgentRecord(body.agent), input: body.input }, access ?? undefined, principal);
      return c.json({ runId }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.use("/:runId", async (c, next) => {
    const principal = c.get("principal");
    const runId = c.req.param("runId");
    if (runId === "agent-test") return next();
    if (!canAccessRun(principal, runId)) return c.json({ error: "Run not found" }, 404);
    await next();
  });

  app.use("/:runId/*", async (c, next) => {
    const principal = c.get("principal");
    const runId = c.req.param("runId")!;
    if (runId === "agent-test") return next();
    if (!canAccessRun(principal, runId)) return c.json({ error: "Run not found" }, 404);
    await next();
  });

  app.get("/", async (c) => {
    const principal = c.get("principal");
    if (!principal) return c.json([]);
    const filters = {
      agentId: c.req.query("agentId") || undefined,
      workflowId: c.req.query("workflowId") || undefined,
      taskId: c.req.query("taskId") || undefined,
      status: c.req.query("status") as import("@multi-agent/types").RunStatus | undefined,
      from: c.req.query("from") || undefined,
      to: c.req.query("to") || undefined,
    };
    const runs = executor.getStore().list(filters, principal);
    return c.json(
      runs.map((run) => ({
        ...run,
        input: undefined,
        output: undefined,
        error: redact(run.error),
        metadata: redact(run.metadata),
      })),
    );
  });

  app.get("/:runId/definition", (c) => {
    const runId = c.req.param("runId");
    const entry = executor.getStore().get(runId);
    if (!entry) return c.json({ error: "Run not found" }, 404);
    const workflow = executor.getStore().getWorkflowSnapshot?.(runId) ?? entry.workflowSnapshot;
    const agents = entry.agentsSnapshot;
    if (!workflow) return c.json({ error: "Run definition snapshot not available" }, 404);
    return c.json({ workflow, agents: agents ?? [] });
  });

  app.get("/:runId/approvals", (c) => {
    const runId = c.req.param("runId");
    if (!executor.getStore().get(runId)) return c.json({ error: "Run not found" }, 404);
    return c.json(executor.getStore().listApprovals(runId));
  });

  app.post("/:runId/approvals/:approvalId/resolve", async (c) => {
    const runId = c.req.param("runId");
    const approvalId = c.req.param("approvalId");
    if (!executor.getStore().get(runId)) return c.json({ error: "Run not found" }, 404);
    const body = await c.req.json<{ decision?: string; response?: string }>().catch(() => ({}) as { decision?: string; response?: string });
    if (body.decision !== "approved" && body.decision !== "rejected") return c.json({ error: "decision must be 'approved' or 'rejected'" }, 400);
    try {
      executor.resolveApproval(runId, approvalId, { decision: body.decision, response: body.response });
      return c.json({ ok: true }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/:runId/history", (c) => {
    const runId = c.req.param("runId");
    if (!executor.getStore().get(runId)) return c.json({ error: "Run not found" }, 404);
    const agentId = c.req.query("agentId");
    const events = executor.getStore().events(runId);
    const nodes = new Set(events.filter((event) => event.agentId === agentId).map((event) => event.nodeId).filter(Boolean));
    return c.json(
      events.filter(
        (event) => !agentId || event.agentId === agentId || (!event.agentId && event.nodeId && nodes.has(event.nodeId)),
      ),
    );
  });

  app.post("/", async (c) => {
    const principal = c.get("principal");
    if (!principal) return c.json({ error: "Authentication required." }, 401);
    const body = await c.req.json<Partial<RunCreateRequest>>();
    if (!body.workflow || !Array.isArray(body.workflow.nodes) || !Array.isArray(body.workflow.edges) || !Array.isArray(body.agents)) {
      return c.json({ error: "workflow, agents, nodes, and edges are required" }, 400);
    }
    try {
      if (body.workflow.id && studioStore) {
        const storedWf = await studioStore.getWorkflow(body.workflow.id);
        if (storedWf && (storedWf.ownerId !== principal.userId || storedWf.tenantId !== principal.tenantId)) {
          return c.json({ error: "Access denied to workflow." }, 404);
        }
      }

      const agents = body.agents.map((agent) => migrateAgentRecord(agent));
      assertNoCredentials({ workflow: body.workflow, agents: body.agents });

      if (studioStore) {
        for (const agent of agents) {
          if (agent.id) {
            const storedAgent = await studioStore.getAgent(agent.id);
            if (storedAgent && !storedAgent.isSystem) {
              if (storedAgent.tenantId !== principal.tenantId || (storedAgent.ownerId && storedAgent.ownerId !== principal.userId)) {
                return c.json({ error: "Access denied to agent." }, 404);
              }
            }
          }
        }
      }

      const access = hasLongTermMemory(agents) ? await resolveMemoryAccess(c.req.raw) : null;
      if (hasLongTermMemory(agents) && !access) return c.json({ error: "Authenticated memory access is required for this workflow." }, 401);

      // Tool definitions are resolved server-side scoped to principal; callers cannot smuggle a replacement registry.
      const tools = studioStore ? await studioStore.listTools(principal) : (body.tools ?? []);
      const runId = executor.start({ ...(body as RunCreateRequest), agents, tools }, access ?? undefined, principal);
      return c.json({ runId }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/:runId", async (c) => {
    const entry = executor.getStore().get(c.req.param("runId"));
    return entry ? c.json(redact(entry.run)) : c.json({ error: "Run not found" }, 404);
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
      let sequence = after;
      let resolve: (() => void) | undefined;
      const wake = () => resolve?.();
      const unsubscribe = executor.getStore().subscribe(runId, wake);
      stream.onAbort(wake);
      try {
        while (!stream.aborted) {
          const pending = executor.getStore().events(runId, sequence);
          for (const event of pending) {
            await send(event);
            sequence = event.sequence;
          }
          if (executor.getStore().events(runId, sequence).length) continue;
          const status = executor.getStore().get(runId)?.run.status;
          if (status === "completed" || status === "failed" || status === "cancelled") break;
          if (stream.aborted) break;
          await new Promise<void>((done) => {
            resolve = done;
          });
          resolve = undefined;
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return { app, executor };
}
