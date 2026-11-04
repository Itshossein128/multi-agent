import { createEmptyDefinition, createNode, type ConditionNodeConfig } from "@multi-agent/types";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import {
  edgeSemanticsFromSourceHandle,
  projectApprovalSourceHandle,
} from "../apps/web/src/lib/workflow/canvasRoutingHandles";

describe("canvas routing handle → edge semantics", () => {
  beforeEach(() => {
    const approval = createNode("approval", { x: 0, y: 0 });
    const condition = createNode("condition", { x: 120, y: 0 });
    condition.config = {
      branches: [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
        { key: "c", label: "C" },
      ],
    } satisfies ConditionNodeConfig;
    const agent = createNode("agent", { x: 240, y: 0 });
    const out = createNode("output", { x: 360, y: 0 });
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: {
        ...createEmptyDefinition("Routing"),
        nodes: [approval, condition, agent, out],
        edges: [],
      },
      agents: [],
      tools: [],
      loadState: "ready",
      isDirty: false,
      issues: [],
      focusedIssueCode: null,
    });
  });

  test("edgeSemanticsFromSourceHandle matches contract table", () => {
    expect(edgeSemanticsFromSourceHandle({ sourceNodeType: "approval", sourceHandle: "approved" })).toEqual({
      kind: "conditional",
      branchKey: "approved",
    });
    expect(edgeSemanticsFromSourceHandle({ sourceNodeType: "approval", sourceHandle: "rejected" })).toEqual({
      kind: "conditional",
      branchKey: "rejected",
    });
    expect(
      edgeSemanticsFromSourceHandle({ sourceNodeType: "approval", sourceHandle: "needs_clarification" }),
    ).toEqual({ kind: "conditional", branchKey: "needs_clarification" });
    expect(edgeSemanticsFromSourceHandle({ sourceNodeType: "approval", sourceHandle: "out" })).toEqual({
      kind: "normal",
      branchKey: "",
    });
    expect(edgeSemanticsFromSourceHandle({ sourceNodeType: "condition", sourceHandle: "a" })).toEqual({
      kind: "conditional",
      branchKey: "a",
    });
    expect(edgeSemanticsFromSourceHandle({ sourceNodeType: "agent", sourceHandle: "out" })).toEqual({
      kind: "normal",
      branchKey: "",
    });
  });

  test("addEdge from approval outcome handles creates conditional edges", () => {
    const { definition } = useWorkflowStore.getState();
    const approval = definition.nodes.find((n) => n.type === "approval")!;
    const agent = definition.nodes.find((n) => n.type === "agent")!;
    const output = definition.nodes.find((n) => n.type === "output")!;

    useWorkflowStore.getState().addEdge({
      source: approval.id,
      target: agent.id,
      sourceHandle: "approved",
    });
    useWorkflowStore.getState().addEdge({
      source: approval.id,
      target: output.id,
      sourceHandle: "rejected",
    });
    useWorkflowStore.getState().addEdge({
      source: approval.id,
      target: output.id,
      sourceHandle: "needs_clarification",
    });

    const edges = useWorkflowStore.getState().definition.edges;
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: approval.id,
          target: agent.id,
          kind: "conditional",
          branchKey: "approved",
        }),
        expect.objectContaining({
          source: approval.id,
          target: output.id,
          kind: "conditional",
          branchKey: "rejected",
        }),
        expect.objectContaining({
          source: approval.id,
          target: output.id,
          kind: "conditional",
          branchKey: "needs_clarification",
        }),
      ]),
    );
  });

  test("addEdge from non-outcome approval handle stays normal", () => {
    const { definition } = useWorkflowStore.getState();
    const approval = definition.nodes.find((n) => n.type === "approval")!;
    const agent = definition.nodes.find((n) => n.type === "agent")!;
    useWorkflowStore.getState().addEdge({
      source: approval.id,
      target: agent.id,
      sourceHandle: "out",
    });
    const edge = useWorkflowStore.getState().definition.edges[0];
    expect(edge).toMatchObject({ kind: "normal", branchKey: "" });
  });

  test("duplicate approval outcome edges are rejected", () => {
    const { definition } = useWorkflowStore.getState();
    const approval = definition.nodes.find((n) => n.type === "approval")!;
    const agent = definition.nodes.find((n) => n.type === "agent")!;
    useWorkflowStore.getState().addEdge({
      source: approval.id,
      target: agent.id,
      sourceHandle: "approved",
    });
    useWorkflowStore.getState().addEdge({
      source: approval.id,
      target: agent.id,
      sourceHandle: "approved",
    });
    expect(useWorkflowStore.getState().definition.edges).toHaveLength(1);
  });

  test("condition sourceHandle still binds branchKey for three branches", () => {
    const { definition } = useWorkflowStore.getState();
    const condition = definition.nodes.find((n) => n.type === "condition")!;
    const agent = definition.nodes.find((n) => n.type === "agent")!;
    const output = definition.nodes.find((n) => n.type === "output")!;
    useWorkflowStore.getState().addEdge({ source: condition.id, target: agent.id, sourceHandle: "a" });
    useWorkflowStore.getState().addEdge({ source: condition.id, target: output.id, sourceHandle: "b" });
    useWorkflowStore.getState().addEdge({ source: condition.id, target: output.id, sourceHandle: "c" });
    const keys = useWorkflowStore.getState().definition.edges.map((e) => e.branchKey).sort();
    expect(keys).toEqual(["a", "b", "c"]);
    expect(useWorkflowStore.getState().definition.edges.every((e) => e.kind === "conditional")).toBe(true);
  });

  test("projectApprovalSourceHandle docks known keys and leaves unknowns undefined without inventing", () => {
    expect(projectApprovalSourceHandle("approved")).toBe("approved");
    expect(projectApprovalSourceHandle("rejected")).toBe("rejected");
    expect(projectApprovalSourceHandle("needs_clarification")).toBe("needs_clarification");
    expect(projectApprovalSourceHandle("")).toBeUndefined();
    expect(projectApprovalSourceHandle("custom")).toBeUndefined();
    expect(projectApprovalSourceHandle(undefined)).toBeUndefined();
  });

  test("legacy approval conditional edges retain branchKey when new edges are added", () => {
    const { definition } = useWorkflowStore.getState();
    const approval = definition.nodes.find((n) => n.type === "approval")!;
    const agent = definition.nodes.find((n) => n.type === "agent")!;
    const output = definition.nodes.find((n) => n.type === "output")!;
    // Simulate legacy edge already present (as if created via panel)
    useWorkflowStore.setState({
      definition: {
        ...definition,
        edges: [
          {
            id: "legacy-approved",
            source: approval.id,
            target: agent.id,
            kind: "conditional",
            branchKey: "approved",
            label: "approved",
            metadata: {},
          },
        ],
      },
    });
    const before = JSON.parse(JSON.stringify(useWorkflowStore.getState().definition.edges));
    useWorkflowStore.getState().addEdge({
      source: approval.id,
      target: output.id,
      sourceHandle: "rejected",
    });
    const after = useWorkflowStore.getState().definition.edges;
    expect(after.find((e) => e.id === "legacy-approved")).toEqual(before[0]);
    expect(after.some((e) => e.branchKey === "rejected" && e.kind === "conditional")).toBe(true);
  });
});
