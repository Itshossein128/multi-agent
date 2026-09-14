"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRunsRouter = createRunsRouter;
const hono_1 = require("hono");
const body_limit_1 = require("hono/body-limit");
const runExecutor_1 = require("../runtime/runExecutor");
const principal_1 = require("../auth/principal");
const http_1 = require("./shared/http");
const eventStream_1 = require("./runs/eventStream");
const runApiService_1 = require("./runs/runApiService");
function createRunsRouter(executor = new runExecutor_1.RunExecutor(), resolveMemoryAccess = async () => null, studioStore, resolvePrincipal = principal_1.resolveRequestPrincipal) {
    const app = new hono_1.Hono();
    const service = new runApiService_1.RunApiService(executor, resolveMemoryAccess, studioStore, resolvePrincipal);
    app.use("*", (0, body_limit_1.bodyLimit)({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Run request is too large." }, 413) }));
    app.use("*", async (c, next) => { const principal = await service.principalFor(c.req.raw); if (principal)
        c.set("principal", principal); await next(); });
    app.onError(http_1.respondWithApiError);
    app.post("/agent-test", async (c) => c.json({ runId: await service.startAgentTest(await c.req.json(), c.req.raw, c.get("principal")) }, 202));
    const authorizeRun = async (c, next) => {
        const runId = c.req.param("runId");
        if (runId === "agent-test")
            return next();
        if (!service.canAccess(c.get("principal"), runId))
            return c.json({ error: "Run not found" }, 404);
        await next();
    };
    app.use("/:runId", authorizeRun);
    app.use("/:runId/*", authorizeRun);
    app.get("/", (c) => c.json(service.list({ agentId: c.req.query("agentId") || undefined, workflowId: c.req.query("workflowId") || undefined,
        taskId: c.req.query("taskId") || undefined, status: c.req.query("status"), from: c.req.query("from") || undefined, to: c.req.query("to") || undefined }, c.get("principal"))));
    app.post("/", async (c) => c.json({ runId: await service.startRun(await c.req.json(), c.req.raw, c.get("principal")) }, 202));
    app.get("/:runId/definition", (c) => c.json(service.definition(c.req.param("runId"))));
    app.get("/:runId/approvals", (c) => c.json(service.approvals(c.req.param("runId"))));
    app.post("/:runId/approvals/:approvalId/resolve", async (c) => { service.resolveApproval(c.req.param("runId"), c.req.param("approvalId"), await c.req.json().catch(() => ({}))); return c.json({ ok: true }, 202); });
    app.get("/:runId/history", (c) => c.json(service.history(c.req.param("runId"), c.req.query("agentId"))));
    app.get("/:runId", (c) => c.json(service.get(c.req.param("runId"))));
    app.post("/:runId/cancel", (c) => c.json(service.cancel(c.req.param("runId")), 202));
    app.post("/:runId/retry", async (c) => c.json(await service.retry(c.req.param("runId"), c.req.raw, c.get("principal")), 202));
    app.get("/:runId/events", (c) => (0, eventStream_1.streamRunEvents)(c, service.store, c.req.param("runId"), Number(c.req.query("sequence") ?? c.req.header("Last-Event-ID") ?? 0) || 0));
    return { app, executor };
}
//# sourceMappingURL=runs.js.map