import { DatabaseToolExecutor } from "../src/tools/databaseToolExecutor";
import { SearchToolExecutor } from "../src/tools/searchToolExecutor";
import { McpToolExecutor } from "../src/tools/mcpToolExecutor";
import { EnvironmentCredentialGateway, HttpCredentialGateway, type CredentialGateway } from "../src/security/credentialGateway";
import { createToolRecord } from "@multi-agent/types";

const context = { runId: "run-real-tools", credentialPrincipal: { tenantId: "tenant", principalId: "user" } };

function gateway(secret: string): CredentialGateway {
  return {
    issue: async () => ({ leaseId: "lease", expiresAt: Date.now() + 10_000 }),
    consume: async () => secret,
  };
}

test("credential gateway leases are single-use and context-bound", async () => {
  const configured = new EnvironmentCredentialGateway(true, { TOOL_DATABASE_MAIN_URL: "postgres://server-only" }, 10_000);
  const request = { provider: "database" as const, alias: "main", tenantId: "tenant", principalId: "user", runId: "run" };
  const lease = await configured.issue(request);
  expect(await configured.consume(lease, request)).toBe("postgres://server-only");
  await expect(configured.consume(lease, request)).rejects.toThrow(/invalid|expired/i);
});

test("HTTP credential gateway uses server-to-broker authentication and opaque leases", async () => {
  const calls: Array<{ url: string; headers: Headers; body: any }> = [];
  const fetchImpl = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(calls.length === 1 ? { leaseId: "opaque", expiresAt: Date.now() + 10_000 } : { secret: "broker-secret" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const request = { provider: "search" as const, alias: "web", tenantId: "tenant", principalId: "user", runId: "run" };
  const broker = new HttpCredentialGateway("https://gateway.internal/", "service-token", fetchImpl);
  const lease = await broker.issue(request);
  expect(lease.leaseId).toBe("opaque");
  expect(await broker.consume(lease, request)).toBe("broker-secret");
  expect(calls[0].headers.get("authorization")).toBe("Bearer service-token");
  expect(calls[0].body).toEqual(request);
});

test("database executor performs bounded read-only parameterized queries", async () => {
  const queries: unknown[] = [];
  const client = {
    query: jest.fn(async (query: unknown) => { queries.push(query); return { rows: [{ id: 1 }, { id: 2 }], rowCount: 2, fields: [{ name: "id" }] }; }),
    release: jest.fn(),
  };
  const pool = { connect: async () => client, end: async () => undefined };
  const tool = createToolRecord({ category: "database" });
  tool.configuration = { connection: "main", maxRows: 1 };
  const result = await new DatabaseToolExecutor(gateway("postgres://secret"), () => pool as any).execute({
    tool, input: { query: "SELECT id FROM users WHERE id = $1", parameters: [1] }, ...context,
  });
  expect(result.rows).toEqual([{ id: 1 }]);
  expect(queries.some((query) => typeof query === "object" && String((query as { text?: string }).text).includes("LIMIT 1"))).toBe(true);
  await expect(new DatabaseToolExecutor(gateway("postgres://secret"), () => pool as any).execute({ tool, input: { query: "DELETE FROM users" }, ...context })).rejects.toThrow(/read-only/i);
});

test("search executor calls only the server endpoint and keeps API keys out of output", async () => {
  const fetchImpl = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer search-secret" }));
    return new Response(JSON.stringify({ hits: [{ title: "result" }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const tool = createToolRecord({ category: "search" });
  tool.configuration = { provider: "web" };
  const result = await new SearchToolExecutor(gateway("search-secret"), fetchImpl, { TOOL_SEARCH_WEB_URL: "https://search.internal/query" }).execute({ tool, input: { query: "langgraph" }, ...context });
  expect(result).toEqual({ provider: "web", results: { hits: [{ title: "result" }] } });
  expect(JSON.stringify(result)).not.toContain("search-secret");
  expect(fetchImpl).toHaveBeenCalledWith(new URL("https://search.internal/query"), expect.any(Object));
});

test("MCP executor performs initialize, initialized notification, and tools/call", async () => {
  const methods: string[] = [];
  const fetchImpl = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    methods.push(body.method);
    const payload = body.method === "initialize" ? { result: { protocolVersion: "2025-06-18" } } : { result: { content: [{ type: "text", text: "ok" }] } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json", ...(body.method === "initialize" ? { "mcp-session-id": "session-1" } : {}) } });
  });
  const tool = createToolRecord({ category: "mcp" });
  tool.configuration = { server: "local", tool: "search" };
  const result = await new McpToolExecutor(gateway("mcp-secret"), fetchImpl, { TOOL_MCP_LOCAL_URL: "http://mcp.internal" }).execute({ tool, input: { arguments: { query: "hello" } }, ...context });
  expect(methods).toEqual(["initialize", "notifications/initialized", "tools/call"]);
  expect(result.server).toBe("local");
  expect(JSON.stringify(result)).not.toContain("mcp-secret");
});
