jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/auth", () => ({ getAuthenticatedPrincipal: jest.fn() }));

import { proxyExecutionWith } from "../apps/web/src/lib/executionBff";
import { verifyInternalPrincipalAssertion } from "../src/auth/internalPrincipal";
import { createWorkflowService } from "../apps/web/src/services/workflowService";
import { runService } from "../apps/web/src/services/runService";
import { toolService } from "../apps/web/src/services/toolService";

const bffDeps = (overrides: Partial<Parameters<typeof proxyExecutionWith>[2]> = {}) => ({
  principal: async () => ({ userId: "owner", tenantId: "tenant" }),
  fetchImpl: jest.fn() as unknown as typeof fetch, secret: "transport-secret", base: "http://execution.internal/base/",
  ...overrides,
});
const asFetch = (mock: jest.Mock) => mock as unknown as typeof fetch;

test("BFF rejects a missing session before calling the execution server", async () => {
  const fetchSpy = jest.fn();
  const response = await proxyExecutionWith(new Request("http://web/api/execution/runs/x"), "/runs/x", { ...bffDeps({ fetchImpl: asFetch(fetchSpy) }), principal: async () => null });
  expect(response.status).toBe(401);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("BFF reconstructs the destination and forwards only allow-listed headers with a fresh server principal", async () => {
  const request = new Request("http://web/api/execution/runs/x?after=2&filter=a%20b", {
    method: "PATCH", headers: {
      "Accept": "application/json", "Content-Type": "application/json", "X-Request-Id": "request-1", "X-User-Id": "evil", "X-Tenant-Id": "evil", "X-Multi-Agent-Principal": "forged", "Authorization": "Bearer browser-token", "Cookie": "session=browser", "X-Other": "nope",
    }, body: JSON.stringify({ value: 1 })
  });
  const fetchSpy = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("ok", { status: 202, headers: { "X-Upstream": "yes", "Cache-Control": "no-store", "Content-Type": "application/json" } }));
  const response = await proxyExecutionWith(request, "/runs/x", bffDeps({ fetchImpl: asFetch(fetchSpy), base: "http://execution.internal/base/" }));
  expect(response.status).toBe(202); expect(response.headers.get("X-Upstream")).toBe("yes"); expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(response.headers.get("Content-Type")).toContain("application/json");
  const [url, init] = fetchSpy.mock.calls[0]!; const headers = new Headers(init?.headers);
  expect(String(url)).toBe("http://execution.internal/runs/x?after=2&filter=a%20b"); expect(init?.method).toBe("PATCH");
  expect((init as RequestInit & { duplex?: string })?.duplex).toBe("half");
  expect(headers.get("Accept")).toBe("application/json"); expect(headers.get("Content-Type")).toBe("application/json"); expect(headers.get("X-Request-Id")).toBe("request-1");
  for (const header of ["X-User-Id", "X-Tenant-Id", "Authorization", "Cookie", "X-Other"]) expect(headers.get(header)).toBeNull();
  expect(verifyInternalPrincipalAssertion(headers.get("X-Multi-Agent-Principal"), "transport-secret")).toEqual({ userId: "owner", tenantId: "tenant" });
  expect(headers.get("X-Multi-Agent-Principal")).not.toBe("forged"); expect(await new Response(init?.body).text()).toBe('{"value":1}');
});

test("BFF exposes SSE chunks before the upstream stream completes and propagates cancellation", async () => {
  let upstreamController!: ReadableStreamDefaultController<Uint8Array>;
  const controller = new ReadableStream<Uint8Array>({ start(c) { upstreamController = c; c.enqueue(new TextEncoder().encode("data: one\n\n")); } });
  const abort = new AbortController(); let upstreamAborted = false; let passedRequestSignal = false;
  let request!: Request;
  const fetchSpy = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { passedRequestSignal = init?.signal === request.signal; init?.signal?.addEventListener("abort", () => { upstreamAborted = true; }); return new Response(controller, { headers: { "Content-Type": "text/event-stream" } }); });
  request = new Request("http://web/x", { signal: abort.signal });
  const response = await proxyExecutionWith(request, "/runs/r/events", bffDeps({ fetchImpl: asFetch(fetchSpy) }));
  expect(passedRequestSignal).toBe(true); expect(response.headers.get("Content-Type")).toContain("text/event-stream"); const reader = response.body!.getReader(); expect(new TextDecoder().decode((await reader.read()).value)).toContain("one");
  abort.abort(); expect(upstreamAborted).toBe(true);
  upstreamController.enqueue(new TextEncoder().encode("data: two\n\n")); upstreamController.close(); expect(new TextDecoder().decode((await reader.read()).value)).toContain("two");
});

test("BFF returns 503 when the execution server is unreachable", async () => {
  const fetchSpy = jest.fn(async () => {
    const error = new TypeError("fetch failed");
    (error as { cause?: { code?: string } }).cause = { code: "ECONNREFUSED" };
    throw error;
  });
  const response = await proxyExecutionWith(
    new Request("http://web/api/dashboard"),
    "/dashboard",
    bffDeps({ fetchImpl: asFetch(fetchSpy), base: "http://localhost:4000" }),
  );
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    error: "Execution server is unreachable at http://localhost:4000. Start it with pnpm run dev:server (or pnpm run dev).",
  });
});

test("workflow, run, and tool browser clients target only the BFF", async () => {
  const calls: string[] = [];
  const fetchSpy = jest.fn(async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response("[]", { headers: { "Content-Type": "application/json" } }); });
  const fetchImpl = asFetch(fetchSpy);
  await createWorkflowService({ fetch: fetchImpl }).listWorkflows();
  const originalFetch = global.fetch;
  global.fetch = fetchImpl;
  try {
    await runService.listRuns();
    await toolService.testTool({ id: "tool", name: "Tool", description: "", category: "function", inputSchema: {}, configuration: {}, enabled: true, createdAt: "", updatedAt: "" } as never, {});
  } finally { global.fetch = originalFetch; }
  expect(calls).toEqual(["/api/execution/studio/workflows", "/api/execution/runs", "/api/execution/tools/test"]);
});
