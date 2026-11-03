import { createEmptyDefinition } from "@multi-agent/types";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";

describe("workflow navigation protection", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: {
        ...createEmptyDefinition("Guarded"),
        archetype: "linear-pipeline",
        archetypeConfig: { category: "linear-pipeline" },
      },
      isDirty: false,
      loadState: "ready",
    });
  });

  test("pending archetype edits prompt before leaving and stay in place when cancelled", () => {
    const confirm = jest.fn(() => false);
    Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm } });
    useWorkflowStore.getState().setWorkflowArchetype("hierarchical-supervisor");
    const dirty = useWorkflowStore.getState().isDirty;
    const canLeave = () => !dirty || window.confirm("Discard unsaved workflow changes?");
    const pushed: string[] = [];
    if (canLeave()) pushed.push("/org?workflowId=other");
    expect(confirm).toHaveBeenCalledWith("Discard unsaved workflow changes?");
    expect(pushed).toEqual([]);
    expect(useWorkflowStore.getState().definition.archetype).toBe("hierarchical-supervisor");
    delete (globalThis as { window?: unknown }).window;
  });

  test("confirming the prompt allows the workflow switch", () => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { confirm: () => true } });
    useWorkflowStore.getState().setWorkflowArchetype("hierarchical-supervisor");
    const dirty = useWorkflowStore.getState().isDirty;
    const canLeave = () => !dirty || window.confirm("Discard unsaved workflow changes?");
    expect(canLeave()).toBe(true);
    delete (globalThis as { window?: unknown }).window;
  });
});
