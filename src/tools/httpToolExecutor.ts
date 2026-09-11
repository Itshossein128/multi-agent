import type { ToolExecutionInput, ToolExecutor } from "./types";

export type ToolFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Executes a configured HTTP endpoint; callers cannot replace its destination through input. */
export class HttpToolExecutor implements ToolExecutor {
  constructor(private readonly fetchImpl: ToolFetch = fetch) {}

  async execute({ tool, input, signal }: ToolExecutionInput): Promise<Record<string, unknown>> {
    const rawUrl = tool.configuration.url;
    if (typeof rawUrl !== "string") throw new Error(`HTTP tool "${tool.name}" requires a string configuration.url.`);
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new Error(`HTTP tool "${tool.name}" has an invalid configuration.url.`); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`HTTP tool "${tool.name}" only permits http(s) URLs.`);
    const method = String(tool.configuration.method ?? "GET").toUpperCase();
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) throw new Error(`HTTP tool "${tool.name}" has an unsupported HTTP method.`);
    const response = await this.fetchImpl(url, {
      method,
      headers: { Accept: "application/json", ...(method === "GET" ? {} : { "Content-Type": "application/json" }) },
      body: method === "GET" ? undefined : JSON.stringify(input),
      signal,
    });
    const body = await response.json().catch(async () => await response.text());
    if (!response.ok) throw new Error(`HTTP tool "${tool.name}" returned ${response.status}.`);
    return { status: response.status, body };
  }
}
