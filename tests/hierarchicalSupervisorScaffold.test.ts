import { createEmptyDefinition } from "@multi-agent/types";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import {
  scaffoldAutonomousSwarm,
  scaffoldEvaluatorOptimizer,
  scaffoldHierarchicalSupervisor,
} from "../apps/server/src/api/studio/topologyScaffolds";

const EMPTY_CANVAS_CODES = new Set([
  "MISSING_SUPERVISOR_HUB",
  "MISSING_ROUTING_NODES",
  "MISSING_APPROVAL_GATE",
]);

describe("hierarchical supervisor create scaffold (015)", () => {
  test("scaffold clears empty-canvas structural codes and sets hub", () => {
    const def = scaffoldHierarchicalSupervisor(createEmptyDefinition("Hier"));
    const issues = validateWorkflow(def, []);
    const codes = issues.map((issue) => issue.code);
    for (const code of EMPTY_CANVAS_CODES) {
      expect(codes).not.toContain(code);
    }
    expect(def.archetype).toBe("hierarchical-supervisor");
    expect(def.archetypeConfig?.category).toBe("hierarchical-supervisor");
    expect(def.archetypeConfig?.supervisorHubNodeId).toBeTruthy();
    const hub = def.nodes.find((n) => n.id === def.archetypeConfig?.supervisorHubNodeId);
    expect(hub?.type).toBe("agent");
    expect(def.nodes.some((n) => n.type === "condition")).toBe(true);
    expect(def.nodes.some((n) => n.type === "approval")).toBe(true);
    expect(def.nodes.some((n) => n.type === "input")).toBe(true);
    expect(def.nodes.some((n) => n.type === "output")).toBe(true);
    expect(codes).not.toContain("UNGUARDED_CYCLE");
  });

  test("EO and swarm scaffolds still validate without their empty-canvas traps", () => {
    const eo = scaffoldEvaluatorOptimizer(createEmptyDefinition("EO"));
    const swarm = scaffoldAutonomousSwarm(createEmptyDefinition("Swarm"));
    expect(
      validateWorkflow(eo, []).some((issue) => issue.code.startsWith("EVALUATOR_OPTIMIZER_")),
    ).toBe(false);
    expect(validateWorkflow(swarm, []).some((issue) => issue.code === "SWARM_BOUNDS_REQUIRED")).toBe(
      false,
    );
  });
});
