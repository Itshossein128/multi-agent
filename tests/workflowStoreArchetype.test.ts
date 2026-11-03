import { createEmptyDefinition, createNode, type WorkflowDefinition } from "@multi-agent/types";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";

function definition(archetype?: WorkflowDefinition["archetype"]): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const agent = createNode("agent", { x: 120, y: 0 });
  return {
    ...createEmptyDefinition("Store archetype"),
    ...(archetype ? { archetype, archetypeConfig: { category: archetype } } : {}),
    nodes: [input, agent],
    edges: [],
  };
}

describe("workflow store archetype mutations", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: definition("linear-pipeline"),
      agents: [],
      tools: [],
      loadState: "ready",
      isDirty: false,
      issues: [],
      focusedIssueCode: null,
    });
  });

  test("setWorkflowArchetype records history, marks the draft dirty, and preserves the graph", () => {
    const before = useWorkflowStore.getState().definition;
    useWorkflowStore.getState().setWorkflowArchetype("hierarchical-supervisor");
    const next = useWorkflowStore.getState();
    expect(next.definition.archetype).toBe("hierarchical-supervisor");
    expect(next.definition.archetypeConfig?.category).toBe("hierarchical-supervisor");
    expect(next.definition.archetypeConfig?.humanApprovalGateRequired).toBe(true);
    expect(next.definition.nodes.map((node) => node.id)).toEqual(before.nodes.map((node) => node.id));
    expect(next.isDirty).toBe(true);
    expect(next.canUndo).toBe(true);

    next.undo();
    expect(useWorkflowStore.getState().definition.archetype).toBe("linear-pipeline");
    expect(useWorkflowStore.getState().canRedo).toBe(true);
    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().definition.archetype).toBe("hierarchical-supervisor");
  });

  test("supervisor config and recursion guard edits are undoable", () => {
    const store = useWorkflowStore.getState();
    store.setWorkflowArchetype("hierarchical-supervisor");
    const agentId = useWorkflowStore.getState().definition.nodes[1].id;
    useWorkflowStore.getState().updateSupervisorConfig({ supervisorHubNodeId: agentId, maxExecutionSteps: 1000 });
    useWorkflowStore.getState().addRecursionGuard({ routeKey: "feedback_loop", maxIterations: 3, fallbackBranch: "loop_limit_exceeded" });
    expect(useWorkflowStore.getState().definition.archetypeConfig?.recursionGuards).toHaveLength(1);
    useWorkflowStore.getState().updateRecursionGuard(0, { maxIterations: 4, routeKey: "qa->fix" });
    expect(useWorkflowStore.getState().definition.archetypeConfig?.recursionGuards?.[0]).toMatchObject({
      maxIterations: 4,
      routeKey: "qa->fix",
    });
    useWorkflowStore.getState().removeRecursionGuard(0);
    expect(useWorkflowStore.getState().definition.archetypeConfig?.recursionGuards).toEqual([]);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().definition.archetypeConfig?.recursionGuards).toHaveLength(1);
  });

  test("graph edits do not change the archetype", () => {
    useWorkflowStore.getState().addNode("condition", { x: 40, y: 40 });
    expect(useWorkflowStore.getState().definition.archetype).toBe("linear-pipeline");
    expect(useWorkflowStore.getState().definition.nodes.some((node) => node.type === "condition")).toBe(true);
  });
});
