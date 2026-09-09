"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStudioRouter = createStudioRouter;
const hono_1 = require("hono");
const types_1 = require("@multi-agent/types");
function createStudioRouter(store) {
    const app = new hono_1.Hono();
    app.get("/workflows", async (c) => c.json(await store.listWorkflows()));
    app.get("/workflows/:id", async (c) => {
        const workflow = await store.getWorkflow(c.req.param("id"));
        return workflow ? c.json(workflow) : c.json({ error: "Workflow not found" }, 404);
    });
    app.put("/workflows/:id", async (c) => {
        try {
            const body = await c.req.json();
            if (body.id !== c.req.param("id"))
                return c.json({ error: "Workflow id mismatch" }, 400);
            (0, types_1.assertNoCredentials)(body);
            const stamped = { ...body, updatedAt: body.updatedAt ?? (0, types_1.nowIso)() };
            return c.json(await store.saveWorkflow(stamped));
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.post("/workflows", async (c) => {
        try {
            const body = (await c.req.json().catch(() => ({})));
            const definition = body.workflow ?? (0, types_1.createEmptyDefinition)(body.name ?? "Untitled Workflow");
            (0, types_1.assertNoCredentials)(definition);
            return c.json(await store.saveWorkflow(definition), 201);
        }
        catch (error) {
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
            const body = (await c.req.json().catch(() => ({})));
            (0, types_1.assertNoCredentials)(body);
            const agent = body.id ? (0, types_1.migrateAgentRecord)(body) : (0, types_1.createAgentRecord)(body);
            return c.json(await store.saveAgent(agent), 201);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.post("/agents/:id/duplicate", async (c) => {
        const original = await store.getAgent(c.req.param("id"));
        if (!original)
            return c.json({ error: "Agent not found" }, 404);
        const copy = { ...structuredClone(original), id: (0, types_1.uid)("agent"), name: `${original.name} (copy)`, createdAt: (0, types_1.nowIso)(), updatedAt: (0, types_1.nowIso)() };
        return c.json(await store.saveAgent(copy), 201);
    });
    app.patch("/agents/:id", async (c) => {
        try {
            const patch = await c.req.json();
            (0, types_1.assertNoCredentials)(patch);
            const original = await store.getAgent(c.req.param("id"));
            if (!original)
                return c.json({ error: "Agent not found" }, 404);
            const updated = { ...(0, types_1.migrateAgentRecord)({ ...original, ...patch }), ...patch, id: original.id, createdAt: original.createdAt, updatedAt: (0, types_1.nowIso)() };
            return c.json(await store.saveAgent(updated));
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.delete("/agents/:id", async (c) => {
        const agentId = c.req.param("id");
        const removeReferences = c.req.query("removeReferences") === "true";
        const workflows = await store.listWorkflows();
        const referenced = workflows.some((workflow) => workflow.nodes.some((node) => node.type === "agent" && node.config.agentId === agentId));
        if (referenced && !removeReferences)
            return c.json({ error: "Remove this agent’s nodes in the Graph Editor and save the workflows before deleting the agent." }, 409);
        if (removeReferences) {
            for (const workflow of workflows) {
                if (workflow.nodes.some((node) => node.type === "agent" && node.config.agentId === agentId)) {
                    await store.saveWorkflow({ ...(0, types_1.removeAgentNodes)(workflow, agentId), updatedAt: (0, types_1.nowIso)() });
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
            const body = await c.req.json().catch(() => undefined);
            (0, types_1.assertNoCredentials)(body);
            return c.json(await store.saveTool((0, types_1.createToolRecord)(body)), 201);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.post("/tools/:id/duplicate", async (c) => {
        const original = await store.getTool(c.req.param("id"));
        if (!original)
            return c.json({ error: "Tool not found" }, 404);
        const copy = { ...structuredClone(original), id: (0, types_1.uid)("tool"), name: `${original.name} (copy)`, createdAt: (0, types_1.nowIso)(), updatedAt: (0, types_1.nowIso)() };
        return c.json(await store.saveTool(copy), 201);
    });
    app.patch("/tools/:id", async (c) => {
        try {
            const patch = await c.req.json();
            (0, types_1.assertNoCredentials)(patch);
            const original = await store.getTool(c.req.param("id"));
            if (!original)
                return c.json({ error: "Tool not found" }, 404);
            const updated = { ...(0, types_1.migrateToolRecord)({ ...original, ...patch }), ...patch, id: original.id, createdAt: original.createdAt, updatedAt: (0, types_1.nowIso)() };
            return c.json(await store.saveTool(updated));
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.delete("/tools/:id", async (c) => {
        const toolId = c.req.param("id");
        const removeReferences = c.req.query("removeReferences") === "true";
        const [workflows, agents] = await Promise.all([store.listWorkflows(), store.listAgents()]);
        const referencedByNode = workflows.some((workflow) => workflow.nodes.some((node) => node.type === "tool" && node.config.toolId === toolId));
        const referencedByAgent = agents.some((agent) => agent.tools.includes(toolId));
        if ((referencedByNode || referencedByAgent) && !removeReferences) {
            return c.json({ error: "Remove this tool’s nodes in the Graph Editor and agent assignments before deleting the tool." }, 409);
        }
        if (removeReferences) {
            for (const workflow of workflows) {
                if (workflow.nodes.some((node) => node.type === "tool" && node.config.toolId === toolId)) {
                    await store.saveWorkflow({ ...(0, types_1.removeToolNodes)(workflow, toolId), updatedAt: (0, types_1.nowIso)() });
                }
            }
            for (const agent of agents) {
                if (agent.tools.includes(toolId)) {
                    await store.saveAgent({ ...agent, tools: agent.tools.filter((id) => id !== toolId), updatedAt: (0, types_1.nowIso)() });
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
            const body = await c.req.json();
            if (body.id !== c.req.param("id"))
                return c.json({ error: "Task id mismatch" }, 400);
            return c.json(await store.saveTask(body));
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.post("/tasks", async (c) => {
        try {
            const body = await c.req.json();
            return c.json(await store.saveTask(body), 201);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.delete("/tasks/:id", async (c) => {
        await store.deleteTask(c.req.param("id"));
        return c.json({ ok: true });
    });
    app.put("/tasks", async (c) => {
        try {
            const body = await c.req.json();
            if (!Array.isArray(body))
                return c.json({ error: "Expected task array" }, 400);
            const existing = await store.listTasks();
            const keep = new Set(body.map((task) => task.id));
            for (const task of existing)
                if (!keep.has(task.id))
                    await store.deleteTask(task.id);
            for (const task of body)
                await store.saveTask(task);
            return c.json(await store.listTasks());
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.post("/workspace/import", async (c) => {
        try {
            const body = await c.req.json();
            (0, types_1.assertNoCredentials)(body);
            await store.importWorkspace({
                workflows: body.workflows ?? [],
                agents: (body.agents ?? []).map(types_1.migrateAgentRecord),
                tools: (body.tools ?? []).map(types_1.migrateToolRecord),
            });
            return c.json({ ok: true });
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.get("/workspace", async (c) => {
        const [workflows, agents, tools] = await Promise.all([store.listWorkflows(), store.listAgents(), store.listTools()]);
        return c.json({ version: 3, workflows, agents, tools });
    });
    return app;
}
//# sourceMappingURL=studio.js.map