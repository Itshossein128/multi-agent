"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRunsRouter = createRunsRouter;
const hono_1 = require("hono");
const streaming_1 = require("hono/streaming");
const types_1 = require("@multi-agent/types");
const runExecutor_1 = require("../runtime/runExecutor");
function createRunsRouter(executor = new runExecutor_1.RunExecutor()) {
    const app = new hono_1.Hono();
    app.post("/", async (c) => {
        const body = await c.req.json();
        if (!body.workflow || !Array.isArray(body.workflow.nodes) || !Array.isArray(body.workflow.edges) || !Array.isArray(body.agents)) {
            return c.json({ error: "workflow, agents, nodes, and edges are required" }, 400);
        }
        try {
            const agents = body.agents.map((agent) => (0, types_1.migrateAgentRecord)(agent));
            return c.json({ runId: executor.start({ ...body, agents }) }, 202);
        }
        catch (error) {
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
            for (const event of executor.getStore().events(runId, after))
                await send(event);
            let resolve;
            const wake = () => resolve?.();
            const unsubscribe = executor.getStore().subscribe(runId, (event) => { void send(event).then(wake); });
            try {
                while (!stream.aborted) {
                    await new Promise((done) => { resolve = done; });
                    resolve = undefined;
                    const status = executor.getStore().get(runId)?.run.status;
                    if (status === "completed" || status === "failed" || status === "cancelled")
                        break;
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