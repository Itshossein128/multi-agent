/**
 * @jest-environment jsdom
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAgentRecord, createEmptyDefinition, createNode, type WorkflowDefinition } from "@multi-agent/types";
import { OrgProvider, type OrgInfo } from "../apps/web/src/components/organization/OrgProvider";
import { Overview } from "../apps/web/src/components/workflow/properties/panels";
import { workflowService } from "../apps/web/src/services/workflowService";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { renderUi } from "./renderUi";

function supervisorDefinition(): WorkflowDefinition {
  const hub = createNode("agent", { x: 0, y: 0 }, { agentId: "local-agent" });
  return {
    ...createEmptyDefinition("Access"),
    archetype: "hierarchical-supervisor",
    archetypeConfig: {
      category: "hierarchical-supervisor",
      supervisorHubNodeId: hub.id,
      humanApprovalGateRequired: true,
      maxExecutionSteps: 1000,
      recursionGuards: [{ routeKey: "feedback_loop", maxIterations: 3, fallbackBranch: "loop_limit_exceeded" }],
    },
    nodes: [hub],
    edges: [],
  };
}

function renderAs(role: OrgInfo["role"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <OrgProvider org={{ id: "tenant-a", slug: "pga", name: "PGA", role }} organizations={[]}>
        {children}
      </OrgProvider>
    </QueryClientProvider>
  );
  return renderUi(tree(<Overview />));
}

describe("workflow archetype access", () => {
  beforeEach(() => {
    const local = { ...createAgentRecord({ name: "Local", model: "gpt-4o" }), id: "local-agent", tenantId: "tenant-a" };
    const foreign = { ...createAgentRecord({ name: "Foreign", model: "gpt-4o" }), id: "foreign-agent", tenantId: "tenant-b" };
    const foreignNode = createNode("agent", { x: 40, y: 0 }, { agentId: foreign.id });
    const definition = supervisorDefinition();
    definition.nodes = [...definition.nodes, foreignNode];
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition,
      agents: [local, foreign],
      loadState: "ready",
      isDirty: false,
      selectedNodeIds: ["stale-node"],
      selectedEdgeIds: ["stale-edge"],
      saveError: "previous",
      issues: [{ id: "stale", severity: "error", message: "stale", code: "MISSING_SUPERVISOR_HUB" }],
    });
  });

  test("viewer controls are read-only and writers stay interactive", async () => {
    const viewer = await renderAs("viewer");
    expect(viewer.container.querySelector<HTMLSelectElement>("#archetype-selector")?.disabled).toBe(true);
    expect(viewer.container.querySelector<HTMLSelectElement>("#supervisor-hub-select")?.disabled).toBe(true);
    expect(viewer.container.querySelector<HTMLInputElement>("#human-approval-gate")?.disabled).toBe(true);
    expect(viewer.container.querySelector("#archetype-selector")?.getAttribute("aria-label")).toBe("Active archetype");
    await viewer.unmount();

    for (const role of ["member", "admin", "owner"] as const) {
      const view = await renderAs(role);
      expect(view.container.querySelector<HTMLSelectElement>("#archetype-selector")?.disabled).toBe(false);
      await view.unmount();
    }
  });

  test("hub options are limited to the active tenant and loading another workflow clears stale state", async () => {
    const view = await renderAs("owner");
    const labels = [...view.container.querySelectorAll<HTMLOptionElement>("#supervisor-hub-select option")].map((option) => option.textContent);
    expect(labels.some((label) => label?.includes("Local"))).toBe(true);
    expect(labels.some((label) => label?.includes("Foreign"))).toBe(false);
    expect(view.container.querySelector("[role='alert'], [aria-invalid]")).toBeTruthy();
    await view.unmount();

    const other = { ...createEmptyDefinition("Other"), id: "wf-other", archetype: "linear-pipeline" as const };
    jest.spyOn(workflowService, "getWorkflow").mockResolvedValue(other);
    jest.spyOn(workflowService, "listAgents").mockResolvedValue([]);
    jest.spyOn(workflowService, "listTools").mockResolvedValue([]);
    await useWorkflowStore.getState().loadWorkflow(other.id);
    const state = useWorkflowStore.getState();
    expect(state.definition.id).toBe("wf-other");
    expect(state.selectedNodeIds).toEqual([]);
    expect(state.selectedEdgeIds).toEqual([]);
    expect(state.saveError).toBeNull();
    expect(state.issues.every((issue) => issue.code !== "MISSING_SUPERVISOR_HUB")).toBe(true);
    jest.restoreAllMocks();
  });
});
