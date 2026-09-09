import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isMemoryNamespace, type Memory, type MemoryKind, type MemoryNamespace, type MemoryRetrievalQuery, type RememberMemoryInput } from "@multi-agent/types";
import { MemoryAccessDeniedError, MemoryConflictError, MemoryValidationError, type MemoryAccessContext, type MemoryService, type UpdateMemoryInput } from "../../../../src/memory/contracts";
import type { MemoryAccessResolver } from "../memory/access";

/** Embeddings are an internal representation, never a management API payload. */
function visible(memory: Memory) { const { embedding, contentHash, tenantId, ...result } = memory; void embedding; void contentHash; void tenantId; return result; }
function namespaceFromUrl(url: URL): MemoryNamespace {
  const namespace = { scope: url.searchParams.get("scope"), id: url.searchParams.get("namespaceId") };
  if (!isMemoryNamespace(namespace)) throw new MemoryValidationError("A valid scope and namespaceId are required.");
  return namespace;
}
function integer(value: string | null, fallback: number, min: number, max: number) {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new MemoryValidationError("Invalid pagination value.");
  return parsed;
}
export function createMemoriesRouter(service: MemoryService | undefined, resolveAccess: MemoryAccessResolver) {
  const app = new Hono<{ Variables: { memoryAccess: MemoryAccessContext } }>();
  app.use("*", bodyLimit({ maxSize: 128 * 1024, onError: (c) => c.json({ error: "Memory request is too large." }, 413) }));
  app.use("*", async (c, next) => {
    const access = await resolveAccess(c.req.raw);
    if (!access) return c.json({ error: "Memory authentication required." }, 401);
    if (!service) return c.json({ error: "Long-term memory persistence is not configured." }, 503);
    c.set("memoryAccess", access);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof MemoryAccessDeniedError) return c.json({ error: "Memory access denied." }, 403);
    if (error instanceof MemoryConflictError) return c.json({ error: "Memory changed; reload and retry." }, 409);
    if (error instanceof MemoryValidationError || error instanceof SyntaxError) return c.json({ error: error instanceof SyntaxError ? "Invalid JSON." : error.message }, 400);
    return c.json({ error: "Memory operation failed." }, 503);
  });
  app.get("/", async (c) => {
    const url = new URL(c.req.url);
    const kind = url.searchParams.get("kind");
    if (kind && !["semantic", "episodic", "procedural"].includes(kind)) throw new MemoryValidationError("Invalid memory kind.");
    const result = await service!.list({ namespaces: [namespaceFromUrl(url)], limit: integer(url.searchParams.get("limit"), 50, 1, 100), offset: integer(url.searchParams.get("offset"), 0, 0, 100000), kinds: kind ? [kind as MemoryKind] : undefined }, c.get("memoryAccess"));
    return c.json(result.map(visible));
  });
  app.post("/search", async (c) => {
    const body = await c.req.json<MemoryRetrievalQuery>();
    if (!body || typeof body.text !== "string" || body.text.length > 16000 || !Array.isArray(body.namespaces) || !body.namespaces.length || body.namespaces.length > 20 || !body.namespaces.every(isMemoryNamespace)) throw new MemoryValidationError("Search requires text and explicit valid namespaces.");
    const result = await service!.recall(body, c.get("memoryAccess"));
    return c.json({ ...result, results: result.results.map((item) => ({ ...item, memory: visible(item.memory) })) });
  });
  app.post("/", async (c) => {
    const body = await c.req.json<RememberMemoryInput>();
    if (!body || !isMemoryNamespace(body.namespace)) throw new MemoryValidationError("Memory namespace is required.");
    const result = await service!.remember(body, c.get("memoryAccess"));
    return c.json({ ...result, memory: visible(result.memory) }, result.action === "inserted" ? 201 : 200);
  });
  app.get("/:memoryId", async (c) => {
    const result = await service!.get(c.req.param("memoryId"), c.get("memoryAccess"));
    return result ? c.json(visible(result)) : c.json({ error: "Memory not found." }, 404);
  });
  app.patch("/:memoryId", async (c) => {
    const body = await c.req.json<UpdateMemoryInput>();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new MemoryValidationError("Memory patch must be an object.");
    return c.json(visible(await service!.update(c.req.param("memoryId"), body, c.get("memoryAccess"))));
  });
  app.delete("/:memoryId", async (c) => { await service!.forget(c.req.param("memoryId"), c.get("memoryAccess")); return c.body(null, 204); });
  return app;
}
