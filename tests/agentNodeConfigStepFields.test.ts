import {
  createEmptyDefinition,
  createNode,
  type AgentNodeConfig,
} from "@multi-agent/types";

describe("AgentNodeConfig step fields round-trip", () => {
  test("optional step fields round-trip without requiring them on legacy configs", () => {
    const legacy = createNode("agent", { x: 0, y: 0 }, { agentId: "agent_1" });
    const config = legacy.config as AgentNodeConfig;
    expect(config.agentId).toBe("agent_1");
    expect(config.taskInstruction).toBeUndefined();
    expect(config.modelSettingsOverride).toBeUndefined();
    expect(config.activeTools).toBeUndefined();

    const withSteps = {
      agentId: "agent_1" as string,
      taskInstruction: "Do the thing",
      modelSettingsOverride: { temperature: 0, maxTokens: 512 },
      activeTools: [] as string[],
      mutatesCode: true,
      role: "gap_auditor",
      executionMode: "react" as const,
      maxToolSteps: 3,
    };

    const node = createNode("agent", { x: 1, y: 1 }, withSteps);
    const json = JSON.parse(JSON.stringify(node.config)) as AgentNodeConfig;
    expect(json.taskInstruction).toBe("Do the thing");
    expect(json.modelSettingsOverride).toEqual({ temperature: 0, maxTokens: 512 });
    expect(json.modelSettingsOverride?.temperature).toBe(0);
    expect(json.activeTools).toEqual([]);
    expect(Array.isArray(json.activeTools) && json.activeTools.length === 0).toBe(true);
    expect(json.mutatesCode).toBe(true);
    expect(json.role).toBe("gap_auditor");

    const def = createEmptyDefinition("step-fields");
    def.nodes.push(node);
    const roundTrip = JSON.parse(JSON.stringify(def));
    const restored = roundTrip.nodes[0].config as AgentNodeConfig;
    expect(restored.activeTools).toEqual([]);
    expect("activeTools" in restored).toBe(true);
    expect(restored.modelSettingsOverride?.temperature).toBe(0);
  });
});
