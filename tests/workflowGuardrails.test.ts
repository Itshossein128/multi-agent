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
    expect(issues.some(issue => issue.code === "CYCLE_REQUIRES_GUARDRAIL" && issue.level === "warning")).toBe(true);
    expect(issues.some(issue => issue.code === "INVALID_CONNECTION" && issue.level === "error")).toBe(true);
  });

  test("enforces server-owned graph limits", () => {
    const workflow = validWorkflow();
    expect(validateWorkflow(workflow, [agent], { maxNodes: 2 }).some(issue => issue.code === "NODE_LIMIT_EXCEEDED")).toBe(true);
  });

  test("returns a structured error for malformed graph containers", () => {
    const issues = validateWorkflow({ nodes: undefined, edges: [] } as never, [agent]);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_WORKFLOW", level: "error" }),
    ]));
  });

  test("preserves and compiles a supported back-edge with a bounded-cycle warning", () => {
    const workflow = validWorkflow();
    const secondAgent = createNode("agent", { x: 2, y: 0 }, { agentId: agent.id });
    workflow.nodes.splice(2, 0, secondAgent);
    workflow.edges = [
      createEdge({ source: workflow.nodes[0].id, target: workflow.nodes[1].id }),
      createEdge({ source: workflow.nodes[1].id, target: secondAgent.id }),
      createEdge({ source: secondAgent.id, target: workflow.nodes[1].id }),
      createEdge({ source: secondAgent.id, target: workflow.nodes[3].id }),
    ];
    const issues = validateWorkflow(workflow, [agent]);
    expect(issues.some(issue => issue.code === "CYCLE_REQUIRES_GUARDRAIL" && issue.level === "warning")).toBe(true);
    expect(() => compileWorkflow(workflow, [agent])).not.toThrow();
  });

  test("clamps malformed environment values to safe defaults", () => {
    expect(runtimeGuardrailsFromEnvironment({ RUN_MAX_DURATION_MS: "bad", WORKFLOW_MAX_NODES: "-1" } as unknown as NodeJS.ProcessEnv))
      .toMatchObject({ maxRunDurationMs: 900000, maxNodes: 100, recursionLimit: 100 });
  });
});
