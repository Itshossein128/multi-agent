/**
 * @jest-environment jsdom
 */
import { createAgentRecord, createNode, createToolRecord, createEmptyDefinition } from "@multi-agent/types";
import { AgentForm } from "../apps/web/src/components/workflow/properties/NodeForms";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { renderUi, setInputValue, setSelectValue } from "./renderUi";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe("AgentForm ReAct controls", () => {
  const tool = { ...createToolRecord({ name: "Lookup Tool" }), id: "tool_lookup" };
  const agent = {
    ...createAgentRecord({ name: "ReAct Agent", model: "gpt-4o" }),
    id: "agent_1",
    tools: ["tool_lookup"],
  };
  const node = createNode("agent", { x: 0, y: 0 }, { agentId: agent.id });

  beforeEach(() => {
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: { ...createEmptyDefinition("ReAct form"), nodes: [node], edges: [] },
      agents: [agent],
      tools: [tool],
      loadState: "ready",
      isDirty: false,
    });
  });

  test("shows node execution overrides and step-local tool mode (not agent-level editors)", async () => {
    const view = await renderUi(<AgentForm node={node} />);
    expect(view.container.querySelector('[data-testid="node-execution-mode"]')).toBeTruthy();
    expect(view.container.querySelector('[data-testid="node-max-tool-steps"]')).toBeTruthy();
    expect(view.container.querySelector('[data-testid="step-active-tools-mode"]')).toBeTruthy();
    expect(view.container.querySelector('[data-testid="agent-execution-mode"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="agent-max-tool-steps"]')).toBeNull();
    await view.unmount();
  });

  test("node overrides write AgentNodeConfig fields", async () => {
    const view = await renderUi(<AgentForm node={node} />);
    const mode = view.container.querySelector<HTMLSelectElement>('[data-testid="node-execution-mode"]')!;
    const steps = view.container.querySelector<HTMLInputElement>('[data-testid="node-max-tool-steps"]')!;
    await setSelectValue(mode, "react");
    await setInputValue(steps, "4");
    const config = useWorkflowStore.getState().definition.nodes.find((n) => n.id === node.id)?.config as {
      executionMode?: string;
      maxToolSteps?: number;
    };
    expect(config.executionMode).toBe("react");
    expect(config.maxToolSteps).toBe(4);
    await view.unmount();
  });

  test("node max tool steps input clamps to 1–10", async () => {
    const view = await renderUi(<AgentForm node={node} />);
    const steps = view.container.querySelector<HTMLInputElement>('[data-testid="node-max-tool-steps"]')!;
    await setInputValue(steps, "99");
    expect(
      (
        useWorkflowStore.getState().definition.nodes.find((n) => n.id === node.id)?.config as {
          maxToolSteps?: number;
        }
      ).maxToolSteps
    ).toBe(10);
    await setInputValue(steps, "0");
    expect(
      (
        useWorkflowStore.getState().definition.nodes.find((n) => n.id === node.id)?.config as {
          maxToolSteps?: number;
        }
      ).maxToolSteps
    ).toBe(5);
    await view.unmount();
  });
});
