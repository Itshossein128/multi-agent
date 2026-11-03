import * as fs from "node:fs";
import * as path from "node:path";
import {
  createEdge,
  createEmptyDefinition,
  createNode,
  serializeWorkflowDefinition,
  validateAgainstSchema,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { validateWorkflow } from "../apps/web/src/lib/workflow/validation";
import { archetypeImportError } from "../apps/web/src/components/workflow/WorkflowSwitcher";
import { workflowService } from "../apps/web/src/services/workflowService";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";

const schema = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, "../specs/009-dual-mode-orchestration/contracts/workflow-archetype.schema.json"),
  "utf8",
));

function cyclicLegacy(): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const agent = createNode("agent", { x: 100, y: 0 });
  return {
    ...createEmptyDefinition("Legacy"),
    id: "wf-mw08286f-97zear",
    nodes: [input, agent],
    edges: [
      createEdge({ source: input.id, target: agent.id }),
      createEdge({ source: agent.id, target: input.id }),
    ],
  };
}

describe("workflow archetype persistence and legacy compatibility", () => {
  test("untyped workflows display as linear and skip strict cycle errors until promoted", () => {
    const legacy = cyclicLegacy();
    delete legacy.archetype;
    delete legacy.archetypeConfig;
    expect(validateWorkflow(legacy, []).some((issue) => issue.code === "LINEAR_PIPELINE_CYCLE_FORBIDDEN")).toBe(false);

    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition: legacy,
      loadState: "ready",
      isDirty: false,
    });
    useWorkflowStore.getState().setWorkflowArchetype("linear-pipeline");
    const promoted = useWorkflowStore.getState().definition;
    expect(promoted.archetype).toBe("linear-pipeline");
    expect(promoted.archetypeConfig?.category).toBe("linear-pipeline");
    expect(validateWorkflow(promoted, []).some((issue) => issue.code === "LINEAR_PIPELINE_CYCLE_FORBIDDEN")).toBe(true);
  });

  test("a category-only definition validates as that category", () => {
    const definition = cyclicLegacy();
    delete definition.archetype;
    definition.archetypeConfig = { category: "hierarchical-supervisor", supervisorHubNodeId: definition.nodes[1].id };
    const codes = validateWorkflow(definition, []).map((issue) => issue.code);
    expect(codes).not.toContain("LINEAR_PIPELINE_CYCLE_FORBIDDEN");
    expect(codes).toContain("MISSING_ROUTING_NODES");
  });

  test("export keeps archetype fields and import rejects an unknown category", () => {
    const definition: WorkflowDefinition = {
      ...createEmptyDefinition("Exported"),
      id: "wf-export",
      archetype: "hierarchical-supervisor",
      archetypeConfig: { category: "hierarchical-supervisor", maxExecutionSteps: 1000, humanApprovalGateRequired: true },
      nodes: [createNode("input", { x: 0, y: 0 }), createNode("output", { x: 120, y: 0 })],
    };
    const serialized = serializeWorkflowDefinition(definition);
    expect(serialized.archetype).toBe("hierarchical-supervisor");
    expect(serialized.archetypeConfig).toEqual(definition.archetypeConfig);
    expect(validateAgainstSchema(schema, serialized).valid).toBe(true);

    const invalid = { ...serialized, archetype: "mesh" as WorkflowDefinition["archetype"] };
    expect(validateAgainstSchema(schema, invalid).valid).toBe(false);
    expect(archetypeImportError(invalid)).toMatch(/Unrecognized workflow archetype/);
  });

  test("a failed save keeps the dirty draft and surfaces the error", async () => {
    const definition = { ...createEmptyDefinition("Dirty"), archetype: "linear-pipeline" as const, archetypeConfig: { category: "linear-pipeline" as const } };
    useWorkflowStore.setState({
      ...useWorkflowStore.getInitialState(),
      definition,
      isDirty: true,
      loadState: "ready",
      saveError: null,
    });
    const spy = jest.spyOn(workflowService, "saveWorkflow").mockRejectedValue(new Error("Workflow failed server validation: LINEAR_PIPELINE_CYCLE_FORBIDDEN"));
    await useWorkflowStore.getState().saveWorkflow();
    expect(useWorkflowStore.getState().saveError).toMatch(/LINEAR_PIPELINE_CYCLE_FORBIDDEN/);
    expect(useWorkflowStore.getState().isDirty).toBe(true);
    expect(useWorkflowStore.getState().definition).toEqual(definition);
    spy.mockRestore();
  });
});
