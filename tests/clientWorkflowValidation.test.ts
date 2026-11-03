import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createHierarchicalSupervisorConfig,
  createLinearPipelineConfig,
  createNode,
  createRecursionGuard,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { validateWorkflow } from "../apps/web/src/lib/workflow/validation";

const worker = { ...createAgentRecord({ name: "Worker", model: "gpt-4o" }), id: "agent-worker" };
const lead = { ...createAgentRecord({ name: "Lead", model: "gpt-4o" }), id: "agent-lead" };

function linear(explicit = true): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const agent = createNode("agent", { x: 200, y: 0 }, { agentId: worker.id });
  const output = createNode("output", { x: 400, y: 0 });
  return {
    ...createEmptyDefinition("Linear"),
    ...(explicit ? { archetype: "linear-pipeline" as const, archetypeConfig: createLinearPipelineConfig() } : {}),
    nodes: [input, agent, output],
    edges: [
      createEdge({ source: input.id, target: agent.id }),
      createEdge({ source: agent.id, target: output.id }),
    ],
  };
}

function withCycle(definition: WorkflowDefinition): WorkflowDefinition {
  const [input, agent, output] = definition.nodes;
  const second = createNode("agent", { x: 300, y: 80 }, { agentId: worker.id });
  return {
    ...definition,
    nodes: [input, agent, second, output],
    edges: [
      createEdge({ source: input.id, target: agent.id }),
      createEdge({ source: agent.id, target: second.id }),
      createEdge({ source: second.id, target: agent.id }),
      createEdge({ source: second.id, target: output.id }),
    ],
  };
}

function supervisor(patch?: Partial<NonNullable<WorkflowDefinition["archetypeConfig"]>>): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const hub = createNode("agent", { x: 180, y: 0 }, { agentId: lead.id });
  hub.id = "hub-agent";
  const condition = createNode("condition", { x: 360, y: 0 });
  condition.config = {
    branches: [
      { key: "implement_spec", label: "Implement" },
      { key: "loop_limit_exceeded", label: "Exit" },
    ],
  };
  const workerNode = createNode("agent", { x: 540, y: 0 }, { agentId: worker.id });
  const approval = createNode("approval", { x: 540, y: 120 });
  const output = createNode("output", { x: 720, y: 0 });
  return {
    ...createEmptyDefinition("Supervisor"),
    archetype: "hierarchical-supervisor",
    archetypeConfig: createHierarchicalSupervisorConfig("hub-agent", {
      humanApprovalGateRequired: true,
      recursionGuards: [createRecursionGuard("qa_verify->implement_spec", "loop_limit_exceeded", 3)],
      ...patch,
    }),
    nodes: [input, hub, condition, workerNode, approval, output],
    edges: [
      createEdge({ source: input.id, target: hub.id }),
      createEdge({ source: hub.id, target: condition.id }),
      createEdge({ source: condition.id, target: approval.id, kind: "conditional", branchKey: "implement_spec" }),
      createEdge({ source: approval.id, target: workerNode.id }),
      createEdge({ source: workerNode.id, target: hub.id }),
      createEdge({ source: condition.id, target: output.id, kind: "conditional", branchKey: "loop_limit_exceeded" }),
    ],
  };
}

function codes(definition: WorkflowDefinition) {
  return validateWorkflow(definition, [worker, lead]).map((issue) => issue.code);
}

describe("client archetype validation parity", () => {
  test("rejects an unknown archetype and a category mismatch", () => {
    const unknown = linear();
    (unknown as { archetype: string }).archetype = "mesh";
    expect(codes(unknown)).toContain("INVALID_ARCHETYPE");

    const mismatch = supervisor();
    mismatch.archetype = "linear-pipeline";
    const mismatchCodes = codes(mismatch);
    expect(mismatchCodes).toContain("INVALID_ARCHETYPE");
    expect(validateWorkflow(mismatch, [worker, lead]).some((issue) => issue.message === "Workflow archetype must match archetypeConfig.category.")).toBe(true);
  });

  test("flags every node in an explicit linear cycle and skips untyped legacy graphs", () => {
    const cyclic = withCycle(linear(true));
    const issues = validateWorkflow(cyclic, [worker, lead]).filter((issue) => issue.code === "LINEAR_PIPELINE_CYCLE_FORBIDDEN");
    expect(issues.length).toBeGreaterThan(0);
    expect(new Set(issues.map((issue) => issue.nodeId))).toEqual(new Set([cyclic.nodes[1].id, cyclic.nodes[2].id]));

    const legacy = withCycle(linear(false));
    expect(codes(legacy)).not.toContain("LINEAR_PIPELINE_CYCLE_FORBIDDEN");
  });

  test("requires a real agent hub and a condition node for supervisor graphs", () => {
    const missingHub = supervisor({ supervisorHubNodeId: undefined, humanApprovalGateRequired: false, recursionGuards: [] });
    delete missingHub.archetypeConfig?.supervisorHubNodeId;
    expect(codes(missingHub)).toContain("MISSING_SUPERVISOR_HUB");

    const invalidHub = supervisor({ supervisorHubNodeId: "missing-node" });
    expect(codes(invalidHub)).toContain("INVALID_SUPERVISOR_HUB");

    const nonAgent = supervisor();
    nonAgent.archetypeConfig = { ...nonAgent.archetypeConfig!, supervisorHubNodeId: nonAgent.nodes[0].id };
    expect(codes(nonAgent)).toContain("INVALID_SUPERVISOR_HUB");

    const noRouting = supervisor({ humanApprovalGateRequired: false, recursionGuards: [] });
    noRouting.nodes = noRouting.nodes.filter((node) => node.type !== "condition");
    expect(codes(noRouting)).toContain("MISSING_ROUTING_NODES");
  });

  test("requires a matching recursion guard and a wired fallback", () => {
    const unguarded = supervisor({ recursionGuards: [], humanApprovalGateRequired: false });
    expect(codes(unguarded)).toContain("UNGUARDED_CYCLE");

    const irrelevant = supervisor({
      humanApprovalGateRequired: false,
      recursionGuards: [createRecursionGuard("other->branch", "loop_limit_exceeded", 3)],
    });
    expect(codes(irrelevant)).toContain("UNGUARDED_CYCLE");

    const invalidGuard = supervisor({
      humanApprovalGateRequired: false,
      recursionGuards: [{ routeKey: "  ", maxIterations: 0, fallbackBranch: "" }],
    });
    expect(codes(invalidGuard)).toContain("INVALID_RECURSION_GUARD");

    const unwired = supervisor({
      humanApprovalGateRequired: false,
      recursionGuards: [createRecursionGuard("qa_verify->implement_spec", "missing_fallback", 3)],
    });
    expect(codes(unwired)).toContain("FALLBACK_NOT_WIRED");
  });

  test("requires an approval gate and rejects an implement_spec bypass", () => {
    const missingApproval = supervisor();
    missingApproval.nodes = missingApproval.nodes.filter((node) => node.type !== "approval");
    missingApproval.edges = missingApproval.edges.map((edge) =>
      edge.branchKey === "implement_spec" ? { ...edge, target: missingApproval.nodes.find((node) => node.type === "agent" && node.id !== "hub-agent")!.id } : edge,
    );
    const missingCodes = codes(missingApproval);
    expect(missingCodes).toContain("MISSING_APPROVAL_GATE");
    expect(missingCodes).toContain("APPROVAL_GATE_BYPASS");
  });

  test("accepts a guarded supervisor whose fallback reaches an output", () => {
    const issues = validateWorkflow(supervisor(), [worker, lead]).filter((issue) => issue.severity === "error" && issue.code);
    const archetypeErrors = issues.filter((issue) =>
      [
        "INVALID_ARCHETYPE",
        "LINEAR_PIPELINE_CYCLE_FORBIDDEN",
        "MISSING_SUPERVISOR_HUB",
        "INVALID_SUPERVISOR_HUB",
        "MISSING_ROUTING_NODES",
        "UNGUARDED_CYCLE",
        "INVALID_RECURSION_GUARD",
        "FALLBACK_NOT_WIRED",
        "MISSING_APPROVAL_GATE",
        "APPROVAL_GATE_BYPASS",
      ].includes(issue.code ?? ""),
    );
    expect(archetypeErrors).toEqual([]);
  });
});
