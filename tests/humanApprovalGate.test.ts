import {
  createEdge,
  createEmptyDefinition,
  createNode,
  type ConsolidatedGapReport,
  type HumanApprovalInterruptContext,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { createRunsRouter } from "../apps/server/src/api/runs";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";

async function waitFor(predicate: () => boolean, timeoutMs = 4000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function sampleGapReport(): ConsolidatedGapReport {
  return {
    totalUserStories: 42,
    auditedCount: 42,
    averageCompletenessScore: 78.5,
    criticalGapsCount: 2,
    allGaps: [
      {
        specCode: "SPEC-01",
        title: "Missing Daily Report Aggregation Endpoint",
        severity: "critical",
        description: "Aggregation logic not found in field_reports",
        missingFiles: ["apps/api/core/field_reports/services/daily_report_aggregation.py"],
        suggestedFix: "Implement daily report aggregation service",
      },
      {
        specCode: "SPEC-02",
        title: "Missing Weather Log Drawer",
        severity: "major",
        description: "UI drawer component not found",
        missingFiles: ["apps/web/src/components/weather/weather-log-drawer.tsx"],
      },
    ],
    remediationPlanSummary: "Remediate 2 critical gaps and 3 minor gaps in sandbox workspace",
    estimatedEffortHours: 12,
    preparedAt: new Date().toISOString(),
  };
}

function createSupervisorApprovalWorkflow(options: {
  timeoutSeconds?: number;
  approvalType?: "manual" | "timeout" | "required";
} = {}): {
  workflow: WorkflowDefinition;
  intakeNode: any;
  approvalNode: any;
  remediationNode: any;
  cleanHaltNode: any;
  outputNode: any;
} {
  const intakeNode = createNode("input", { x: 0, y: 0 });

  const approvalNode = createNode("approval", { x: 1, y: 0 });
  approvalNode.config = {
    gateId: "gate-remediation-auth",
    message: "Mandatory review of consolidated gap audit report before sandbox remediation",
    approvalType: options.approvalType ?? "required",
    timeoutSeconds: options.timeoutSeconds ?? 86400,
    requiredRoles: ["admin", "project_manager", "lead_architect"],
    onTimeout: "fail_closed",
    allowedDecisions: ["approved", "rejected", "needs_clarification"],
  };

  const remediationNode = createNode("memory", { x: 2, y: -1 });
  remediationNode.config = { memoryType: "short_term", mode: "write", key: "remediation_executed" };

  const cleanHaltNode = createNode("memory", { x: 2, y: 1 });
  cleanHaltNode.config = { memoryType: "short_term", mode: "write", key: "clean_halt_executed" };

  const outputNode = createNode("output", { x: 3, y: 0 });

  const workflow: WorkflowDefinition = {
    ...createEmptyDefinition(),
    nodes: [intakeNode, approvalNode, remediationNode, cleanHaltNode, outputNode],
    edges: [
      createEdge({ source: intakeNode.id, target: approvalNode.id }),
      createEdge({
        source: approvalNode.id,
        target: remediationNode.id,
        kind: "conditional",
        branchKey: "approved",
      }),
      createEdge({
        source: approvalNode.id,
        target: cleanHaltNode.id,
        kind: "conditional",
        branchKey: "rejected",
      }),
      createEdge({ source: remediationNode.id, target: outputNode.id }),
      createEdge({ source: cleanHaltNode.id, target: outputNode.id }),
    ],
  };

  return { workflow, intakeNode, approvalNode, remediationNode, cleanHaltNode, outputNode };
}

describe("Human Approval Gate Lifecycle & Safety Tests (T025 - T028)", () => {
  test("LangGraph interrupt() pauses run with status waiting_for_human and persists HumanApprovalInterruptContext", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const { workflow, approvalNode } = createSupervisorApprovalWorkflow();
    const gapReport = sampleGapReport();

    const runId = executor.start({
      workflow,
      agents: [],
      input: { consolidatedGapReport: gapReport },
    });

    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    const run = store.get(runId)!.run;

    expect(run.status).toBe("waiting_for_human");
    expect(run.currentNodeId).toBe(approvalNode.id);

    const approvals = store.listApprovals(runId);
    expect(approvals).toHaveLength(1);
    const [approval] = approvals;
    expect(approval.status).toBe("requested");

    const interruptContext = approval.context as unknown as HumanApprovalInterruptContext;
    expect(interruptContext).toBeDefined();
    expect(interruptContext.gateId).toBe("gate-remediation-auth");
    expect(interruptContext.runId).toBe(runId);
    expect(interruptContext.nodeId).toBe(approvalNode.id);
    expect(interruptContext.consolidatedGapReport.criticalGapsCount).toBe(2);
    expect(interruptContext.consolidatedGapReport.totalUserStories).toBe(42);

    const eventTypes = store.events(runId).map((e) => e.type);
    expect(eventTypes).toContain("run.paused");
    expect(eventTypes).toContain("human_approval.requested");
  });

  test("downstream remediation node is blocked from execution while approval is pending", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const { workflow, remediationNode, cleanHaltNode } = createSupervisorApprovalWorkflow();

    const runId = executor.start({
      workflow,
      agents: [],
      input: { consolidatedGapReport: sampleGapReport() },
    });

    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");

    // Give time to ensure no downstream nodes run
    await new Promise((resolve) => setTimeout(resolve, 50));

    const events = store.events(runId);
    const executedNodeIds = events.map((e) => e.nodeId).filter(Boolean);

    expect(executedNodeIds).not.toContain(remediationNode.id);
    expect(executedNodeIds).not.toContain(cleanHaltNode.id);
    expect(store.get(runId)?.run.status).toBe("waiting_for_human");
  });

  test("approving decision resumes workflow and executes downstream remediation node", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const { workflow, remediationNode, cleanHaltNode } = createSupervisorApprovalWorkflow();

    const runId = executor.start({
      workflow,
      agents: [],
      input: { consolidatedGapReport: sampleGapReport() },
    });

    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");

    // Approve the pending request
    executor.approveRun(runId, {
      reviewerId: "lead-architect-1",
      reviewerRole: "lead_architect",
      notes: "Audit looks accurate; authorize remediation in sandbox.",
    });

    await waitFor(() => store.get(runId)?.run.status === "completed");

    const run = store.get(runId)!.run;
    expect(run.status).toBe("completed");

    const events = store.events(runId);
    const eventTypes = events.map((e) => e.type);
    const executedNodeIds = events.map((e) => e.nodeId).filter(Boolean);

    expect(eventTypes).toContain("human_approval.approved");
    expect(eventTypes).toContain("run.resumed");
    expect(eventTypes).toContain("run.completed");

    // Remediation node executed, clean halt node did NOT execute
    expect(executedNodeIds).toContain(remediationNode.id);
    expect(executedNodeIds).not.toContain(cleanHaltNode.id);
  });

  test("rejecting decision halts cleanly, pauses Studio task, and does not execute remediation", async () => {
    const store = new RunStore();
    const studioStore = new InMemoryStudioStore();

    // Create a Studio task to associate with the run
    const task = await studioStore.saveTask({
      id: "task-building-gap-01",
      tenantId: "tenant-building-gap",
      projectId: "project-1",
      title: "Fix Daily Report Aggregation",
      description: "Implement missing gap",
      status: "in_progress",
      priority: "high",
      assignedAgent: "agent-implementer",
      assignedAgents: ["agent-implementer"],
      dependencies: [],
      retryCount: 0,
      paused: false,
      output: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const executor = new RunExecutor(
      store,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      studioStore,
    );

    const { workflow, remediationNode, cleanHaltNode } = createSupervisorApprovalWorkflow();

    const runId = executor.start({
      workflow,
      agents: [],
      input: { taskId: task.id, consolidatedGapReport: sampleGapReport() },
    });

    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");

    // Reject the pending approval
    executor.rejectRun(runId, {
      reviewerId: "pm-reviewer-2",
      reviewerRole: "project_manager",
      notes: "Requirements must be re-scoped before any sandbox code modification.",
    });

    await waitFor(() => store.get(runId)?.run.status === "completed");

    const events = store.events(runId);
    const eventTypes = events.map((e) => e.type);
    const executedNodeIds = events.map((e) => e.nodeId).filter(Boolean);

    expect(eventTypes).toContain("human_approval.rejected");
    expect(eventTypes).toContain("human_approval.rejection_halt");

    // Remediation node was NEVER executed!
    expect(executedNodeIds).not.toContain(remediationNode.id);
    expect(executedNodeIds).toContain(cleanHaltNode.id);

    // Associated Studio task must be paused with audit comment
    const updatedTask = await studioStore.getTask(task.id);
    expect(updatedTask?.status).toBe("paused");

    const comments = await studioStore.listComments(task.id);
    expect(comments.length).toBeGreaterThan(0);
    const rejectionComment = comments.find((c) => c.metadata?.event === "human_approval.rejected");
    expect(rejectionComment).toBeDefined();
    expect(rejectionComment?.content).toContain("pm-reviewer-2");
    expect(rejectionComment?.content).toContain("Requirements must be re-scoped");
  });

  test("HTTP endpoints /api/runs/:runId/approve and /api/runs/:runId/reject operate correctly", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const { app } = createRunsRouter(
      executor,
      undefined,
      undefined,
      async () => ({ userId: "admin-user", tenantId: "tenant-building-gap" }),
    );
    const { workflow } = createSupervisorApprovalWorkflow();

    // Start run
    const startRes = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow, agents: [], input: { consolidatedGapReport: sampleGapReport() } }),
    });
    expect(startRes.status).toBe(202);
    const { runId } = (await startRes.json()) as { runId: string };

    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");

    // Test approve endpoint
    const approveRes = await app.request(`http://localhost/${runId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: "admin-user", notes: "Approved via HTTP" }),
    });
    expect(approveRes.status).toBe(202);

    await waitFor(() => store.get(runId)?.run.status === "completed");
    expect(store.get(runId)?.run.status).toBe("completed");
  });

  test("timeout on required gate fails closed by rejecting rather than auto-approving", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const { workflow, remediationNode } = createSupervisorApprovalWorkflow({
      approvalType: "required",
      timeoutSeconds: 1, // 1s timeout
    });

    const runId = executor.start({
      workflow,
      agents: [],
      input: { consolidatedGapReport: sampleGapReport() },
    });

    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");

    // Wait for 1s timeout to trigger
    await waitFor(() => store.get(runId)?.run.status === "completed", 3000);

    const run = store.get(runId)!.run;
    expect(run.status).toBe("completed");

    const events = store.events(runId);
    const eventTypes = events.map((e) => e.type);
    const executedNodeIds = events.map((e) => e.nodeId).filter(Boolean);

    // Verified: fail-closed means rejected, NOT approved
    expect(eventTypes).toContain("human_approval.rejected");
    expect(eventTypes).not.toContain("human_approval.approved");
    expect(executedNodeIds).not.toContain(remediationNode.id);
  });

  test("needs_clarification stays paused and does not execute remediation", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const { workflow, remediationNode } = createSupervisorApprovalWorkflow();
    const runId = executor.start({
      workflow,
      agents: [],
      input: { consolidatedGapReport: sampleGapReport() },
    });
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    const [approval] = store.listApprovals(runId);
    executor.resolveApproval(runId, approval.id, { decision: "needs_clarification", response: "Which files change?" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.get(runId)?.run.status).toBe("waiting_for_human");
    expect(store.listApprovals(runId)[0].status).toBe("requested");
    expect(store.listApprovals(runId)[0].metadata).toMatchObject({ decision: "needs_clarification" });
    expect(store.events(runId).map((event) => event.type)).toContain("human_approval.needs_clarification");
    expect(store.events(runId).map((event) => event.nodeId)).not.toContain(remediationNode.id);
  });
});
