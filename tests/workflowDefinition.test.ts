import {
  createEdge,
  createEmptyDefinition,
  createNode,
  deserializeWorkflowDefinition,
  serializeWorkflowDefinition,
} from "@multi-agent/types";

describe("workflow definition boundary", () => {
  test("serializes domain data without React Flow-only fields", () => {
    const input = createNode("input", { x: 10, y: 20 });
    const output = createNode("output", { x: 200, y: 20 });
    const definition = {
      ...createEmptyDefinition("Serializable"),
      nodes: [input, output],
      edges: [{
        ...createEdge({ source: input.id, target: output.id, metadata: { lane: "main" } }),
        sourceHandle: "out",
        data: { reactFlowOnly: true },
      }],
    } as unknown as ReturnType<typeof createEmptyDefinition>;

    const serialized = serializeWorkflowDefinition(definition);
    expect(serialized.nodes[0]).not.toHaveProperty("data");
    expect(serialized.edges[0]).not.toHaveProperty("sourceHandle");
    expect(serialized.edges[0].metadata).toEqual({ lane: "main" });
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
  });

  test("loads legacy edge type and applies safe defaults", () => {
    const input = createNode("input", { x: 0, y: 0 });
    const output = createNode("output", { x: 100, y: 0 });
    const loaded = deserializeWorkflowDefinition({
      ...createEmptyDefinition("Legacy"),
      nodes: [
        { ...input, position: { x: "bad", y: null }, data: { ignored: true } },
        output,
      ],
      edges: [{ id: "legacy-edge", source: input.id, target: output.id, type: "normal" }],
    });

    expect(loaded.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(loaded.edges[0]).toMatchObject({ id: "legacy-edge", kind: "normal", label: "", branchKey: "" });
    expect(loaded.edges[0]).not.toHaveProperty("type");
  });
});
