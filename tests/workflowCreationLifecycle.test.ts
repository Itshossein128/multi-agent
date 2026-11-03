import { createTestStudioService } from "./fixtures/studioService";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";

describe("workflow creation lifecycle", () => {
  test("persists the selected archetype and the store loads that definition", async () => {
    const { service } = createTestStudioService();
    const created = await service.createWorkflow("Test Supervisor", "hierarchical-supervisor");
    expect(created.archetype).toBe("hierarchical-supervisor");
    expect(created.archetypeConfig?.category).toBe("hierarchical-supervisor");
    expect(created.name).toBe("Test Supervisor");

    const loaded = await service.getWorkflow(created.id);
    expect(loaded?.archetype).toBe("hierarchical-supervisor");

    const linear = await service.createWorkflow("Customer Intake Pipeline", "linear-pipeline");
    expect(linear.archetype).toBe("linear-pipeline");
    expect(linear.archetypeConfig?.category).toBe("linear-pipeline");

    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: loaded!,
      loadState: "ready",
      isDirty: false,
    });
    expect(useWorkflowStore.getState().definition.archetype).toBe("hierarchical-supervisor");
    expect(useWorkflowStore.getState().definition.id).toBe(created.id);
  });

  test("rejects an archetype that does not match archetypeConfig.category", async () => {
    const { service } = createTestStudioService();
    const created = await service.createWorkflow("Conflict", "linear-pipeline");
    await expect(service.saveWorkflow({
      ...created,
      archetype: "linear-pipeline",
      archetypeConfig: { ...created.archetypeConfig!, category: "hierarchical-supervisor" },
    })).rejects.toThrow("Workflow archetype must match archetypeConfig.category");
  });
});
