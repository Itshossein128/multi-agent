import { createAgentRecord, type WorkflowDefinition, type WorkflowNode } from "@multi-agent/types";
import { NODE_VALIDATORS, type ValidationContext } from "../apps/server/src/compiler/nodeValidators";

describe("agent node ReAct config validation", () => {
  function run(config: Record<string, unknown>) {
    const codes: string[] = [];
    const agent = createAgentRecord({ name: "A", model: "gpt-4o", provider: "openai" });
    agent.id = "agent_1";
    const definition = {
      id: "wf",
      name: "w",
      version: 1,
      nodes: [],
      edges: [],
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as WorkflowDefinition;
    const ctx: ValidationContext = {
      add(_level, code) {
        codes.push(code);
      },
      definition,
      agents: [agent],
      tools: [],
      limits: { allowToolSideEffects: true },
      maxBranches: 8,
      supportedToolCategories: new Set(["function", "http", "database", "search", "file", "mcp", "cli", "custom"]),
    };
    const node = {
      id: "n1",
      type: "agent",
      position: { x: 0, y: 0 },
      config,
    } as unknown as WorkflowNode;
    NODE_VALIDATORS.agent(node, ctx);
    return codes;
  }

  test("rejects invalid executionMode on AgentNodeConfig", () => {
    const codes = run({ agentId: "agent_1", executionMode: "turbo" });
    expect(codes).toContain("INVALID_AGENT_NODE_EXECUTION_MODE");
  });

  test("rejects maxToolSteps outside 1–10", () => {
    const codes = run({ agentId: "agent_1", maxToolSteps: 99 });
    expect(codes).toContain("INVALID_AGENT_NODE_MAX_TOOL_STEPS");
  });

  test("accepts valid react overrides", () => {
    const codes = run({ agentId: "agent_1", executionMode: "react", maxToolSteps: 3 });
    expect(codes.filter((c) => c.startsWith("INVALID_AGENT_NODE_"))).toHaveLength(0);
  });
});
