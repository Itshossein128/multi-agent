import {
  createAgentRecord,
  createEdge,
  createNode,
  createEmptyDefinition,
  type AgentRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { NODE_TYPE_META } from "@/lib/workflow/types";
import { NODE_ICONS, sampleGraph, workflowToGraph } from "../apps/web/src/components/dashboard/graph/graphMappers";

const EDGE_COLOR_COUNT = 5;

function agent(name: string, backend: AgentRecord["backend"] = { type: "api", provider: "openai", model: "gpt-4o" }): AgentRecord {
  return createAgentRecord({ name, backend });
}

function workflow(nodes: WorkflowDefinition["nodes"], edges: WorkflowDefinition["edges"]): WorkflowDefinition {
  return { ...createEmptyDefinition("Mapper test"), nodes, edges };
}

describe("workflowToGraph", () => {
  const linked = agent("Writer");
  const input = createNode("input", { x: 0, y: 0 });
  const agentNode = createNode("agent", { x: 100, y: 0 }, { agentId: linked.id });
  const orphanAgent = createNode("agent", { x: 200, y: 0 });

  it("maps every node to the custom agentNode type with preserved id and position", () => {
    const graph = workflowToGraph(workflow([input, agentNode], []), [linked]);
    expect(graph.nodes.map((n) => n.type)).toEqual(["agentNode", "agentNode"]);
    expect(graph.nodes.map((n) => n.id)).toEqual([input.id, agentNode.id]);
    expect(graph.nodes[0].position).toEqual(input.position);
  });

  it("labels agent nodes from the registry and shows the backend label as role", () => {
    const graph = workflowToGraph(workflow([agentNode], []), [linked]);
    const data = graph.nodes[0].data as { label: string; role: string };
    expect(data.label).toBe("Writer");
    expect(data.role).toBe("gpt-4o"); // agentBackendLabel for api backend returns the model
  });

  it("falls back to meta label/description for unlinked agent nodes", () => {
    const graph = workflowToGraph(workflow([orphanAgent], []), [linked]);
    const data = graph.nodes[0].data as { label: string; role: string };
    expect(data.label).toBe(NODE_TYPE_META.agent.label);
    expect(data.role).toBe(NODE_TYPE_META.agent.description);
  });

  it("labels tool nodes by their toolId and gives them meta role", () => {
    const toolNode = createNode("tool", { x: 0, y: 0 }, { toolId: "tool-123" });
    const graph = workflowToGraph(workflow([toolNode], []), []);
    const data = graph.nodes[0].data as { label: string; role: string };
    expect(data.label).toBe("tool-123");
    expect(data.role).toBe(NODE_TYPE_META.tool.description);
  });

  it("assigns the per-type icon and idle status to every node", () => {
    const nodes = [
      createNode("input", { x: 0, y: 0 }),
      createNode("agent", { x: 1, y: 0 }, { agentId: linked.id }),
      createNode("approval", { x: 2, y: 0 }),
      createNode("memory", { x: 3, y: 0 }),
      createNode("condition", { x: 4, y: 0 }),
      createNode("output", { x: 5, y: 0 }),
    ];
    const graph = workflowToGraph(workflow(nodes, []), [linked]);
    graph.nodes.forEach((node, index) => {
      const data = node.data as { icon: unknown; status: string };
      expect(data.status).toBe("idle");
      // workflowToGraph passes the registry element by reference
      expect(data.icon).toBe(NODE_ICONS[nodes[index].type]);
    });
  });

  it("maps normal edges as static with no branch label", () => {
    const a = createNode("input", { x: 0, y: 0 });
    const b = createNode("output", { x: 1, y: 0 });
    const edge = createEdge({ source: a.id, target: b.id });
    const graph = workflowToGraph(workflow([a, b], [edge]), []);
    const mapped = graph.edges[0];
    expect(mapped.id).toBe(edge.id);
    expect(mapped.source).toBe(a.id);
    expect(mapped.target).toBe(b.id);
    expect(mapped.animated).toBe(false);
    expect(mapped.label).toBeUndefined();
    expect((mapped.style as { strokeWidth: number }).strokeWidth).toBe(2);
  });

  it("maps conditional edges as animated with the branch key as label", () => {
    const cond = createNode("condition", { x: 0, y: 0 });
    const out = createNode("output", { x: 1, y: 0 });
    const edge = createEdge({ source: cond.id, target: out.id, kind: "conditional", branchKey: "approved" });
    const graph = workflowToGraph(workflow([cond, out], [edge]), []);
    const mapped = graph.edges[0];
    expect(mapped.animated).toBe(true);
    expect(mapped.label).toBe("approved");
    expect(mapped.labelStyle).toEqual({ fill: "#a1a1aa", fontSize: 10 });
    expect(mapped.labelBgStyle).toEqual({ fill: "#18181b" });
    expect((mapped.style as { strokeWidth: number }).strokeWidth).toBe(1.5);
  });

  it("cycles edge colors deterministically across the palette", () => {
    const a = createNode("input", { x: 0, y: 0 });
    const b = createNode("output", { x: 1, y: 0 });
    const edges = Array.from({ length: EDGE_COLOR_COUNT + 2 }, (_, i) =>
      createEdge({ source: a.id, target: b.id })
    );
    const graph = workflowToGraph(workflow([a, b], edges), []);
    const strokes = graph.edges.map((e) => (e.style as { stroke: string }).stroke);
    // Deterministic palette cycling: index 0 and index 5 share a color
    expect(strokes[0]).toBe(strokes[EDGE_COLOR_COUNT]);
    expect(new Set(strokes.slice(0, EDGE_COLOR_COUNT)).size).toBe(EDGE_COLOR_COUNT);
  });
});

describe("sampleGraph", () => {
  it("returns the five-node sample topology", () => {
    const graph = sampleGraph();
    expect(graph.nodes).toHaveLength(5);
    expect(graph.nodes.map((n) => n.id)).toEqual(["input", "orchestrator", "docGen", "developer", "end"]);
    expect(graph.nodes.every((n) => n.type === "agentNode")).toBe(true);
  });

  it("marks orchestrator active and developer processing, others idle", () => {
    const graph = sampleGraph();
    const statusById = new Map(graph.nodes.map((n) => [n.id, (n.data as { status: string }).status]));
    expect(statusById.get("orchestrator")).toBe("active");
    expect(statusById.get("developer")).toBe("processing");
    expect(statusById.get("input")).toBe("idle");
    expect(statusById.get("docGen")).toBe("idle");
    expect(statusById.get("end")).toBe("idle");
  });

  it("only references existing node ids and labels the dev handoff edge", () => {
    const graph = sampleGraph();
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
    const devEdge = graph.edges.find((e) => e.id === "e-orch-dev");
    expect(devEdge?.label).toBe("ready_for_dev");
    expect(devEdge?.animated).toBe(true);
  });
});
