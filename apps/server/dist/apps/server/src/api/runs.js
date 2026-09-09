"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRunsRouter = createRunsRouter;
const hono_1 = require("hono");
const streaming_1 = require("hono/streaming");
const types_1 = require("@multi-agent/types");
const runExecutor_1 = require("../runtime/runExecutor");
const langGraphEventAdapter_1 = require("../adapters/langGraphEventAdapter");
const body_limit_1 = require("hono/body-limit");
function createRunsRouter(executor = new runExecutor_1.RunExecutor(), resolveMemoryAccess = async () => null, studioStore) {
    const app = new hono_1.Hono();
    const hasLongTermMemory = (agents) => agents.some((agent) => agent.memory?.enabled && agent.memory.longTerm?.enabled);
    const canRead = async (runId, request) => {
        const owner = executor.getStore().getMemoryOwner(runId);
        if (!owner)
            return true;
        const access = await resolveMemoryAccess(request);
        return access?.principalId === owner.principalId && access.tenantId === owner.tenantId;
    };
    app.use("*", (0, body_limit_1.bodyLimit)({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Run request is too large." }, 413) }));
    app.use("/:runId/*", async (c, next) => {
        if (!await canRead(c.req.param("runId"), c.req.raw))
            return c.json({ error: "Run not found" }, 404);
        await next();
    });
    app.post("/agent-test", async (c) => {
        try {
            const body = await c.req.json();
            if (!body.agent || !body.input || typeof body.input !== "object" || Array.isArray(body.input))
                return c.json({ error: "agent and sample input object are required" }, 400);
            (0, types_1.assertNoCredentials)(body.agent);
            const errors = (0, types_1.validateAgent)(body.agent);
            if (errors.length)
                return c.json({ error: errors.join(" ") }, 400);
            const access = hasLongTermMemory([body.agent]) ? await resolveMemoryAccess(c.req.raw) : null;
            if (hasLongTermMemory([body.agent]) && !access)
                return c.json({ error: "Authenticated memory access is required for this agent." }, 401);
            const runId = executor.startAgentTest({ agent: (0, types_1.migrateAgentRecord)(body.agent), input: body.input }, access ?? undefined);
            return c.json({ runId }, 202);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.get("/", async (c) => {
        const filters = {
            agentId: c.req.query("agentId") || undefined,
            workflowId: c.req.query("workflowId") || undefined,
            taskId: c.req.query("taskId") || undefined,
            status: c.req.query("status"),
            from: c.req.query("from") || undefined,
            to: c.req.query("to") || undefined,
        };
        const runs = executor.getStore().list(filters);
        const allowed = await Promise.all(runs.map((run) => canRead(run.id, c.req.raw)));
        return c.json(runs.filter((_, index) => allowed[index]).map((run) => ({
            ...run, input: undefined, output: undefined,
            error: (0, langGraphEventAdapter_1.redact)(run.error), metadata: (0, langGraphEventAdapter_1.redact)(run.metadata),
        })));
    });
    app.get("/:runId/definition", (c) => {
        const runId = c.req.param("runId");
        const entry = executor.getStore().get(runId);
        if (!entry)
            return c.json({ error: "Run not found" }, 404);
        const workflow = executor.getStore().getWorkflowSnapshot?.(runId) ?? entry.workflowSnapshot;
        const agents = entry.agentsSnapshot;
        if (!workflow)
            return c.json({ error: "Run definition snapshot not available" }, 404);
        return c.json({ workflow, agents: agents ?? [] });
    });
    app.get("/:runId/approvals", (c) => {
        const runId = c.req.param("runId");
        if (!executor.getStore().get(runId))
            return c.json({ error: "Run not found" }, 404);
        return c.json(executor.getStore().listApprovals(runId));
    });
    app.post("/:runId/approvals/:approvalId/resolve", async (c) => {
        const runId = c.req.param("runId");
        const approvalId = c.req.param("approvalId");
        if (!executor.getStore().get(runId))
            return c.json({ error: "Run not found" }, 404);
        const body = await c.req.json().catch(() => ({}));
        if (body.decision !== "approved" && body.decision !== "rejected")
            return c.json({ error: "decision must be 'approved' or 'rejected'" }, 400);
        try {
            executor.resolveApproval(runId, approvalId, { decision: body.decision, response: body.response });
            return c.json({ ok: true }, 202);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.get("/:runId/history", (c) => {
        const runId = c.req.param("runId");
        if (!executor.getStore().get(runId))
            return c.json({ error: "Run not found" }, 404);
        const agentId = c.req.query("agentId");
        const events = executor.getStore().events(runId);
        const nodes = new Set(events.filter((event) => event.agentId === agentId).map((event) => event.nodeId).filter(Boolean));
        return c.json(events.filter((event) => !agentId || event.agentId === agentId ||
            (!event.agentId && event.nodeId && nodes.has(event.nodeId))));
    });
    app.post("/", async (c) => {
        const body = await c.req.json();
        if (!body.workflow || !Array.isArray(body.workflow.nodes) || !Array.isArray(body.workflow.edges) || !Array.isArray(body.agents)) {
            return c.json({ error: "workflow, agents, nodes, and edges are required" }, 400);
        }
        try {
            const agents = body.agents.map((agent) => (0, types_1.migrateAgentRecord)(agent));
            (0, types_1.assertNoCredentials)({ workflow: body.workflow, agents: body.agents });
            const access = hasLongTermMemory(agents) ? await resolveMemoryAccess(c.req.raw) : null;
            if (hasLongTermMemory(agents) && !access)
                return c.json({ error: "Authenticated memory access is required for this workflow." }, 401);
            // Tool definitions are resolved server-side; callers cannot smuggle a replacement registry.
            const tools = studioStore ? await studioStore.listTools() : (body.tools ?? []);
            const runId = executor.start({ ...body, agents, tools }, access ?? undefined);
            return c.json({ runId }, 202);
        }
        catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    app.get("/:runId", async (c) => {
        if (!await canRead(c.req.param("runId"), c.req.raw))
            return c.json({ error: "Run not found" }, 404);
        const entry = executor.getStore().get(c.req.param("runId"));
        return entry ? c.json((0, langGraphEventAdapter_1.redact)(entry.run)) : c.json({ error: "Run not found" }, 404);
    });
    app.post("/:runId/cancel", (c) => {
        const runId = c.req.param("runId");
        const entry = executor.getStore().get(runId);
        if (!entry)
            return c.json({ error: "Run not found" }, 404);
        executor.cancel(runId);
        return c.json({ runId, status: "cancelling" }, 202);
    });
    app.get("/:runId/events", (c) => {
        const runId = c.req.param("runId");
        if (!executor.getStore().get(runId))
            return c.json({ error: "Run not found" }, 404);
        const after = Number(c.req.query("sequence") ?? c.req.header("Last-Event-ID") ?? 0) || 0;
        return (0, streaming_1.streamSSE)(c, async (stream) => {
            const send = async (event) => {
                await stream.writeSSE({ id: String(event.sequence), event: "run-event", data: JSON.stringify(event) });
            };
            let sequence = after;
            let resolve;
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
                    // Re-read after writes: events may have arrived while the stream was draining.
                    if (executor.getStore().events(runId, sequence).length)
                        continue;
                    const status = executor.getStore().get(runId)?.run.status;
                    if (status === "completed" || status === "failed" || status === "cancelled")
                        break;
                    if (stream.aborted)
                        break;
                    await new Promise((done) => { resolve = done; });
                    resolve = undefined;
                }
            }
            finally {
                unsubscribe();
            }
        });
    });
    return { app, executor };
}
//# sourceMappingURL=runs.js.map