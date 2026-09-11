"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStudioRouter = createStudioRouter;
const hono_1 = require("hono");
const types_1 = require("@multi-agent/types");
const principal_1 = require("../auth/principal");
function createStudioRouter(store, resolvePrincipal = principal_1.resolveRequestPrincipal) {
    const app = new hono_1.Hono();
    app.use("/*", async (c, next) => {
        const principal = await resolvePrincipal(c.req.raw);
        if (!principal)
            return c.json({ error: "Authentication required." }, 401);
        c.set("principal", principal);
        await next();
    });
    app.get("/workflows", async (c) => {
        const principal = c.get("principal");
        return c.json(await store.listWorkflows(principal));
    });
    app.get("/workflows/:id", async (c) => {
        const principal = c.get("principal");
        const workflow = await store.getWorkflow(c.req.param("id"), principal);
        return workflow ? c.json(workflow) : c.json({ error: "Workflow not found" }, 404);
    });
    app.put("/workflows/:id", async (c) => {
        const principal = c.get("principal");
        try {
            const body = await c.req.json();
            if (body.id !== c.req.param("id"))
                return c.json({ error: "Workflow id mismatch" }, 400);
            (0, types_1.assertNoCredentials)(body);
            const stamped = {
                ...body,
                id: c.req.param("id"),
                ownerId: principal.userId,
                tenantId: principal.tenantId,
                updatedAt: body.updatedAt ?? (0, types_1.nowIso)(),
            };
            return c.json(await store.saveWorkflow(stamped, principal));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("Access denied") || message.includes("Cannot modify another")) {
                return c.json({ error: "Workflow not found" }, 404);
            }
            return c.json({ error: message }, 400);
        }
    });
    app.post("/workflows", async (c) => {
        const principal = c.get("principal");
        try {
            const body = (await c.req.json().catch(() => ({})));
            const definition = body.workflow ?? (0, types_1.createEmptyDefinition)(body.name ?? "Untitled Workflow");
            (0, types_1.assertNoCredentials)(definition);
            const stamped = {
                ...definition,
                ownerId: principal.userId,
                tenantId: principal.tenantId,
            };
            return c.json(await store.saveWorkflow(stamped, principal), 201);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.delete("/workflows/:id", async (c) => {
        const principal = c.get("principal");
        const existing = await store.getWorkflow(c.req.param("id"), principal);
        if (!existing)
            return c.json({ error: "Workflow not found" }, 404);
        await store.deleteWorkflow(c.req.param("id"), principal);
        return c.json({ ok: true });
    });
    app.get("/agents", async (c) => {
        const principal = c.get("principal");
        return c.json(await store.listAgents(principal));
    });
    app.get("/agents/:id", async (c) => {
        const principal = c.get("principal");
        const agent = await store.getAgent(c.req.param("id"), principal);
        return agent ? c.json(agent) : c.json({ error: "Agent not found" }, 404);
    });
    app.post("/agents", async (c) => {
        const principal = c.get("principal");
        try {
            const body = (await c.req.json().catch(() => ({})));
            (0, types_1.assertNoCredentials)(body);
            const agent = body.id ? (0, types_1.migrateAgentRecord)(body) : (0, types_1.createAgentRecord)(body);
            const stamped = {
                ...agent,
                ownerId: principal.userId,
                tenantId: principal.tenantId,
                isSystem: false,
            };
            return c.json(await store.saveAgent(stamped, principal), 201);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.post("/agents/:id/duplicate", async (c) => {
        const principal = c.get("principal");
        const original = await store.getAgent(c.req.param("id"), principal);
        if (!original)
            return c.json({ error: "Agent not found" }, 404);
        const copy = {
            ...structuredClone(original),
            id: (0, types_1.uid)("agent"),
            name: `${original.name} (copy)`,
            ownerId: principal.userId,
            tenantId: principal.tenantId,
            isSystem: false,
            createdAt: (0, types_1.nowIso)(),
            updatedAt: (0, types_1.nowIso)(),
        };
        return c.json(await store.saveAgent(copy, principal), 201);
    });
    app.patch("/agents/:id", async (c) => {
        const principal = c.get("principal");
        try {
            const patch = await c.req.json();
            (0, types_1.assertNoCredentials)(patch);
            const original = await store.getAgent(c.req.param("id"), principal);
            if (!original)
                return c.json({ error: "Agent not found" }, 404);
            if (original.isSystem)
                return c.json({ error: "Cannot modify system agent" }, 403);
            const updated = {
                ...(0, types_1.migrateAgentRecord)({ ...original, ...patch }),
                ...patch,
                id: original.id,
                ownerId: original.ownerId,
                tenantId: original.tenantId,
                isSystem: false,
                createdAt: original.createdAt,
                updatedAt: (0, types_1.nowIso)(),
            };
            return c.json(await store.saveAgent(updated, principal));
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.delete("/agents/:id", async (c) => {
        const principal = c.get("principal");
        const agentId = c.req.param("id");
        const removeReferences = c.req.query("removeReferences") === "true";
        const original = await store.getAgent(agentId, principal);
        if (!original)
            return c.json({ error: "Agent not found" }, 404);
        if (original.isSystem)
            return c.json({ error: "Cannot delete system agent" }, 403);
        const workflows = await store.listWorkflows(principal);
        const referenced = workflows.some((workflow) => workflow.nodes.some((node) => node.type === "agent" && node.config.agentId === agentId));
        if (referenced && !removeReferences) {
            return c.json({ error: "Remove this agent’s nodes in the Graph Editor and save the workflows before deleting the agent." }, 409);
        }
        if (removeReferences) {
            await store.transaction(async (transaction) => {
                for (const workflow of workflows) {
                    if (workflow.nodes.some((node) => node.type === "agent" && node.config.agentId === agentId)) {
                        await transaction.saveWorkflow({ ...(0, types_1.removeAgentNodes)(workflow, agentId), updatedAt: (0, types_1.nowIso)() }, principal);
                    }
                }
                await transaction.deleteAgent(agentId, principal);
            });
        }
        else {
            await store.deleteAgent(agentId, principal);
        }
        return c.json({ ok: true });
    });
    app.get("/tools", async (c) => {
        const principal = c.get("principal");
        return c.json(await store.listTools(principal));
    });
    app.get("/tools/:id", async (c) => {
        const principal = c.get("principal");
        const tool = await store.getTool(c.req.param("id"), principal);
        return tool ? c.json(tool) : c.json({ error: "Tool not found" }, 404);
    });
    app.post("/tools", async (c) => {
        const principal = c.get("principal");
        try {
            const body = await c.req.json().catch(() => undefined);
            (0, types_1.assertNoCredentials)(body);
            const tool = (0, types_1.createToolRecord)(body);
            const stamped = {
                ...tool,
                ownerId: principal.userId,
                tenantId: principal.tenantId,
                isSystem: false,
            };
            return c.json(await store.saveTool(stamped, principal), 201);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.post("/tools/:id/duplicate", async (c) => {
        const principal = c.get("principal");
        const original = await store.getTool(c.req.param("id"), principal);
        if (!original)
            return c.json({ error: "Tool not found" }, 404);
        const copy = {
            ...structuredClone(original),
            id: (0, types_1.uid)("tool"),
            name: `${original.name} (copy)`,
            ownerId: principal.userId,
            tenantId: principal.tenantId,
            isSystem: false,
            createdAt: (0, types_1.nowIso)(),
            updatedAt: (0, types_1.nowIso)(),
        };
        return c.json(await store.saveTool(copy, principal), 201);
    });
    app.patch("/tools/:id", async (c) => {
        const principal = c.get("principal");
        try {
            const patch = await c.req.json();
            (0, types_1.assertNoCredentials)(patch);
            const original = await store.getTool(c.req.param("id"), principal);
            if (!original)
                return c.json({ error: "Tool not found" }, 404);
            if (original.isSystem)
                return c.json({ error: "Cannot modify system tool" }, 403);
            const updated = {
                ...(0, types_1.migrateToolRecord)({ ...original, ...patch }),
                ...patch,
                id: original.id,
                ownerId: original.ownerId,
                tenantId: original.tenantId,
                isSystem: false,
                createdAt: original.createdAt,
                updatedAt: (0, types_1.nowIso)(),
            };
            return c.json(await store.saveTool(updated, principal));
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.delete("/tools/:id", async (c) => {
        const principal = c.get("principal");
        const toolId = c.req.param("id");
        const removeReferences = c.req.query("removeReferences") === "true";
        const original = await store.getTool(toolId, principal);
        if (!original)
            return c.json({ error: "Tool not found" }, 404);
        if (original.isSystem)
            return c.json({ error: "Cannot delete system tool" }, 403);
        const [workflows, agents] = await Promise.all([store.listWorkflows(principal), store.listAgents(principal)]);
        const referencedByNode = workflows.some((workflow) => workflow.nodes.some((node) => node.type === "tool" && node.config.toolId === toolId));
        const referencedByAgent = agents.some((agent) => agent.tools.includes(toolId));
        if ((referencedByNode || referencedByAgent) && !removeReferences) {
            return c.json({ error: "Remove this tool’s nodes in the Graph Editor and agent assignments before deleting the tool." }, 409);
        }
        if (removeReferences) {
            await store.transaction(async (transaction) => {
                for (const workflow of workflows) {
                    if (workflow.nodes.some((node) => node.type === "tool" && node.config.toolId === toolId)) {
                        await transaction.saveWorkflow({ ...(0, types_1.removeToolNodes)(workflow, toolId), updatedAt: (0, types_1.nowIso)() }, principal);
                    }
                }
                for (const agent of agents) {
                    if (agent.tools.includes(toolId)) {
                        await transaction.saveAgent({ ...agent, tools: agent.tools.filter((id) => id !== toolId), updatedAt: (0, types_1.nowIso)() }, principal);
                    }
                }
                await transaction.deleteTool(toolId, principal);
            });
        }
        else {
            await store.deleteTool(toolId, principal);
        }
        return c.json({ ok: true });
    });
    app.get("/tasks", async (c) => {
        const principal = c.get("principal");
        return c.json(await store.listTasks(principal));
    });
    app.get("/tasks/:id", async (c) => {
        const principal = c.get("principal");
        const task = await store.getTask(c.req.param("id"), principal);
        return task ? c.json(task) : c.json({ error: "Task not found" }, 404);
    });
    app.put("/tasks/:id", async (c) => {
        const principal = c.get("principal");
        try {
            const body = await c.req.json();
            if (body.id !== c.req.param("id"))
                return c.json({ error: "Task id mismatch" }, 400);
            const existing = await store.getTask(c.req.param("id"), principal);
            if (!existing)
                return c.json({ error: "Task not found" }, 404);
            const stamped = {
                ...body,
                id: c.req.param("id"),
                tenantId: principal.tenantId,
                ownerId: existing.ownerId ?? principal.userId,
            };
            return c.json(await store.saveTask(stamped, principal));
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.post("/tasks", async (c) => {
        const principal = c.get("principal");
        try {
            const body = await c.req.json();
            const stamped = {
                ...body,
                tenantId: principal.tenantId,
                ownerId: principal.userId,
            };
            return c.json(await store.saveTask(stamped, principal), 201);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.delete("/tasks/:id", async (c) => {
        const principal = c.get("principal");
        const existing = await store.getTask(c.req.param("id"), principal);
        if (!existing)
            return c.json({ error: "Task not found" }, 404);
        await store.deleteTask(c.req.param("id"), principal);
        return c.json({ ok: true });
    });
    app.put("/tasks", async (c) => {
        const principal = c.get("principal");
        try {
            const body = await c.req.json();
            if (!Array.isArray(body))
                return c.json({ error: "Expected task array" }, 400);
            const existing = await store.listTasks(principal);
            const keep = new Set(body.map((task) => task.id));
            for (const task of existing)
                if (!keep.has(task.id))
                    await store.deleteTask(task.id, principal);
            for (const task of body) {
                await store.saveTask({ ...task, tenantId: principal.tenantId, ownerId: task.ownerId ?? principal.userId }, principal);
            }
            return c.json(await store.listTasks(principal));
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.post("/workspace/import", async (c) => {
        const principal = c.get("principal");
        try {
            const body = await c.req.json();
            (0, types_1.assertNoCredentials)(body);
            await store.importWorkspace({
                workflows: body.workflows ?? [],
                agents: (body.agents ?? []).map(types_1.migrateAgentRecord),
                tools: (body.tools ?? []).map(types_1.migrateToolRecord),
            }, principal);
            return c.json({ ok: true });
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.get("/workspace", async (c) => {
        const principal = c.get("principal");
        const [workflows, agents, tools] = await Promise.all([
            store.listWorkflows(principal),
            store.listAgents(principal),
            store.listTools(principal),
        ]);
        return c.json({ version: 3, workflows, agents, tools });
    });
    return app;
}
//# sourceMappingURL=studio.js.map