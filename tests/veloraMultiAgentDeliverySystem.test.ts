import path from "node:path";
import fs from "node:fs";
import { Pool } from "pg";
import {
  createAgentRecord,
  createEmptyDefinition,
  type AgentRecord,
  type WorkflowDefinition,
  type AgentSessionState,
} from "@multi-agent/types";
import { CliAgentExecutor } from "../src/agents/runtime/cliAgentExecutor";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import {
  createVeloraSubphaseWorkflow,
  createVeloraMasterWorkflow,
  veloraSpecialistAgents,
  veloraStudioTools,
  VELORA_TENANT_ID,
  VELORA_PROJECT_ID,
  VELORA_WORKSPACE_ID,
  VELORA_SUBPHASE_WORKFLOW_ID,
  VELORA_MASTER_WORKFLOW_ID,
  BUILDING_MANAGEMENT_ROOT,
  seedVeloraDeliverySystem,
} from "../src/studio/seeds/veloraDeliverySystemSeed";
import {
  executeDeliveryPlanReader,
  executeEmployerRequirementsExtractor,
  executeSpecKitWorkspaceInspector,
  executeBrowserQaProbe,
} from "../src/tools/deliverySystemTools";
import { StudioTaskToolExecutor } from "../src/tools/studioTaskToolExecutor";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";

describe("Velora Multi-Agent Delivery System", () => {
  describe("CliAgentExecutor Native Session Capture & Continuation", () => {
    test("Codex: initial turn captures thread_id and emits onSessionUpdate", async () => {
      const start = jest.fn(async () => ({ workerId: "w1", runId: "r1" }));
      const jsonlStdout = [
        JSON.stringify({ type: "thread.started", thread_id: "thread-codex-initial-123" }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Task 1 completed." } }),
      ].join("\n");
      const wait = jest.fn(async () => ({ code: 0, stdout: jsonlStdout, stderr: "", reason: "completed" }));
      const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

      const agent = createAgentRecord({
        backend: { type: "cli", provider: "codex", executable: "codex" },
      });
      agent.executionPolicy = {
        shell: "restricted",
        filesystem: "read",
        workspaceRoot: "/workspace",
        allowedCommands: ["codex"],
      };

      const serverPolicy = {
        enabled: true,
        workerMode: "local" as const,
        allowedExecutables: ["codex"],
        workspaceRoots: ["/workspace"],
        maxOutputBytes: 1024 * 1024,
      };

      let capturedSession: AgentSessionState | undefined;
      const onSessionUpdate = jest.fn((s: AgentSessionState) => {
        capturedSession = s;
      });

      const events: any[] = [];
      const executor = new CliAgentExecutor(workerRuntime, serverPolicy);
      for await (const event of executor.execute({
        agent,
        input: "Implement subphase tasks",
        runId: "run-turn-1",
        nodeId: "node-implement",
        sessionMode: "shared",
        sessionKey: "subphase-implementer-session",
        onSessionUpdate,
      })) {
        events.push(event);
      }

      expect(onSessionUpdate).toHaveBeenCalledTimes(1);
      expect(capturedSession).toMatchObject({
        sessionId: "thread-codex-initial-123",
        sessionKey: "subphase-implementer-session",
        provider: "codex",
        turnCount: 1,
      });

      const outputEvent = events.find((e) => e.type === "agent.output");
      expect(outputEvent?.payload?.content).toBe("Task 1 completed.");
    });

    test("Codex: continuation turn passes resume flags and delta prompt to same thread_id", async () => {
      const start = jest.fn(async () => ({ workerId: "w2", runId: "r2" }));
      const jsonlStdout = [
        JSON.stringify({ type: "thread.started", thread_id: "thread-codex-initial-123" }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Convergence tasks remediated." } }),
      ].join("\n");
      const wait = jest.fn(async () => ({ code: 0, stdout: jsonlStdout, stderr: "", reason: "completed" }));
      const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

      const agent = createAgentRecord({
        backend: { type: "cli", provider: "codex", executable: "codex", args: ["--sandbox", "read-only"] },
      });
      agent.executionPolicy = {
        shell: "restricted",
        filesystem: "read",
        workspaceRoot: "/workspace",
        allowedCommands: ["codex"],
      };

      const serverPolicy = {
        enabled: true,
        workerMode: "local" as const,
        allowedExecutables: ["codex"],
        workspaceRoots: ["/workspace"],
        maxOutputBytes: 1024 * 1024,
      };

      const priorSession: AgentSessionState = {
        sessionId: "thread-codex-initial-123",
        sessionKey: "subphase-implementer-session",
        provider: "codex",
        agentId: agent.id,
        nodeId: "node-implement",
        turnCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      let updatedSession: AgentSessionState | undefined;
      const onSessionUpdate = jest.fn((s: AgentSessionState) => {
        updatedSession = s;
      });

      const executor = new CliAgentExecutor(workerRuntime, serverPolicy);
      for await (const _event of executor.execute({
        agent,
        input: "Review feedback: append 2 tasks",
        runId: "run-turn-2",
        nodeId: "node-implement",
        sessionMode: "shared",
        sessionKey: "subphase-implementer-session",
        resumePromptMode: "delta",
        resumeSession: priorSession,
        onSessionUpdate,
      })) {
        // drain
      }

      expect(start).toHaveBeenCalled();
      const firstCall = (start.mock.calls as any)[0];
      const spawnArgs = firstCall[0].args as string[];
      // Must contain exec, resume subcommand, and the session ID
      expect(spawnArgs).toContain("resume");
      expect(spawnArgs).toContain("thread-codex-initial-123");
      // Pre-resume flags
      expect(spawnArgs[0]).toBe("exec");
      expect(spawnArgs).toContain("--sandbox");
      expect(spawnArgs).toContain("read-only");

      // Verify stdin payload contains continuation notice
      const stdin = String(firstCall[2] ?? "");
      expect(stdin).toContain("SESSION CONTINUATION");
      expect(stdin).toContain("Review feedback: append 2 tasks");

      expect(onSessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "thread-codex-initial-123",
          turnCount: 2,
        }),
      );
    });

    test("Claude Code & Antigravity session arg generation", async () => {
      const start = jest.fn(async () => ({ workerId: "w3", runId: "r3" }));
      const wait = jest.fn(async () => ({ code: 0, stdout: "Claude response", stderr: "", reason: "completed" }));
      const workerRuntime = { start, wait, cleanup: jest.fn() } as any;

      const claudeAgent = createAgentRecord({
        backend: { type: "cli", provider: "claude-code", executable: "claude" },
      });
      claudeAgent.executionPolicy = { shell: "restricted", filesystem: "read", workspaceRoot: "/workspace", allowedCommands: ["claude"] };

      const serverPolicy = {
        enabled: true,
        workerMode: "local" as const,
        allowedExecutables: ["claude"],
        workspaceRoots: ["/workspace"],
        maxOutputBytes: 1024 * 1024,
      };

      const executor = new CliAgentExecutor(workerRuntime, serverPolicy);
      // Turn 1
      for await (const _e of executor.execute({
        agent: claudeAgent,
        input: "task 1",
        runId: "r",
        nodeId: "n",
        sessionMode: "node",
      })) {}
      const turn1Call = (start.mock.calls as any)[0];
      const turn1Args = turn1Call[0].args as string[];
      expect(turn1Args).toContain("--session-id");

      // Turn 2: resume
      start.mockClear();
      const claudeSession: AgentSessionState = {
        sessionId: "claude-uuid-999",
        sessionKey: "node:n",
        provider: "claude-code",
        agentId: claudeAgent.id,
        nodeId: "n",
        turnCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      for await (const _e of executor.execute({
        agent: claudeAgent,
        input: "task 1 loop",
        runId: "r",
        nodeId: "n",
        sessionMode: "node",
        resumeSession: claudeSession,
      })) {}
      const turn2Call = (start.mock.calls as any)[0];
      const turn2Args = turn2Call[0].args as string[];
      expect(turn2Args).toContain("--resume");
      expect(turn2Args).toContain("claude-uuid-999");
    });
  });

  describe("Domain Delivery Tools", () => {
    test("delivery-plan-reader: discovers 14 phases, 72 packages, 664 hours, and A.6 prompts", async () => {
      const result = executeDeliveryPlanReader(
        { projectRoot: BUILDING_MANAGEMENT_ROOT },
        {},
      );

      expect(result.totalPhases).toBe(14);
      expect(result.totalWorkPackages).toBe(72);
      expect(result.totalLikelyHours).toBe(664);

      const phases = result.phases as any[];
      expect(phases[0].wbs).toBe("R.0");
      expect(phases[1].wbs).toBe("A.6");
      expect(phases[1].hasSubphaseDecomposition).toBe(true);
      expect(phases[1].subphasesCount).toBe(6);
    });

    test("employer-requirements-extractor: extracts A6-P1 prompt, acceptance, and matrix", async () => {
      const result = executeEmployerRequirementsExtractor(
        { projectRoot: BUILDING_MANAGEMENT_ROOT },
        { phase: "A.6", subphase: "A6-P1" },
      );

      expect(result.phaseId).toBe("A.6");
      expect(result.subphaseId).toBe("A6-P1");
      expect(result.promptMarkdown).toBeDefined();
      expect(typeof result.promptMarkdown).toBe("string");
      expect(result.promptMarkdown).toContain("A6-P1");
      expect(result.acceptanceCriteriaDoc).toBeDefined();
      expect(result.moduleAccessMatrixDoc).toBeDefined();
      expect((result.mandatoryEndUserPersonas as any[]).length).toBeGreaterThan(0);
    });

    test("speckit-workspace-inspector: returns verdict and task counts", async () => {
      const result = executeSpecKitWorkspaceInspector(
        { projectRoot: BUILDING_MANAGEMENT_ROOT },
        {},
      );

      expect(result.verdict).toBeDefined();
      expect(["needs_specify", "needs_plan", "needs_tasks", "continue_implement", "converged"]).toContain(result.verdict);
    });

    test("browser-qa-probe: checks loopback readiness safely", async () => {
      const result = await executeBrowserQaProbe(
        { projectRoot: BUILDING_MANAGEMENT_ROOT },
        { checkBrowserAutomation: true },
      );

      expect((result.frontend as any).url).toContain("5173");
      expect((result.backend as any).url).toContain("8000");
      expect(result.browserCapabilities).toBeDefined();
      expect((result.priorBrowserAudits as string[]).length).toBeGreaterThan(0);
    });

    test("StudioTaskToolExecutor: supports get_task, create_task, bulk_create_tasks", async () => {
      const inMemoryStore = new InMemoryStudioStore();
      const executor = new StudioTaskToolExecutor(inMemoryStore);
      const credentialPrincipal = { tenantId: VELORA_TENANT_ID, principalId: "dev-user" };

      const toolRecord = {
        ...veloraStudioTools[0],
        configuration: {},
      };

      // 1. Create task
      const createRes = await executor.execute({
        tool: toolRecord,
        input: {
          action: "create_task",
          taskId: "test-task-1",
          title: "Initial Subphase Task",
          priority: "high",
        },
        agentId: "agent-delivery-plan-orchestrator",
        authorizedToolIds: ["studio_task_tool"],
        credentialPrincipal,
        runId: "run-test",
      });
      expect((createRes as any).success).toBe(true);

      // 2. Get task
      const getRes = await executor.execute({
        tool: toolRecord,
        input: {
          action: "get_task",
          taskId: "test-task-1",
        },
        agentId: "agent-delivery-plan-orchestrator",
        authorizedToolIds: ["studio_task_tool"],
        credentialPrincipal,
        runId: "run-test",
      });
      expect((getRes as any).data.task.id).toBe("test-task-1");

      // 3. Bulk create
      const bulkRes = await executor.execute({
        tool: toolRecord,
        input: {
          action: "bulk_create_tasks",
          tasks: [
            { taskId: "test-task-2", title: "Task 2", priority: "medium" },
            { taskId: "test-task-3", title: "Task 3", priority: "low" },
          ],
        },
        agentId: "agent-delivery-plan-orchestrator",
        authorizedToolIds: ["studio_task_tool"],
        credentialPrincipal,
        runId: "run-test",
      });
      expect((bulkRes as any).data.createdCount).toBe(2);
    });
  });

  describe("Seeded Workflows Validation & Graph Compilation", () => {
    test("velora-subphase-speckit-converge-qa: zero validation errors and compiles cleanly", () => {
      const subphaseWf = createVeloraSubphaseWorkflow();
      const issues = validateWorkflow(subphaseWf, veloraSpecialistAgents, {}, veloraStudioTools as any);
      const errors = issues.filter((i) => i.level === "error" || (i as any).severity === "error");
      expect(errors).toEqual([]);

      const compiled = compileWorkflow(subphaseWf, veloraSpecialistAgents, {
        tools: veloraStudioTools,
      });
      expect(compiled.graph).toBeDefined();
    });

    test("velora-delivery-plan-master-orchestrator: zero validation errors and compiles cleanly", () => {
      const masterWf = createVeloraMasterWorkflow();
      const issues = validateWorkflow(masterWf, veloraSpecialistAgents, {}, veloraStudioTools as any);
      const errors = issues.filter((i) => i.level === "error" || (i as any).severity === "error");
      expect(errors).toEqual([]);

      const compiled = compileWorkflow(masterWf, veloraSpecialistAgents, {
        tools: veloraStudioTools,
      });
      expect(compiled.graph).toBeDefined();
    });
  });

  describe("End-to-End Simulation of Converge & Browser QA Session Continuation", () => {
    test("Implementer continues exact session across Converge review loop and Browser QA defect loop", async () => {
      const subphaseWf = createVeloraSubphaseWorkflow();

      // Track sessions across the compiled execution
      const mockAgentSessions: Record<string, AgentSessionState> = {};
      const agentRuntime = {
        execute: jest.fn(async function* (args: any) {
          const { agent, nodeId, sessionMode, sessionKey, resumeSession, onSessionUpdate } = args;

          if (nodeId === "node-implement") {
            const currentTurn = (resumeSession?.turnCount ?? 0) + 1;
            const updated: AgentSessionState = {
              sessionId: resumeSession?.sessionId ?? "thread-session-velora-99",
              sessionKey: sessionKey ?? "subphase-implementer-session",
              provider: "codex",
              agentId: agent.id,
              nodeId,
              turnCount: currentTurn,
              createdAt: resumeSession?.createdAt ?? new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            if (sessionKey) {
              mockAgentSessions[sessionKey] = updated;
            }
            if (onSessionUpdate) onSessionUpdate(updated);

            yield {
              type: "agent.output",
              payload: {
                content: `Implementer turn ${currentTurn} finished.`,
                turnCount: currentTurn,
                sessionId: updated.sessionId,
              },
            };
            yield {
              type: "agent.completed",
              payload: { status: "success", turnCount: currentTurn, sessionId: updated.sessionId },
            };
            return;
          }

          if (nodeId === "node-converge-review") {
            // First time: request implementation continuation; subsequent: converged
            const implementerSession = mockAgentSessions["subphase-implementer-session"];
            const isFirstReview = (implementerSession?.turnCount ?? 1) <= 1;
            const verdict = isFirstReview ? "continue_implement" : "converged";
            yield {
              type: "agent.output",
              payload: {
                verdict,
                message: isFirstReview ? "2 tasks appended" : "100% converged",
              },
            };
            yield { type: "agent.completed", payload: { verdict } };
            return;
          }

          if (nodeId === "node-browser-qa") {
            // First time: detect defect; subsequent: passed
            const implementerSession = mockAgentSessions["subphase-implementer-session"];
            const isFirstQA = (implementerSession?.turnCount ?? 1) <= 2;
            const verdict = isFirstQA ? "remediate_browser_defects" : "qa_passed";
            yield {
              type: "agent.output",
              payload: {
                verdict,
                message: isFirstQA ? "Role boundary defect in table" : "All scenarios passed",
              },
            };
            yield { type: "agent.completed", payload: { verdict } };
            return;
          }

          // Other nodes (specify, clarify, plan, tasks, analyze, remediate)
          const nextAction = nodeId === "node-analyze" ? "ready_for_implement" : "ok";
          yield {
            type: "agent.output",
            payload: { result: `Node ${nodeId} ok`, nextAction },
          };
          yield { type: "agent.completed", payload: { nextAction } };
        }),
      } as any;

      const compiled = compileWorkflow(subphaseWf, veloraSpecialistAgents, {
        runtime: agentRuntime,
        tools: veloraStudioTools,
        toolRuntime: {
          execute: async () => ({ status: 200, promptContent: "Spec instructions" }),
        },
      });

      const graph = compiled.graph as {
        invoke: (state: Record<string, unknown>, config?: unknown) => Promise<Record<string, unknown>>;
      };

      const result = await graph.invoke({
        input: { subphase: "A6-P1" },
        output: {},
        memory: {},
        workingMemory: {},
        lastValue: { subphase: "A6-P1" },
        agentSessions: {},
      });

      expect(result).toBeDefined();
      const implementerState = (result as any).agentSessions?.["subphase-implementer-session"];
      expect(implementerState).toBeDefined();
      expect(implementerState.sessionId).toBe("thread-session-velora-99");
      // Must have executed multiple turns in the exact same session (Initial + Converge loop + QA loop = 3 turns)
      expect(implementerState.turnCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("PostgreSQL Database Seed Verification", () => {
    test("org-building-gap contains all seeded Velora entities", async () => {
      const dbUrl =
        process.env.MEMORY_DATABASE_URL ??
        process.env.MEMORY_TEST_DATABASE_URL ??
        "postgresql://studio_memory:studio_memory_local@127.0.0.1:55432/studio_memory";

      const pool = new Pool({ connectionString: dbUrl });
      try {
        const client = await pool.connect();
        try {
          await client.query("SELECT set_config('app.tenant_id', $1, false)", [VELORA_TENANT_ID]);
          await client.query("SELECT set_config('app.principal_kind', 'user', false)");

          // Verify Project
          const projectRes = await client.query("SELECT * FROM studio_projects WHERE id = $1", [VELORA_PROJECT_ID]);
          expect(projectRes.rows.length).toBe(1);

          // Verify Workspace
          const wsRes = await client.query("SELECT * FROM studio_workspaces WHERE id = $1", [VELORA_WORKSPACE_ID]);
          expect(wsRes.rows.length).toBe(1);

          // Verify Workflows
          const wfRes = await client.query(
            "SELECT id, name FROM studio_workflows WHERE tenant_id = $1 AND id IN ($2, $3)",
            [VELORA_TENANT_ID, VELORA_SUBPHASE_WORKFLOW_ID, VELORA_MASTER_WORKFLOW_ID],
          );
          expect(wfRes.rows.length).toBe(2);

          // Verify 14 Phase Tasks
          const phaseTasksRes = await client.query(
            "SELECT count(*) FROM studio_tasks WHERE tenant_id = $1 AND project_id = $2 AND metadata->>'type' = 'delivery_phase'",
            [VELORA_TENANT_ID, VELORA_PROJECT_ID],
          );
          expect(Number(phaseTasksRes.rows[0].count)).toBe(14);

          // Verify 6 Subphase Tasks
          const subphaseTasksRes = await client.query(
            "SELECT count(*) FROM studio_tasks WHERE tenant_id = $1 AND project_id = $2 AND metadata->>'type' = 'subphase_deliverable'",
            [VELORA_TENANT_ID, VELORA_PROJECT_ID],
          );
          expect(Number(subphaseTasksRes.rows[0].count)).toBe(6);
        } finally {
          client.release();
        }
      } finally {
        await pool.end();
      }
    });
  });
});
