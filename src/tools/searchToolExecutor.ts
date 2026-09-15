import type { CredentialGateway } from "../security/credentialGateway";
import { credentialEnvironmentName, credentialGatewayFromEnvironment } from "../security/credentialGateway";
import type { ToolExecutionInput, ToolExecutor } from "./types";

export type SearchFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Executes a server-configured search provider; endpoint and API key are never accepted from agent input. */
export class SearchToolExecutor implements ToolExecutor {
  constructor(
    private readonly gateway: CredentialGateway = credentialGatewayFromEnvironment(),
    private readonly fetchImpl: SearchFetch = fetch,
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  async execute({ tool, input, signal, runId, credentialPrincipal }: ToolExecutionInput): Promise<Record<string, unknown>> {
    const alias = serverAlias(tool.configuration.provider ?? tool.configuration.service);
    const url = this.environment[endpointEnvironmentName(alias)];
    if (!url) throw new Error(`Search provider "${alias}" has no server-configured endpoint.`);
    const endpoint = safeEndpoint(url);
    const query = String(input.query ?? "").trim();
    if (!query || query.length > 4_000) throw new Error("Search input.query must contain 1-4000 characters.");
    if (!credentialPrincipal || !runId) throw new Error("Search tool requires an authenticated run context.");
    const lease = await this.gateway.issue({ provider: "search", alias, tenantId: credentialPrincipal.tenantId, principalId: credentialPrincipal.principalId, runId });
    const apiKey = await this.gateway.consume(lease, { provider: "search", alias, tenantId: credentialPrincipal.tenantId, principalId: credentialPrincipal.principalId, runId });
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ query, limit: boundedLimit(input.limit), filters: input.filters ?? {} }),
      signal,
    });
    const body = await response.json().catch(async () => ({ text: await response.text() }));
    if (!response.ok) throw new Error(`Search provider "${alias}" returned ${response.status}.`);
    return { provider: alias, results: body };
  }
}

function serverAlias(value: string | number | boolean | undefined) {
  const alias = String(value ?? "").trim();
  if (!/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(alias)) throw new Error("Search tool requires a safe server-owned configuration.provider alias.");
  return alias;
}

function endpointEnvironmentName(alias: string) { return `TOOL_SEARCH_${alias.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_URL`; }
export function searchCredentialEnvironmentName(alias: string) { return credentialEnvironmentName({ provider: "search", alias }); }
function safeEndpoint(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Search endpoint must be a valid HTTP(S) URL."); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Search endpoint must be HTTP(S) without embedded credentials.");
  return url;
}
function boundedLimit(value: unknown) { const parsed = Number(value ?? 10); return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 10; }
