import type { CredentialGateway } from "../security/credentialGateway";
import { credentialEnvironmentName, credentialGatewayFromEnvironment } from "../security/credentialGateway";
import type { ToolExecutionInput, ToolExecutor } from "./types";

export type McpFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Minimal Streamable HTTP MCP client with server-owned endpoint/token configuration. */
export class McpToolExecutor implements ToolExecutor {
  constructor(
    private readonly gateway: CredentialGateway = credentialGatewayFromEnvironment(),
    private readonly fetchImpl: McpFetch = fetch,
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  async execute({ tool, input, signal, runId, credentialPrincipal }: ToolExecutionInput): Promise<Record<string, unknown>> {
    const alias = serverAlias(tool.configuration.server ?? tool.configuration.provider);
    const toolName = String(tool.configuration.tool ?? tool.configuration.toolName ?? "").trim();
    if (!toolName || toolName.length > 128 || /[\r\n\0]/.test(toolName)) throw new Error("MCP tool requires a safe configuration.tool name.");
    const endpoint = this.environment[endpointEnvironmentName(alias)];
    if (!endpoint) throw new Error(`MCP server "${alias}" has no server-configured endpoint.`);
    const url = safeEndpoint(endpoint);
    if (!credentialPrincipal || !runId) throw new Error("MCP tool requires an authenticated run context.");
    const lease = await this.gateway.issue({ provider: "mcp", alias, tenantId: credentialPrincipal.tenantId, principalId: credentialPrincipal.principalId, runId, toolId: tool.id, purpose: "mcp" });
    const token = await this.gateway.consume(lease, { provider: "mcp", alias, tenantId: credentialPrincipal.tenantId, principalId: credentialPrincipal.principalId, runId, toolId: tool.id, purpose: "mcp" });
    const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const initialized = await rpc(this.fetchImpl, url, headers, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "multi-agent-platform", version: "1.0" } }, signal);
    const sessionId = initialized.sessionId;
    const sessionHeaders = sessionId ? { ...headers, "Mcp-Session-Id": sessionId } : headers;
    await rpc(this.fetchImpl, url, sessionHeaders, "notifications/initialized", undefined, signal, true);
    const result = await rpc(this.fetchImpl, url, sessionHeaders, "tools/call", { name: toolName, arguments: input.arguments && typeof input.arguments === "object" && !Array.isArray(input.arguments) ? input.arguments : input }, signal);
    return { server: alias, tool: toolName, result: result.result };
  }
}

async function rpc(fetchImpl: McpFetch, url: URL, headers: Record<string, string>, method: string, params: unknown, signal: AbortSignal | undefined, notification = false) {
  const response = await fetchImpl(url, { method: "POST", headers, signal, body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }), method, ...(params === undefined ? {} : { params }) }) });
  const body = await parseResponse(response);
  if (!response.ok) throw new Error(`MCP server returned ${response.status}.`);
  if (body?.error) throw new Error(`MCP request "${method}" failed.`);
  return { result: body?.result, sessionId: response.headers.get("mcp-session-id") ?? undefined };
}

async function parseResponse(response: Response): Promise<any> {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    const text = await response.text();
    const data = text.split(/\r?\n/).filter(line => line.startsWith("data:")).at(-1)?.slice(5).trim();
    return data ? JSON.parse(data) : {};
  }
  return response.json().catch(async () => ({ text: await response.text() }));
}

function serverAlias(value: string | number | boolean | undefined) { const alias = String(value ?? "").trim(); if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(alias)) throw new Error("MCP tool requires a safe server-owned configuration.server alias."); return alias; }
function endpointEnvironmentName(alias: string) { return `TOOL_MCP_${alias.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_URL`; }
export function mcpCredentialEnvironmentName(alias: string) { return credentialEnvironmentName({ provider: "mcp", alias }); }
function safeEndpoint(raw: string) { let url: URL; try { url = new URL(raw); } catch { throw new Error("MCP endpoint must be a valid HTTP(S) URL."); } if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("MCP endpoint must be HTTP(S) without embedded credentials."); return url; }
