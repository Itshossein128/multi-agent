import "server-only";
import { createInternalPrincipalAssertion } from "../../../../src/auth/internalPrincipal";
import { getAuthenticatedPrincipal } from "@/auth";

/**
 * This is deliberately an allow-list.  The browser is an untrusted hop, so
 * forwarding arbitrary headers would let it smuggle an identity assertion (or
 * ambient credentials) to the execution service.
 */
const forwardedHeaders = new Set([
  "accept",
  "content-type",
  "idempotency-key",
  "last-event-id",
  "prefer",
  "x-request-id",
]);
export async function proxyExecution(request: Request, path: string): Promise<Response> {
  const base = process.env.EXECUTION_SERVER_URL ?? "http://localhost:4000";
  const secret = process.env.INTERNAL_PRINCIPAL_SECRET;
  return proxyExecutionWith(request, path, { principal: getAuthenticatedPrincipal, fetchImpl: fetch, secret, base });
}
export async function proxyExecutionWith(request: Request, path: string, deps: { principal: typeof getAuthenticatedPrincipal; fetchImpl: typeof fetch; secret?: string; base?: string }): Promise<Response> {
  const principal = await deps.principal();
  if (!principal) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { secret, base = "http://localhost:4000" } = deps;
  if (!secret || !base) return Response.json({ error: "Execution gateway is not configured." }, { status: 503 });
  const headers = new Headers();
  request.headers.forEach((value, key) => { if (forwardedHeaders.has(key.toLowerCase())) headers.set(key, value); });
  headers.set("X-Multi-Agent-Principal", createInternalPrincipalAssertion(principal, secret));
  const url = new URL(path, base); url.search = new URL(request.url).search;
  const hasBody = !["GET", "HEAD"].includes(request.method) && request.body !== null;
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    signal: request.signal,
  };
  // Node's fetch requires duplex when forwarding a ReadableStream request body.
  if (hasBody) init.duplex = "half";
  try {
    const upstream = await deps.fetchImpl(url, init);
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string } | null)?.cause?.code
      ?? (error as { code?: string } | null)?.code;
    const unreachable = code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENOTFOUND"
      || (error instanceof TypeError && /fetch failed/i.test(error.message));
    if (unreachable) {
      console.error(`[execution proxy] Upstream unreachable at ${base}:`, error);
      return Response.json(
        { error: `Execution server is unreachable at ${base}. Start it with pnpm run dev:server (or pnpm run dev).` },
        { status: 503 },
      );
    }
    throw error;
  }
}
