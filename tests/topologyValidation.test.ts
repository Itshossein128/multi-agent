import {
  createAutonomousSwarmConfig,
  createEdge,
  createEmptyDefinition,
  createEvaluatorOptimizerConfig,
  createHierarchicalSupervisorConfig,
  createLinearPipelineConfig,
  createNode,
  DEFAULT_MAX_CONCURRENT_BRANCHES,
} from "@multi-agent/types";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { scaffoldAutonomousSwarm, scaffoldEvaluatorOptimizer } from "../apps/server/src/api/studio/topologyScaffolds";
import { validateWorkflow as validateWebWorkflow } from "../apps/web/src/lib/workflow/validation";

function codes(issues: Array<{ code: string }>): string[] {
  return issues.map((issue) => issue.code);
}

describe("topology validation (014)", () => {
  test("evaluator-optimizer scaffold has no blocking EO structural errors", () => {
    const def = scaffoldEvaluatorOptimizer(createEmptyDefinition("EO"));
    const issues = validateWorkflow(def, []);
    expect(codes(issues).some((code) => code.startsWith("EVALUATOR_OPTIMIZER_"))).toBe(false);
  });

  test("evaluator-optimizer missing config", () => {
    const def = {
      ...createEmptyDefinition("EO"),
      archetype: "evaluator-optimizer" as const,
      archetypeConfig: { category: "evaluator-optimizer" as const },
    };
    expect(codes(validateWorkflow(def, []))).toContain("EVALUATOR_OPTIMIZER_CONFIG_REQUIRED");
  });

  test("evaluator-optimizer ceiling out of range", () => {
    const base = scaffoldEvaluatorOptimizer(createEmptyDefinition("EO"));
    const def = {
      ...base,
      archetypeConfig: createEvaluatorOptimizerConfig({
        ...base.archetypeConfig!.evaluatorOptimizer!,
        maxIterations: 11,
      }),
    };
    // factory clamps — force invalid after clamp bypass
    def.archetypeConfig!.evaluatorOptimizer!.maxIterations = 11;
    expect(codes(validateWorkflow(def, []))).toContain("EVALUATOR_OPTIMIZER_CEILING_REQUIRED");
  });

  test("evaluator-optimizer unrelated cycle rejected", () => {
    const base = scaffoldEvaluatorOptimizer(createEmptyDefinition("EO"));
    const extraA = createNode("agent", { x: 0, y: 0 });
    const extraB = createNode("agent", { x: 40, y: 0 });
    const def = {
      ...base,
      nodes: [...base.nodes, extraA, extraB],
      edges: [
        ...base.edges,
        createEdge({ source: extraA.id, target: extraB.id }),
        createEdge({ source: extraB.id, target: extraA.id }),
      ],
    };
    expect(codes(validateWorkflow(def, []))).toContain("EVALUATOR_OPTIMIZER_CYCLE_INVALID");
  });

  test("parallel split over budget", () => {
    const split = createNode("parallel_split", { x: 0, y: 0 });
    const join = createNode("parallel_join", { x: 200, y: 0 });
    const specialists = Array.from({ length: DEFAULT_MAX_CONCURRENT_BRANCHES + 1 }, (_, i) =>
      createNode("agent", { x: 100, y: i * 40 }),
    );
    const def = {
      ...createEmptyDefinition("Parallel"),
      archetype: "linear-pipeline" as const,
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [createNode("input", { x: -80, y: 0 }), split, ...specialists, join, createNode("output", { x: 320, y: 0 })],
      edges: [
        createEdge({ source: split.id, target: specialists[0]!.id }), // wired below
        ...specialists.flatMap((node) => [
          createEdge({ source: split.id, target: node.id }),
          createEdge({ source: node.id, target: join.id }),
        ]),
      ],
    };
    // remove accidental duplicate first edge by rebuilding cleanly
    def.edges = [
      createEdge({ source: def.nodes[0]!.id, target: split.id }),
      ...specialists.flatMap((node) => [
        createEdge({ source: split.id, target: node.id }),
        createEdge({ source: node.id, target: join.id }),
      ]),
      createEdge({ source: join.id, target: def.nodes[def.nodes.length - 1]!.id }),
    ];
    expect(codes(validateWorkflow(def, []))).toContain("PARALLEL_BRANCH_LIMIT_EXCEEDED");
  });

  test("subgraph missing workflowId and self-reference", () => {
    const missing = createNode("subgraph", { x: 0, y: 0 });
    const defMissing = {
      ...createEmptyDefinition("Sub"),
      archetype: "linear-pipeline" as const,
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [missing],
      edges: [],
    };
    expect(codes(validateWorkflow(defMissing, []))).toContain("SUBGRAPH_REF_MISSING");

    const self = createNode("subgraph", { x: 0, y: 0 });
    (self.config as { workflowId: string }).workflowId = defMissing.id;
    const defSelf = { ...defMissing, id: defMissing.id, nodes: [self] };
    expect(codes(validateWorkflow(defSelf, []))).toContain("SUBGRAPH_NESTING_UNSAFE");
  });

  test("swarm missing bounds", () => {
    const def = {
      ...createEmptyDefinition("Swarm"),
      archetype: "autonomous-swarm" as const,
      archetypeConfig: { category: "autonomous-swarm" as const },
    };
    expect(codes(validateWorkflow(def, []))).toContain("SWARM_BOUNDS_REQUIRED");
  });

  test("swarm scaffold validates without SWARM_BOUNDS_REQUIRED", () => {
    const def = scaffoldAutonomousSwarm(createEmptyDefinition("Swarm"));
    expect(codes(validateWorkflow(def, [])).includes("SWARM_BOUNDS_REQUIRED")).toBe(false);
  });

  test("linear still forbids cycles", () => {
    const a = createNode("agent", { x: 0, y: 0 });
    const b = createNode("agent", { x: 40, y: 0 });
    const def = {
      ...createEmptyDefinition("Linear"),
      archetype: "linear-pipeline" as const,
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [a, b],
      edges: [createEdge({ source: a.id, target: b.id }), createEdge({ source: b.id, target: a.id })],
    };
    expect(codes(validateWorkflow(def, []))).toContain("LINEAR_PIPELINE_CYCLE_FORBIDDEN");
  });

  test("hierarchical still requires hub", () => {
    const def = {
      ...createEmptyDefinition("Hier"),
      archetype: "hierarchical-supervisor" as const,
      archetypeConfig: createHierarchicalSupervisorConfig(undefined, { recursionGuards: [] }),
      nodes: [createNode("condition", { x: 0, y: 0 })],
      edges: [],
    };
    expect(codes(validateWorkflow(def, []))).toContain("MISSING_SUPERVISOR_HUB");
  });

  test("createAutonomousSwarmConfig factory sets category", () => {
    expect(createAutonomousSwarmConfig().category).toBe("autonomous-swarm");
  });

  test("client EO scaffold validates without CYCLE_INVALID", () => {
    const def = scaffoldEvaluatorOptimizer(createEmptyDefinition("EO Client"));
    const webCodes = validateWebWorkflow(def, []).map((issue) => issue.code);
    expect(webCodes).not.toContain("EVALUATOR_OPTIMIZER_CYCLE_INVALID");
  });

  test("parallel split with one outgoing is mismatched", () => {
    const split = createNode("parallel_split", { x: 0, y: 0 });
    const a = createNode("agent", { x: 100, y: 0 });
    const def = {
      ...createEmptyDefinition("OrphanSplit"),
      archetype: "linear-pipeline" as const,
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [split, a],
      edges: [createEdge({ source: split.id, target: a.id })],
    };
    expect(codes(validateWorkflow(def, []))).toContain("PARALLEL_SPLIT_JOIN_MISMATCH");
  });

  test("subgraph knownWorkflowIds rejects unknown refs", () => {
    const sub = createNode("subgraph", { x: 0, y: 0 });
    (sub.config as { workflowId: string }).workflowId = "missing-wf";
    const def = {
      ...createEmptyDefinition("SubCat"),
      archetype: "linear-pipeline" as const,
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [sub],
      edges: [],
    };
    expect(codes(validateWorkflow(def, [], { knownWorkflowIds: ["other-wf"] }))).toContain("SUBGRAPH_REF_MISSING");
  });

  test("swarm cycles without termination branch rejected", () => {
    const a = createNode("agent", { x: 0, y: 0 });
    const b = createNode("agent", { x: 40, y: 0 });
    const def = {
      ...createEmptyDefinition("SwarmLoop"),
      archetype: "autonomous-swarm" as const,
      archetypeConfig: createAutonomousSwarmConfig({ maxHops: 5, maxDepth: 3, maxActivePeerTasks: 2 }),
      nodes: [a, b],
      edges: [createEdge({ source: a.id, target: b.id }), createEdge({ source: b.id, target: a.id })],
    };
    expect(codes(validateWorkflow(def, []))).toContain("SWARM_UNBOUNDED_PEER_LOOP");
  });
});
