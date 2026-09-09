"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createToolsRouter = createToolsRouter;
const hono_1 = require("hono");
const body_limit_1 = require("hono/body-limit");
const types_1 = require("@multi-agent/types");
const tools_1 = require("../../../../src/tools");
function createToolsRouter() {
    const app = new hono_1.Hono();
    app.use("*", (0, body_limit_1.bodyLimit)({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "Tool request is too large." }, 413) }));
    app.post("/test", async (c) => {
        try {
            const body = await c.req.json();
            if (!body.tool || !body.input || typeof body.input !== "object" || Array.isArray(body.input))
                return c.json({ error: "tool and sample input object are required" }, 400);
            (0, types_1.assertNoCredentials)(body.tool);
            const tool = (0, types_1.migrateToolRecord)(body.tool);
            const errors = (0, types_1.validateTool)(tool);
            if (errors.length)
                return c.json({ error: errors.join(" ") }, 400);
            if (tool.enabled === false)
                return c.json({ error: "Tool is disabled." }, 400);
            const output = await tools_1.toolExecutorFactory.create(tool.category).execute({ tool, input: body.input });
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