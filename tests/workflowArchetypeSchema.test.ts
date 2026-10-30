import * as fs from "node:fs";
import * as path from "node:path";
import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  validateAgainstSchema,
  createLinearPipelineConfig,
  createHierarchicalSupervisorConfig,
  createRecursionGuard,
  isHierarchicalSupervisor,
  isLinearPipeline,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";

describe("Workflow Archetype Schema and Contract Validation", () => {
  const schemaPath = path.resolve(
    __dirname,
    "../specs/009-dual-mode-orchestration/contracts/workflow-archetype.schema.json"
  );
  const archetypeSchema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

  const testAgent = {
    ...createAgentRecord({ name: "Lead Orchestrator", model: "gpt-4o" }),
    id: "agent-supervisor",
  };
  const workerAgent = {
    ...createAgentRecord({ name: "Worker Agent", model: "gpt-4o" }),
    id: "agent-worker",
  };

  function createValidLinearWorkflow(): WorkflowDefinition {
    const input = createNode("input", { x: 0, y: 0 });
    const agent = createNode("agent", { x: 200, y: 0 }, { agentId: workerAgent.id });
    const output = createNode("output", { x: 400, y: 0 });
    return {
      id: "linear-spec-pipeline",
      name: "Linear Spec-to-Code Pipeline",
      schemaVersion: 2,
      archetype: "linear-pipeline",
      archetypeConfig: createLinearPipelineConfig(),
      nodes: [input, agent, output],
      edges: [
        createEdge({ source: input.id, target: agent.id }),
        createEdge({ source: agent.id, target: output.id }),
      ],
      updatedAt: new Date().toISOString(),
    };
  }

  function createValidSupervisorWorkflow(): WorkflowDefinition {
    const input = createNode("input", { x: 0, y: 0 });
    const supervisor = createNode("agent", { x: 200, y: 0 }, { agentId: testAgent.id });
    supervisor.id = "agent-supervisor";
    const condition = createNode("condition", { x: 400, y: 0 });
    condition.config = {
      branches: [
        { key: "implement_spec", label: "Implement Spec" },
        { key: "complete", label: "Complete" },
      ],
    };
    const worker = createNode("agent", { x: 600, y: 0 }, { agentId: workerAgent.id });
    const output = createNode("output", { x: 800, y: 0 });

    return {
      id: "supervisor-gap-delivery-workflow",
      name: "Hierarchical Supervisor Workflow",
      schemaVersion: 2,
      archetype: "hierarchical-supervisor",
      archetypeConfig: createHierarchicalSupervisorConfig("agent-supervisor", {
        recursionGuards: [
          createRecursionGuard("qa_verify->implement_spec", "loop_limit_exceeded", 3),
        ],
      }),
      nodes: [input, supervisor, condition, worker, output],
      edges: [
        createEdge({ source: input.id, target: supervisor.id }),
        createEdge({ source: supervisor.id, target: condition.id }),
        createEdge({ source: condition.id, target: worker.id, kind: "conditional", branchKey: "implement_spec" }),
        createEdge({ source: worker.id, target: supervisor.id }), // cycle back to supervisor
        createEdge({ source: condition.id, target: output.id, kind: "conditional", branchKey: "complete" }),
      ],
      updatedAt: new Date().toISOString(),
    };
  }

  describe("JSON Schema conformance (contracts/workflow-archetype.schema.json)", () => {
    test("validates valid linear-pipeline workflow against schema", () => {
      const workflow = createValidLinearWorkflow();
      const result = validateAgainstSchema(archetypeSchema, workflow);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test("validates valid hierarchical-supervisor workflow against schema", () => {
      const workflow = createValidSupervisorWorkflow();
      const result = validateAgainstSchema(archetypeSchema, workflow);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    });

    test("rejects invalid archetype category enum", () => {
      const workflow = {
        ...createValidLinearWorkflow(),
        archetype: "invalid-category",
      };
      const result = validateAgainstSchema(archetypeSchema, workflow);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path === "$.archetype")).toBe(true);
    });

    test("rejects out-of-bounds maxIterations in recursion guards", () => {
      const workflow = {
        ...createValidSupervisorWorkflow(),
        archetypeConfig: {
          category: "hierarchical-supervisor",
          supervisorHubNodeId: "agent-supervisor",
          recursionGuards: [
            { routeKey: "qa->engineer", maxIterations: 15, fallbackBranch: "escalate" },
          ],
        },
      };
      const result = validateAgainstSchema(archetypeSchema, workflow);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path.includes("maxIterations"))).toBe(true);
    });

    test("rejects out-of-bounds maxExecutionSteps in archetypeConfig", () => {
      const workflow = {
        ...createValidLinearWorkflow(),
        archetypeConfig: {
          category: "linear-pipeline",
          maxExecutionSteps: 6000,
        },
      };
      const result = validateAgainstSchema(archetypeSchema, workflow);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.path.includes("maxExecutionSteps"))).toBe(true);
    });
  });

  describe("Archetype-aware compiler validation (apps/server/src/compiler/validation.ts)", () => {
    test("linear-pipeline with cycles is rejected with LINEAR_PIPELINE_CYCLE_FORBIDDEN", () => {
      const workflow = createValidLinearWorkflow();
      // Add cycle between agent and itself or back to previous
      workflow.edges.push(createEdge({ source: workflow.nodes[1].id, target: workflow.nodes[1].id })); // self cycle
      const issues = validateWorkflow(workflow, [workerAgent]);
      expect(issues.some((i) => i.code === "UNSAFE_CYCLE")).toBe(true);

      const cyclicWorkflow = createValidLinearWorkflow();
      const secondAgent = createNode("agent", { x: 300, y: 0 }, { agentId: workerAgent.id });
      cyclicWorkflow.nodes.splice(2, 0, secondAgent);
      cyclicWorkflow.edges = [
        createEdge({ source: cyclicWorkflow.nodes[0].id, target: cyclicWorkflow.nodes[1].id }),
        createEdge({ source: cyclicWorkflow.nodes[1].id, target: secondAgent.id }),
        createEdge({ source: secondAgent.id, target: cyclicWorkflow.nodes[1].id }), // cycle
        createEdge({ source: secondAgent.id, target: cyclicWorkflow.nodes[3].id }),
      ];
      const cyclicIssues = validateWorkflow(cyclicWorkflow, [workerAgent]);
      expect(cyclicIssues.some((i) => i.code === "LINEAR_PIPELINE_CYCLE_FORBIDDEN")).toBe(true);
      expect(() => compileWorkflow(cyclicWorkflow, [workerAgent])).toThrow(/Linear pipeline workflows cannot contain cycles/);
    });

    test("hierarchical-supervisor missing supervisorHubNodeId produces MISSING_SUPERVISOR_HUB", () => {
      const workflow = createValidSupervisorWorkflow();
      workflow.archetypeConfig = {
        category: "hierarchical-supervisor",
      };
      const issues = validateWorkflow(workflow, [testAgent, workerAgent]);
      expect(issues.some((i) => i.code === "MISSING_SUPERVISOR_HUB")).toBe(true);
    });

    test("hierarchical-supervisor referencing non-existent supervisorHubNodeId produces INVALID_SUPERVISOR_HUB", () => {
      const workflow = createValidSupervisorWorkflow();
      workflow.archetypeConfig = {
        category: "hierarchical-supervisor",
        supervisorHubNodeId: "missing-node-id",
      };
      const issues = validateWorkflow(workflow, [testAgent, workerAgent]);
      expect(issues.some((i) => i.code === "INVALID_SUPERVISOR_HUB")).toBe(true);
    });

    test("hierarchical-supervisor referencing non-agent supervisorHubNodeId produces INVALID_SUPERVISOR_HUB", () => {
      const workflow = createValidSupervisorWorkflow();
      workflow.archetypeConfig = {
        category: "hierarchical-supervisor",
        supervisorHubNodeId: workflow.nodes[0].id, // input node, not agent
      };
      const issues = validateWorkflow(workflow, [testAgent, workerAgent]);
      expect(issues.some((i) => i.code === "INVALID_SUPERVISOR_HUB")).toBe(true);
    });

    test("hierarchical-supervisor without condition routing nodes produces MISSING_ROUTING_NODES", () => {
      const workflow = createValidSupervisorWorkflow();
      // Remove condition node
      workflow.nodes = workflow.nodes.filter((n) => n.type !== "condition");
      workflow.edges = [
        createEdge({ source: workflow.nodes[0].id, target: workflow.nodes[1].id }),
        createEdge({ source: workflow.nodes[1].id, target: workflow.nodes[2].id }),
        createEdge({ source: workflow.nodes[2].id, target: workflow.nodes[3].id }),
      ];
      const issues = validateWorkflow(workflow, [testAgent, workerAgent]);
      expect(issues.some((i) => i.code === "MISSING_ROUTING_NODES")).toBe(true);
    });

    test("hierarchical-supervisor with cycles but no recursion guards produces UNGUARDED_CYCLE", () => {
      const workflow = createValidSupervisorWorkflow();
      workflow.archetypeConfig = {
        category: "hierarchical-supervisor",
        supervisorHubNodeId: "agent-supervisor",
        recursionGuards: [],
      };
      const issues = validateWorkflow(workflow, [testAgent, workerAgent]);
      expect(issues.some((i) => i.code === "UNGUARDED_CYCLE")).toBe(true);
    });

    test("hierarchical-supervisor with valid config compiles successfully", () => {
      const workflow = createValidSupervisorWorkflow();
      const issues = validateWorkflow(workflow, [testAgent, workerAgent]);
      const errors = issues.filter((i) => i.severity === "error");
      expect(errors).toEqual([]);
      expect(() => compileWorkflow(workflow, [testAgent, workerAgent])).not.toThrow();
    });

    test("backward compatibility: workflow with undefined archetype compiles without error", () => {
      const legacyWorkflow: WorkflowDefinition = {
        ...createEmptyDefinition("Legacy Workflow"),
        archetype: undefined,
        archetypeConfig: undefined,
        nodes: [
          createNode("input", { x: 0, y: 0 }),
          createNode("agent", { x: 200, y: 0 }, { agentId: workerAgent.id }),
          createNode("output", { x: 400, y: 0 }),
        ],
        edges: [],
      };
      legacyWorkflow.edges = [
        createEdge({ source: legacyWorkflow.nodes[0].id, target: legacyWorkflow.nodes[1].id }),
        createEdge({ source: legacyWorkflow.nodes[1].id, target: legacyWorkflow.nodes[2].id }),
      ];

      const issues = validateWorkflow(legacyWorkflow, [workerAgent]);
      expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
      expect(() => compileWorkflow(legacyWorkflow, [workerAgent])).not.toThrow();
    });
  });

  describe("Helper functions", () => {
    test("isHierarchicalSupervisor and isLinearPipeline classify correctly", () => {
      expect(isHierarchicalSupervisor("hierarchical-supervisor")).toBe(true);
      expect(isHierarchicalSupervisor("linear-pipeline")).toBe(false);
      expect(isHierarchicalSupervisor({ category: "hierarchical-supervisor" })).toBe(true);
      expect(isHierarchicalSupervisor(undefined)).toBe(false);

      expect(isLinearPipeline("linear-pipeline")).toBe(true);
      expect(isLinearPipeline("hierarchical-supervisor")).toBe(false);
      expect(isLinearPipeline(undefined)).toBe(true); // default fallback
    });

    test("createRecursionGuard clamps maxIterations between 1 and 10", () => {
      const guardMin = createRecursionGuard("route", "fallback", -5);
      expect(guardMin.maxIterations).toBe(1);

      const guardMax = createRecursionGuard("route", "fallback", 100);
      expect(guardMax.maxIterations).toBe(10);

      const guardNormal = createRecursionGuard("route", "fallback", 4);
      expect(guardNormal.maxIterations).toBe(4);
    });
  });
});
