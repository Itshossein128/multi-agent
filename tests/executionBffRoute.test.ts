jest.mock("../apps/web/src/lib/executionBff", () => ({ proxyExecution: jest.fn() }));

import { proxyExecution } from "../apps/web/src/lib/executionBff";
import { GET, POST } from "../apps/web/src/app/api/execution/[...path]/route";

const mockedProxy = jest.mocked(proxyExecution);

beforeEach(() => mockedProxy.mockReset().mockResolvedValue(new Response("proxied")));

test("catch-all route reconstructs nested paths and preserves the original request", async () => {
  const request = new Request("http://web/api/execution/runs/run-1/events?sequence=9", { method: "GET" });
  await GET(request, { params: Promise.resolve({ path: ["runs", "run-1", "events"] }) });
  expect(mockedProxy).toHaveBeenCalledWith(request, "/runs/run-1/events");
});

test("catch-all route dispatches mutating methods without rewriting their body or query", async () => {
  const request = new Request("http://web/api/execution/studio/workflows/a?draft=true", { method: "POST", body: '{"name":"A"}' });
  await POST(request, { params: Promise.resolve({ path: ["studio", "workflows", "a"] }) });
  const [forwarded] = mockedProxy.mock.calls[0]!;
  expect(forwarded).toBe(request); expect(forwarded.method).toBe("POST"); expect(new URL(forwarded.url).search).toBe("?draft=true"); expect(await forwarded.text()).toBe('{"name":"A"}');
});
