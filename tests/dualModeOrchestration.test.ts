import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import {
  createEdge,
  createEmptyDefinition,
  createNode,
  createRecursionGuard,
  createSupervisorOutcomeEnvelope,
  type WorkflowDefinition,
  type SupervisorOutcomeEnvelope,
  type ConsolidatedGapReport,
} from "@multi-agent/types";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import {
  createSeededLinearWorkflow,
  createSeededSupervisorWorkflow,
  seedSpecialistAgents,
  studioTaskToolRecord,
  SEED_TENANT_ID,
} from "../src/studio/seeds/buildingGapOrgSeed";
import {
  createLeadOrchestratorPersona,
  LEAD_ORCHESTRATOR_PERSONA_ID,
} from "../src/agents/personas/leadOrchestrator";
import {
  createQaVerifierPersona,
  createGapEngineerPersona,
  QA_VERIFIER_PERSONA_ID,
  GAP_ENGINEER_PERSONA_ID,
} from "../src/agents/personas/qaVerifier";
import { StudioTaskToolExecutor } from "../src/tools/studioTaskToolExecutor";
import { formatArchetypeLabel } from "../apps/web/src/components/workflow/WorkflowSwitcher";
import { useWorkflowStore } from "../apps/web/src/store/useWorkflowStore";
import {
  SandboxExecutionBarrier,
  SandboxHostProtectionViolationError,
  SandboxBoundaryViolationError,
} from "../src/security";

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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

function createQARemediationWorkflow(options: { maxIterations?: number } = {}) {
  const maxIterations = options.maxIterations ?? 3;
  const fallbackBranch = "loop_limit_exceeded";

  const intakeNode = createNode("input", { x: 0, y: 0 });
  intakeNode.id = "intake-node";

  const supervisorNode = createNode("agent", { x: 100, y: 0 }, { agentId: LEAD_ORCHESTRATOR_PERSONA_ID });
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

  const fallbackNode = createNode("memory", { x: 500, y: 100 });
  fallbackNode.id = fallbackBranch;
  fallbackNode.config = { memoryType: "short_term", mode: "write", key: "loop_limit_reached" };

  const outputNode = createNode("output", { x: 900, y: 0 });
  outputNode.id = "output-node";

  const workflow: WorkflowDefinition = {
    ...createEmptyDefinition("Supervisor Delivery Workflow"),
    id: "wf-qa-adaptive-loop",
    archetype: "hierarchical-supervisor",
    archetypeConfig: {
      category: "hierarchical-supervisor",
      supervisorHubNodeId: supervisorNode.id,
      recursionGuards: [
        createRecursionGuard("implement_spec", fallbackBranch, maxIterations),
      ],
    },
    nodes: [intakeNode, supervisorNode, conditionNode, engineerNode, qaNode, fallbackNode, outputNode],
    edges: [
      createEdge({ source: intakeNode.id, target: supervisorNode.id }),
      createEdge({ source: supervisorNode.id, target: conditionNode.id }),
      createEdge({ source: conditionNode.id, target: engineerNode.id, kind: "conditional", branchKey: "implement_spec" }),
      createEdge({ source: conditionNode.id, target: outputNode.id, kind: "conditional", branchKey: "complete" }),
      createEdge({ source: conditionNode.id, target: fallbackNode.id, kind: "conditional", branchKey: fallbackBranch }),
      createEdge({ source: engineerNode.id, target: qaNode.id }),
      createEdge({ source: qaNode.id, target: supervisorNode.id }),
      createEdge({ source: fallbackNode.id, target: outputNode.id }),
    ],
  };

  return { workflow, fallbackNode, engineerNode, outputNode };
}

function sampleGapReport(): ConsolidatedGapReport {
  return {
    totalUserStories: 42,
    auditedCount: 42,
    averageCompletenessScore: 78.5,
    criticalGapsCount: 2,
    allGaps: [
      {
        specCode: "US-DR-01",
        title: "Missing Daily Report Aggregation Endpoint",
        severity: "critical",
        description: "Aggregation logic not found in field_reports",
        missingFiles: ["apps/api/core/field_reports/services/daily_report_aggregation.py"],
        suggestedFix: "Implement daily report aggregation service",
      },
    ],
    remediationPlanSummary: "Remediate 2 critical gaps in sandbox workspace",
    estimatedEffortHours: 12,
    preparedAt: new Date().toISOString(),
  };
}

function createSupervisorApprovalWorkflow(): {
  workflow: WorkflowDefinition;
  approvalNode: any;
  remediationNode: any;
  outputNode: any;
} {
  const intakeNode = createNode("input", { x: 0, y: 0 });
  intakeNode.id = "intake-node";

  const approvalNode = createNode("approval", { x: 100, y: 0 });
  approvalNode.id = "human-approval-gate";
  approvalNode.config = {
    gateId: "gate-remediation-auth",
    message: "Mandatory review of consolidated gap audit report before sandbox remediation",
    approvalType: "required",
    timeoutSeconds: 86400,
    requiredRoles: ["admin", "project_manager", "lead_architect"],
    onTimeout: "fail_closed",
    allowedDecisions: ["approved", "rejected", "needs_clarification"],
  };

  const remediationNode = createNode("memory", { x: 300, y: -50 });
  remediationNode.id = "remediation-engineer-node";
  remediationNode.config = { memoryType: "short_term", mode: "write", key: "remediation_executed" };

  const outputNode = createNode("output", { x: 500, y: 0 });
  outputNode.id = "output-node";

  const workflow: WorkflowDefinition = {
    ...createEmptyDefinition("Approval Workflow"),
    id: "wf-human-approval",
    nodes: [intakeNode, approvalNode, remediationNode, outputNode],
    edges: [
      createEdge({ source: intakeNode.id, target: approvalNode.id }),
      createEdge({
        source: approvalNode.id,
        target: remediationNode.id,
        kind: "conditional",
        branchKey: "approved",
      }),
      createEdge({ source: remediationNode.id, target: outputNode.id }),
    ],
  };

  return { workflow, approvalNode, remediationNode, outputNode };
}

describe("dualModeOrchestration end-to-end integration test suite", () => {
  const qaVerifierAgent = createQaVerifierPersona();
  const gapEngineerAgent = createGapEngineerPersona();
  const supervisorAgent = createLeadOrchestratorPersona({ tools: [] });
  const allAgents = [supervisorAgent, qaVerifierAgent, gapEngineerAgent];

  describe("Workflow Archetypes", () => {
    test("compiles linear-pipeline as an acyclic graph", () => {
      const linearWf = createSeededLinearWorkflow();
      const validationIssues = validateWorkflow(linearWf, seedSpecialistAgents, {}, [studioTaskToolRecord as any]);
      const errors = validationIssues.filter((i) => i.severity === "error");

      expect(errors).toHaveLength(0);
      expect(linearWf.archetype).toBe("linear-pipeline");
      expect(linearWf.nodes.length).toBeGreaterThanOrEqual(5);

      const compiled = compileWorkflow(linearWf, seedSpecialistAgents, {
        tools: [studioTaskToolRecord as any],
      });
      expect(compiled).toBeDefined();
      expect(compiled.graph).toBeDefined();
    });

    test("compiles hierarchical-supervisor with cyclic feedback routes", () => {
      const supervisorWf = createSeededSupervisorWorkflow();
      const validationIssues = validateWorkflow(supervisorWf, seedSpecialistAgents, {}, [studioTaskToolRecord as any]);
      const errors = validationIssues.filter((i) => i.severity === "error");

      expect(errors).toHaveLength(0);
      expect(supervisorWf.archetype).toBe("hierarchical-supervisor");
      expect(supervisorWf.archetypeConfig?.supervisorHubNodeId).toBe("node-lead-orchestrator");
      expect(supervisorWf.archetypeConfig?.recursionGuards).toHaveLength(1);
      const implementEdge = supervisorWf.edges.find((edge) => edge.branchKey === "implement_spec");
      expect(implementEdge?.target).toBe("human-approval-gate");
      expect(supervisorWf.edges.some((edge) => edge.branchKey === "implement_spec" && edge.target === "node-gap-engineer")).toBe(false);

      const compiled = compileWorkflow(supervisorWf, seedSpecialistAgents, {
        tools: [studioTaskToolRecord as any],
      });
      expect(compiled).toBeDefined();
      expect(compiled.graph).toBeDefined();
    });

    test("enforces recursion limit guardrails at max 3 iterations on QA failure", async () => {
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

      await studioStore.saveTask({
        id: "task-guardrail-test",
        tenantId: "org-building-gap",
        projectId: "project-building-gap",
        title: "US-DR-01 QA loop limit test",
        description: "Testing recursion guardrail",
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

      const { workflow, fallbackNode } = createQARemediationWorkflow({ maxIterations: 3 });

      const exhaustedEnvelope: SupervisorOutcomeEnvelope = createSupervisorOutcomeEnvelope({
        nextAction: "implement_spec",
        statusMessage: "QA tests failed 3 times in a row. Remediation limit exhausted.",
        taskId: "task-guardrail-test",
        iterationCount: 3,
        qaResult: {
          taskId: "task-guardrail-test",
          testsPassed: false,
          totalTests: 12,
          failedTestsCount: 1,
          failureOutput: "WeatherConditionError: Invalid range check",
          iterationCount: 3,
          verifiedFiles: ["workspaces/building-management-sandbox/src/weather.ts"],
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

      expect(executedNodeIds).toContain(fallbackNode.id);
      expect(eventTypes).toContain("node.loop_limit_reached");

      await waitFor(async () => {
        const t = await studioStore.getTask("task-guardrail-test");
        return t?.status === "paused" && t?.paused === true;
      });

      const updatedTask = await studioStore.getTask("task-guardrail-test");
      expect(updatedTask?.status).toBe("paused");
      expect(updatedTask?.paused).toBe(true);
    });

    test("suspends execution at Human Approval Gate before remediation node", async () => {
      const store = new RunStore();
      const executor = new RunExecutor(store);
      const { workflow, approvalNode, remediationNode } = createSupervisorApprovalWorkflow();

      const runId = executor.start({
        workflow,
        agents: [],
        input: { consolidatedGapReport: sampleGapReport() },
      });

      await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
      const run = store.get(runId)!.run;
      expect(run.status).toBe("waiting_for_human");
      expect(run.currentNodeId).toBe(approvalNode.id);

      const eventsBefore = store.events(runId);
      const executedNodeIdsBefore = eventsBefore.map((e) => e.nodeId).filter(Boolean);
      expect(executedNodeIdsBefore).not.toContain(remediationNode.id);

      executor.approveRun(runId, {
        reviewerId: "admin-user",
        reviewerRole: "admin",
        notes: "Approved gap remediation for building-management sandbox.",
      });

      await waitFor(() => store.get(runId)?.run.status === "completed");
      expect(store.get(runId)!.run.status).toBe("completed");

      const eventsAfter = store.events(runId);
      const executedNodeIdsAfter = eventsAfter.map((e) => e.nodeId).filter(Boolean);
      expect(executedNodeIdsAfter).toContain(remediationNode.id);
    });
  });

  describe("Supervisor Loop & Board Sync", () => {
    let store: InMemoryStudioStore;
    let executor: StudioTaskToolExecutor;
    const principal = { tenantId: SEED_TENANT_ID, principalId: "agent-lead-orchestrator" };

    beforeEach(async () => {
      store = new InMemoryStudioStore();
      executor = new StudioTaskToolExecutor(store);

      await store.saveTask({
        id: "task-sync-01",
        title: "US-DR-01: ثبت و پایش شرایط آب‌وهوایی و دما",
        description: "ثبت شرایط آب‌وهوا و بازه مجاز دما",
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
      await store.saveTask({
        id: "task-sync-02",
        title: "US-DR-02: مدیریت شیفت‌های کاری",
        description: "مدیریت شیفت‌های کاری کارگاه",
        priority: "medium",
        status: "in_progress",
        assignedAgent: "agent-gap-auditor",
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

    test("supervisor queries queued tasks from Studio Task Board", async () => {
      const queryRes = await executor.execute({
        tool: studioTaskToolRecord as any,
        input: {
          action: "query_tasks",
          params: { status: "queued" },
        },
        credentialPrincipal: principal,
      });

      expect(queryRes.success).toBe(true);
      if (queryRes.success) {
        const data = queryRes.data as any;
        expect(data.tasks).toHaveLength(1);
        expect(data.tasks[0].id).toBe("task-sync-01");
        expect(data.tasks[0].status).toBe("queued");
      }
    });

    test("transitions task status across lifecycle: queued -> in_progress -> in_review -> done", async () => {
      // 1. queued -> in_progress
      const r1 = await executor.execute({
        tool: studioTaskToolRecord as any,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-sync-01",
            newStatus: "in_progress",
            reason: "Claimed by Spec Delivery Lead Orchestrator",
          },
        },
        credentialPrincipal: principal,
      });
      expect(r1.success).toBe(true);
      expect((await store.getTask("task-sync-01"))?.status).toBe("in_progress");

      // 2. in_progress -> in_review
      const r2 = await executor.execute({
        tool: studioTaskToolRecord as any,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-sync-01",
            newStatus: "in_review",
            reason: "Spec audit complete, awaiting review",
          },
        },
        credentialPrincipal: principal,
      });
      expect(r2.success).toBe(true);
      expect((await store.getTask("task-sync-01"))?.status).toBe("in_review");

      // 3. in_review -> done
      const r3 = await executor.execute({
        tool: studioTaskToolRecord as any,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-sync-01",
            newStatus: "done",
            reason: "All QA verification tests passed",
          },
        },
        credentialPrincipal: principal,
      });
      expect(r3.success).toBe(true);
      expect((await store.getTask("task-sync-01"))?.status).toBe("done");

      // 4. Invalid transition: done -> queued (fail-closed)
      const rInvalid = await executor.execute({
        tool: studioTaskToolRecord as any,
        input: {
          action: "update_task_status",
          params: {
            taskId: "task-sync-01",
            newStatus: "queued",
          },
        },
        credentialPrincipal: principal,
      });
      expect(rInvalid.success).toBe(false);
      if (!rInvalid.success) {
        expect((rInvalid as any).error.code).toBe("INVALID_STATUS_TRANSITION");
      }
    });

    test("appends structured audit findings and completeness score to task comments", async () => {
      const commentRes = await executor.execute({
        tool: studioTaskToolRecord as any,
        input: {
          action: "add_task_comment",
          params: {
            taskId: "task-sync-01",
            content: "Spec Audit Complete: Completeness score 78.5%. Passed 11/14 checks. Missing weather condition override validation.",
            authorRole: "agent",
            metadata: {
              completenessScore: 78.5,
              specCode: "US-DR-01",
              gapsCount: 1,
              inspectedFiles: ["apps/web/src/components/daily-reports/WeatherSection.tsx"],
            },
          },
        },
        credentialPrincipal: principal,
      });

      expect(commentRes.success).toBe(true);
      const comments = await store.listComments("task-sync-01");
      expect(comments.length).toBeGreaterThanOrEqual(1);
      const lastComment = comments[comments.length - 1];
      expect(lastComment.content).toContain("78.5%");
      expect(lastComment.authorType).toBe("agent");
      expect(lastComment.metadata?.completenessScore).toBe(78.5);
    });
  });

  describe("Workflow Switcher Coexistence", () => {
    const linearWf = createSeededLinearWorkflow();
    const supervisorWf = createSeededSupervisorWorkflow();

    test("loads both linear and supervisor workflows in org-building-gap", () => {
      expect(linearWf.tenantId).toBe(SEED_TENANT_ID);
      expect(supervisorWf.tenantId).toBe(SEED_TENANT_ID);

      expect(formatArchetypeLabel(linearWf.archetype)).toBe("Linear Pipeline");
      expect(formatArchetypeLabel(supervisorWf.archetype)).toBe("Hierarchical Supervisor");
    });

    test("switches active workflow definition without state pollution", () => {
      useWorkflowStore.setState({
        ...useWorkflowStore.getInitialState(),
        definition: linearWf,
        isDirty: false,
      });

      expect(useWorkflowStore.getState().definition?.id).toBe(linearWf.id);
      expect(useWorkflowStore.getState().definition?.archetype).toBe("linear-pipeline");
      expect(useWorkflowStore.getState().definition?.nodes).toHaveLength(linearWf.nodes.length);

      useWorkflowStore.setState({
        definition: supervisorWf,
        isDirty: false,
        selectedNodeIds: [],
        selectedEdgeIds: [],
      });

      expect(useWorkflowStore.getState().definition?.id).toBe(supervisorWf.id);
      expect(useWorkflowStore.getState().definition?.archetype).toBe("hierarchical-supervisor");
      expect(useWorkflowStore.getState().definition?.nodes).toHaveLength(supervisorWf.nodes.length);

      // Verify original definitions remain intact
      expect(linearWf.nodes).toHaveLength(7);
      expect(linearWf.archetype).toBe("linear-pipeline");
    });
  });

  describe("Sandbox Containment & Host Repository Protection", () => {
    const hostRepoPath = "/home/hossein/Desktop/projects/building-management";
    const sandboxRoot = path.resolve(process.cwd(), "workspaces/building-management-sandbox");
    const barrier = new SandboxExecutionBarrier(sandboxRoot, [hostRepoPath]);
    let hostGitStatusBefore = "";

    beforeAll(() => {
      if (!fs.existsSync(sandboxRoot)) {
        fs.mkdirSync(sandboxRoot, { recursive: true });
      }
      if (fs.existsSync(hostRepoPath) && fs.existsSync(path.join(hostRepoPath, ".git"))) {
        try {
          hostGitStatusBefore = execSync(`git -C "${hostRepoPath}" status --porcelain`, { encoding: "utf-8" });
        } catch {
          hostGitStatusBefore = "";
        }
      }
    });

    afterAll(() => {
      const testFile = path.join(sandboxRoot, ".dual-mode-e2e-test.txt");
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    });

    test("permits reads and writes inside workspaces/building-management-sandbox", () => {
      const allowedFilePath = path.join(sandboxRoot, ".dual-mode-e2e-test.txt");

      expect(() => barrier.assertPathAllowed(allowedFilePath, "read")).not.toThrow();
      expect(() => barrier.assertPathAllowed(allowedFilePath, "write")).not.toThrow();
      expect(barrier.isPathAllowed(allowedFilePath, "write")).toBe(true);

      fs.writeFileSync(allowedFilePath, "e2e sandbox test content", "utf-8");
      expect(fs.readFileSync(allowedFilePath, "utf-8")).toBe("e2e sandbox test content");
    });

    test("rejects write operations targeting /home/hossein/Desktop/projects/building-management", () => {
      const hostFilePath = path.join(hostRepoPath, "unauthorized-e2e-attempt.txt");

      expect(() => barrier.assertPathAllowed(hostFilePath, "write")).toThrow(
        SandboxHostProtectionViolationError
      );
      expect(barrier.isPathAllowed(hostFilePath, "write")).toBe(false);
    });

    test("blocks path traversal attacks (e.g., ../../ escapes)", () => {
      const traversalOutside = path.join(sandboxRoot, "../../outside-file.txt");
      expect(() => barrier.assertPathAllowed(traversalOutside, "write")).toThrow(
        SandboxBoundaryViolationError
      );

      const traversalToHost = path.join(sandboxRoot, "../../../building-management/unauthorized.txt");
      expect(() => barrier.assertPathAllowed(traversalToHost, "write")).toThrow();
    });

    test("confirms host repository git status is 100% clean post-execution", () => {
      if (fs.existsSync(hostRepoPath) && fs.existsSync(path.join(hostRepoPath, ".git"))) {
        const hostGitStatusAfter = execSync(`git -C "${hostRepoPath}" status --porcelain`, { encoding: "utf-8" });
        expect(hostGitStatusAfter).toBe(hostGitStatusBefore);
      }
    });
  });
});
