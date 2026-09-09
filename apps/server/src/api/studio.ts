import { Hono } from "hono";
import {
  assertNoCredentials,
  createAgentRecord,
  createEmptyDefinition,
  createToolRecord,
  migrateAgentRecord,
  migrateToolRecord,
  nowIso,
  removeAgentNodes,
  removeToolNodes,
  uid,
  type AgentRecord,
  type ToolRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import type { StudioStore, StudioTask } from "../../../../src/studio/contracts";

export function createStudioRouter(store: StudioStore) {
  const app = new Hono();

  app.get("/workflows", async (c) => c.json(await store.listWorkflows()));
  app.get("/workflows/:id", async (c) => {
    const workflow = await store.getWorkflow(c.req.param("id"));
    return workflow ? c.json(workflow) : c.json({ error: "Workflow not found" }, 404);
  });
  app.put("/workflows/:id", async (c) => {
    try {
      const body = await c.req.json<WorkflowDefinition>();
      if (body.id !== c.req.param("id")) return c.json({ error: "Workflow id mismatch" }, 400);
      assertNoCredentials(body);
      const stamped = { ...body, updatedAt: body.updatedAt ?? nowIso() };
      return c.json(await store.saveWorkflow(stamped));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.post("/workflows", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { name?: string; workflow?: WorkflowDefinition };
      const definition = body.workflow ?? createEmptyDefinition(body.name ?? "Untitled Workflow");
      assertNoCredentials(definition);
      return c.json(await store.saveWorkflow(definition), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.delete("/workflows/:id", async (c) => {
    await store.deleteWorkflow(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/agents", async (c) => c.json(await store.listAgents()));
  app.get("/agents/:id", async (c) => {
    const agent = await store.getAgent(c.req.param("id"));
    return agent ? c.json(agent) : c.json({ error: "Agent not found" }, 404);
  });
  app.post("/agents", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Partial<AgentRecord> & { name?: string };
      assertNoCredentials(body);
      const agent = body.id ? migrateAgentRecord(body as AgentRecord) : createAgentRecord(body);
      return c.json(await store.saveAgent(agent), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.post("/agents/:id/duplicate", async (c) => {
    const original = await store.getAgent(c.req.param("id"));
    if (!original) return c.json({ error: "Agent not found" }, 404);
    const copy = { ...structuredClone(original), id: uid("agent"), name: `${original.name} (copy)`, createdAt: nowIso(), updatedAt: nowIso() };
    return c.json(await store.saveAgent(copy), 201);
  });
  app.patch("/agents/:id", async (c) => {
    try {
      const patch = await c.req.json<Partial<Omit<AgentRecord, "id" | "createdAt">>>();
      assertNoCredentials(patch);
      const original = await store.getAgent(c.req.param("id"));
      if (!original) return c.json({ error: "Agent not found" }, 404);
      const updated = { ...migrateAgentRecord({ ...original, ...patch }), ...patch, id: original.id, createdAt: original.createdAt, updatedAt: nowIso() };
      return c.json(await store.saveAgent(updated));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.delete("/agents/:id", async (c) => {
    const agentId = c.req.param("id");
    const removeReferences = c.req.query("removeReferences") === "true";
    const workflows = await store.listWorkflows();
    const referenced = workflows.some((workflow) => workflow.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId));
    if (referenced && !removeReferences) return c.json({ error: "Remove this agent’s nodes in the Graph Editor and save the workflows before deleting the agent." }, 409);
    if (removeReferences) {
      for (const workflow of workflows) {
        if (workflow.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId)) {
          await store.saveWorkflow({ ...removeAgentNodes(workflow, agentId), updatedAt: nowIso() });
        }
      }
    }
    await store.deleteAgent(agentId);
    return c.json({ ok: true });
  });

  app.get("/tools", async (c) => c.json(await store.listTools()));
  app.get("/tools/:id", async (c) => {
    const tool = await store.getTool(c.req.param("id"));
    return tool ? c.json(tool) : c.json({ error: "Tool not found" }, 404);
  });
  app.post("/tools", async (c) => {
    try {
      const body = await c.req.json<Parameters<typeof createToolRecord>[0]>().catch(() => undefined);
      assertNoCredentials(body);
      return c.json(await store.saveTool(createToolRecord(body)), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.post("/tools/:id/duplicate", async (c) => {
    const original = await store.getTool(c.req.param("id"));
    if (!original) return c.json({ error: "Tool not found" }, 404);
    const copy = { ...structuredClone(original), id: uid("tool"), name: `${original.name} (copy)`, createdAt: nowIso(), updatedAt: nowIso() };
    return c.json(await store.saveTool(copy), 201);
  });
  app.patch("/tools/:id", async (c) => {
    try {
      const patch = await c.req.json<Partial<Omit<ToolRecord, "id" | "createdAt">>>();
      assertNoCredentials(patch);
      const original = await store.getTool(c.req.param("id"));
      if (!original) return c.json({ error: "Tool not found" }, 404);
      const updated = { ...migrateToolRecord({ ...original, ...patch }), ...patch, id: original.id, createdAt: original.createdAt, updatedAt: nowIso() };
      return c.json(await store.saveTool(updated));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.delete("/tools/:id", async (c) => {
    const toolId = c.req.param("id");
    const removeReferences = c.req.query("removeReferences") === "true";
    const [workflows, agents] = await Promise.all([store.listWorkflows(), store.listAgents()]);
    const referencedByNode = workflows.some((workflow) => workflow.nodes.some((node) => node.type === "tool" && (node.config as { toolId?: string | null }).toolId === toolId));
    const referencedByAgent = agents.some((agent) => agent.tools.includes(toolId));
    if ((referencedByNode || referencedByAgent) && !removeReferences) {
      return c.json({ error: "Remove this tool’s nodes in the Graph Editor and agent assignments before deleting the tool." }, 409);
    }
    if (removeReferences) {
      for (const workflow of workflows) {
        if (workflow.nodes.some((node) => node.type === "tool" && (node.config as { toolId?: string | null }).toolId === toolId)) {
          await store.saveWorkflow({ ...removeToolNodes(workflow, toolId), updatedAt: nowIso() });
        }
      }
      for (const agent of agents) {
        if (agent.tools.includes(toolId)) {
          await store.saveAgent({ ...agent, tools: agent.tools.filter((id) => id !== toolId), updatedAt: nowIso() });
        }
      }
    }
    await store.deleteTool(toolId);
    return c.json({ ok: true });
  });

  app.get("/tasks", async (c) => c.json(await store.listTasks()));
  app.get("/tasks/:id", async (c) => {
    const task = await store.getTask(c.req.param("id"));
    return task ? c.json(task) : c.json({ error: "Task not found" }, 404);
  });
  app.put("/tasks/:id", async (c) => {
    try {
      const body = await c.req.json<StudioTask>();
      if (body.id !== c.req.param("id")) return c.json({ error: "Task id mismatch" }, 400);
      return c.json(await store.saveTask(body));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.post("/tasks", async (c) => {
    try {
      const body = await c.req.json<StudioTask>();
      return c.json(await store.saveTask(body), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });
  app.delete("/tasks/:id", async (c) => {
    await store.deleteTask(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.put("/tasks", async (c) => {
    try {
      const body = await c.req.json<StudioTask[]>();
      if (!Array.isArray(body)) return c.json({ error: "Expected task array" }, 400);
      const existing = await store.listTasks();
      const keep = new Set(body.map((task) => task.id));
      for (const task of existing) if (!keep.has(task.id)) await store.deleteTask(task.id);
      for (const task of body) await store.saveTask(task);
      return c.json(await store.listTasks());
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post("/workspace/import", async (c) => {
    try {
      const body = await c.req.json<{ workflows?: WorkflowDefinition[]; agents?: AgentRecord[]; tools?: ToolRecord[] }>();
      assertNoCredentials(body);
      await store.importWorkspace({
        workflows: body.workflows ?? [],
        agents: (body.agents ?? []).map(migrateAgentRecord),
        tools: (body.tools ?? []).map(migrateToolRecord),
      });
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/workspace", async (c) => {
    const [workflows, agents, tools] = await Promise.all([store.listWorkflows(), store.listAgents(), store.listTools()]);
    return c.json({ version: 3 as const, workflows, agents, tools });
  });

  return app;
}
