/**
 * Minimal valid starter graphs for create-time archetypes (features 014 / 015).
 */
import {
  createAutonomousSwarmConfig,
  createEdge,
  createEvaluatorOptimizerConfig,
  createHierarchicalSupervisorConfig,
  createNode,
  type ConditionNodeConfig,
  type WorkflowDefinition,
} from "@multi-agent/types";

/**
 * Acyclic Hierarchical Supervisor starter:
 * Input → Supervisor Hub → Condition Router → Worker → Approval → Output
 * Clears empty-canvas MISSING_SUPERVISOR_HUB / MISSING_ROUTING_NODES / MISSING_APPROVAL_GATE.
 */
export function scaffoldHierarchicalSupervisor(definition: WorkflowDefinition): WorkflowDefinition {
  const input = createNode("input", { x: 80, y: 200 });
  const hub = createNode("agent", { x: 280, y: 200 });
  const router = createNode("condition", { x: 500, y: 200 });
  router.config = {
    branches: [
      { key: "route_worker", label: "Route worker" },
      { key: "done", label: "Done" },
    ],
  } satisfies ConditionNodeConfig;
  const worker = createNode("agent", { x: 720, y: 120 });
  const approval = createNode("approval", { x: 940, y: 120 });
  const output = createNode("output", { x: 1160, y: 200 });

  const nodes = [input, hub, router, worker, approval, output];
  const edges = [
    createEdge({ source: input.id, target: hub.id }),
    createEdge({ source: hub.id, target: router.id }),
    createEdge({
      source: router.id,
      target: worker.id,
      kind: "conditional",
      branchKey: "route_worker",
      label: "route_worker",
    }),
    createEdge({ source: worker.id, target: approval.id }),
    createEdge({
      source: approval.id,
      target: output.id,
      kind: "conditional",
      branchKey: "approved",
      label: "approved",
    }),
    createEdge({
      source: router.id,
      target: output.id,
      kind: "conditional",
      branchKey: "done",
      label: "done",
    }),
  ];

  return {
    ...definition,
    archetype: "hierarchical-supervisor",
    archetypeConfig: createHierarchicalSupervisorConfig(hub.id, {
      recursionGuards: [],
      maxExecutionSteps: 1000,
      humanApprovalGateRequired: true,
    }),
    nodes,
    edges,
  };
}

export function scaffoldEvaluatorOptimizer(definition: WorkflowDefinition): WorkflowDefinition {
  const input = createNode("input", { x: 80, y: 200 });
  const generator = createNode("agent", { x: 280, y: 200 });
  const evaluator = createNode("agent", { x: 480, y: 200 });
  const router = createNode("condition", { x: 680, y: 200 });
  router.config = {
    branches: [
      { key: "pass", label: "Pass" },
      { key: "fail", label: "Fail" },
      { key: "exhausted", label: "Exhausted" },
    ],
  } satisfies ConditionNodeConfig;
  const output = createNode("output", { x: 900, y: 200 });

  const nodes = [input, generator, evaluator, router, output];
  const edges = [
    createEdge({ source: input.id, target: generator.id }),
    createEdge({ source: generator.id, target: evaluator.id }),
    createEdge({ source: evaluator.id, target: router.id }),
    createEdge({ source: router.id, target: output.id, kind: "conditional", branchKey: "pass", label: "pass" }),
    createEdge({ source: router.id, target: generator.id, kind: "conditional", branchKey: "fail", label: "fail" }),
    createEdge({ source: router.id, target: output.id, kind: "conditional", branchKey: "exhausted", label: "exhausted" }),
  ];

  return {
    ...definition,
    archetype: "evaluator-optimizer",
    archetypeConfig: createEvaluatorOptimizerConfig({
      generatorNodeIds: [generator.id],
      evaluatorNodeIds: [evaluator.id],
      maxIterations: 3,
      passBranch: "pass",
      failBranch: "fail",
      exhaustionOutcome: "exit_path",
      exhaustionBranch: "exhausted",
    }),
    nodes,
    edges,
  };
}

export function scaffoldAutonomousSwarm(definition: WorkflowDefinition): WorkflowDefinition {
  const input = createNode("input", { x: 80, y: 200 });
  const peerA = createNode("agent", { x: 280, y: 160 });
  const peerB = createNode("agent", { x: 280, y: 280 });
  const router = createNode("condition", { x: 520, y: 200 });
  router.config = {
    branches: [
      { key: "handoff", label: "Handoff" },
      { key: "done", label: "Done" },
    ],
  } satisfies ConditionNodeConfig;
  const output = createNode("output", { x: 760, y: 200 });

  const nodes = [input, peerA, peerB, router, output];
  const edges = [
    createEdge({ source: input.id, target: peerA.id }),
    createEdge({ source: peerA.id, target: router.id }),
    createEdge({ source: router.id, target: peerB.id, kind: "conditional", branchKey: "handoff", label: "handoff" }),
    createEdge({ source: peerB.id, target: router.id }),
    createEdge({ source: router.id, target: output.id, kind: "conditional", branchKey: "done", label: "done" }),
  ];

  return {
    ...definition,
    archetype: "autonomous-swarm",
    archetypeConfig: createAutonomousSwarmConfig({
      maxHops: 10,
      maxDepth: 5,
      maxActivePeerTasks: 4,
      terminationBranch: "done",
    }),
    nodes,
    edges,
  };
}
