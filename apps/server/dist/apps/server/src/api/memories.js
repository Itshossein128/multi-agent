"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoriesRouter = createMemoriesRouter;
const hono_1 = require("hono");
const body_limit_1 = require("hono/body-limit");
const types_1 = require("@multi-agent/types");
const contracts_1 = require("../../../../src/memory/contracts");
/** Embeddings are an internal representation, never a management API payload. */
function visible(memory) { const { embedding, contentHash, tenantId, ...result } = memory; void embedding; void contentHash; void tenantId; return result; }
function namespaceFromUrl(url) {
    const namespace = { scope: url.searchParams.get("scope"), id: url.searchParams.get("namespaceId") };
    if (!(0, types_1.isMemoryNamespace)(namespace))
        throw new contracts_1.MemoryValidationError("A valid scope and namespaceId are required.");
    return namespace;
}
function integer(value, fallback, min, max) {
    if (value === null)
        return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max)
        throw new contracts_1.MemoryValidationError("Invalid pagination value.");
    return parsed;
}
function createMemoriesRouter(service, resolveAccess) {
    const app = new hono_1.Hono();
    app.use("*", (0, body_limit_1.bodyLimit)({ maxSize: 128 * 1024, onError: (c) => c.json({ error: "Memory request is too large." }, 413) }));
    app.use("*", async (c, next) => {
        const access = await resolveAccess(c.req.raw);
        if (!access)
            return c.json({ error: "Memory authentication required." }, 401);
        if (!service)
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
    app.get("/", async (c) => {
        const url = new URL(c.req.url);
        const kind = url.searchParams.get("kind");
        if (kind && !["semantic", "episodic", "procedural"].includes(kind))
            throw new contracts_1.MemoryValidationError("Invalid memory kind.");
        const result = await service.list({ namespaces: [namespaceFromUrl(url)], limit: integer(url.searchParams.get("limit"), 50, 1, 100), offset: integer(url.searchParams.get("offset"), 0, 0, 100000), kinds: kind ? [kind] : undefined }, c.get("memoryAccess"));
        return c.json(result.map(visible));
    });
    app.post("/search", async (c) => {
        const body = await c.req.json();
        if (!body || typeof body.text !== "string" || body.text.length > 16000 || !Array.isArray(body.namespaces) || !body.namespaces.length || body.namespaces.length > 20 || !body.namespaces.every(types_1.isMemoryNamespace))
            throw new contracts_1.MemoryValidationError("Search requires text and explicit valid namespaces.");
        const result = await service.recall(body, c.get("memoryAccess"));
        return c.json({ ...result, results: result.results.map((item) => ({ ...item, memory: visible(item.memory) })) });
    });
    app.post("/", async (c) => {
        const body = await c.req.json();
        if (!body || !(0, types_1.isMemoryNamespace)(body.namespace))
            throw new contracts_1.MemoryValidationError("Memory namespace is required.");
        const result = await service.remember(body, c.get("memoryAccess"));
        return c.json({ ...result, memory: visible(result.memory) }, result.action === "inserted" ? 201 : 200);
    });
    app.get("/:memoryId", async (c) => {
        const result = await service.get(c.req.param("memoryId"), c.get("memoryAccess"));
        return result ? c.json(visible(result)) : c.json({ error: "Memory not found." }, 404);
    });
    app.patch("/:memoryId", async (c) => {
        const body = await c.req.json();
        if (!body || typeof body !== "object" || Array.isArray(body))
            throw new contracts_1.MemoryValidationError("Memory patch must be an object.");
        return c.json(visible(await service.update(c.req.param("memoryId"), body, c.get("memoryAccess"))));
    });
    app.delete("/:memoryId", async (c) => { await service.forget(c.req.param("memoryId"), c.get("memoryAccess")); return c.body(null, 204); });
    return app;
}
//# sourceMappingURL=memories.js.map