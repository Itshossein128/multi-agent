"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createToolsRouter = createToolsRouter;
const hono_1 = require("hono");
const body_limit_1 = require("hono/body-limit");
const tools_1 = require("../../../../src/tools");
const principal_1 = require("../auth/principal");
const http_1 = require("./shared/http");
const toolTestService_1 = require("./tools/toolTestService");
function createToolsRouter(runtime = new tools_1.ToolRuntime(), studioStore, resolvePrincipal = principal_1.resolveRequestPrincipal) {
    const app = new hono_1.Hono();
    const service = new toolTestService_1.ToolTestService(runtime, studioStore);
    app.use("*", (0, body_limit_1.bodyLimit)({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Tool request is too large." }, 413) }));
    app.use("*", (0, http_1.requirePrincipal)(resolvePrincipal));
    app.onError(http_1.respondWithApiError);
    app.post("/test", async (c) => c.json(await service.execute(await c.req.json(), c.get("principal"))));
    return app;
}
//# sourceMappingURL=tools.js.map