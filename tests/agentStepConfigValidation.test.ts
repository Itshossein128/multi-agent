import {
  UNSUPPORTED_STEP_MODEL_OVERRIDE,
  UNSUPPORTED_STEP_ACTIVE_TOOLS,
  createAgentRecord,
  createEmptyDefinition,
  createNode,
  createToolRecord,
} from "@multi-agent/types";
import { validateWorkflow as validateWorkflowWeb } from "../apps/web/src/lib/workflow/validation";
import { validateWorkflow as validateWorkflowServer } from "../apps/server/src/compiler/validation";

describe("step config validation parity", () => {
  const tool = { ...createToolRecord({ name: "A" }), id: "tool_a", enabled: true };

  test("cli modelSettingsOverride surfaces UNSUPPORTED_STEP_MODEL_OVERRIDE on web + server", () => {
    const agent = {
      ...createAgentRecord({ name: "CLI", provider: "codex" }),
      id: "agent_cli",
      backend: { type: "cli" as const, provider: "codex" },
      tools: [],
    };
    const def = createEmptyDefinition("v");
    def.nodes.push(
      createNode("agent", { x: 0, y: 0 }, {
        agentId: agent.id,
        modelSettingsOverride: { temperature: 0.2 },
      })
    );
    const web = validateWorkflowWeb(def, [agent], [tool]);
    expect(web.some((i) => i.code === UNSUPPORTED_STEP_MODEL_OVERRIDE)).toBe(true);

    const server = validateWorkflowServer(def, [agent], {}, [tool]);
    expect(server.some((i) => i.code === UNSUPPORTED_STEP_MODEL_OVERRIDE)).toBe(true);
  });

  test("cli activeTools surfaces UNSUPPORTED_STEP_ACTIVE_TOOLS", () => {
    const agent = {
      ...createAgentRecord({ name: "CLI", provider: "codex" }),
      id: "agent_cli",
      backend: { type: "cli" as const, provider: "codex" },
      tools: ["tool_a"],
    };
    const def = createEmptyDefinition("v");
    def.nodes.push(createNode("agent", { x: 0, y: 0 }, { agentId: agent.id, activeTools: [] }));
    const web = validateWorkflowWeb(def, [agent], [tool]);
    expect(web.some((i) => i.code === UNSUPPORTED_STEP_ACTIVE_TOOLS)).toBe(true);
  });

  test("missing / disabled agent still produce actionable codes", () => {
    const def = createEmptyDefinition("v");
    def.nodes.push(createNode("agent", { x: 0, y: 0 }, { agentId: null }));
    const webMissing = validateWorkflowWeb(def, [], []);
    expect(webMissing.some((i) => i.code === "MISSING_AGENT_CONFIG" || i.message.includes("not linked"))).toBe(
      true
    );

    const disabled = {
      ...createAgentRecord({ name: "Off", model: "gpt-4o" }),
      id: "agent_off",
      enabled: false,
    };
    const def2 = createEmptyDefinition("v2");
    def2.nodes.push(createNode("agent", { x: 0, y: 0 }, { agentId: disabled.id }));
    const webDisabled = validateWorkflowWeb(def2, [disabled], []);
    expect(webDisabled.some((i) => i.code === "AGENT_DISABLED")).toBe(true);
  });
});
