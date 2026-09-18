import { createAgentRecord, createEmptyDefinition, createNode, createEdge, type WorkflowDefinition } from "@multi-agent/types";
import { type createWorkflowService } from "../apps/web/src/services/workflowService";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { createTestStudioService, memoryStorage } from "./fixtures/studioService";

describe("Phase 5 browser workspace", () => {
  let storage: ReturnType<typeof memoryStorage>;
  let workflowService: ReturnType<typeof createWorkflowService>;
  beforeEach(() => {
    ({ storage, service: workflowService } = createTestStudioService());
    useWorkflowStore.setState({ agents: [], tools: [], saveError: null });
  });
  const graph = (agentId: string): WorkflowDefinition => {
    const input = createNode("input", { x: 0, y: 0 });
    const output = createNode("output", { x: 300, y: 0 });
    const agent = createNode("agent", { x: 150, y: 0 }, { agentId });
    return { ...createEmptyDefinition(), nodes: [input, agent, output], edges: [
      { ...createEdge({ source: input.id, target: output.id }), id: "unrelated" },
      { ...createEdge({ source: input.id, target: agent.id }), id: "incident" },
    ] };
  };
  test("migrates legacy storage and retains one shared identity across multiple workflows", async () => {
    const agent = createAgentRecord();
    const first = graph(agent.id);
    storage.setItem("agent-studio.workflow.v1", JSON.stringify(first));
    storage.setItem("agent-studio.agents.v1", JSON.stringify([agent]));
    expect((await workflowService.getWorkflow())?.id).toBe(first.id);
    const second = graph(agent.id);
    await workflowService.saveWorkflow(second);
    await workflowService.updateAgent(agent.id, { name: "Shared", enabled: false });
    expect(await workflowService.listWorkflows()).toHaveLength(2);
    expect((await workflowService.getWorkflow(first.id))?.nodes[1].config).toMatchObject({ agentId: agent.id });
    expect((await workflowService.getAgent(agent.id))?.enabled).toBe(false);
    expect(storage.has("agent-studio.workflow.v1")).toBe(false);
  });
  test("duplicates configuration deeply, preserving model limits and permissions", async () => {
    const agent = await workflowService.createAgent();
    await workflowService.updateAgent(agent.id, { backend: { ...agent.backend, type: "api", model: "gpt-4o", settings: { maxTokens: 512, temperature: 0.3 } }, executionPolicy: { shell: "disabled" }, tools: ["tool-a"] });
    const copy = await workflowService.duplicateAgent(agent.id);
    expect(copy.id).not.toBe(agent.id);
    expect(copy.name).toContain("(copy)");
    copy.tools.push("tool-b");
    expect((await workflowService.getAgent(agent.id))?.tools).toEqual(["tool-a"]);
    expect((await workflowService.getAgent(copy.id))?.backend).toMatchObject({ settings: { maxTokens: 512 } });
    expect(copy.executionPolicy).toEqual({ shell: "disabled" });
  });
  test("deletion guards references and cascade preserves unrelated edges in every workflow", async () => {
    const agent = await workflowService.createAgent();
    await workflowService.saveWorkflow(graph(agent.id));
    await workflowService.saveWorkflow(graph(agent.id));
    await expect(workflowService.deleteAgent(agent.id)).rejects.toThrow(/Remove/);
    await workflowService.deleteAgent(agent.id, { removeReferences: true });
    for (const workflow of await workflowService.listWorkflows()) {
      expect(workflow.nodes).toHaveLength(2);
      expect(workflow.edges.map((edge) => edge.id)).toEqual(["unrelated"]);
    }
    expect(await workflowService.getAgent(agent.id)).toBeNull();
  });
  test("rejects credentials before editor state or storage mutation", async () => {
    const agent = await workflowService.createAgent();
    await workflowService.saveWorkflow(graph(agent.id));
    useWorkflowStore.setState({ agents: [agent], tools: [], saveError: null });
    const before = storage.get("agent-studio.workspace.v3");
    useWorkflowStore.getState().updateAgentRecord(agent.id, { metadata: { apiKey: "private-value" } });
    expect(useWorkflowStore.getState().agents[0].metadata).toEqual({});
    expect(useWorkflowStore.getState().saveError).toMatch(/Credentials/);
    await expect(workflowService.updateAgent(agent.id, { metadata: { token: "private-value" } })).rejects.toThrow(/Credentials/);
    expect(storage.get("agent-studio.workspace.v3")).toBe(before);
    const unsafe = { ...graph(agent.id), metadata: { apiKey: "private-value" } };
    await expect(workflowService.saveWorkflow(unsafe)).rejects.toThrow(/Credentials/);
  });
  test("failed atomic deletion leaves registry and workflows intact", async () => {
    class FailingStore extends InMemoryStudioStore {
      failWorkflowWrites = false;
      override async saveWorkflow(definition: WorkflowDefinition) {
        if (this.failWorkflowWrites) throw new Error("simulated workflow write failure");
        return super.saveWorkflow(definition);
      }
    }
    const store = new FailingStore();
    ({ storage, service: workflowService } = createTestStudioService(memoryStorage(), store));
    const agent = await workflowService.createAgent();
    const first = graph(agent.id);
    const second = graph(agent.id);
    await workflowService.saveWorkflow(first);
    await workflowService.saveWorkflow(second);
    const [firstBefore, secondBefore] = await Promise.all([workflowService.getWorkflow(first.id), workflowService.getWorkflow(second.id)]);
    store.failWorkflowWrites = true;

    await expect(workflowService.deleteAgent(agent.id, { removeReferences: true })).rejects.toThrow(/simulated workflow write failure/);
    expect(await workflowService.getAgent(agent.id)).not.toBeNull();
    expect(await workflowService.getWorkflow(first.id)).toEqual(firstBefore);
    expect(await workflowService.getWorkflow(second.id)).toEqual(secondBefore);
  });
});
