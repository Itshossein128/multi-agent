import { createAgentRecord, createEmptyDefinition, createNode, createToolRecord } from "@multi-agent/types";
import { resolveAgentToolsForRuntime } from "../apps/server/src/compiler/workflowCompiler";

describe("resolveAgentToolsForRuntime activeTools", () => {
  const tools = [
    { ...createToolRecord({ name: "A" }), id: "tool_a", enabled: true },
    { ...createToolRecord({ name: "B" }), id: "tool_b", enabled: true },
    { ...createToolRecord({ name: "C" }), id: "tool_c", enabled: false },
  ];
  const agent = {
    ...createAgentRecord({ name: "A", model: "gpt-4o" }),
    id: "agent_1",
    tools: ["tool_a", "tool_b", "tool_c"],
  };

  test("omit activeTools ⇒ agent.tools ∩ enabled registry", () => {
    expect(resolveAgentToolsForRuntime(agent, tools).map((t) => t.id)).toEqual(["tool_a", "tool_b"]);
  });

  test("activeTools: [] ⇒ empty", () => {
    expect(resolveAgentToolsForRuntime(agent, tools, []).map((t) => t.id)).toEqual([]);
  });

  test("subset never expands beyond agent allowlist", () => {
    expect(resolveAgentToolsForRuntime(agent, tools, ["tool_b", "tool_missing"]).map((t) => t.id)).toEqual([
      "tool_b",
    ]);
  });
});

describe("agent node step fields on workflow definition", () => {
  test("taskInstruction is retained on AgentNodeConfig for compiler consumers", () => {
    const def = createEmptyDefinition("compiler-step");
    const node = createNode("agent", { x: 0, y: 0 }, {
      agentId: "agent_1",
      taskInstruction: "Do X",
      modelSettingsOverride: { temperature: 0 },
      activeTools: ["tool_a"],
    });
    def.nodes.push(node);
    const roundTrip = JSON.parse(JSON.stringify(def));
    expect(roundTrip.nodes[0].config.taskInstruction).toBe("Do X");
    expect(roundTrip.nodes[0].config.modelSettingsOverride.temperature).toBe(0);
    expect(roundTrip.nodes[0].config.activeTools).toEqual(["tool_a"]);
  });
});
