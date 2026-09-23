import { createAgentRecord, createEmptyDefinition } from "@multi-agent/types";
import { createWorkflowService } from "../apps/web/src/services/workflowService";
import { ApiRequestError } from "../apps/web/src/services/requestJson";
import { createTestStudioService, memoryStorage } from "./fixtures/studioService";

/**
 * A failed Studio read must never look like a missing resource.
 * Only a genuine HTTP 404 resolves to null; 401, 500, and transport failures
 * must reject so the detail page can render a retry path.
 */
const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const statusService = (status: number) =>
  createWorkflowService({
    fetch: jest.fn().mockResolvedValue(jsonResponse({ error: `Injected failure (${status})` }, status)),
    storage: memoryStorage(),
    apiUrl: "http://studio.test",
  });

async function expectApiStatus(promise: Promise<unknown>, status: number) {
  const error = await promise.then(
    () => undefined,
    (cause) => cause
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  expect((error as ApiRequestError).status).toBe(status);
}

describe("workflowService failed reads are distinct from missing resources", () => {
  test("a genuine 404 resolves to null for agents, workflows, and tools", async () => {
    const { service } = createTestStudioService();
    expect(await service.getAgent("agent-missing")).toBeNull();
    expect(await service.getWorkflow("wf-missing")).toBeNull();
    expect(await service.getTool("tool-missing")).toBeNull();
  });

  test("getAgent propagates authentication failures instead of returning null", async () => {
    await expectApiStatus(statusService(401).getAgent("agent-1"), 401);
  });

  test("getAgent propagates server failures instead of returning null", async () => {
    await expectApiStatus(statusService(500).getAgent("agent-1"), 500);
  });

  test("getAgent propagates transport failures instead of returning null", async () => {
    const service = createWorkflowService({
      fetch: jest.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED")),
      storage: memoryStorage(),
      apiUrl: "http://studio.test",
    });
    await expect(service.getAgent("agent-1")).rejects.toThrow(/ECONNREFUSED/);
  });

  test("getWorkflow propagates 401, 500, and transport failures instead of returning null", async () => {
    await expectApiStatus(statusService(401).getWorkflow("wf-1"), 401);
    await expectApiStatus(statusService(500).getWorkflow("wf-1"), 500);
    const offline = createWorkflowService({
      fetch: jest.fn().mockRejectedValue(new Error("fetch failed: network unreachable")),
      storage: memoryStorage(),
      apiUrl: "http://studio.test",
    });
    await expect(offline.getWorkflow("wf-1")).rejects.toThrow(/network unreachable/);
  });

  test("getTool propagates non-404 failures instead of returning null", async () => {
    await expectApiStatus(statusService(401).getTool("tool-1"), 401);
  });

  test("import failure keeps legacy keys so the browser data stays recoverable", async () => {
    const storage = memoryStorage();
    const agent = createAgentRecord({ name: "Recoverable" });
    storage.setItem("agent-studio.agents.v1", JSON.stringify([agent]));
    storage.setItem("agent-studio.workflow.v1", JSON.stringify(createEmptyDefinition("Recoverable workflow")));
    const service = statusService(500);
    await expectApiStatus(service.listAgents(), 500);
    expect(storage.getItem("agent-studio.agents.v1")).toBe(JSON.stringify([agent]));
    expect(storage.getItem("agent-studio.workspace-imported.v1")).toBeNull();
  });
});
