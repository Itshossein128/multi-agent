"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createToolsRouter = createToolsRouter;
const hono_1 = require("hono");
const body_limit_1 = require("hono/body-limit");
const types_1 = require("@multi-agent/types");
const tools_1 = require("../../../../src/tools");
const principal_1 = require("../auth/principal");
function createToolsRouter(runtime = new tools_1.ToolRuntime(), studioStore, resolvePrincipal = principal_1.resolveRequestPrincipal) {
    const app = new hono_1.Hono();
    app.use("*", (0, body_limit_1.bodyLimit)({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Tool request is too large." }, 413) }));
    app.use("*", async (c, next) => {
        const principal = await resolvePrincipal(c.req.raw);
        if (!principal)
            return c.json({ error: "Authentication required." }, 401);
        c.set("principal", principal);
        await next();
    });
    app.post("/test", async (c) => {
        const principal = c.get("principal");
        try {
            const body = await c.req.json();
            if ((!body.tool && !body.toolId) || !body.input || typeof body.input !== "object" || Array.isArray(body.input)) {
                return c.json({ error: "tool and sample input object are required" }, 400);
            }
            let toolToExecute = null;
            const targetId = body.toolId ?? body.tool?.id;
            if (targetId && studioStore) {
                const storedTool = await studioStore.getTool(targetId);
                if (storedTool) {
                    if (!(0, principal_1.authorizeToolOrAgent)(principal, storedTool, "execute")) {
                        return c.json({ error: "Access denied to tool." }, 404);
                    }
                    toolToExecute = storedTool;
                }
            }
            if (body.tool) {
                (0, types_1.assertNoCredentials)(body.tool);
                toolToExecute = (0, types_1.migrateToolRecord)(body.tool);
            }
            if (!toolToExecute) {
                return c.json({ error: "Tool not found" }, 404);
            }
            const errors = (0, types_1.validateTool)(toolToExecute);
            if (errors.length)
                return c.json({ error: errors.join(" ") }, 400);
            const output = await runtime.execute(toolToExecute, body.input);
            return c.json({ output });
        }
        catch (error) {
            if (error instanceof tools_1.UnsupportedToolCategoryError)
                return c.json({ error: error.message }, 400);
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
    });
    return app;
}
//# sourceMappingURL=tools.js.map