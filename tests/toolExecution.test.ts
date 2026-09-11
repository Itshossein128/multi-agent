import { createToolRecord, type ToolRecord } from "@multi-agent/types";
import { createToolsRouter } from "../apps/server/src/api/tools";
import { ToolRuntime } from "../src/tools/toolRuntime";
import { HttpToolExecutor } from "../src/tools/httpToolExecutor";

function json(response: Response) { return response.json(); }

const testPrincipal = { userId: "test-user", tenantId: "test-tenant" };

describe("POST /tools/test", () => {
  const app = createToolsRouter(undefined, undefined, async () => testPrincipal);

  test("executes the function category as a safe local echo", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Echo" }), configuration: { greeting: "hi" } };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: { name: "world" } }) });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ output: { greeting: "hi", name: "world" } });
  });

  test("executes a configured HTTP endpoint without accepting an input-controlled destination", async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ result: "ok" }), { status: 200 }));
    const runtime = new ToolRuntime(1_000, true, { create: (category) => category === "http" ? new HttpToolExecutor(fetchImpl) : { execute: jest.fn() } });
    const app = createToolsRouter(runtime, undefined, async () => testPrincipal);
    const tool: ToolRecord = { ...createToolRecord({ name: "Lookup", category: "http" }), configuration: { url: "https://service.test/lookup", method: "POST" }, impact: "external" };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: { query: "status", url: "https://attacker.test" } }) });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ output: { status: 200, body: { result: "ok" } } });
    expect(fetchImpl).toHaveBeenCalledWith(new URL("https://service.test/lookup"), expect.objectContaining({ method: "POST" }));
  });

  test("reports an explicit error for still unsupported categories", async () => {
    const tool: ToolRecord = createToolRecord({ name: "Database", category: "database" });
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: {} }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/not implemented/);
  });

  test("rejects tool configuration carrying credentials", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Leaky" }), configuration: { apiKey: "sk-abcdefghijklmnop" } };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: {} }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/Credentials/);
  });

  test("rejects a disabled tool", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Off" }), enabled: false };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: {} }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/disabled/);
  });

  test("does not allow side-effecting HTTP tools without server approval", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Mutate", category: "http" }), configuration: { url: "https://service.test/items", method: "POST" }, impact: "external" };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: {} }) });
    expect(response.status).toBe(400);
    expect((await json(response)).error).toMatch(/requires server approval/);
  });
});
