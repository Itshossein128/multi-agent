import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createLinearPipelineConfig,
  createNode,
} from "@multi-agent/types";
import { compileWorkflow, evaluateParallelJoinResult, NodeOutcomeError } from "../apps/server/src/compiler/workflowCompiler";
import { scaffoldEvaluatorOptimizer, scaffoldAutonomousSwarm } from "../apps/server/src/api/studio/topologyScaffolds";
import { validateWorkflow } from "../apps/server/src/compiler/validation";

function linkAgents(definition: ReturnType<typeof createEmptyDefinition>) {
  const agents = definition.nodes
    .filter((node) => node.type === "agent")
    .map((node, index) => {
      const agent = createAgentRecord({ name: `Agent ${index}` });
      (node.config as { agentId: string | null }).agentId = agent.id;
      return agent;
    });
  return agents;
}

describe("workflowCompiler topology (014)", () => {
  test("evaluator-optimizer scaffold validates without EO error codes", () => {
    const definition = scaffoldEvaluatorOptimizer(createEmptyDefinition("EO Compile"));
    const issues = validateWorkflow(definition, []);
    expect(issues.some((issue) => issue.code.startsWith("EVALUATOR_OPTIMIZER_") || issue.code === "INVALID_ARCHETYPE")).toBe(false);
  });

  test("evaluator-optimizer scaffold compiles when agents are linked", () => {
    const definition = scaffoldEvaluatorOptimizer(createEmptyDefinition("EO Compile"));
    const agents = linkAgents(definition);
    expect(() => compileWorkflow(definition, agents)).not.toThrow();
  });

  test("autonomous-swarm scaffold validates without SWARM_BOUNDS_REQUIRED", () => {
    const definition = scaffoldAutonomousSwarm(createEmptyDefinition("Swarm Compile"));
    expect(validateWorkflow(definition, []).some((issue) => issue.code === "SWARM_BOUNDS_REQUIRED")).toBe(false);
  });

  test("parallel join all_success graph validates and compiles under budget", () => {
    const input = createNode("input", { x: 0, y: 0 });
    const split = createNode("parallel_split", { x: 80, y: 0 });
    const a = createNode("agent", { x: 200, y: -40 });
    const b = createNode("agent", { x: 200, y: 40 });
    const join = createNode("parallel_join", { x: 360, y: 0 });
    const output = createNode("output", { x: 480, y: 0 });
    const definition = {
      ...createEmptyDefinition("Scatter"),
      archetype: "linear-pipeline" as const,
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [input, split, a, b, join, output],
      edges: [
        createEdge({ source: input.id, target: split.id }),
        createEdge({ source: split.id, target: a.id }),
        createEdge({ source: split.id, target: b.id }),
        createEdge({ source: a.id, target: join.id }),
        createEdge({ source: b.id, target: join.id }),
        createEdge({ source: join.id, target: output.id }),
      ],
    };
    const agents = linkAgents(definition);
    expect(validateWorkflow(definition, agents).some((issue) => issue.code === "PARALLEL_BRANCH_LIMIT_EXCEEDED")).toBe(false);
    expect(() => compileWorkflow(definition, agents)).not.toThrow();
  });

  test("subgraph node type is accepted by compiler when agents unused", () => {
    const input = createNode("input", { x: 0, y: 0 });
    const sub = createNode("subgraph", { x: 120, y: 0 });
    (sub.config as { workflowId: string }).workflowId = "child-wf";
    const output = createNode("output", { x: 240, y: 0 });
    const definition = {
      ...createEmptyDefinition("Parent"),
      archetype: "linear-pipeline" as const,
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [input, sub, output],
      edges: [
        createEdge({ source: input.id, target: sub.id }),
        createEdge({ source: sub.id, target: output.id }),
      ],
    };
    expect(() => compileWorkflow(definition, [])).not.toThrow();
  });

  test("subgraph without runner fails closed on invoke", async () => {
    const input = createNode("input", { x: 0, y: 0 });
    const sub = createNode("subgraph", { x: 120, y: 0 });
    (sub.config as { workflowId: string }).workflowId = "child-wf";
    const output = createNode("output", { x: 240, y: 0 });
    const definition = {
      ...createEmptyDefinition("ParentFail"),
      archetype: "linear-pipeline" as const,
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [input, sub, output],
      edges: [
        createEdge({ source: input.id, target: sub.id }),
        createEdge({ source: sub.id, target: output.id }),
      ],
    };
    const { graph } = compileWorkflow(definition, []);
    await expect(
      (graph as { invoke: (state: Record<string, unknown>) => Promise<unknown> }).invoke({
        input: { hello: "world" },
        output: {},
        memory: {},
        workingMemory: {},
        lastValue: { hello: "world" },
      }),
    ).rejects.toThrow(/subgraph|nested workflow resolver/i);
  });

  test("parallel join all_success completes when every required branch finishes", async () => {
    const input = createNode("input", { x: 0, y: 0 });
    const split = createNode("parallel_split", { x: 80, y: 0 });
    const a = createNode("agent", { x: 200, y: -40 });
    const b = createNode("agent", { x: 200, y: 40 });
    const join = createNode("parallel_join", { x: 360, y: 0 });
    (join.config as { joinPolicy: string }).joinPolicy = "all_success";
    const output = createNode("output", { x: 480, y: 0 });
    const definition = {
      ...createEmptyDefinition("JoinOk"),
      archetype: "linear-pipeline" as const,
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [input, split, a, b, join, output],
      edges: [
        createEdge({ source: input.id, target: split.id }),
        createEdge({ source: split.id, target: a.id }),
        createEdge({ source: split.id, target: b.id }),
        createEdge({ source: a.id, target: join.id }),
        createEdge({ source: b.id, target: join.id }),
        createEdge({ source: join.id, target: output.id }),
      ],
    };
    const agents = linkAgents(definition);
    const { graph } = compileWorkflow(definition, agents, {
      agentRunner: async () => ({ status: "success", value: { ok: true } }),
    });
    const state = await (graph as { invoke: (s: Record<string, unknown>) => Promise<Record<string, unknown>> }).invoke({
      input: { brief: "review" },
      output: {},
      memory: {},
      workingMemory: {},
      lastValue: { brief: "review" },
    });
    expect(state.lastValue).toMatchObject({ partial: false });
  });

  test("parallel join all_success fails closed when a required branch is missing", () => {
    const join = createNode("parallel_join", { x: 0, y: 0 });
    Object.assign(join.config, { joinPolicy: "all_success", requiredBranchKeys: ["a", "b"], branchTimeoutMs: 10 });
    expect(() => evaluateParallelJoinResult(join, ["a", "b"], { a: { ok: true } })).toThrow(NodeOutcomeError);
    try {
      evaluateParallelJoinResult(join, ["a", "b"], { a: { ok: true } });
    } catch (error) {
      expect(error).toBeInstanceOf(NodeOutcomeError);
      const envelope = (error as NodeOutcomeError).envelope;
      expect(envelope.error?.code).toBe("PARALLEL_JOIN_FAILED");
      expect((envelope.value as { timedOut?: string[] }).timedOut).toContain("b");
    }
  });

  test("parallel join partial_allowed delivers failed/timedOut carrier", () => {
    const join = createNode("parallel_join", { x: 0, y: 0 });
    Object.assign(join.config, { joinPolicy: "partial_allowed", requiredBranchKeys: ["a", "b"], branchTimeoutMs: 5 });
    const carrier = evaluateParallelJoinResult(join, ["a", "b"], { a: { ok: true } });
    expect(carrier.partial).toBe(true);
    expect(carrier.timedOut).toContain("b");
    expect(carrier.failed?.b?.code).toBe("PARALLEL_BRANCH_TIMEOUT");
  });
});
