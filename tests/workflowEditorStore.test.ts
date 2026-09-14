import { createAgentRecord, createEmptyDefinition, createNode } from "@multi-agent/types";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";

describe("workflow editor store graph invariants", () => {
  const agent = { ...createAgentRecord({ name: "Editor Agent" }), id: "editor-agent" };

  beforeEach(() => {
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: createEmptyDefinition("Editor test"),
      agents: [agent],
      tools: [],
      loadState: "ready",
      issues: [],
    });
  });

  test("allows a back-edge while rejecting self and duplicate edges", () => {
    const input = createNode("input", { x: 0, y: 0 });
    const worker = createNode("agent", { x: 100, y: 0 }, { agentId: agent.id });
    useWorkflowStore.setState((state) => ({
      definition: { ...state.definition, nodes: [input, worker] },
    }));

    const store = useWorkflowStore.getState();
    store.addEdge({ source: input.id, target: worker.id });
    store.addEdge({ source: input.id, target: worker.id });
    store.addEdge({ source: worker.id, target: input.id });
    store.addEdge({ source: worker.id, target: worker.id });

    expect(useWorkflowStore.getState().definition.edges).toHaveLength(2);
    expect(useWorkflowStore.getState().definition.edges.map((edge) => [edge.source, edge.target])).toEqual([
      [input.id, worker.id],
      [worker.id, input.id],
    ]);
  });

  test("keeps edge endpoints immutable through property updates", () => {
    const input = createNode("input", { x: 0, y: 0 });
    const output = createNode("output", { x: 100, y: 0 });
    useWorkflowStore.setState((state) => ({
      definition: { ...state.definition, nodes: [input, output] },
    }));
    const store = useWorkflowStore.getState();
    store.addEdge({ source: input.id, target: output.id });
    const edge = useWorkflowStore.getState().definition.edges[0];

    store.updateEdge(edge.id, { label: "done" });
    expect(useWorkflowStore.getState().definition.edges[0]).toMatchObject({
      source: input.id,
      target: output.id,
      label: "done",
    });
  });

  test("deletes selected nodes and edges as one undoable operation", () => {
    const input = createNode("input", { x: 0, y: 0 });
    const output = createNode("output", { x: 100, y: 0 });
    useWorkflowStore.setState((state) => ({
      definition: { ...state.definition, nodes: [input, output] },
    }));
    const store = useWorkflowStore.getState();
    store.addEdge({ source: input.id, target: output.id });
    const edgeId = useWorkflowStore.getState().definition.edges[0].id;
    store.removeSelection([input.id], [edgeId]);

    expect(useWorkflowStore.getState().definition.nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().definition.edges).toHaveLength(0);
    store.undo();
    expect(useWorkflowStore.getState().definition.nodes.map((node) => node.id)).toEqual([input.id, output.id]);
    expect(useWorkflowStore.getState().definition.edges).toHaveLength(1);
  });
});
