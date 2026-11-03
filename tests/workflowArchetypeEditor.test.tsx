/**
 * @jest-environment jsdom
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createNode } from "@multi-agent/types";
import { OrgProvider } from "../apps/web/src/components/organization/OrgProvider";
import { Overview } from "../apps/web/src/components/workflow/properties/panels";
import { WorkflowSwitcher } from "../apps/web/src/components/workflow/WorkflowSwitcher";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { createEmptyDefinition } from "@multi-agent/types";
import { renderUi, setSelectValue } from "./renderUi";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

function harness(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <OrgProvider org={{ id: "org-1", slug: "pga", name: "PGA", role: "member" }} organizations={[]}>
        {children}
      </OrgProvider>
    </QueryClientProvider>
  );
}

describe("workflow archetype editor", () => {
  beforeEach(() => {
    const input = createNode("input", { x: 0, y: 0 });
    const agent = createNode("agent", { x: 80, y: 0 });
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: {
        ...createEmptyDefinition("Editable"),
        archetype: "linear-pipeline",
        archetypeConfig: { category: "linear-pipeline" },
        nodes: [input, agent],
        edges: [],
      },
      loadState: "ready",
      isDirty: false,
      issues: [],
    });
  });

  test("shows the active archetype, switches it, and restores it with undo and redo", async () => {
    const view = await renderUi(harness(<><WorkflowSwitcher /><Overview /></>));
    expect(view.container.textContent).toContain("Linear Pipeline");
    expect(view.container.textContent).toContain("Sequential, deterministic multi-agent pipeline");

    const select = view.container.querySelector<HTMLSelectElement>("#archetype-selector")!;
    const beforeNodes = useWorkflowStore.getState().definition.nodes.map((node) => node.id);
    await setSelectValue(select, "hierarchical-supervisor");
    expect(useWorkflowStore.getState().isDirty).toBe(true);
    expect(useWorkflowStore.getState().definition.archetype).toBe("hierarchical-supervisor");
    expect(useWorkflowStore.getState().definition.nodes.map((node) => node.id)).toEqual(beforeNodes);
    expect(view.container.querySelector('[data-testid="workflow-archetype-badge"]')?.textContent).toContain("Hierarchical Supervisor");

    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().definition.archetype).toBe("linear-pipeline");
    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().definition.archetype).toBe("hierarchical-supervisor");
    await view.unmount();
  });

  test("adding a condition node does not change the archetype", async () => {
    useWorkflowStore.getState().addNode("condition", { x: 10, y: 10 });
    expect(useWorkflowStore.getState().definition.archetype).toBe("linear-pipeline");
  });
});
