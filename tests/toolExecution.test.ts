import { createToolRecord, type ToolRecord } from "@multi-agent/types";
import { createToolsRouter } from "../apps/server/src/api/tools";

function json(response: Response) { return response.json(); }

describe("POST /tools/test", () => {
  const app = createToolsRouter();

  test("executes the function category as a safe local echo", async () => {
    const tool: ToolRecord = { ...createToolRecord({ name: "Echo" }), configuration: { greeting: "hi" } };
    const response = await app.request("/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input: { name: "world" } }) });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ output: { greeting: "hi", name: "world" } });
  });

  test("reports an explicit not-implemented error for unsupported categories", async () => {
    const tool: ToolRecord = createToolRecord({ name: "Search", category: "http" });
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
});
