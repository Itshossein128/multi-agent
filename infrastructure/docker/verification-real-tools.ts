import { createServer } from "node:http";
import { McpToolExecutor } from "../../src/tools/mcpToolExecutor";
import { SearchToolExecutor } from "../../src/tools/searchToolExecutor";
import { EnvironmentCredentialGateway } from "../../src/security/credentialGateway";
import { createToolRecord } from "@multi-agent/types";

const methods: string[] = [];
const server = createServer(async (request, response) => {
  const body = await new Promise<string>((resolve) => { let value = ""; request.on("data", chunk => { value += chunk; }); request.on("end", () => resolve(value)); });
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/search") {
    if (request.method !== "POST" || request.headers.authorization !== "Bearer search-secret") { response.statusCode = 401; response.end(JSON.stringify({ error: "unauthorized" })); return; }
    response.end(JSON.stringify({ hits: [{ title: JSON.parse(body).query }] }));
    return;
  }
  if (request.url === "/mcp") {
    const message = JSON.parse(body) as { method: string };
    methods.push(message.method);
    if (request.headers.authorization !== "Bearer mcp-secret") { response.statusCode = 401; response.end(JSON.stringify({ error: "unauthorized" })); return; }
    if (message.method === "initialize") { response.setHeader("Mcp-Session-Id", "live-session"); response.end(JSON.stringify({ result: { protocolVersion: "2025-06-18" } })); return; }
    if (message.method === "tools/call") { if (request.headers["mcp-session-id"] !== "live-session") { response.statusCode = 400; response.end(JSON.stringify({ error: "missing session" })); return; } response.end(JSON.stringify({ result: { content: [{ type: "text", text: "live-ok" }] } })); return; }
    response.end(JSON.stringify({ result: {} }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
});

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

async function main() {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string", "verification server did not bind");
  const env = {
    TOOL_SEARCH_LOCAL_URL: `http://127.0.0.1:${address.port}/search`,
    TOOL_SEARCH_LOCAL_API_KEY: "search-secret",
    TOOL_MCP_LOCAL_URL: `http://127.0.0.1:${address.port}/mcp`,
    TOOL_MCP_LOCAL_TOKEN: "mcp-secret",
  };
  const gateway = new EnvironmentCredentialGateway(true, env);
  const context = { runId: "live-tools-run", credentialPrincipal: { tenantId: "verification", principalId: "verification" } };
  const search = createToolRecord({ category: "search" });
  search.configuration = { provider: "local" };
  const searchResult = await new SearchToolExecutor(gateway, fetch, env).execute({ tool: search, input: { query: "live-search" }, ...context });
  assert((searchResult.results as { hits?: unknown[] }).hits?.length === 1, "live search returned no hit");
  const mcp = createToolRecord({ category: "mcp" });
  mcp.configuration = { server: "local", tool: "echo" };
  const mcpResult = await new McpToolExecutor(gateway, fetch, env).execute({ tool: mcp, input: { arguments: { value: "live" } }, ...context });
  assert(methods.join(",") === "initialize,notifications/initialized,tools/call", `unexpected MCP methods: ${methods.join(",")}`);
  assert(JSON.stringify({ searchResult, mcpResult }).includes("secret") === false, "live tool output leaked a credential");
  console.log("PASS live search HTTP execution");
  console.log("PASS live MCP Streamable HTTP execution");
} 

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }).finally(() => server.close());
