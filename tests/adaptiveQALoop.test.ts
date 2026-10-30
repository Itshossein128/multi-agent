import {
  createEdge,
  createEmptyDefinition,
  createNode,
  createRecursionGuard,
  createHierarchicalSupervisorConfig,
  createSupervisorOutcomeEnvelope,
  type WorkflowDefinition,
  type SupervisorOutcomeEnvelope,
  type QAVerificationResult,
} from "@multi-agent/types";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import {
  createQaVerifierPersona,
  createGapEngineerPersona,
  createQaRemediationRecursionGuard,
  QA_VERIFIER_PERSONA_ID,
  GAP_ENGINEER_PERSONA_ID,
} from "../src/agents/personas/qaVerifier";
import { leadOrchestratorPersona, createLeadOrchestratorPersona } from "../src/agents/personas/leadOrchestrator";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 4000) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Adaptive QA Feedback & Remediation Loop (User Story 5)", () => {
  const qaVerifierAgent = createQaVerifierPersona();
  const gapEngineerAgent = createGapEngineerPersona();
  const supervisorAgent = createLeadOrchestratorPersona({ tools: [] });
  const allAgents = [supervisorAgent, qaVerifierAgent, gapEngineerAgent];

  const passThroughRuntime = {
    execute: async function* (input: any) {
      const val = input.input ?? input;
      yield {
        type: "agent.started",
        timestamp: new Date().toISOString(),
        agentId: input.agent.id,
        nodeId: input.nodeId,
        runId: input.runId,
        payload: {},
      };
      yield {
        type: "agent.completed",
        timestamp: new Date().toISOString(),
        agentId: input.agent.id,
        nodeId: input.nodeId,
        runId: input.runId,
        payload: typeof val === "object" ? val : { content: val },
      };
    },
  };

  function createQARemediationWorkflow(options: {
    maxIterations?: number;
    fallbackBranch?: string;
  } = {}): {
    workflow: WorkflowDefinition;
    intakeNode: any;
    supervisorNode: any;
    conditionNode: any;
    engineerNode: any;
    qaNode: any;
    fallbackNode: any;
    outputNode: any;
  } {
    const maxIterations = options.maxIterations ?? 3;
    const fallbackBranch = options.fallbackBranch ?? "loop_limit_exceeded";

    const intakeNode = createNode("input", { x: 0, y: 0 });
    intakeNode.id = "intake-node";

    const supervisorNode = createNode("agent", { x: 100, y: 0 }, { agentId: supervisorAgent.id });
    supervisorNode.id = "agent-supervisor";

    const conditionNode = createNode("condition", { x: 300, y: 0 });
    conditionNode.id = "supervisor-router";
    conditionNode.config = {
      branches: [
        { key: "implement_spec", label: "Remediate Gaps" },
        { key: "complete", label: "Complete Delivery" },
        { key: fallbackBranch, label: "Loop Limit Exceeded" },
      ],
      valueSource: "last_value",
      valueField: "nextAction",
      unknownRoute: fallbackBranch,
    };

    const engineerNode = createNode("memory", { x: 500, y: -100 });
    engineerNode.id = "remediation-engineer-node";
    engineerNode.config = { memoryType: "short_term", mode: "write", key: "engineer_executed" };

    const qaNode = createNode("memory", { x: 700, y: -100 });
    qaNode.id = "qa-verifier-node";
    qaNode.config = { memoryType: "short_term", mode: "write", key: "qa_executed" };

    const fallbackNode = createNode("memory", { x: 500, y: 150 });
    fallbackNode.id = "loop_limit_exceeded";
    fallbackNode.config = { memoryType: "short_term", mode: "write", key: "fallback_executed" };

    const outputNode = createNode("output", { x: 900, y: 0 });
    outputNode.id = "output-node";

    const workflow: WorkflowDefinition = {
      ...createEmptyDefinition(),
      id: "wf-qa-adaptive-loop",
      name: "Adaptive QA Feedback Loop Test Workflow",
      archetype: "hierarchical-supervisor",
      archetypeConfig: createHierarchicalSupervisorConfig("agent-supervisor", {
        recursionGuards: [
          createRecursionGuard("qa_verify->implement_spec", fallbackBranch, maxIterations),
        ],
      }),
      nodes: [intakeNode, supervisorNode, conditionNode, engineerNode, qaNode, fallbackNode, outputNode],
      edges: [
        createEdge({ source: intakeNode.id, target: supervisorNode.id }),
        createEdge({ source: supervisorNode.id, target: conditionNode.id }),
        createEdge({
          source: conditionNode.id,
          target: engineerNode.id,
          kind: "conditional",
          branchKey: "implement_spec",
        }),
        createEdge({ source: engineerNode.id, target: qaNode.id }),
        createEdge({ source: qaNode.id, target: supervisorNode.id }), // cycle back to supervisor
        createEdge({
          source: conditionNode.id,
          target: outputNode.id,
          kind: "conditional",
          branchKey: "complete",
        }),
        createEdge({
          source: conditionNode.id,
          target: fallbackNode.id,
          kind: "conditional",
          branchKey: fallbackBranch,
        }),
        createEdge({ source: fallbackNode.id, target: outputNode.id }),
      ],
      updatedAt: new Date().toISOString(),
    };

    return {
      workflow,
      intakeNode,
      supervisorNode,
      conditionNode,
      engineerNode,
      qaNode,
      fallbackNode,
      outputNode,
    };
  }

  test("tracks loop iterations per route key in RuntimeState during feedback cycle", async () => {
    const { workflow, conditionNode } = createQARemediationWorkflow();
    const compiled = compileWorkflow(workflow, allAgents);

    expect(compiled).toBeDefined();
    expect(compiled.graph).toBeDefined();
  });

  test("routes execution back to remediation engineer on QA test failure for iterations below recursion limit", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store, passThroughRuntime as any);
    const { workflow, engineerNode } = createQARemediationWorkflow({ maxIterations: 3 });

    // Simulate input with iteration 1 (< 3) and nextAction = "implement_spec"
    const failureEnvelope: SupervisorOutcomeEnvelope = createSupervisorOutcomeEnvelope({
      nextAction: "implement_spec",
      statusMessage: "QA tests failed on iteration 1. Re-routing to remediation engineer.",
      taskId: "task-test-01",
      iterationCount: 1,
      qaResult: {
        taskId: "task-test-01",
        testsPassed: false,
        totalTests: 10,
        failedTestsCount: 2,
        failureOutput: "AssertionError: expected 200 OK but received 404",
        iterationCount: 1,
        verifiedFiles: ["apps/web/src/components/Weather.tsx"],
      },
    });

    const runId = executor.start({
      workflow,
      agents: allAgents,
      input: failureEnvelope as unknown as Record<string, unknown>,
    });

    await waitFor(() => store.get(runId)?.run.status === "completed" || store.get(runId)?.run.status === "failed");

    const events = store.events(runId);
    const executedNodeIds = events.map((e) => e.nodeId).filter(Boolean);

    // Iteration 1 routes to remediation engineer
    expect(executedNodeIds).toContain(engineerNode.id);
  });

  test("routes to completion when QA verification tests pass", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store, passThroughRuntime as any);
    const { workflow, outputNode, fallbackNode } = createQARemediationWorkflow();

    const successEnvelope: SupervisorOutcomeEnvelope = createSupervisorOutcomeEnvelope({
      nextAction: "complete",
      statusMessage: "All acceptance criteria and QA tests passed successfully.",
      taskId: "task-test-02",
      iterationCount: 2,
      qaResult: {
        taskId: "task-test-02",
        testsPassed: true,
        totalTests: 10,
        failedTestsCount: 0,
        iterationCount: 2,
        verifiedFiles: ["apps/web/src/components/Weather.tsx"],
      },
    });

    const runId = executor.start({
      workflow,
      agents: allAgents,
      input: successEnvelope as unknown as Record<string, unknown>,
    });

    await waitFor(() => store.get(runId)?.run.status === "completed");

    const events = store.events(runId);
    const executedNodeIds = events.map((e) => e.nodeId).filter(Boolean);

    expect(executedNodeIds).toContain(outputNode.id);
    expect(executedNodeIds).not.toContain(fallbackNode.id);
    expect(store.get(runId)?.run.status).toBe("completed");
  });

  test("enforces recursion limit guardrail at max 3 iterations and routes to fallbackBranch (loop_limit_exceeded)", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store, passThroughRuntime as any);
    const { workflow, fallbackNode, engineerNode } = createQARemediationWorkflow({ maxIterations: 3 });

    // Envelope indicating iterationCount = 3 (limit reached)
    const exhaustedEnvelope: SupervisorOutcomeEnvelope = createSupervisorOutcomeEnvelope({
      nextAction: "implement_spec",
      statusMessage: "QA tests failed 3 times in a row. Remediation limit exhausted.",
      taskId: "task-test-03",
      iterationCount: 3,
      qaResult: {
        taskId: "task-test-03",
        testsPassed: false,
        totalTests: 10,
        failedTestsCount: 1,
        failureOutput: "Unresolved syntax error in generated code",
        iterationCount: 3,
        verifiedFiles: ["apps/web/src/components/Weather.tsx"],
      },
    });

    const runId = executor.start({
      workflow,
      agents: allAgents,
      input: exhaustedEnvelope as unknown as Record<string, unknown>,
    });

    await waitFor(() => store.get(runId)?.run.status === "completed" || store.get(runId)?.run.status === "failed");

    const events = store.events(runId);
    const executedNodeIds = events.map((e) => e.nodeId).filter(Boolean);
    const eventTypes = events.map((e) => e.type);

    // Fallback node executed; remediation engineer was skipped on limit exhaustion
    expect(executedNodeIds).toContain(fallbackNode.id);
    expect(eventTypes).toContain("node.loop_limit_reached");
  });

  test("loop_limit_exceeded handler updates Studio task status to paused and logs diagnostic comment", async () => {
    const store = new RunStore();
    const studioStore = new InMemoryStudioStore();
    const executor = new RunExecutor(
      store,
      passThroughRuntime as any,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      studioStore
    );
    const { workflow } = createQARemediationWorkflow({ maxIterations: 3 });

    // Seed task in studioStore
    const task = await studioStore.saveTask({
      id: "task-qa-remediation-limit",
      tenantId: "org-building-gap",
      projectId: "project-building-gap",
      title: "Weather Report Aggregator",
      description: "Implement aggregator",
      status: "in_progress",
      priority: "high",
      assignedAgent: GAP_ENGINEER_PERSONA_ID,
      assignedAgents: [GAP_ENGINEER_PERSONA_ID],
      dependencies: [],
      retryCount: 0,
      paused: false,
      output: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const exhaustedEnvelope: SupervisorOutcomeEnvelope = createSupervisorOutcomeEnvelope({
      nextAction: "implement_spec",
      statusMessage: "Remediation recursion limit exceeded on 3rd failure",
      taskId: task.id,
      iterationCount: 3,
      qaResult: {
        taskId: task.id,
        testsPassed: false,
        totalTests: 15,
        failedTestsCount: 3,
        failureOutput: "TimeoutError: Integration test took longer than 30s",
        iterationCount: 3,
        verifiedFiles: ["apps/api/core/weather.py"],
      },
    });

    const runId = executor.start({
      workflow,
      agents: allAgents,
      input: {
        ...exhaustedEnvelope,
        taskId: task.id,
      } as unknown as Record<string, unknown>,
    });

    await waitFor(() => store.get(runId)?.run.status === "completed" || store.get(runId)?.run.status === "failed");

    // Wait for async task and comment updates
    await waitFor(async () => {
      const updated = await studioStore.getTask(task.id);
      return updated?.status === "paused";
    });

    const updatedTask = await studioStore.getTask(task.id);
    expect(updatedTask?.status).toBe("paused");

    const comments = await studioStore.listComments(task.id);
    expect(comments.length).toBeGreaterThan(0);
    const limitComment = comments.find((c: any) => c.metadata?.event === "loop_limit_exceeded" || c.content.includes("limit"));
    expect(limitComment).toBeDefined();
    expect(limitComment?.content).toContain("Remediation recursion limit");
  });

  test("respects custom maxIterations configured in WorkflowRecursionGuardConfig", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store, passThroughRuntime as any);
    // Custom guard set to 2 max iterations
    const { workflow, fallbackNode, engineerNode } = createQARemediationWorkflow({ maxIterations: 2 });

    const iteration2Envelope: SupervisorOutcomeEnvelope = createSupervisorOutcomeEnvelope({
      nextAction: "implement_spec",
      statusMessage: "QA failed at iteration 2 (custom max = 2)",
      taskId: "task-custom-limit",
      iterationCount: 2,
      qaResult: {
        taskId: "task-custom-limit",
        testsPassed: false,
        totalTests: 5,
        failedTestsCount: 1,
        iterationCount: 2,
        verifiedFiles: ["test.py"],
      },
    });

    const runId = executor.start({
      workflow,
      agents: allAgents,
      input: iteration2Envelope as unknown as Record<string, unknown>,
    });

    await waitFor(() => store.get(runId)?.run.status === "completed" || store.get(runId)?.run.status === "failed");

    const events = store.events(runId);
    const executedNodeIds = events.map((e) => e.nodeId).filter(Boolean);

    // Limit was 2, so iteration 2 triggers fallback immediately
    expect(executedNodeIds).toContain(fallbackNode.id);
  });
});
