/**
 * @jest-environment jsdom
 */
import { createAgentRecord, createNode, createToolRecord, createEmptyDefinition } from "@multi-agent/types";
import { AgentForm } from "../apps/web/src/components/workflow/properties/NodeForms";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { act } from "react";
import { renderUi, setSelectValue } from "./renderUi";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("AgentForm step isolation", () => {
  const tool = { ...createToolRecord({ name: "Lookup Tool" }), id: "tool_lookup" };
  const agent = {
    ...createAgentRecord({ name: "Shared Agent", model: "gpt-4o" }),
    id: "agent_1",
    tools: ["tool_lookup"],
    systemPrompt: "You are a helpful base agent.",
    backend: {
      type: "api" as const,
      provider: "openai",
      model: "gpt-4o",
      settings: { temperature: 0.7, maxTokens: 1024 },
    },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const node = createNode("agent", { x: 0, y: 0 }, { agentId: agent.id });

  beforeEach(() => {
    mockPush.mockReset();
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: { ...createEmptyDefinition("Step form"), nodes: [node], edges: [] },
      agents: [{ ...agent }],
      tools: [tool],
      loadState: "ready",
      isDirty: false,
    });
  });

  test("shows base agent, step instructions, model overrides, active tools, registry CTA", async () => {
    const view = await renderUi(<AgentForm node={node} />);
    const text = view.container.textContent ?? "";
    expect(view.container.querySelector('[data-testid="base-agent-select"]')).toBeTruthy();
    expect(view.container.querySelector('[data-testid="base-agent-summary"]')).toBeTruthy();
    expect(view.container.querySelector('[data-testid="step-task-instruction"]')).toBeTruthy();
    expect(view.container.querySelector('[data-testid="step-model-settings"]')).toBeTruthy();
    expect(view.container.querySelector('[data-testid="step-active-tools-mode"]')).toBeTruthy();
    expect(view.container.querySelector('[data-testid="edit-agent-in-registry"]')).toBeTruthy();
    expect(text).toMatch(/Step Instructions/i);
    expect(text).not.toMatch(/Assigned tools/i);
    await view.unmount();
  });

  test("taskInstruction updates only node config and does not mutate registry agent", async () => {
    const view = await renderUi(<AgentForm node={node} />);
    const before = JSON.parse(JSON.stringify(useWorkflowStore.getState().agents[0]));
    const textarea = view.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="step-task-instruction"]'
    )!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "Generate code from the spec.");
    await act(async () => {
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const config = useWorkflowStore.getState().definition.nodes.find((n) => n.id === node.id)
      ?.config as { taskInstruction?: string };
    expect(config.taskInstruction).toBe("Generate code from the spec.");
    expect(useWorkflowStore.getState().agents[0]).toEqual(before);
    await view.unmount();
  });

  test("does not expose registry field editors that call updateAgentRecord", async () => {
    const view = await renderUi(<AgentForm node={node} />);
    expect(view.container.querySelector('[data-testid="agent-execution-mode"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="agent-max-tool-steps"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="agent-tools"]')).toBeNull();
    const before = JSON.parse(JSON.stringify(useWorkflowStore.getState().agents[0]));
    // Interact with step controls only
    const mode = view.container.querySelector<HTMLSelectElement>('[data-testid="node-execution-mode"]')!;
    await setSelectValue(mode, "single_turn");
    expect(useWorkflowStore.getState().agents[0]).toEqual(before);
    await view.unmount();
  });

  test("clearing a model override removes the key from stored modelSettingsOverride", async () => {
    useWorkflowStore.getState().updateNodeConfig(node.id, {
      modelSettingsOverride: { temperature: 0, maxTokens: 512 },
    });
    const freshNode = useWorkflowStore.getState().definition.nodes.find((n) => n.id === node.id)!;
    const view = await renderUi(<AgentForm node={freshNode} />);
    const clear = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="clear-model-override-temperature"]'
    )!;
    await act(async () => {
      clear.click();
    });
    const config = useWorkflowStore.getState().definition.nodes.find((n) => n.id === node.id)
      ?.config as { modelSettingsOverride?: Record<string, number> };
    expect(config.modelSettingsOverride).toEqual({ maxTokens: 512 });
    expect("temperature" in (config.modelSettingsOverride ?? {})).toBe(false);
    await view.unmount();
  });

  test("Edit Agent in Registry warns and navigates without PATCH", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const before = JSON.parse(JSON.stringify(useWorkflowStore.getState().agents[0]));
    const view = await renderUi(<AgentForm node={node} />);
    const button = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="edit-agent-in-registry"]'
    )!;
    button.click();
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/org/agents/agent_1"));
    expect(useWorkflowStore.getState().agents[0]).toEqual(before);
    confirmSpy.mockRestore();
    await view.unmount();
  });
});
