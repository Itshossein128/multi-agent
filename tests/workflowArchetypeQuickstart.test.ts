/**
 * Automated walkthrough of the seven quickstart scenarios.
 * Browser clicks are represented by the same store, validation, and HTTP boundaries the UI uses.
 */
import { createAgentRecord, createEdge, createNode, resolveWorkflowArchetype, type WorkflowDefinition } from "@multi-agent/types";
import { validateWorkflow } from "../apps/web/src/lib/workflow/validation";
import { formatArchetypeLabel } from "../apps/web/src/components/workflow/WorkflowSwitcher";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import { createTestStudioService } from "./fixtures/studioService";

const lead = { ...createAgentRecord({ name: "Triage Lead", model: "gpt-4o" }), id: "lead-agent" };

function blocking(definition: WorkflowDefinition) {
  return validateWorkflow(definition, [lead]).filter((issue) => issue.severity === "error");
}

describe("quickstart archetype scenarios", () => {
  test("scenario 1 creates and reloads a linear pipeline", async () => {
    const { service } = createTestStudioService();
    const created = await service.createWorkflow("Customer Intake Pipeline", "linear-pipeline");
    expect(formatArchetypeLabel(resolveWorkflowArchetype(created))).toBe("Linear Pipeline");
    const reloaded = await service.getWorkflow(created.id);
    expect(reloaded?.archetype).toBe("linear-pipeline");
    expect(reloaded?.archetypeConfig?.category).toBe("linear-pipeline");
  });

  test("scenario 2 configures a supervisor and stays blocked until the approval gate is satisfied", async () => {
    const { service } = createTestStudioService();
    const created = await service.createWorkflow("Bug Triaging & Remediation", "hierarchical-supervisor");
    expect(formatArchetypeLabel(resolveWorkflowArchetype(created))).toBe("Hierarchical Supervisor");
    expect(blocking(created).some((issue) => issue.code === "MISSING_SUPERVISOR_HUB")).toBe(true);

    const hub = createNode("agent", { x: 0, y: 0 }, { agentId: lead.id });
    const condition = createNode("condition", { x: 160, y: 0 });
    condition.config = { branches: [{ key: "implement_fix", label: "Fix" }, { key: "loop_limit_exceeded", label: "Exit" }] };
    const output = createNode("output", { x: 320, y: 0 });
    const approval = createNode("approval", { x: 160, y: 120 });
    const wired: WorkflowDefinition = {
      ...created,
      nodes: [hub, condition, approval, output],
      edges: [
        createEdge({ source: hub.id, target: condition.id }),
        createEdge({ source: condition.id, target: approval.id, kind: "conditional", branchKey: "implement_fix" }),
        createEdge({ source: condition.id, target: output.id, kind: "conditional", branchKey: "loop_limit_exceeded" }),
      ],
      archetypeConfig: {
        ...created.archetypeConfig!,
        category: "hierarchical-supervisor",
        supervisorHubNodeId: hub.id,
        maxExecutionSteps: 1000,
        recursionGuards: [{ routeKey: "qa_verify->implement_fix", maxIterations: 3, fallbackBranch: "loop_limit_exceeded" }],
      },
    };
    expect(blocking(wired).some((issue) => ["MISSING_SUPERVISOR_HUB", "UNGUARDED_CYCLE", "FALLBACK_NOT_WIRED", "MISSING_APPROVAL_GATE"].includes(issue.code ?? ""))).toBe(false);
    const saved = await service.saveWorkflow(wired);
    expect(saved.archetypeConfig?.supervisorHubNodeId).toBe(hub.id);
    expect(saved.archetypeConfig?.maxExecutionSteps).toBe(1000);
    expect(saved.archetypeConfig?.recursionGuards?.[0].maxIterations).toBe(3);
  });

  test("scenarios 3 and 4 convert without data loss and flag linear cycles", () => {
    const input = createNode("input", { x: 0, y: 0 });
    const a = createNode("agent", { x: 80, y: 0 });
    const b = createNode("agent", { x: 160, y: 0 });
    const output = createNode("output", { x: 240, y: 0 });
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: {
        ...createdShape("Line"),
        archetype: "linear-pipeline",
        archetypeConfig: { category: "linear-pipeline" },
        nodes: [input, a, b, output],
        edges: [
          createEdge({ source: input.id, target: a.id }),
          createEdge({ source: a.id, target: b.id }),
          createEdge({ source: b.id, target: output.id }),
        ],
      },
      isDirty: false,
      loadState: "ready",
    });
    useWorkflowStore.getState().setWorkflowArchetype("hierarchical-supervisor");
    expect(useWorkflowStore.getState().isDirty).toBe(true);
    expect(useWorkflowStore.getState().definition.nodes).toHaveLength(4);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().definition.archetype).toBe("linear-pipeline");

    const hub = createNode("agent", { x: 0, y: 0 });
    const condition = createNode("condition", { x: 100, y: 0 });
    useWorkflowStore.setState({
      definition: {
        ...createdShape("Cycle"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: {
          category: "hierarchical-supervisor",
          supervisorHubNodeId: hub.id,
          recursionGuards: [{ routeKey: "loop->yes", maxIterations: 2, fallbackBranch: "no" }],
          humanApprovalGateRequired: false,
        },
        nodes: [hub, condition],
        edges: [
          createEdge({ source: hub.id, target: condition.id }),
          createEdge({ source: condition.id, target: hub.id, kind: "conditional", branchKey: "yes" }),
        ],
      },
    });
    useWorkflowStore.getState().setWorkflowArchetype("linear-pipeline");
    const converted = useWorkflowStore.getState().definition;
    expect(converted.archetypeConfig?.supervisorHubNodeId).toBe(hub.id);
    expect(validateWorkflow(converted, []).some((issue) => issue.code === "LINEAR_PIPELINE_CYCLE_FORBIDDEN")).toBe(true);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().definition.archetype).toBe("hierarchical-supervisor");
  });

  test("scenario 5 clears a deleted hub and restores it with undo", () => {
    const hub = createNode("agent", { x: 0, y: 0 }, { agentId: lead.id });
    hub.id = "lead-agent";
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      agents: [lead],
      loadState: "ready",
      definition: {
        ...createdShape("Hub"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: { category: "hierarchical-supervisor", supervisorHubNodeId: hub.id, humanApprovalGateRequired: false, recursionGuards: [] },
        nodes: [hub],
        edges: [],
      },
    });
    useWorkflowStore.getState().removeNodes([hub.id]);
    expect(validateWorkflow(useWorkflowStore.getState().definition, [lead]).some((issue) => issue.code === "INVALID_SUPERVISOR_HUB")).toBe(true);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().definition.nodes.map((node) => node.id)).toContain("lead-agent");
  });

  test("scenario 6 promotes a legacy workflow and scenario 7 keeps a rejected save", async () => {
    const legacy: WorkflowDefinition = {
      ...createdShape("trigger on Azure DevOps bug submission"),
      id: "wf-mw08286f-97zear",
    };
    delete legacy.archetype;
    delete legacy.archetypeConfig;
    expect(formatArchetypeLabel(resolveWorkflowArchetype(legacy))).toBe("Linear Pipeline");
    expect(`${legacy.name} [${formatArchetypeLabel(resolveWorkflowArchetype(legacy))}]`).toBe(
      "trigger on Azure DevOps bug submission [Linear Pipeline]",
    );
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: legacy,
      isDirty: false,
      loadState: "ready",
    });
    useWorkflowStore.getState().setWorkflowArchetype("linear-pipeline");
    expect(useWorkflowStore.getState().definition.archetype).toBe("linear-pipeline");

    const { service } = createTestStudioService();
    const created = await service.createWorkflow("Guarded save", "hierarchical-supervisor");
    const cyclic = {
      ...created,
      nodes: [createNode("agent", { x: 0, y: 0 }), createNode("agent", { x: 40, y: 0 })],
    };
    cyclic.nodes[0].id = "a";
    cyclic.nodes[1].id = "b";
    cyclic.archetype = "linear-pipeline";
    cyclic.archetypeConfig = { category: "linear-pipeline" };
    cyclic.edges = [createEdge({ source: "a", target: "b" }), createEdge({ source: "b", target: "a" })];
    await expect(service.saveWorkflow(cyclic)).rejects.toThrow(/LINEAR_PIPELINE_CYCLE_FORBIDDEN/);
  });
});

function createdShape(name: string): WorkflowDefinition {
  return {
    id: `wf-${name.replace(/\s+/g, "-").toLowerCase()}`,
    schemaVersion: 2,
    name,
    nodes: [],
    edges: [],
    updatedAt: new Date().toISOString(),
  };
}
