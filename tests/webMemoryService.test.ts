import { memoryService } from "../apps/web/src/services/memoryService";

describe("memoryService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("routes requests to org-scoped BFF path when orgSlug is provided", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse([{ id: "mem-1", content: "Org memory" }]));
    global.fetch = fetchMock;

    const result = await memoryService.listMemories("acme-corp", { scope: "organization", id: "org-123" });
    expect(result).toEqual([{ id: "mem-1", content: "Org memory" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/o/acme-corp/execution/memories?scope=organization&namespaceId=org-123",
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.anything() }),
      }),
    );
  });

  it("routes requests with bearer token to API_URL when a token is provided", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse([{ id: "mem-2", content: "Token memory" }]));
    global.fetch = fetchMock;

    const result = await memoryService.listMemories("sk-test-token-that-is-long-enough-and-has-token-shape", { scope: "agent", id: "agent-1" });
    expect(result).toEqual([{ id: "mem-2", content: "Token memory" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^http:\/\/localhost:4000\/memories\?scope=agent&namespaceId=agent-1/),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-token-that-is-long-enough-and-has-token-shape",
        }),
      }),
    );
  });

  it("sends delete request to org-scoped BFF path", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock;

    await memoryService.deleteMemory("acme-corp", "mem-123");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/o/acme-corp/execution/memories/mem-123",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("sends search request with POST and body", async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ results: [{ memory: { id: "m1" }, score: 0.9 }] }));
    global.fetch = fetchMock;

    const result = await memoryService.searchMemories("acme-corp", { scope: "organization", id: "org-1" }, "query");
    expect(result.results).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/o/acme-corp/execution/memories/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          text: "query",
          namespaces: [{ scope: "organization", id: "org-1" }],
        }),
      }),
    );
  });
});
