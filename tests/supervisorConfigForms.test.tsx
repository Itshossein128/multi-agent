/**
 * @jest-environment jsdom
 */
import { act, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAgentRecord, createNode } from "@multi-agent/types";
import { OrgProvider } from "../apps/web/src/components/organization/OrgProvider";
import { Overview } from "../apps/web/src/components/workflow/properties/panels";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { createEmptyDefinition } from "@multi-agent/types";
import { renderUi, setInputValue, setSelectValue } from "./renderUi";

function renderOverview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (children: ReactNode) => (
    <QueryClientProvider client={client}>
      <OrgProvider org={{ id: "tenant-a", slug: "pga", name: "PGA", role: "admin" }} organizations={[]}>
        {children}
      </OrgProvider>
    </QueryClientProvider>
  );
  return renderUi(tree(<Overview />));
}

describe("supervisor configuration forms", () => {
  const lead = { ...createAgentRecord({ name: "Triage Lead", model: "gpt-4o" }), id: "lead", tenantId: "tenant-a" };
  const outsider = { ...createAgentRecord({ name: "Other Org", model: "gpt-4o" }), id: "outsider", tenantId: "tenant-b" };

  beforeEach(() => {
    const hub = createNode("agent", { x: 0, y: 0 }, { agentId: lead.id });
    const foreign = createNode("agent", { x: 40, y: 40 }, { agentId: outsider.id });
    const condition = createNode("condition", { x: 80, y: 0 });
    condition.config = { branches: [{ key: "implement_fix", label: "Fix" }, { key: "loop_limit_exceeded", label: "Exit" }] };
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: {
        ...createEmptyDefinition("Supervisor forms"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: {
          category: "hierarchical-supervisor",
          supervisorHubNodeId: hub.id,
          maxExecutionSteps: 1000,
          humanApprovalGateRequired: true,
          recursionGuards: [],
        },
        nodes: [hub, foreign, condition],
        edges: [],
      },
      agents: [lead, outsider],
      loadState: "ready",
      isDirty: false,
    });
    useWorkflowStore.setState({ issues: [] });
  });

  test("lists only tenant agent nodes and reports a deleted hub", async () => {
    const view = await renderUi((() => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return (
        <QueryClientProvider client={client}>
          <OrgProvider org={{ id: "tenant-a", slug: "pga", name: "PGA", role: "admin" }} organizations={[]}>
            <Overview />
          </OrgProvider>
        </QueryClientProvider>
      );
    })());
    const hub = view.container.querySelector<HTMLSelectElement>("#supervisor-hub-select")!;
    const labels = [...hub.options].map((option) => option.textContent);
    expect(labels.some((label) => label?.includes("Triage Lead"))).toBe(true);
    expect(labels.some((label) => label?.includes("Other Org"))).toBe(false);

    const hubId = useWorkflowStore.getState().definition.archetypeConfig?.supervisorHubNodeId!;
    await act(async () => {
      useWorkflowStore.getState().removeNodes([hubId]);
    });
    expect(view.container.textContent).toContain("Selected hub node missing from canvas or not an agent");
    expect(view.container.querySelector("#supervisor-hub-select")?.className).toContain("border-red-500");
    await view.unmount();
  });

  test("adds, clamps, and deletes recursion guards and execution limits", async () => {
    const view = await renderOverview();
    const add = [...view.container.querySelectorAll("button")].find((button) => button.textContent === "Add guard");
    await act(async () => { add?.click(); });
    expect(useWorkflowStore.getState().definition.archetypeConfig?.recursionGuards?.[0]).toMatchObject({
      routeKey: "feedback_loop",
      maxIterations: 3,
      fallbackBranch: "loop_limit_exceeded",
    });

    const iterations = view.container.querySelector<HTMLInputElement>('input[aria-label="Guard 1 max iterations"]')!;
    await setInputValue(iterations, "40");
    expect(useWorkflowStore.getState().definition.archetypeConfig?.recursionGuards?.[0].maxIterations).toBe(10);

    const steps = view.container.querySelector<HTMLInputElement>("#max-execution-steps")!;
    await setInputValue(steps, "9000");
    expect(useWorkflowStore.getState().definition.archetypeConfig?.maxExecutionSteps).toBe(5000);

    const fallback = view.container.querySelector<HTMLSelectElement>("#recursion-guard-fallback-0")!;
    const fallbackLabels = [...fallback.options].map((option) => option.value);
    expect(fallbackLabels).toEqual(expect.arrayContaining(["implement_fix", "loop_limit_exceeded"]));
    await setSelectValue(fallback, "implement_fix");
    expect(useWorkflowStore.getState().definition.archetypeConfig?.recursionGuards?.[0].fallbackBranch).toBe("implement_fix");

    const approval = view.container.querySelector<HTMLInputElement>("#human-approval-gate")!;
    expect(approval.checked).toBe(true);
    await act(async () => { approval.click(); });
    expect(useWorkflowStore.getState().definition.archetypeConfig?.humanApprovalGateRequired).toBe(false);

    await act(async () => {
      view.container.querySelector<HTMLButtonElement>('button[aria-label="Delete guard 1"]')?.click();
    });
    expect(useWorkflowStore.getState().definition.archetypeConfig?.recursionGuards).toEqual([]);
    await view.unmount();
  });
});
