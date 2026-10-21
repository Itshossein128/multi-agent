import {
  pinnedHttpFetch,
  resolveDestination,
  validateDestination,
  type DestinationResolver,
  type PinnedRequestInit,
} from "./httpDestination";
import type { ToolExecutionInput, ToolExecutor } from "./types";

export type ToolFetch = (input: RequestInfo | URL, init?: PinnedRequestInit) => Promise<Response>;

/** Executes a configured HTTP endpoint; callers cannot replace its destination through input. */
export class HttpToolExecutor implements ToolExecutor {
  constructor(
    private readonly fetchImpl: ToolFetch = pinnedHttpFetch,
    private readonly options: { resolve?: DestinationResolver; maxRedirects?: number } = {},
  ) {}

  async execute({ tool, input, signal }: ToolExecutionInput): Promise<Record<string, unknown>> {
    const rawUrl = tool.configuration.url;
    if (typeof rawUrl !== "string") throw new Error(`HTTP tool "${tool.name}" requires a string configuration.url.`);
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new Error(`HTTP tool "${tool.name}" has an invalid configuration.url.`); }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`HTTP tool "${tool.name}" only permits http(s) URLs.`);
    const method = String(tool.configuration.method ?? "GET").toUpperCase();
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(method)) throw new Error(`HTTP tool "${tool.name}" has an unsupported HTTP method.`);
    let bodyInput = method === "GET" ? undefined : JSON.stringify(input);
    let nextMethod = method;
    let response: Response;
    const maxRedirects = Math.min(this.options.maxRedirects ?? 5, 10);

    for (let hop = 0; ; hop += 1) {
      const pinnedAddress = await validateDestination(url, this.options.resolve ?? resolveDestination);
      response = await this.fetchImpl(url, {
        method: nextMethod,
        headers: {
          Accept: "application/json",
          ...(bodyInput === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: bodyInput,
        signal,
        redirect: "manual",
        pinnedAddress,
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) break;

      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || hop >= maxRedirects) {
        throw new Error("HTTP destination redirect limit exceeded or missing location.");
      }

      const target = new URL(location, url);
      if (target.origin !== url.origin && bodyInput !== undefined) {
        throw new Error("HTTP redirects may not forward an input body across origins.");
      }
      if (response.status === 303 || ([301, 302].includes(response.status) && nextMethod === "POST")) {
        nextMethod = "GET";
        bodyInput = undefined;
      }
      url = target;
    }

    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = text;
    }
    if (!response.ok) throw new Error(`HTTP tool "${tool.name}" returned ${response.status}.`);
    return { status: response.status, body };
  }
}
