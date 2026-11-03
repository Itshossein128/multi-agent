import { createEdge, createEmptyDefinition, createNode, type ToolRecord } from "@multi-agent/types";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import {
  SEED_TENANT_ID,
  seedSpecialistAgents,
  studioTaskToolRecord,
} from "../src/studio/seeds/buildingGapOrgSeed";
import {
  invokeLeadOrchestratorBoardAction,
} from "../src/tools/leadOrchestratorBoardBridge";
import { ToolExecutorFactory } from "../src/tools/toolExecutorFactory";
import { ToolRuntime } from "../src/tools/toolRuntime";

describe("T051 Lead Orchestrator studio_task_tool callable board path", () => {
  const tool = {
    ...studioTaskToolRecord,
    impact: "read-only",
  } as ToolRecord;
  const lead = seedSpecialistAgents.find((agent) => agent.id === "agent-lead-orchestrator")!;
  const auditor = seedSpecialistAgents.find((agent) => agent.id === "agent-gap-auditor")!;

  let store: InMemoryStudioStore;

  beforeEach(async () => {
    store = new InMemoryStudioStore();
    await store.saveTask({
      id: "task-board-e2e-01",
      title: "US-DR-01 board sync",
      description: "Claim and comment via Lead Orchestrator tool path",
      priority: "high",
      status: "queued",
      assignedAgent: null,
      projectId: "project-building-gap",
      workspaceId: "ws-building-sandbox",
      dependencies: [],
      retryCount: 0,
      paused: false,
      output: null,
      tenantId: SEED_TENANT_ID,
      createdAt: new Date().toISOString(),
    });
  });

  test("Lead Orchestrator queries, claims, assigns, and comments through authorized bridge", async () => {
    const query = await invokeLeadOrchestratorBoardAction({
      tool,
      action: "query_tasks",
      params: { status: "queued" },
      tenantId: SEED_TENANT_ID,
      agent: lead,
      runId: "run-board-e2e",
    }, { store });
    expect(query.success).toBe(true);
    if (query.success) {
      expect((query.data as { tasks: Array<{ id: string }> }).tasks[0]?.id).toBe("task-board-e2e-01");
    }

    const claim = await invokeLeadOrchestratorBoardAction({
      tool,
      action: "update_task_status",
      params: {
        taskId: "task-board-e2e-01",
        newStatus: "in_progress",
        reason: "Claimed by Spec Delivery Lead Orchestrator",
      },
      tenantId: SEED_TENANT_ID,
      agent: lead,
      runId: "run-board-e2e",
    }, { store });
    expect(claim.success).toBe(true);
    expect((await store.getTask("task-board-e2e-01"))?.status).toBe("in_progress");

    const assign = await invokeLeadOrchestratorBoardAction({
      tool,
      action: "assign_task",
      params: {
        taskId: "task-board-e2e-01",
        assignedAgent: "agent-gap-auditor",
      },
      tenantId: SEED_TENANT_ID,
      agent: lead,
      runId: "run-board-e2e",
    }, { store });
    expect(assign.success).toBe(true);

    const comment = await invokeLeadOrchestratorBoardAction({
      tool,
      action: "add_task_comment",
      params: {
        taskId: "task-board-e2e-01",
        content: "Audit kickoff recorded by Lead Orchestrator",
        authorRole: "agent",
        authorAgentId: lead.id,
        metadata: { completenessScore: 12, gapsCount: 3, iteration: 0 },
      },
      tenantId: SEED_TENANT_ID,
      agent: lead,
      runId: "run-board-e2e",
    }, { store });
    expect(comment.success).toBe(true);

    const review = await invokeLeadOrchestratorBoardAction({
      tool,
      action: "update_task_status",
      params: {
        taskId: "task-board-e2e-01",
        newStatus: "in_review",
        reason: "Ready for human gate",
      },
      tenantId: SEED_TENANT_ID,
      agent: lead,
      runId: "run-board-e2e",
    }, { store });
    expect(review.success).toBe(true);
    expect((await store.getTask("task-board-e2e-01"))?.status).toBe("in_review");
  });

  test("denies board actions for agents without studio_task_tool authorization", async () => {
    const denied = await invokeLeadOrchestratorBoardAction({
      tool,
      action: "query_tasks",
      params: { status: "queued" },
      tenantId: SEED_TENANT_ID,
      agent: { id: auditor.id, tools: auditor.tools ?? [] },
      runId: "run-board-unauthorized",
    }, { store });

    expect(denied.success).toBe(false);
    if (!denied.success) {
      expect(denied.error.code).toBe("UNAUTHORIZED_ACTION");
    }
  });

  test("workflow tool node executes studio_task_tool under Lead Orchestrator authorization", async () => {
    const input = createNode("input", { x: 0, y: 0 });
    const boardTool = createNode("tool", { x: 120, y: 0 }, { toolId: tool.id });
    boardTool.id = "node-board-intake";
    boardTool.config = { toolId: tool.id, agentId: lead.id };
    const output = createNode("output", { x: 240, y: 0 });
    const workflow = {
      ...createEmptyDefinition(),
      id: "wf-lead-board-tool",
      name: "Lead Board Tool Path",
      nodes: [input, boardTool, output],
      edges: [
        createEdge({ source: input.id, target: boardTool.id }),
        createEdge({ source: boardTool.id, target: output.id }),
      ],
    };

    const factory = new ToolExecutorFactory(undefined, store);
    const toolRuntime = new ToolRuntime(30_000, true, factory);
    const compiled = compileWorkflow(workflow, [lead], {
      tools: [tool],
      toolRuntime,
      credentialPrincipal: { tenantId: SEED_TENANT_ID, principalId: lead.id },
    });

    const result = await compiled.graph.invoke({
      input: { action: "query_tasks", params: { status: "queued" } },
    });
    expect(result).toBeTruthy();
    const toolOutput = (result as { output?: { success?: boolean }; lastValue?: { success?: boolean } }).output
      ?? (result as { lastValue?: { success?: boolean } }).lastValue;
    expect(toolOutput).toMatchObject({ success: true });
  });
});
