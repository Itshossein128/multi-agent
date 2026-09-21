import { requestJson } from "../apps/web/src/services/requestJson";
import { matchesTimeFilter } from "../apps/web/src/lib/dashboardFilters";

describe("requestJson", () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("sends JSON content type and parses responses", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const result = await requestJson<{ ok: boolean }>("/runs", { method: "POST" }, { fetchImpl, apiUrl: "/api/test" });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("/api/test/runs", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Content-Type": "application/json" }),
    }));
  });

  it("throws the server-provided error message on failure", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ error: "Nope" }, 404));
    await expect(requestJson("/runs/1", {}, { fetchImpl })).rejects.toThrow("Nope");
  });

  it("falls back to a status-based message when the body has no error", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response("not json", { status: 500 }));
    await expect(requestJson("/runs", {}, { fetchImpl })).rejects.toThrow(/Execution request failed \(500\)/);
  });

  it("returns undefined for 204 responses", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(requestJson("/runs/1", { method: "DELETE" }, { fetchImpl })).resolves.toBeUndefined();
  });

  it("preserves caller headers", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({}));
    await requestJson("/runs", { headers: { Authorization: "Bearer token" } }, { fetchImpl });
    const headers = fetchImpl.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token");
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

describe("matchesTimeFilter", () => {
  it.each([
    ["today", "today", true],
    ["today", "week", false],
    ["today", "month", false],
    ["week", "today", true],
    ["week", "week", true],
    ["week", "month", false],
    ["month", "month", true],
    ["month", "today", true],
  ] as const)("filter %s includes period %s: %s", (filter, period, expected) => {
    expect(matchesTimeFilter(period, filter)).toBe(expected);
  });

  it("treats undefined period as month-only data", () => {
    expect(matchesTimeFilter(undefined, "month")).toBe(true);
    expect(matchesTimeFilter(undefined, "today")).toBe(false);
  });
});
