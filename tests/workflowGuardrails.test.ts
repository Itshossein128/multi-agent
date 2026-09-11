import { createAgentRecord, createEdge, createEmptyDefinition, createNode } from "@multi-agent/types";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { runtimeGuardrailsFromEnvironment } from "../apps/server/src/runtime/guardrails";

function validWorkflow() {
  const input = createNode("input", { x: 0, y: 0 });
  const agent = createNode("agent", { x: 1, y: 0 }, { agentId: "agent-1" });
  const output = createNode("output", { x: 2, y: 0 });
  return { ...createEmptyDefinition("safe"), nodes: [input, agent, output], edges: [createEdge({ source: input.id, target: agent.id }), createEdge({ source: agent.id, target: output.id })] };
}

describe("workflow guardrails", () => {
  const agent = { ...createAgentRecord({ name: "Safe", model: "gpt-4o" }), id: "agent-1" };

  test("reports stable codes for unsafe graph structure", () => {
    const workflow = validWorkflow();
    workflow.edges.push({ ...workflow.edges[0], id: workflow.edges[0].id, source: workflow.nodes[1].id, target: workflow.nodes[0].id });
    const issues = validateWorkflow(workflow, [agent]);
    expect(issues.some(issue => issue.code === "DUPLICATE_EDGE_ID" && issue.level === "error")).toBe(true);
    expect(issues.some(issue => issue.code === "UNSAFE_CYCLE" && issue.level === "error")).toBe(true);
    expect(issues.some(issue => issue.code === "INVALID_CONNECTION" && issue.level === "error")).toBe(true);
  });

  test("enforces server-owned graph limits", () => {
    const workflow = validWorkflow();
    expect(validateWorkflow(workflow, [agent], { maxNodes: 2 }).some(issue => issue.code === "NODE_LIMIT_EXCEEDED")).toBe(true);
  });

  test("rejects a cyclic persisted definition before DAG compilation", () => {
    const workflow = validWorkflow();
    workflow.edges.push({ ...workflow.edges[1], id: "cycle", source: workflow.nodes[1].id, target: workflow.nodes[0].id });
    expect(() => compileWorkflow(workflow, [agent])).toThrow(/Cycles are not supported/);
  });

  test("clamps malformed environment values to safe defaults", () => {
    expect(runtimeGuardrailsFromEnvironment({ RUN_MAX_DURATION_MS: "bad", WORKFLOW_MAX_NODES: "-1" } as NodeJS.ProcessEnv))
      .toMatchObject({ maxRunDurationMs: 900000, maxNodes: 100, recursionLimit: 100 });
  });
});
