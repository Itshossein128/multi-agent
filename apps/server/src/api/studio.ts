import { Hono } from "hono";
import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import type { StudioStore, StudioTask } from "../../../../src/studio/contracts";
import { resolveRequestPrincipal, type PrincipalResolver } from "../auth/principal";
import { requirePrincipal, respondWithApiError, type PrincipalVariables } from "./shared/http";
import { WorkflowService } from "./studio/workflowService";
import { AgentService } from "./studio/agentService";
import { StudioToolService } from "./studio/toolService";
import { TaskService } from "./studio/taskService";
import { WorkspaceService, type WorkspaceImport } from "./studio/workspaceService";

import type { RunExecutor } from "../runtime/runExecutor";

export function createStudioRouter(
  store: StudioStore,
  resolvePrincipal: PrincipalResolver = resolveRequestPrincipal,
  executor?: RunExecutor,
) {
  const app = new Hono<{ Variables: PrincipalVariables }>();
  const workflows = new WorkflowService(store);
  const agents = new AgentService(store);
  const tools = new StudioToolService(store);
  const tasks = new TaskService(store, executor);
  const workspace = new WorkspaceService(store);
  app.use("/*", requirePrincipal(resolvePrincipal));
  app.onError(respondWithApiError);

  app.get("/workflows", async (c) => c.json(await workflows.list(c.get("principal"))));
  app.get("/workflows/:id", async (c) => c.json(await workflows.get(c.req.param("id"), c.get("principal"))));
  app.put("/workflows/:id", async (c) => c.json(await workflows.save(c.req.param("id"), await c.req.json<WorkflowDefinition>(), c.get("principal"))));
  app.post("/workflows", async (c) => c.json(await workflows.create(await c.req.json<{ name?: string; workflow?: WorkflowDefinition }>().catch(() => ({})), c.get("principal")), 201));
  app.delete("/workflows/:id", async (c) => { await workflows.delete(c.req.param("id"), c.get("principal")); return c.json({ ok: true }); });

  app.get("/agents", async (c) => c.json(await agents.list(c.get("principal"))));
  app.get("/agents/:id", async (c) => c.json(await agents.get(c.req.param("id"), c.get("principal"))));
  app.post("/agents", async (c) => c.json(await agents.create(await c.req.json<Partial<AgentRecord> & { name?: string }>().catch(() => ({})), c.get("principal")), 201));
  app.post("/agents/:id/duplicate", async (c) => c.json(await agents.duplicate(c.req.param("id"), c.get("principal")), 201));
  app.patch("/agents/:id", async (c) => c.json(await agents.update(c.req.param("id"), await c.req.json<Partial<Omit<AgentRecord, "id" | "createdAt">>>(), c.get("principal"))));
  app.delete("/agents/:id", async (c) => { await agents.delete(c.req.param("id"), c.req.query("removeReferences") === "true", c.get("principal")); return c.json({ ok: true }); });

  app.get("/tools", async (c) => c.json(await tools.list(c.get("principal"))));
  app.get("/tools/:id", async (c) => c.json(await tools.get(c.req.param("id"), c.get("principal"))));
  app.post("/tools", async (c) => c.json(await tools.create(await c.req.json<Parameters<StudioToolService["create"]>[0]>().catch(() => undefined), c.get("principal")), 201));
  app.post("/tools/:id/duplicate", async (c) => c.json(await tools.duplicate(c.req.param("id"), c.get("principal")), 201));
  app.patch("/tools/:id", async (c) => c.json(await tools.update(c.req.param("id"), await c.req.json<Partial<Omit<ToolRecord, "id" | "createdAt">>>(), c.get("principal"))));
  app.delete("/tools/:id", async (c) => { await tools.delete(c.req.param("id"), c.req.query("removeReferences") === "true", c.get("principal")); return c.json({ ok: true }); });

  app.get("/tasks", async (c) => c.json(await tasks.list(c.get("principal"))));
  app.get("/tasks/:id", async (c) => c.json(await tasks.get(c.req.param("id"), c.get("principal"))));
  app.put("/tasks/:id", async (c) => c.json(await tasks.save(c.req.param("id"), await c.req.json<StudioTask>(), c.get("principal"))));
  app.patch("/tasks/:id", async (c) => c.json(await tasks.patch(c.req.param("id"), await c.req.json<Partial<StudioTask>>(), c.get("principal"))));
  app.post("/tasks", async (c) => c.json(await tasks.create(await c.req.json<Partial<StudioTask>>(), c.get("principal")), 201));
  app.delete("/tasks/:id", async (c) => { await tasks.delete(c.req.param("id"), c.get("principal")); return c.json({ ok: true }); });
  app.put("/tasks", async (c) => c.json(await tasks.replace(await c.req.json<StudioTask[]>(), c.get("principal"))));
  app.post("/tasks/:id/start", async (c) => c.json(await tasks.start(c.req.param("id"), c.get("principal")), 200));
  app.post("/tasks/:id/cancel", async (c) => c.json(await tasks.cancel(c.req.param("id"), c.get("principal")), 200));
  app.post("/tasks/:id/retry", async (c) => c.json(await tasks.retry(c.req.param("id"), c.get("principal")), 200));
  app.post("/tasks/:id/pause", async (c) => c.json(await tasks.pause(c.req.param("id"), c.get("principal")), 200));
  app.post("/tasks/:id/resume", async (c) => c.json(await tasks.resume(c.req.param("id"), c.get("principal")), 200));

  app.post("/workspace/import", async (c) => { await workspace.import(await c.req.json<WorkspaceImport>(), c.get("principal")); return c.json({ ok: true }); });
  app.get("/workspace", async (c) => c.json(await workspace.export(c.get("principal"))));
  return app;
}
