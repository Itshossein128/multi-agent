"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDashboardRouter = createDashboardRouter;
const hono_1 = require("hono");
const principal_1 = require("../auth/principal");
const dashboardService_1 = require("./dashboard/dashboardService");
const http_1 = require("./shared/http");
__exportStar(require("./dashboard/models"), exports);
function createDashboardRouter(runStore, studioStore, executor, resolvePrincipal = principal_1.resolveRequestPrincipal) {
    const app = new hono_1.Hono();
    const service = new dashboardService_1.DashboardService(runStore, studioStore, executor);
    app.use("/*", (0, http_1.requirePrincipal)(resolvePrincipal));
    app.onError(http_1.respondWithApiError);
    app.get("/", async (c) => c.json(await service.get(c.get("principal"))));
    app.post("/", async (c) => {
        let command;
        try {
            command = await c.req.json();
        }
        catch {
            return c.json({ error: "Invalid JSON body" }, 400);
        }
        const result = await service.execute(command, c.get("principal"));
        return c.json(result, command.action === "enqueue" ? 201 : 200);
    });
    return app;
}
//# sourceMappingURL=dashboard.js.map