import {
  createAgentRecord,
  createToolRecord,
  INVALID_AGENT_NODE_ACTIVE_TOOLS,
  INVALID_AGENT_NODE_MODEL_OVERRIDE,
  resolveEffectiveAgentStepConfig,
  UNSUPPORTED_STEP_ACTIVE_TOOLS,
  UNSUPPORTED_STEP_MODEL_OVERRIDE,
  validateAgentNodeStepConfig,
  type AgentNodeConfig,
  type AgentRecord,
} from "@multi-agent/types";

function apiAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    ...createAgentRecord({ name: "Base", model: "gpt-4o" }),
    id: "agent_1",
    tools: ["tool_a", "tool_b"],
    backend: {
      type: "api",
      provider: "openai",
      model: "gpt-4o",
      settings: { temperature: 0.7, maxTokens: 1024 },
    },
    ...overrides,
  };
}

const registryTools = [
  { ...createToolRecord({ name: "A" }), id: "tool_a", enabled: true },
  { ...createToolRecord({ name: "B" }), id: "tool_b", enabled: true },
  { ...createToolRecord({ name: "C" }), id: "tool_c", enabled: false },
  { ...createToolRecord({ name: "D" }), id: "tool_d", enabled: true },
];

describe("resolveEffectiveAgentStepConfig", () => {
  test("omitted taskInstruction / blank string ⇒ effective instruction undefined", () => {
    const agent = apiAgent();
    expect(
      resolveEffectiveAgentStepConfig({
        agent,
        nodeConfig: { agentId: agent.id },
        registryTools,
      }).taskInstruction
    ).toBeUndefined();
    expect(
      resolveEffectiveAgentStepConfig({
        agent,
        nodeConfig: { agentId: agent.id, taskInstruction: "   " },
        registryTools,
      }).taskInstruction
    ).toBeUndefined();
  });

  test("non-empty taskInstruction is trimmed and returned", () => {
    const agent = apiAgent();
    expect(
      resolveEffectiveAgentStepConfig({
        agent,
        nodeConfig: { agentId: agent.id, taskInstruction: "  Generate code  " },
        registryTools,
      }).taskInstruction
    ).toBe("Generate code");
  });

  test("partial modelSettingsOverride merges field-by-field; unspecified keys inherit", () => {
    const agent = apiAgent();
    const effective = resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: { agentId: agent.id, modelSettingsOverride: { temperature: 0.2 } },
      registryTools,
    });
    expect(effective.modelSettings).toEqual({ temperature: 0.2, maxTokens: 1024 });
  });

  test("explicit temperature: 0 is preserved (not treated as unset)", () => {
    const agent = apiAgent();
    const effective = resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: { agentId: agent.id, modelSettingsOverride: { temperature: 0 } },
      registryTools,
    });
    expect(effective.modelSettings.temperature).toBe(0);
  });

  test("clearing semantics: override object without a key ⇒ that key inherits", () => {
    const agent = apiAgent();
    // Stored JSON must omit cleared keys — only temperature override present.
    const effective = resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: { agentId: agent.id, modelSettingsOverride: { temperature: 0.1 } },
      registryTools,
    });
    expect(effective.modelSettings.maxTokens).toBe(1024);
    expect(effective.modelSettings.temperature).toBe(0.1);
  });

  test("activeTools omitted ⇒ effective tools = agent.tools ∩ usable registry tools", () => {
    const agent = apiAgent({ tools: ["tool_a", "tool_b", "tool_c", "tool_missing"] });
    const effective = resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: { agentId: agent.id },
      registryTools,
    });
    expect(effective.toolIds).toEqual(["tool_a", "tool_b"]);
  });

  test("activeTools: [] ⇒ effective toolIds empty (distinct from omit)", () => {
    const agent = apiAgent();
    const effective = resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: { agentId: agent.id, activeTools: [] },
      registryTools,
    });
    expect(effective.toolIds).toEqual([]);
  });

  test("nonempty activeTools ⊆ allowed ⇒ effective equals that subset (stable order)", () => {
    const agent = apiAgent();
    const effective = resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: { agentId: agent.id, activeTools: ["tool_b", "tool_a"] },
      registryTools,
    });
    expect(effective.toolIds).toEqual(["tool_b", "tool_a"]);
  });

  test("activeTools containing unknown/disabled/not-allowed id ⇒ validation error", () => {
    const agent = apiAgent();
    const issues = validateAgentNodeStepConfig({
      agent,
      nodeConfig: { agentId: agent.id, activeTools: ["tool_a", "tool_d"] },
      registryTools,
    });
    expect(issues.some((i) => i.code === INVALID_AGENT_NODE_ACTIVE_TOOLS)).toBe(true);

    const disabled = validateAgentNodeStepConfig({
      agent: apiAgent({ tools: ["tool_a", "tool_c"] }),
      nodeConfig: { agentId: "agent_1", activeTools: ["tool_c"] },
      registryTools,
    });
    expect(disabled.some((i) => i.code === INVALID_AGENT_NODE_ACTIVE_TOOLS)).toBe(true);
  });

  test("executionMode / maxToolSteps precedence uses effective toolIds; clamp 1–10 default 5", () => {
    // No explicit agent/node mode — derivation uses effective toolIds.
    const agent = apiAgent({ tools: ["tool_a"], maxToolSteps: 8 });
    delete (agent as { executionMode?: string }).executionMode;
    // Empty effective tools ⇒ default single_turn even if base agent has tools
    const emptyTools = resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: { agentId: agent.id, activeTools: [] },
      registryTools,
    });
    expect(emptyTools.executionMode).toBe("single_turn");
    expect(emptyTools.maxToolSteps).toBe(8);

    // Explicit agent mode still wins over derived-from-effective-tools
    const forcedReact = resolveEffectiveAgentStepConfig({
      agent: apiAgent({ tools: ["tool_a"], executionMode: "react" }),
      nodeConfig: { agentId: "agent_1", activeTools: [] },
      registryTools,
    });
    expect(forcedReact.executionMode).toBe("react");

    const nodeOverride = resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: { agentId: agent.id, executionMode: "single_turn", maxToolSteps: 2 },
      registryTools,
    });
    expect(nodeOverride.executionMode).toBe("single_turn");
    expect(nodeOverride.maxToolSteps).toBe(2);

    const clamped = resolveEffectiveAgentStepConfig({
      agent: apiAgent({ maxToolSteps: 99 }),
      nodeConfig: { agentId: "agent_1" },
      registryTools,
    });
    expect(clamped.maxToolSteps).toBe(10);

    const defaultSteps = resolveEffectiveAgentStepConfig({
      agent: apiAgent({ maxToolSteps: undefined }),
      nodeConfig: { agentId: "agent_1" },
      registryTools,
    });
    expect(defaultSteps.maxToolSteps).toBe(5);
  });

  test("resolve MUST NOT mutate the input AgentRecord", () => {
    const agent = apiAgent();
    const before = JSON.stringify(agent);
    Object.freeze(agent);
    Object.freeze(agent.backend);
    if (agent.backend.type === "api" && agent.backend.settings) {
      Object.freeze(agent.backend.settings);
    }
    Object.freeze(agent.tools);
    resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: {
        agentId: agent.id,
        taskInstruction: "x",
        modelSettingsOverride: { temperature: 0 },
        activeTools: ["tool_a"],
      },
      registryTools,
    });
    expect(JSON.stringify(agent)).toBe(before);
  });
});

describe("backend support matrix", () => {
  test("api accepts valid override keys; illegal keys / Anthropic temp+topP on effective merge rejected", () => {
    const agent = apiAgent();
    expect(
      validateAgentNodeStepConfig({
        agent,
        nodeConfig: { agentId: agent.id, modelSettingsOverride: { temperature: 0.5 } },
        registryTools,
      })
    ).toEqual([]);

    const badKey = validateAgentNodeStepConfig({
      agent,
      nodeConfig: {
        agentId: agent.id,
        modelSettingsOverride: { temperature: 0.5, notAKey: 1 } as AgentNodeConfig["modelSettingsOverride"],
      },
      registryTools,
    });
    expect(badKey.some((i) => i.code === INVALID_AGENT_NODE_MODEL_OVERRIDE)).toBe(true);

    const anthropic = apiAgent({
      backend: {
        type: "api",
        provider: "anthropic",
        model: "claude-3",
        settings: { temperature: 0.5 },
      },
    });
    const both = validateAgentNodeStepConfig({
      agent: anthropic,
      nodeConfig: { agentId: anthropic.id, modelSettingsOverride: { topP: 0.9 } },
      registryTools,
    });
    expect(both.some((i) => i.code === INVALID_AGENT_NODE_MODEL_OVERRIDE)).toBe(true);
  });

  test("local accepts model settings overrides", () => {
    const agent = apiAgent({
      backend: { type: "local", provider: "ollama", model: "llama3", settings: { temperature: 0.5 } },
      tools: [],
    });
    expect(
      validateAgentNodeStepConfig({
        agent,
        nodeConfig: { agentId: agent.id, modelSettingsOverride: { temperature: 0 } },
        registryTools,
      })
    ).toEqual([]);
  });

  test("cli / process / webhook: any present modelSettingsOverride ⇒ UNSUPPORTED_STEP_MODEL_OVERRIDE", () => {
    for (const backend of [
      { type: "cli" as const, provider: "codex" },
      { type: "process" as const, command: "echo" },
      { type: "webhook" as const, url: "https://example.com/hook" },
    ]) {
      const agent = apiAgent({ backend: backend as AgentRecord["backend"], tools: [] });
      const issues = validateAgentNodeStepConfig({
        agent,
        nodeConfig: { agentId: agent.id, modelSettingsOverride: { temperature: 0.1 } },
        registryTools,
      });
      expect(issues.some((i) => i.code === UNSUPPORTED_STEP_MODEL_OVERRIDE)).toBe(true);
    }
  });

  test("cli / process / webhook / local: any present activeTools (including []) ⇒ UNSUPPORTED_STEP_ACTIVE_TOOLS", () => {
    for (const backend of [
      { type: "cli" as const, provider: "codex" },
      { type: "process" as const, command: "echo" },
      { type: "webhook" as const, url: "https://example.com/hook" },
      { type: "local" as const, provider: "ollama", model: "llama3" },
    ]) {
      const agent = apiAgent({ backend: backend as AgentRecord["backend"], tools: ["tool_a"] });
      const withEmpty = validateAgentNodeStepConfig({
        agent,
        nodeConfig: { agentId: agent.id, activeTools: [] },
        registryTools,
      });
      expect(withEmpty.some((i) => i.code === UNSUPPORTED_STEP_ACTIVE_TOOLS)).toBe(true);

      const omitted = validateAgentNodeStepConfig({
        agent,
        nodeConfig: { agentId: agent.id },
        registryTools,
      });
      expect(omitted.some((i) => i.code === UNSUPPORTED_STEP_ACTIVE_TOOLS)).toBe(false);
    }
  });
});

describe("base-agent switch / legacy / registry default change", () => {
  test("taskInstruction preserved conceptually; incompatible tools produce issues", () => {
    const agent = apiAgent({ tools: ["tool_a"] });
    const nodeConfig: AgentNodeConfig = {
      agentId: agent.id,
      taskInstruction: "Keep me",
      activeTools: ["tool_b"],
    };
    const effective = resolveEffectiveAgentStepConfig({ agent, nodeConfig, registryTools });
    expect(effective.taskInstruction).toBe("Keep me");
    expect(effective.incompatibilities.some((i) => i.code === INVALID_AGENT_NODE_ACTIVE_TOOLS || i.code === "INCOMPATIBLE_STEP_CONFIG_FOR_AGENT")).toBe(true);
  });

  test("legacy node with only agentId resolves identically to inherit-all baseline", () => {
    const agent = apiAgent();
    const effective = resolveEffectiveAgentStepConfig({
      agent,
      nodeConfig: { agentId: agent.id },
      registryTools,
    });
    expect(effective.taskInstruction).toBeUndefined();
    expect(effective.modelSettings).toEqual({ temperature: 0.7, maxTokens: 1024 });
    expect(effective.toolIds).toEqual(["tool_a", "tool_b"]);
    expect(effective.executionMode).toBe("react");
    expect(effective.maxToolSteps).toBe(5);
  });

  test("registry default change: non-overridden fields pick new defaults; overrides unchanged", () => {
    const nodeConfig: AgentNodeConfig = {
      agentId: "agent_1",
      modelSettingsOverride: { temperature: 0 },
      activeTools: ["tool_a"],
    };
    const first = resolveEffectiveAgentStepConfig({
      agent: apiAgent({
        backend: { type: "api", provider: "openai", model: "gpt-4o", settings: { temperature: 0.7, maxTokens: 100 } },
      }),
      nodeConfig,
      registryTools,
    });
    const second = resolveEffectiveAgentStepConfig({
      agent: apiAgent({
        backend: { type: "api", provider: "openai", model: "gpt-4o", settings: { temperature: 0.9, maxTokens: 2000 } },
        tools: ["tool_a", "tool_b"],
      }),
      nodeConfig,
      registryTools,
    });
    expect(first.modelSettings.temperature).toBe(0);
    expect(second.modelSettings.temperature).toBe(0);
    expect(first.modelSettings.maxTokens).toBe(100);
    expect(second.modelSettings.maxTokens).toBe(2000);
    expect(first.toolIds).toEqual(["tool_a"]);
    expect(second.toolIds).toEqual(["tool_a"]);
  });
});
