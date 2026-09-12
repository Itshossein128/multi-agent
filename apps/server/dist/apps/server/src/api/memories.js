"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoriesRouter = createMemoriesRouter;
const hono_1 = require("hono");
const body_limit_1 = require("hono/body-limit");
const contracts_1 = require("../../../../src/memory/contracts");
const memoryApiService_1 = require("./memories/memoryApiService");
function createMemoriesRouter(service, resolveAccess) {
    const app = new hono_1.Hono();
    const api = service ? new memoryApiService_1.MemoryApiService(service) : undefined;
    app.use("*", (0, body_limit_1.bodyLimit)({ maxSize: 128 * 1024, onError: (c) => c.json({ error: "Memory request is too large." }, 413) }));
    app.use("*", async (c, next) => {
        const access = await resolveAccess(c.req.raw);
        if (!access)
            return c.json({ error: "Memory authentication required." }, 401);
        if (!api)
            return c.json({ error: "Long-term memory persistence is not configured." }, 503);
        c.set("memoryAccess", access);
        await next();
    });
    app.onError((error, c) => {
        if (error instanceof contracts_1.MemoryAccessDeniedError)
            return c.json({ error: "Memory access denied." }, 403);
        if (error instanceof contracts_1.MemoryConflictError)
            return c.json({ error: "Memory changed; reload and retry." }, 409);
        if (error instanceof contracts_1.MemoryValidationError || error instanceof SyntaxError)
            return c.json({ error: error instanceof SyntaxError ? "Invalid JSON." : error.message }, 400);
        return c.json({ error: "Memory operation failed." }, 503);
    });
    app.get("/", async (c) => c.json(await api.list(new URL(c.req.url), c.get("memoryAccess"))));
    app.post("/search", async (c) => c.json(await api.search(await c.req.json(), c.get("memoryAccess"))));
    app.post("/", async (c) => {
        const result = await api.remember(await c.req.json(), c.get("memoryAccess"));
        return c.json(result.body, result.action === "inserted" ? 201 : 200);
    });
    app.get("/:memoryId", async (c) => {
        const result = await api.get(c.req.param("memoryId"), c.get("memoryAccess"));
        return result ? c.json(result) : c.json({ error: "Memory not found." }, 404);
    });
    app.patch("/:memoryId", async (c) => c.json(await api.update(c.req.param("memoryId"), await c.req.json(), c.get("memoryAccess"))));
    app.delete("/:memoryId", async (c) => { await api.forget(c.req.param("memoryId"), c.get("memoryAccess")); return c.body(null, 204); });
    return app;
}
//# sourceMappingURL=memories.js.map