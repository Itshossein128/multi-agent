import { createEmptyDefinition, createEdge, createNode } from "@multi-agent/types";
import { computeAutoArrangePositions } from "../apps/web/src/components/workflow/layout/autoArrange";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";

describe("auto-arrange layout", () => {
  test("computeAutoArrangePositions returns a position for every node without touching edges", () => {
    const a = createNode("input", { x: 500, y: 500 });
    const b = createNode("agent", { x: 10, y: 10 });
    const c = createNode("output", { x: 900, y: 40 });
    const edges = [
      createEdge({ source: a.id, target: b.id }),
      createEdge({ source: b.id, target: c.id }),
    ];
    const positions = computeAutoArrangePositions(
      [a, b, c].map((n) => ({ id: n.id, position: n.position })),
      edges.map((e) => ({ source: e.source, target: e.target })),
    );
    expect(positions.size).toBe(3);
    expect(positions.get(a.id)).toBeDefined();
    expect(positions.get(b.id)).toBeDefined();
    expect(positions.get(c.id)).toBeDefined();
    // Hierarchical: input rank above/before agent before output (smaller y)
    expect(positions.get(a.id)!.y).toBeLessThan(positions.get(b.id)!.y);
    expect(positions.get(b.id)!.y).toBeLessThan(positions.get(c.id)!.y);
  });

  test("autoArrangeNodes is layout-only and Undo restores prior positions", () => {
    const input = createNode("input", { x: 800, y: 800 });
    const agent = createNode("agent", { x: 0, y: 0 });
    const output = createNode("output", { x: 50, y: 900 });
    const edges = [
      createEdge({ source: input.id, target: agent.id, kind: "conditional", branchKey: "approved" }),
      createEdge({ source: agent.id, target: output.id }),
    ];
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: {
        ...createEmptyDefinition("Arrange"),
        nodes: [input, agent, output],
        edges,
      },
      agents: [],
      tools: [],
      loadState: "ready",
      isDirty: false,
      issues: [],
      focusedIssueCode: null,
      flowHelpers: null,
    });

    const beforeEdges = JSON.parse(JSON.stringify(useWorkflowStore.getState().definition.edges));
    const beforePositions = Object.fromEntries(
      useWorkflowStore.getState().definition.nodes.map((n) => [n.id, { ...n.position }]),
    );

    useWorkflowStore.getState().autoArrangeNodes();
    const mid = useWorkflowStore.getState();
    expect(JSON.stringify(mid.definition.edges)).toBe(JSON.stringify(beforeEdges));
    expect(mid.definition.edges[0]).toMatchObject({ kind: "conditional", branchKey: "approved" });
    const moved = mid.definition.nodes.some(
      (n) => n.position.x !== beforePositions[n.id].x || n.position.y !== beforePositions[n.id].y,
    );
    expect(moved).toBe(true);
    expect(mid.canUndo).toBe(true);

    mid.undo();
    const restored = useWorkflowStore.getState().definition.nodes;
    for (const node of restored) {
      expect(node.position).toEqual(beforePositions[node.id]);
    }
    expect(useWorkflowStore.getState().definition.edges).toEqual(beforeEdges);
  });
});
