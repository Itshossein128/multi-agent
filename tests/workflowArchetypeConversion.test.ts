import {
  createEdge,
  createEmptyDefinition,
  createNode,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { validateWorkflow } from "../apps/web/src/lib/workflow/validation";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { assertArchetypeConsistent } from "../apps/web/src/services/workflowService";

function cyclicSupervisor(): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const hub = createNode("agent", { x: 100, y: 0 });
  const condition = createNode("condition", { x: 200, y: 0 });
  const output = createNode("output", { x: 300, y: 0 });
  return {
    ...createEmptyDefinition("Convert"),
    archetype: "hierarchical-supervisor",
    archetypeConfig: {
      category: "hierarchical-supervisor",
      supervisorHubNodeId: hub.id,
      recursionGuards: [{ routeKey: "loop->yes", maxIterations: 3, fallbackBranch: "no" }],
      maxExecutionSteps: 1000,
      humanApprovalGateRequired: true,
    },
    nodes: [input, hub, condition, output],
    edges: [
      createEdge({ source: input.id, target: hub.id }),
      createEdge({ source: hub.id, target: condition.id }),
      createEdge({ source: condition.id, target: hub.id, kind: "conditional", branchKey: "yes" }),
      createEdge({ source: condition.id, target: output.id, kind: "conditional", branchKey: "no" }),
    ],
  };
}

describe("workflow archetype conversion", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: cyclicSupervisor(),
      loadState: "ready",
      isDirty: false,
    });
  });

  test("keeps supervisor settings dormant when converting to a linear pipeline and restores them", () => {
    const before = useWorkflowStore.getState().definition;
    useWorkflowStore.getState().setWorkflowArchetype("linear-pipeline");
    const linear = useWorkflowStore.getState().definition;
    expect(linear.archetype).toBe("linear-pipeline");
    expect(linear.archetypeConfig?.category).toBe("linear-pipeline");
    expect(linear.archetypeConfig?.supervisorHubNodeId).toBe(before.archetypeConfig?.supervisorHubNodeId);
    expect(linear.archetypeConfig?.recursionGuards).toEqual(before.archetypeConfig?.recursionGuards);
    expect(linear.nodes.map((node) => node.id)).toEqual(before.nodes.map((node) => node.id));
    expect(linear.edges.map((edge) => edge.id)).toEqual(before.edges.map((edge) => edge.id));
    const cycleIssues = validateWorkflow(linear, []).filter((issue) => issue.code === "LINEAR_PIPELINE_CYCLE_FORBIDDEN");
    expect(cycleIssues.length).toBeGreaterThan(0);

    useWorkflowStore.getState().undo();
    const restored = useWorkflowStore.getState().definition;
    expect(restored.archetype).toBe("hierarchical-supervisor");
    expect(restored.archetypeConfig?.supervisorHubNodeId).toBe(before.archetypeConfig?.supervisorHubNodeId);
    expect(restored.archetypeConfig?.humanApprovalGateRequired).toBe(true);
  });

  test("rejects conflicting archetype declarations", () => {
    const definition = cyclicSupervisor();
    definition.archetype = "linear-pipeline";
    expect(() => assertArchetypeConsistent(definition)).toThrow("Workflow archetype must match archetypeConfig.category");
    expect(validateWorkflow(definition, []).some((issue) => issue.code === "INVALID_ARCHETYPE")).toBe(true);
  });

  test("converting a linear pipeline to supervisor preserves nodes and reveals supervisor requirements", () => {
    const input = createNode("input", { x: 0, y: 0 });
    const output = createNode("output", { x: 100, y: 0 });
    useWorkflowStore.setState({
      definition: {
        ...createEmptyDefinition("Line"),
        archetype: "linear-pipeline",
        archetypeConfig: { category: "linear-pipeline", supervisorHubNodeId: "kept-hub", recursionGuards: [] },
        nodes: [input, output],
        edges: [createEdge({ source: input.id, target: output.id })],
      },
    });
    useWorkflowStore.getState().setWorkflowArchetype("hierarchical-supervisor");
    const next = useWorkflowStore.getState().definition;
    expect(next.nodes).toHaveLength(2);
    expect(next.edges).toHaveLength(1);
    expect(next.archetypeConfig?.supervisorHubNodeId).toBe("kept-hub");
    expect(validateWorkflow(next, []).some((issue) => issue.code === "INVALID_SUPERVISOR_HUB" || issue.code === "MISSING_ROUTING_NODES")).toBe(true);
  });
});
