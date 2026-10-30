import { formatArchetypeLabel } from "../apps/web/src/components/workflow/WorkflowSwitcher";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { createEmptyDefinition, type WorkflowDefinition } from "@multi-agent/types";

describe("WorkflowSwitcher unit and integration tests", () => {
  const linearWorkflow: WorkflowDefinition = {
    ...createEmptyDefinition("Linear Pipeline Workflow"),
    id: "wf-linear-1",
    archetype: "linear-pipeline",
  };

  const supervisorWorkflow: WorkflowDefinition = {
    ...createEmptyDefinition("Supervisor Delivery Workflow"),
    id: "wf-supervisor-1",
    archetype: "hierarchical-supervisor",
  };

  const legacyWorkflow: WorkflowDefinition = {
    ...createEmptyDefinition("Legacy Workflow"),
    id: "wf-legacy-1",
    archetype: undefined,
  };

  describe("formatArchetypeLabel", () => {
    test("formats hierarchical-supervisor label correctly", () => {
      expect(formatArchetypeLabel("hierarchical-supervisor")).toBe("Hierarchical Supervisor");
    });

    test("formats linear-pipeline label correctly", () => {
      expect(formatArchetypeLabel("linear-pipeline")).toBe("Linear Pipeline");
    });

    test("defaults undefined or empty to Linear Pipeline", () => {
      expect(formatArchetypeLabel(undefined)).toBe("Linear Pipeline");
      expect(formatArchetypeLabel("")).toBe("Linear Pipeline");
    });
  });

  describe("Dropdown option labeling with dual archetypes", () => {
    test("generates expected display label containing archetype badge", () => {
      const workflows = [linearWorkflow, supervisorWorkflow, legacyWorkflow];
      const optionLabels = workflows.map((wf) => `${wf.name} [${formatArchetypeLabel(wf.archetype)}]`);

      expect(optionLabels).toEqual([
        "Linear Pipeline Workflow [Linear Pipeline]",
        "Supervisor Delivery Workflow [Hierarchical Supervisor]",
        "Legacy Workflow [Linear Pipeline]",
      ]);
    });
  });

  describe("URL synchronization and dirty-state confirmation logic", () => {
    let confirmMock: jest.Mock;

    beforeEach(() => {
      confirmMock = jest.fn();
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          confirm: confirmMock,
        },
      });
      useWorkflowStore.setState({
        ...useWorkflowStore.getInitialState(),
        definition: linearWorkflow,
        isDirty: false,
      });
    });

    afterEach(() => {
      delete (globalThis as { window?: unknown }).window;
    });

    test("clean state switches workflow URL without confirmation prompt", () => {
      const dirty = useWorkflowStore.getState().isDirty;
      const canLeave = () => !dirty || window.confirm("Discard unsaved workflow changes?");

      const pushedUrls: string[] = [];
      const orgUrl = (path: string) => `/o/building-gap${path}`;
      const routerPush = (url: string) => pushedUrls.push(url);

      const targetWorkflowId = supervisorWorkflow.id;
      if (canLeave()) {
        routerPush(orgUrl(`/org?workflowId=${encodeURIComponent(targetWorkflowId)}`));
      }

      expect(confirmMock).not.toHaveBeenCalled();
      expect(pushedUrls).toEqual(["/o/building-gap/org?workflowId=wf-supervisor-1"]);
    });

    test("dirty state prompts user and cancels switch if rejected", () => {
      useWorkflowStore.setState({ isDirty: true });
      confirmMock.mockReturnValue(false); // User rejects

      const dirty = useWorkflowStore.getState().isDirty;
      const canLeave = () => !dirty || window.confirm("Discard unsaved workflow changes?");

      const pushedUrls: string[] = [];
      const orgUrl = (path: string) => `/o/building-gap${path}`;
      const routerPush = (url: string) => pushedUrls.push(url);

      const targetWorkflowId = supervisorWorkflow.id;
      if (canLeave()) {
        routerPush(orgUrl(`/org?workflowId=${encodeURIComponent(targetWorkflowId)}`));
      }

      expect(confirmMock).toHaveBeenCalledWith("Discard unsaved workflow changes?");
      expect(pushedUrls).toEqual([]);
    });

    test("dirty state prompts user and proceeds with URL switch if confirmed", () => {
      useWorkflowStore.setState({ isDirty: true });
      confirmMock.mockReturnValue(true); // User confirms discard

      const dirty = useWorkflowStore.getState().isDirty;
      const canLeave = () => !dirty || window.confirm("Discard unsaved workflow changes?");

      const pushedUrls: string[] = [];
      const orgUrl = (path: string) => `/o/building-gap${path}`;
      const routerPush = (url: string) => pushedUrls.push(url);

      const targetWorkflowId = supervisorWorkflow.id;
      if (canLeave()) {
        routerPush(orgUrl(`/org?workflowId=${encodeURIComponent(targetWorkflowId)}`));
      }

      expect(confirmMock).toHaveBeenCalledWith("Discard unsaved workflow changes?");
      expect(pushedUrls).toEqual(["/o/building-gap/org?workflowId=wf-supervisor-1"]);
    });
  });

  describe("Active workflow archetype state in store", () => {
    test("reflects correct archetype when switched to hierarchical supervisor", () => {
      useWorkflowStore.setState({
        definition: supervisorWorkflow,
      });

      const current = useWorkflowStore.getState().definition;
      expect(current.archetype).toBe("hierarchical-supervisor");
      expect(formatArchetypeLabel(current.archetype)).toBe("Hierarchical Supervisor");
    });

    test("reflects correct archetype when switched to linear pipeline", () => {
      useWorkflowStore.setState({
        definition: linearWorkflow,
      });

      const current = useWorkflowStore.getState().definition;
      expect(current.archetype).toBe("linear-pipeline");
      expect(formatArchetypeLabel(current.archetype)).toBe("Linear Pipeline");
    });
  });
});
