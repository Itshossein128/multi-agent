import {
  createEmptyDefinition,
  createNode,
  serializeWorkflowDefinition,
  deserializeWorkflowDefinition,
  type AgentNodeConfig,
} from "@multi-agent/types";

describe("agent step config persistence", () => {
  test("taskInstruction, temperature 0, and activeTools: [] survive serialize/deserialize", () => {
    const def = createEmptyDefinition("persist");
    def.nodes.push(
      createNode("agent", { x: 0, y: 0 }, {
        agentId: "agent_1",
        taskInstruction: "Persist me",
        modelSettingsOverride: { temperature: 0, maxTokens: 256 },
        activeTools: [],
      })
    );
    const serialized = serializeWorkflowDefinition(def);
    const json = JSON.parse(JSON.stringify(serialized));
    const restored = deserializeWorkflowDefinition(json);
    const config = restored.nodes[0].config as AgentNodeConfig;
    expect(config.taskInstruction).toBe("Persist me");
    expect(config.modelSettingsOverride?.temperature).toBe(0);
    expect(config.activeTools).toEqual([]);
    expect(Array.isArray(config.activeTools)).toBe(true);
  });
});
