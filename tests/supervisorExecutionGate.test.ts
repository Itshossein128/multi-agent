/**
 * @jest-environment jsdom
 */
import { createElement } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { createEmptyDefinition } from "@multi-agent/types";
import { EditorToolbar } from "../apps/web/src/components/workflow/EditorToolbar";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { renderUi } from "./renderUi";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe("supervisor execution gate", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: {
        ...createEmptyDefinition("Gated"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: { category: "hierarchical-supervisor", humanApprovalGateRequired: true },
      },
      loadState: "ready",
      issues: [{
        id: "missing-hub",
        code: "MISSING_SUPERVISOR_HUB",
        severity: "error",
        message: "Hierarchical supervisor workflow requires 'supervisorHubNodeId' in archetypeConfig.",
      }],
    });
  });

  test("disables Run while supervisor validation errors exist and focuses the hub field", async () => {
    const view = await renderUi(createElement(ReactFlowProvider, null, createElement(EditorToolbar)));
    const run = [...view.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Run"));
    expect(run?.hasAttribute("disabled")).toBe(true);
    const validate = [...view.container.querySelectorAll("button")].find((button) => button.textContent?.includes("Validate"));
    validate?.click();
    expect(useWorkflowStore.getState().focusedIssueCode).toBe("MISSING_SUPERVISOR_HUB");
    expect(useWorkflowStore.getState().selectedNodeIds).toEqual([]);
    await view.unmount();
  });
});
