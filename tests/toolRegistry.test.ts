import { createAgentRecord, createEmptyDefinition, createNode, createEdge, type WorkflowDefinition } from "@multi-agent/types";
import { workflowService } from "../apps/web/src/services/workflowService";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";

describe("Phase 6 tool registry", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = new Map();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    } } });
  });
  afterEach(() => { Reflect.deleteProperty(globalThis, "window"); });
  const graph = (toolId: string): WorkflowDefinition => {
    const input = createNode("input", { x: 0, y: 0 });
    const output = createNode("output", { x: 300, y: 0 });
    const tool = createNode("tool", { x: 150, y: 0 }, { toolId });
    return { ...createEmptyDefinition(), nodes: [input, tool, output], edges: [
      { ...createEdge({ source: input.id, target: output.id }), id: "unrelated" },
      { ...createEdge({ source: input.id, target: tool.id }), id: "incident" },
    ] };
  };

  test("migrates legacy v2 inline tool nodes into registry entries", async () => {
    const agent = createAgentRecord();
    const legacyTool = createNode("tool", { x: 150, y: 0 });
    // Legacy shape: inline name/description/config alongside toolId, no registry.
    legacyTool.config = { toolId: "legacy-tool-1", name: "Legacy Tool", description: "old inline tool", config: { key: "value" } } as unknown as typeof legacyTool.config;
    const input = createNode("input", { x: 0, y: 0 });
    const output = createNode("output", { x: 300, y: 0 });
    const definition = { ...createEmptyDefinition(), nodes: [input, legacyTool, output], edges: [] };
    storage.set("agent-studio.workspace.v2", JSON.stringify({ version: 2, activeWorkflowId: definition.id, workflows: [definition], agents: [agent] }));

    const tools = await workflowService.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ id: "legacy-tool-1", name: "Legacy Tool", description: "old inline tool", configuration: { key: "value" } });
    const migratedWorkflow = await workflowService.getWorkflow(definition.id);
    expect(migratedWorkflow?.nodes[1].config).toEqual({ toolId: "legacy-tool-1" });
    expect(storage.has("agent-studio.workspace.v2")).toBe(false);
  });

  test("shares one registry entry across multiple workflows", async () => {
    const tool = await workflowService.createTool({ name: "Shared Tool" });
    const first = graph(tool.id);
    const second = graph(tool.id);
    await workflowService.saveWorkflow(first);
    await workflowService.saveWorkflow(second);
    await workflowService.updateTool(tool.id, { name: "Renamed", enabled: false });
    expect(await workflowService.listWorkflows()).toHaveLength(2);
    expect((await workflowService.getWorkflow(first.id))?.nodes[1].config).toEqual({ toolId: tool.id });
    expect((await workflowService.getTool(tool.id))?.enabled).toBe(false);
  });

  test("duplicates configuration deeply, independent of the original", async () => {
    const tool = await workflowService.createTool();
    await workflowService.updateTool(tool.id, { category: "http", configuration: { url: "https://example.test" }, impact: "external" });
    const copy = await workflowService.duplicateTool(tool.id);
    expect(copy.id).not.toBe(tool.id);
    expect(copy.name).toContain("(copy)");
    (copy.configuration as Record<string, unknown>).url = "mutated";
    expect((await workflowService.getTool(tool.id))?.configuration).toEqual({ url: "https://example.test" });
    expect(copy.impact).toBe("external");
  });

  test("deletion guards references from both nodes and agent assignments, cascade preserves unrelated edges", async () => {
    const tool = await workflowService.createTool();
    await workflowService.saveWorkflow(graph(tool.id));
    const agent = await workflowService.createAgent();
    await workflowService.updateAgent(agent.id, { tools: [tool.id] });
    await expect(workflowService.deleteTool(tool.id)).rejects.toThrow(/Remove/);
    await workflowService.deleteTool(tool.id, { removeReferences: true });
    const [workflow] = await workflowService.listWorkflows();
    expect(workflow.nodes).toHaveLength(2);
    expect(workflow.edges.map((edge) => edge.id)).toEqual(["unrelated"]);
    expect((await workflowService.getAgent(agent.id))?.tools).toEqual([]);
    expect(await workflowService.getTool(tool.id)).toBeNull();
  });

  test("rejects credentials before editor state or storage mutation", async () => {
    const tool = await workflowService.createTool();
    await workflowService.saveWorkflow(graph(tool.id));
    await useWorkflowStore.getState().loadWorkflow();
    const before = storage.get("agent-studio.workspace.v3");
    useWorkflowStore.getState().updateToolRecord(tool.id, { metadata: { apiKey: "private-value" } });
    expect(useWorkflowStore.getState().tools[0].metadata).toEqual({});
    expect(useWorkflowStore.getState().saveError).toMatch(/Credentials/);
    await expect(workflowService.updateTool(tool.id, { metadata: { token: "private-value" } })).rejects.toThrow(/Credentials/);
    expect(storage.get("agent-studio.workspace.v3")).toBe(before);
  });
});
