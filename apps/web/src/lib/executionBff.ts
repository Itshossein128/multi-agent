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
  return proxyExecutionWith(request, path, { principal: getAuthenticatedPrincipal, fetchImpl: fetch, secret: process.env.INTERNAL_PRINCIPAL_SECRET, base: process.env.EXECUTION_SERVER_URL });
}
export async function proxyExecutionWith(request: Request, path: string, deps: { principal: typeof getAuthenticatedPrincipal; fetchImpl: typeof fetch; secret?: string; base?: string }): Promise<Response> {
  const principal = await deps.principal();
  if (!principal) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { secret, base } = deps;
  if (!secret || !base) return Response.json({ error: "Execution gateway is not configured." }, { status: 503 });
  const headers = new Headers();
  request.headers.forEach((value, key) => { if (forwardedHeaders.has(key.toLowerCase())) headers.set(key, value); });
  headers.set("X-Multi-Agent-Principal", createInternalPrincipalAssertion(principal, secret));
  const url = new URL(path, base); url.search = new URL(request.url).search;
  const upstream = await deps.fetchImpl(url, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, signal: request.signal });
  return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
}
