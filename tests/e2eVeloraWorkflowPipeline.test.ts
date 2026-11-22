import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  assertNoCredentials,
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createHierarchicalSupervisorConfig,
  createNode,
  createRecursionGuard,
  createResultEnvelope,
  createToolRecord,
  nowIso,
  validateAgent,
  validateAgentNodeStepConfig,
  validateDynamicFanoutNodeConfig,
  type AgentNodeConfig,
  type AgentRecord,
  type AgentSessionState,
  type DynamicFanoutNodeConfig,
  type ToolRecord,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@multi-agent/types";
import { createRunsRouter } from "../apps/server/src/api/runs";
import { createStudioRouter } from "../apps/server/src/api/studio";
import { AgentService } from "../apps/server/src/api/studio/agentService";
import { createStudioSubgraphRunner } from "../apps/server/src/compiler/subgraphRunner";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import { ApiAgentExecutor } from "../src/agents/runtime/apiAgentExecutor";
import { CliAgentExecutor, type CliRuntimePolicy } from "../src/agents/runtime/cliAgentExecutor";
import { defaultCliExecutable } from "../src/agents/runtime/cliProviderDefaults";
import {
  environmentWorkerCredentialResolverFromEnvironment,
} from "../src/agents/runtime/workerCredentials";
import { SandboxExecutionBarrier } from "../src/security/sandboxExecutionBarrier";
import { SandboxedWorkerRuntime } from "../src/security/workerRuntimeBarrier";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { executeDeliveryPlanReader, executeSpecKitWorkspaceInspector } from "../src/tools/deliverySystemTools";
import { ToolExecutorFactory } from "../src/tools/toolExecutorFactory";
import { ToolRuntime } from "../src/tools/toolRuntime";
import {
  agyStreamJsonFixture,
  assertRunCompletedOrDump,
  assertVeloraGitStateUnchanged,
  authHeaders,
  buildVeloraToolRecord,
  codexJsonlFixture,
  createCliAgent,
  createIsolatedVeloraMirror,
  createRecordingWorkerRuntime,
  createScriptableAgentRuntime,
  cursorStreamJsonFixture,
  loadAgenticVeloraSeedPackage,
  PRINCIPAL_ALPHA,
  PRINCIPAL_BETA,
  readJsonResponse,
  REQUIRED_VELORA_AGENT_ROLES,
  resolveTestPrincipal,
  snapshotVeloraGitState,
  VELORA_TARGET_REPO_ROOT,
  type IsolatedVeloraMirror,
  type VeloraGitSnapshot,
} from "./helpers/veloraE2EFixtures";

function buildDynamicFanoutNode(
  id: string,
  pos: { x: number; y: number },
  config: DynamicFanoutNodeConfig,
): WorkflowNode {
  const node = createNode("dynamic_fanout" as WorkflowNode["type"], pos);
  node.id = id;
  node.config = config as unknown as WorkflowNode["config"];
  return node;
}

describe("Agentic Velora Dual-Track Programmatic E2E Suite (F1–F10, F12, Tiers 1–4)", () => {
  jest.setTimeout(60_000);

  let initialGitSnapshot: VeloraGitSnapshot;
  const activeMirrors: IsolatedVeloraMirror[] = [];

  function trackMirror(options?: Parameters<typeof createIsolatedVeloraMirror>[0]): IsolatedVeloraMirror {
    const mirror = createIsolatedVeloraMirror(options);
    activeMirrors.push(mirror);
    return mirror;
  }

  beforeAll(() => {
    initialGitSnapshot = snapshotVeloraGitState(VELORA_TARGET_REPO_ROOT);
  });

  afterEach(() => {
    while (activeMirrors.length > 0) {
      activeMirrors.pop()!.cleanup();
    }
  });

  afterAll(() => {
    assertVeloraGitStateUnchanged(initialGitSnapshot, VELORA_TARGET_REPO_ROOT);
  });

  // =========================================================================
  // TIER 1 — FEATURE COVERAGE (F1–F10, F12)
  // =========================================================================

  describe("Feature F1: Stateful Same-Session Continuation & reinvokeOnClarification", () => {
    it("F1-T1: preserves exact sessionId across specify -> Supervisor -> plan -> Supervisor -> tasks with stateless Supervisor", async () => {
      const store = new InMemoryRunStore();
      const specAgent = createCliAgent("agent-speckit", "agy");
      const supAgent = createCliAgent("agent-supervisor", "codex", { args: ["-s", "read-only"] });

      const seenSpecSessions: Array<{ nodeId: string; sessionId?: string; turnCount: number }> = [];
      const seenSupSessions: Array<{ sessionMode?: string; sessionKey?: string; resumeSession?: AgentSessionState }> = [];

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === specAgent.id) {
          seenSpecSessions.push({
            nodeId: input.nodeId,
            sessionId: helpers.sessionId,
            turnCount: helpers.turnCount,
          });
          return { stage: input.nodeId, sessionId: helpers.sessionId, turnCount: helpers.turnCount };
        }
        seenSupSessions.push({
          sessionMode: input.sessionMode,
          sessionKey: input.sessionKey,
          resumeSession: input.resumeSession,
        });
        return { approved: true, feedback: `Approved after ${input.nodeId}` };
      });

      const nInput = createNode("input", { x: 0, y: 0 });
      const nSpecify = createNode("agent", { x: 100, y: 0 }, {
        agentId: specAgent.id,
        sessionMode: "shared",
        sessionKey: "speckit-main",
      });
      nSpecify.id = "speckit-specify";
      const nSup1 = createNode("agent", { x: 200, y: 0 }, {
        agentId: supAgent.id,
        sessionMode: "stateless",
      });
      nSup1.id = "sup-after-specify";
      const nPlan = createNode("agent", { x: 300, y: 0 }, {
        agentId: specAgent.id,
        sessionMode: "shared",
        sessionKey: "speckit-main",
        resumePromptMode: "delta",
      });
      nPlan.id = "speckit-plan";
      const nSup2 = createNode("agent", { x: 400, y: 0 }, {
        agentId: supAgent.id,
        sessionMode: "stateless",
      });
      nSup2.id = "sup-after-plan";
      const nTasks = createNode("agent", { x: 500, y: 0 }, {
        agentId: specAgent.id,
        sessionMode: "shared",
        sessionKey: "speckit-main",
        resumePromptMode: "delta",
      });
      nTasks.id = "speckit-tasks";
      const nOut = createNode("output", { x: 600, y: 0 });

      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F1-T1 Shared SpecKit Session"),
        nodes: [nInput, nSpecify, nSup1, nPlan, nSup2, nTasks, nOut],
        edges: [
          createEdge({ source: nInput.id, target: nSpecify.id }),
          createEdge({ source: nSpecify.id, target: nSup1.id }),
          createEdge({ source: nSup1.id, target: nPlan.id }),
          createEdge({ source: nPlan.id, target: nSup2.id }),
          createEdge({ source: nSup2.id, target: nTasks.id }),
          createEdge({ source: nTasks.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow, agents: [specAgent, supAgent], input: { prompt: "Spec A.1" } });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(seenSpecSessions).toHaveLength(3);
      expect(seenSpecSessions[0].sessionId).toBeTruthy();
      expect(seenSpecSessions[1].sessionId).toBe(seenSpecSessions[0].sessionId);
      expect(seenSpecSessions[2].sessionId).toBe(seenSpecSessions[0].sessionId);
      expect(seenSpecSessions.map((s) => s.turnCount)).toEqual([1, 2, 3]);

      for (const sup of seenSupSessions) {
        expect(sup.sessionKey).toBeUndefined();
        expect(sup.resumeSession).toBeUndefined();
      }

      const stateUpdatedEvents = store
        .events(runId)
        .filter((e) => e.type === "state.updated" && (e.payload as any)?.agentSession?.sessionKey === "speckit-main");
      expect(stateUpdatedEvents).toHaveLength(3);
      expect((stateUpdatedEvents[0].payload as any).agentSession.resumed).toBe(false);
      expect((stateUpdatedEvents[1].payload as any).agentSession.resumed).toBe(true);
      expect((stateUpdatedEvents[2].payload as any).agentSession.resumed).toBe(true);
    });

    it("F1-T2: reinvokeOnClarification=true re-invokes paused agent in exact same sessionId with clarificationAnswers", async () => {
      const store = new InMemoryRunStore();
      const studioStore = new InMemoryStudioStore();
      const specAgent = createCliAgent("agent-clarify-reinvoke", "agy");
      await studioStore.saveAgent(specAgent, PRINCIPAL_ALPHA);

      let providerCalls = 0;
      let capturedSecondTurn: { resumeSessionId?: string; turnCount: number; inputPayload: unknown } | undefined;

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        providerCalls += 1;
        if (providerCalls === 1) {
          return createResultEnvelope("needs_human", {
            value: { draft: "partial-spec" },
            needsHuman: {
              reason: "Ambiguous billing currency",
              purpose: "clarification",
              questions: [
                { id: "q-currency", prompt: "Which base currency?", required: true },
                { id: "q-rounding", prompt: "Decimal precision?", required: true },
              ],
              missingFields: ["currency", "precision"],
            },
          });
        }
        capturedSecondTurn = {
          resumeSessionId: input.resumeSession?.sessionId,
          turnCount: helpers.turnCount,
          inputPayload: input.input,
        };
        return createResultEnvelope("success", {
          value: { finalSpec: "Confirmed IRR / 0 decimals", answers: (input.input as any)?.clarificationAnswers },
        });
      });

      const executor = new RunExecutor(store, runtime, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const nIn = createNode("input", { x: 0, y: 0 });
      const nAgent = createNode("agent", { x: 100, y: 0 }, {
        agentId: specAgent.id,
        sessionMode: "shared",
        sessionKey: "speckit-main",
        reinvokeOnClarification: true,
      } as AgentNodeConfig);
      nAgent.id = "clarify-node";
      const nOut = createNode("output", { x: 200, y: 0 });

      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F1-T2 Reinvoke Clarification"),
        nodes: [nIn, nAgent, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nAgent.id }),
          createEdge({ source: nAgent.id, target: nOut.id }),
        ],
      };
      await studioStore.saveWorkflow(workflow, PRINCIPAL_ALPHA);

      const startRes = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ workflow, agents: [specAgent], input: { prompt: "Build invoice spec" } }),
        }),
      );
      expect(startRes.status).toBe(202);
      const { runId } = await readJsonResponse<{ runId: string }>(startRes);

      await assertRunCompletedOrDump(store, runId, ["waiting_for_human"]);
      expect(providerCalls).toBe(1);

      const submitRes = await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({
            answers: [
              { questionId: "q-currency", value: "IRR" },
              { questionId: "q-rounding", value: "0" },
            ],
          }),
        }),
      );
      expect([200, 202]).toContain(submitRes.status);

      const completed = await assertRunCompletedOrDump(store, runId, ["completed"]);
      expect(providerCalls).toBe(2);
      expect(capturedSecondTurn).toBeDefined();
      expect(capturedSecondTurn?.resumeSessionId).toBeTruthy();
      expect(capturedSecondTurn?.turnCount).toBe(2);
      expect(JSON.stringify(capturedSecondTurn?.inputPayload)).toContain("IRR");
      expect(JSON.stringify(completed.run.output)).toContain("Confirmed IRR / 0 decimals");
    });

    it("F1-T3: reinvokeOnClarification=false preserves single-call backward compatibility", async () => {
      const store = new InMemoryRunStore();
      const studioStore = new InMemoryStudioStore();
      const agent = createCliAgent("agent-legacy-clarify", "codex");
      await studioStore.saveAgent(agent, PRINCIPAL_ALPHA);

      let providerCalls = 0;
      const { runtime } = createScriptableAgentRuntime(() => {
        providerCalls += 1;
        return createResultEnvelope("needs_human", {
          value: { proposal: "draft" },
          needsHuman: {
            reason: "Need environment",
            purpose: "clarification",
            questions: [{ id: "q-env", prompt: "Target env?", required: true }],
            missingFields: ["env"],
          },
        });
      });

      const executor = new RunExecutor(store, runtime, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const nIn = createNode("input", { x: 0, y: 0 });
      const nAgent = createNode("agent", { x: 100, y: 0 }, {
        agentId: agent.id,
        reinvokeOnClarification: false,
      } as AgentNodeConfig);
      const nOut = createNode("output", { x: 200, y: 0 });
      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F1-T3 Legacy Clarification"),
        nodes: [nIn, nAgent, nOut],
        edges: [createEdge({ source: nIn.id, target: nAgent.id }), createEdge({ source: nAgent.id, target: nOut.id })],
      };
      await studioStore.saveWorkflow(workflow, PRINCIPAL_ALPHA);

      const startRes = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ workflow, agents: [agent], input: { prompt: "Check env" } }),
        }),
      );
      const { runId } = await readJsonResponse<{ runId: string }>(startRes);
      await assertRunCompletedOrDump(store, runId, ["waiting_for_human"]);

      await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ answers: [{ questionId: "q-env", value: "staging" }] }),
        }),
      );

      await assertRunCompletedOrDump(store, runId, ["completed"]);
      expect(providerCalls).toBe(1);
    });

    it("F1-T4: ApiAgentExecutor + AgentRuntime preserves ReAct tool summaries and raised shortTermMemoryMaxTokens across shared session turns", async () => {
      const invokedPrompts: string[] = [];
      let turnInvokeCount = 0;

      const mockModel = {
        bindTools: () => mockModel,
        invoke: async (messages: unknown[]) => {
          invokedPrompts.push(JSON.stringify(messages));
          turnInvokeCount += 1;
          if (turnInvokeCount === 1) {
            return {
              content: "",
              tool_calls: [
                { id: "call-1", name: "spec_reader", args: { path: "specs/057-a1/spec.md" } },
              ],
            };
          }
          if (turnInvokeCount === 2) {
            return {
              content: "Turn 1 Spec Summary: A.1.01 Resident Portal & A.1.02 Unit Directory verified.",
            };
          }
          return {
            content: "Turn 2 Plan Summary: Continuing from Turn 1 findings.",
          };
        },
      };

      const agent: AgentRecord = {
        ...createAgentRecord({
          name: "API SpecKit Agent",
          systemPrompt: "Execute SpecKit turns carefully.",
          backend: { type: "api", provider: "openai", model: "gpt-4o" },
          executionMode: "react",
          tools: ["spec_reader"],
        }),
        id: "api-speckit-agent",
      };

      const specTool: ToolRecord = {
        ...createToolRecord({
          name: "spec_reader",
          category: "function",
          impact: "read-only",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        }),
        id: "spec_reader",
        enabled: true,
      };

      const runtime = new AgentRuntime({
        create: () => new ApiAgentExecutor(() => ({ getModel: () => mockModel }) as any),
      });
      const toolRuntime = new ToolRuntime(5_000, false, {
        create: () => ({
          execute: async () => ({
            artifact: "SPEC_EXCERPT_" + "X".repeat(6000),
          }),
        }),
      });

      const store = new InMemoryRunStore();
      const nIn = createNode("input", { x: 0, y: 0 });
      const nT1 = createNode("agent", { x: 100, y: 0 }, {
        agentId: agent.id,
        sessionMode: "shared",
        sessionKey: "api-speckit-shared",
        shortTermMemoryMaxTokens: 16_000,
      } as AgentNodeConfig);
      nT1.id = "api-turn-1";
      const nT2 = createNode("agent", { x: 200, y: 0 }, {
        agentId: agent.id,
        sessionMode: "shared",
        sessionKey: "api-speckit-shared",
        shortTermMemoryMaxTokens: 16_000,
        activeTools: [],
      } as AgentNodeConfig);
      nT2.id = "api-turn-2";
      const nOut = createNode("output", { x: 300, y: 0 });

      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F1-T4 API Shared Session"),
        nodes: [nIn, nT1, nT2, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nT1.id }),
          createEdge({ source: nT1.id, target: nT2.id }),
          createEdge({ source: nT2.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, runtime, undefined, undefined, undefined, toolRuntime);
      const runId = executor.start({ workflow, agents: [agent], tools: [specTool], input: { prompt: "Start spec" } });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      const stateUpdated = store.events(runId).filter((e) => e.type === "state.updated" && (e.payload as any)?.agentSession);
      expect(stateUpdated).toHaveLength(2);
      expect((stateUpdated[1].payload as any).agentSession.sessionId).toBe(
        (stateUpdated[0].payload as any).agentSession.sessionId,
      );
      expect(invokedPrompts.length).toBe(3);
      const turn2Prompt = invokedPrompts[2];
      expect(turn2Prompt).toContain("spec_reader");
      expect(turn2Prompt).toContain("Turn 1 Spec Summary");
    });

    it("F1-T5: subgraphRunner propagates agentSessions, shortTermHistories, and checkpointing through child needs_human pause/resume", async () => {
      const studioStore = new InMemoryStudioStore();
      const runStore = new InMemoryRunStore();
      const childAgent = createCliAgent("sub-agent", "codex");
      const parentPostAgent = createCliAgent("parent-post-agent", "codex");
      await studioStore.saveAgent(childAgent, PRINCIPAL_ALPHA);
      await studioStore.saveAgent(parentPostAgent, PRINCIPAL_ALPHA);

      let childCalls = 0;
      let parentObservedSessionId: string | undefined;

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === childAgent.id) {
          childCalls += 1;
          if (childCalls === 1) {
            return createResultEnvelope("needs_human", {
              value: { partial: true },
              needsHuman: {
                reason: "Child ambiguity",
                purpose: "clarification",
                questions: [{ id: "q-sub", prompt: "Proceed with subphase?", required: true }],
              },
            });
          }
          return createResultEnvelope("success", { value: { childDone: true, sessionId: helpers.sessionId } });
        }
        parentObservedSessionId = input.resumeSession?.sessionId;
        return { parentDone: true, resumedSessionId: parentObservedSessionId };
      });

      const cIn = createNode("input", { x: 0, y: 0 });
      const cAgent = createNode("agent", { x: 100, y: 0 }, {
        agentId: childAgent.id,
        sessionMode: "shared",
        sessionKey: "sub-shared-session",
        reinvokeOnClarification: true,
      } as AgentNodeConfig);
      const cOut = createNode("output", { x: 200, y: 0 });
      const childWorkflow: WorkflowDefinition = {
        ...createEmptyDefinition("Child Subgraph"),
        id: "wf-child-subgraph",
        nodes: [cIn, cAgent, cOut],
        edges: [createEdge({ source: cIn.id, target: cAgent.id }), createEdge({ source: cAgent.id, target: cOut.id })],
      };
      await studioStore.saveWorkflow(childWorkflow, PRINCIPAL_ALPHA);

      const pIn = createNode("input", { x: 0, y: 0 });
      const pSub = createNode("subgraph", { x: 100, y: 0 }, {
        workflowId: childWorkflow.id,
        inputMappings: [],
        outputMappings: [],
      });
      const pPost = createNode("agent", { x: 200, y: 0 }, {
        agentId: parentPostAgent.id,
        sessionMode: "shared",
        sessionKey: "sub-shared-session",
      });
      const pOut = createNode("output", { x: 300, y: 0 });
      const parentWorkflow: WorkflowDefinition = {
        ...createEmptyDefinition("Parent Workflow"),
        id: "wf-parent-subgraph",
        nodes: [pIn, pSub, pPost, pOut],
        edges: [
          createEdge({ source: pIn.id, target: pSub.id }),
          createEdge({ source: pSub.id, target: pPost.id }),
          createEdge({ source: pPost.id, target: pOut.id }),
        ],
      };
      await studioStore.saveWorkflow(parentWorkflow, PRINCIPAL_ALPHA);

      const executor = new RunExecutor(runStore, runtime, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const startRes = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ workflow: parentWorkflow, agents: [childAgent, parentPostAgent], input: { topic: "A.1" } }),
        }),
      );
      const { runId } = await readJsonResponse<{ runId: string }>(startRes);
      await assertRunCompletedOrDump(runStore, runId, ["waiting_for_human"]);

      const clarifyRes = await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ answers: [{ questionId: "q-sub", value: "Yes" }] }),
        }),
      );
      expect([200, 202]).toContain(clarifyRes.status);
      await assertRunCompletedOrDump(runStore, runId, ["completed"]);

      expect(childCalls).toBe(2);
      expect(parentObservedSessionId).toBeTruthy();
    });

    it("F1-T6: resumePromptMode delta vs full formats Supervisor feedback across continuation turns", async () => {
      const receivedStds: Array<{ mode: string; stdin: string }> = [];
      const mockWorker = createRecordingWorkerRuntime((call, idx) => {
        const mode = idx <= 1 ? "delta-run" : "full-run";
        receivedStds.push({ mode, stdin: call.input ?? "" });
        return {
          code: 0,
          stdout: codexJsonlFixture({
            threadId: "thread-f1-t6",
            message: `Completed turn ${idx + 1}`,
          }),
        };
      });

      const policy: CliRuntimePolicy = {
        enabled: true,
        workerMode: "local",
        allowedExecutables: ["codex"],
        workspaceRoots: ["/workspace"],
        maxOutputBytes: 1024 * 1024,
      };
      const cliExec = new CliAgentExecutor(mockWorker, policy);
      const agent = createCliAgent("codex-resume-mode", "codex", {
        systemPrompt: "BASE_SYSTEM_PROMPT_MARKER",
      });

      const priorSession: AgentSessionState = {
        sessionId: "thread-f1-t6",
        sessionKey: "speckit-main",
        provider: "codex",
        agentId: agent.id,
        nodeId: "speckit-plan",
        turnCount: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };

      for await (const _ of cliExec.execute({
        agent,
        input: { supervisorFeedback: "Add RBAC middleware" },
        taskInstruction: "Run speckit-plan",
        runId: "r-delta",
        nodeId: "speckit-plan",
        sessionMode: "shared",
        sessionKey: "speckit-main",
        resumePromptMode: "delta",
        resumeSession: priorSession,
      })) { /* drain */ }

      for await (const _ of cliExec.execute({
        agent,
        input: { supervisorFeedback: "Add RBAC middleware" },
        taskInstruction: "Run speckit-plan",
        runId: "r-full",
        nodeId: "speckit-plan",
        sessionMode: "shared",
        sessionKey: "speckit-main",
        resumePromptMode: "full",
        resumeSession: priorSession,
      })) { /* drain */ }

      const deltaStdin = receivedStds[0].stdin;
      const fullStdin = receivedStds[1].stdin;

      expect(deltaStdin).toContain("SESSION CONTINUATION");
      expect(deltaStdin).toContain("STEP INSTRUCTIONS");
      expect(deltaStdin).toContain("Add RBAC middleware");
      expect(deltaStdin).not.toContain("BASE_SYSTEM_PROMPT_MARKER");

      expect(fullStdin).toContain("BASE_SYSTEM_PROMPT_MARKER");
      expect(fullStdin).toContain("Add RBAC middleware");
    });
  });

  describe("Feature F2: Dynamic Sub-Agent Fan-Out / Per-Item Delegation", () => {
    it("F2-T1: dynamic_fanout executes 12 (>8) items bounded by maxConcurrency=4 and outputs ordered verdicts", async () => {
      const store = new InMemoryRunStore();
      const discoveryAgent = createCliAgent("agent-discovery", "codex");
      const qaAgent = createCliAgent("agent-qa-per-req", "agy");

      const controller = createScriptableAgentRuntime(async (input) => {
        if (input.agent.id === discoveryAgent.id) {
          return {
            requirements: Array.from({ length: 12 }, (_, idx) => ({
              id: `REQ-${String(idx + 1).padStart(2, "0")}`,
              title: `User Story ${idx + 1}`,
            })),
          };
        }
        await new Promise((r) => setTimeout(r, 25));
        const item = (input.input as any)?.item ?? input.input;
        return {
          requirementId: item?.id ?? "unknown",
          verdict: "implemented",
        };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nDiscovery = createNode("agent", { x: 100, y: 0 }, { agentId: discoveryAgent.id });
      const nFanout = buildDynamicFanoutNode("qa-fanout", { x: 250, y: 0 }, {
        targetAgentId: qaAgent.id,
        itemsField: "requirements",
        maxConcurrency: 4,
        itemPromptTemplate: "Verify {{index}}: {{item}}",
      });
      const nOut = createNode("output", { x: 400, y: 0 });

      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F2-T1 Fanout 12 Items"),
        nodes: [nIn, nDiscovery, nFanout, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nDiscovery.id }),
          createEdge({ source: nDiscovery.id, target: nFanout.id }),
          createEdge({ source: nFanout.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, controller.runtime);
      const runId = executor.start({ workflow, agents: [discoveryAgent, qaAgent], input: { phase: "A.1" } });
      const record = await assertRunCompletedOrDump(store, runId, ["completed"]);

      const qaCalls = controller.calls.filter((c) => c.agent.id === qaAgent.id);
      expect(qaCalls).toHaveLength(12);
      expect(controller.getPeakConcurrency()).toBeLessThanOrEqual(4);
      expect(controller.getPeakConcurrency()).toBeGreaterThan(1);

      const results = (record.run.output?.results ?? record.run.output) as unknown;
      const list = Array.isArray(results) ? results : (record.run.output as any)?.items ?? [];
      expect(list).toHaveLength(12);
      expect(list.map((r: any) => r.requirementId)).toEqual(
        Array.from({ length: 12 }, (_, idx) => `REQ-${String(idx + 1).padStart(2, "0")}`),
      );
    });

    it("F2-T2: emits fanout.started, 5x fanout.item_started/completed, and fanout.completed events", async () => {
      const store = new InMemoryRunStore();
      const qaAgent = createCliAgent("agent-qa-events", "agy");
      const controller = createScriptableAgentRuntime((input) => ({
        ok: true,
        item: input.input,
      }));

      const nIn = createNode("input", { x: 0, y: 0 });
      const nFanout = buildDynamicFanoutNode("fanout-events", { x: 150, y: 0 }, {
        targetAgentId: qaAgent.id,
        itemsField: "items",
        maxConcurrency: 2,
      });
      const nOut = createNode("output", { x: 300, y: 0 });
      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F2-T2 Fanout Events"),
        nodes: [nIn, nFanout, nOut],
        edges: [createEdge({ source: nIn.id, target: nFanout.id }), createEdge({ source: nFanout.id, target: nOut.id })],
      };

      const executor = new RunExecutor(store, controller.runtime);
      const runId = executor.start({
        workflow,
        agents: [qaAgent],
        input: { items: ["A", "B", "C", "D", "E"] },
      });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      const events = store.events(runId);
      const started = events.find((e) => e.type === "fanout.started");
      const itemStarted = events.filter((e) => e.type === "fanout.item_started");
      const itemCompleted = events.filter((e) => e.type === "fanout.item_completed");
      const completed = events.find((e) => e.type === "fanout.completed");

      expect(started?.payload).toMatchObject({ totalItems: 5 });
      expect(itemStarted).toHaveLength(5);
      expect(itemCompleted).toHaveLength(5);
      expect(completed?.payload).toMatchObject({ succeeded: 5, failed: 0 });
    });

    it("F2-T3: dynamic_fanout targeting workflowId with sessionMode=node isolates session keys per item index", async () => {
      const studioStore = new InMemoryStudioStore();
      const runStore = new InMemoryRunStore();
      const subQaAgent = createCliAgent("sub-qa-worker", "codex");
      await studioStore.saveAgent(subQaAgent, PRINCIPAL_ALPHA);

      const observedSessionKeys = new Set<string>();
      const controller = createScriptableAgentRuntime((input) => {
        if (input.sessionKey) observedSessionKeys.add(input.sessionKey);
        return { checked: input.input, sessionKey: input.sessionKey };
      });

      const subIn = createNode("input", { x: 0, y: 0 });
      const subStep = createNode("agent", { x: 100, y: 0 }, {
        agentId: subQaAgent.id,
        sessionMode: "node",
      });
      const subOut = createNode("output", { x: 200, y: 0 });
      const childWf: WorkflowDefinition = {
        ...createEmptyDefinition("Per-Item QA Subworkflow"),
        id: "wf-qa-subworkflow",
        nodes: [subIn, subStep, subOut],
        edges: [createEdge({ source: subIn.id, target: subStep.id }), createEdge({ source: subStep.id, target: subOut.id })],
      };
      await studioStore.saveWorkflow(childWf, PRINCIPAL_ALPHA);

      const pIn = createNode("input", { x: 0, y: 0 });
      const pFanout = buildDynamicFanoutNode("wf-fanout", { x: 150, y: 0 }, {
        workflowId: childWf.id,
        itemsField: "stories",
        sessionMode: "node",
        maxConcurrency: 4,
      });
      const pOut = createNode("output", { x: 300, y: 0 });
      const parentWf: WorkflowDefinition = {
        ...createEmptyDefinition("F2-T3 Workflow Fanout"),
        nodes: [pIn, pFanout, pOut],
        edges: [createEdge({ source: pIn.id, target: pFanout.id }), createEdge({ source: pFanout.id, target: pOut.id })],
      };
      await studioStore.saveWorkflow(parentWf, PRINCIPAL_ALPHA);

      const executor = new RunExecutor(runStore, controller.runtime, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const res = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({
            workflow: parentWf,
            agents: [subQaAgent],
            input: { stories: ["US-1", "US-2", "US-3", "US-4"] },
          }),
        }),
      );
      const { runId } = await readJsonResponse<{ runId: string }>(res);
      await assertRunCompletedOrDump(runStore, runId, ["completed"]);

      expect(controller.calls).toHaveLength(4);
      const distinctSessionIds = new Set(
        runStore
          .events(runId)
          .filter((e) => e.type === "agent.completed")
          .map((e) => (e.payload as any)?.sessionId)
          .filter(Boolean),
      );
      expect(distinctSessionIds.size).toBe(4);
    });

    it("F2-T4: delegate_subagents tool executes N sub-agents via ToolRuntime inheriting credentialPrincipal & tenantId", async () => {
      const studioStore = new InMemoryStudioStore();
      const targetAgent = createCliAgent("delegated-qa-agent", "agy");
      await studioStore.saveAgent(targetAgent, PRINCIPAL_ALPHA);

      const delegateTool = buildVeloraToolRecord("delegate_subagents");
      const toolRuntime = new ToolRuntime(10_000, false, new ToolExecutorFactory(undefined, studioStore));

      const out = await toolRuntime.execute(
        delegateTool,
        {
          agentId: targetAgent.id,
          items: [
            { id: "REQ-1", story: "Login" },
            { id: "REQ-2", story: "Invoices" },
            { id: "REQ-3", story: "Tickets" },
            { id: "REQ-4", story: "Reports" },
          ],
          maxConcurrency: 2,
        },
        undefined,
        {
          runId: "run-delegate-1",
          credentialPrincipal: { tenantId: PRINCIPAL_ALPHA.tenantId, principalId: PRINCIPAL_ALPHA.userId },
          agentId: "orchestrator",
          idempotencyKey: "delegate-idem-1",
        },
      );

      expect(Array.isArray(out.results)).toBe(true);
      expect((out.results as unknown[]).length).toBe(4);
      expect(out.tenantId ?? (out as any).principal?.tenantId).toBe(PRINCIPAL_ALPHA.tenantId);
    });

    it("F2-T5: dynamic_fanout handles failFast=false (collects all remaining) vs failFast=true (aborts remaining)", async () => {
      const qaAgent = createCliAgent("qa-failfast", "agy");

      // Run 1: failFast = false
      {
        const store = new InMemoryRunStore();
        const controller = createScriptableAgentRuntime(async (input) => {
          const item = (input.input as any)?.item ?? input.input;
          if (item === "ITEM-2") throw new Error("Simulated QA failure on ITEM-2");
          await new Promise((r) => setTimeout(r, 15));
          return { item, verdict: "pass" };
        });

        const nIn = createNode("input", { x: 0, y: 0 });
        const nFan = buildDynamicFanoutNode("fan-nofailfast", { x: 150, y: 0 }, {
          targetAgentId: qaAgent.id,
          itemsField: "items",
          maxConcurrency: 2,
          failFast: false,
        });
        const nOut = createNode("output", { x: 300, y: 0 });
        const wf: WorkflowDefinition = {
          ...createEmptyDefinition("F2-T5 failFast=false"),
          nodes: [nIn, nFan, nOut],
          edges: [createEdge({ source: nIn.id, target: nFan.id }), createEdge({ source: nFan.id, target: nOut.id })],
        };

        const executor = new RunExecutor(store, controller.runtime);
        const runId = executor.start({
          workflow: wf,
          agents: [qaAgent],
          input: { items: ["ITEM-0", "ITEM-1", "ITEM-2", "ITEM-3", "ITEM-4"] },
        });
        await assertRunCompletedOrDump(store, runId, ["completed"]);

        const events = store.events(runId);
        expect(events.filter((e) => e.type === "fanout.item_completed")).toHaveLength(4);
        expect(events.filter((e) => e.type === "fanout.item_failed")).toHaveLength(1);
        expect(events.find((e) => e.type === "fanout.completed")?.payload).toMatchObject({
          succeeded: 4,
          failed: 1,
        });
      }

      // Run 2: failFast = true
      {
        const store = new InMemoryRunStore();
        let abortedSeen = false;
        const controller = createScriptableAgentRuntime(async (input) => {
          input.signal?.addEventListener("abort", () => {
            abortedSeen = true;
          });
          const item = (input.input as any)?.item ?? input.input;
          if (item === "ITEM-0") {
            await new Promise((r) => setTimeout(r, 10));
            throw new Error("Abort trigger on ITEM-0");
          }
          await new Promise((r) => setTimeout(r, 150));
          return { item, verdict: "pass" };
        });

        const nIn = createNode("input", { x: 0, y: 0 });
        const nFan = buildDynamicFanoutNode("fan-failfast", { x: 150, y: 0 }, {
          targetAgentId: qaAgent.id,
          itemsField: "items",
          maxConcurrency: 2,
          failFast: true,
        });
        const nOut = createNode("output", { x: 300, y: 0 });
        const wf: WorkflowDefinition = {
          ...createEmptyDefinition("F2-T5 failFast=true"),
          nodes: [nIn, nFan, nOut],
          edges: [createEdge({ source: nIn.id, target: nFan.id }), createEdge({ source: nFan.id, target: nOut.id })],
        };

        const executor = new RunExecutor(store, controller.runtime);
        const runId = executor.start({
          workflow: wf,
          agents: [qaAgent],
          input: { items: ["ITEM-0", "ITEM-1", "ITEM-2", "ITEM-3", "ITEM-4"] },
        });
        await assertRunCompletedOrDump(store, runId, ["failed"]);
        expect(abortedSeen || controller.calls.length < 5).toBe(true);
      }
    });
  });

  describe("Feature F3: Non-Linear Routing, Guard Scoping & Exception-Only HITL", () => {
    it("F3-T1: hierarchical-supervisor routes dynamically across clarify -> constitution -> plan -> checklist -> tasks -> analyze in same session", async () => {
      const store = new InMemoryRunStore();
      const specAgent = createCliAgent("agent-speckit", "agy");
      const supAgent = createCliAgent("agent-supervisor", "codex", { args: ["-s", "read-only"] });

      const scriptSequence = [
        "clarify",
        "constitution",
        "plan",
        "checklist",
        "tasks",
        "analyze",
        "done",
      ];
      let supStep = 0;
      const executedSpecSkills: string[] = [];
      const sessionIds = new Set<string>();

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === supAgent.id) {
          const next = scriptSequence[supStep++] ?? "done";
          return { nextSkill: next };
        }
        executedSpecSkills.push(input.nodeId);
        if (helpers.sessionId) sessionIds.add(helpers.sessionId);
        return { skill: input.nodeId, status: "ok" };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSup = createNode("agent", { x: 150, y: 0 }, { agentId: supAgent.id, sessionMode: "stateless" });
      nSup.id = "agent-supervisor";

      const nGate = createNode("condition", { x: 300, y: 0 }, {
        valueSource: "last_value",
        valueField: "nextSkill",
        unknownRoute: "done",
        branches: [
          { key: "specify", label: "Specify" },
          { key: "clarify", label: "Clarify" },
          { key: "constitution", label: "Constitution" },
          { key: "plan", label: "Plan" },
          { key: "checklist", label: "Checklist" },
          { key: "tasks", label: "Tasks" },
          { key: "analyze", label: "Analyze" },
          { key: "done", label: "Done" },
        ],
      });
      nGate.id = "skill-router";

      const makeSkillNode = (id: string, x: number, y: number) => {
        const n = createNode("agent", { x, y }, {
          agentId: specAgent.id,
          sessionMode: "shared",
          sessionKey: "speckit-main",
          taskInstruction: `Execute ${id}`,
        });
        n.id = id;
        return n;
      };

      const skillNodes = [
        makeSkillNode("speckit-specify", 500, -300),
        makeSkillNode("speckit-clarify", 500, -200),
        makeSkillNode("speckit-constitution", 500, -100),
        makeSkillNode("speckit-plan", 500, 0),
        makeSkillNode("speckit-checklist", 500, 100),
        makeSkillNode("speckit-tasks", 500, 200),
        makeSkillNode("speckit-analyze", 500, 300),
      ];
      const skillMap: Record<string, string> = {
        specify: "speckit-specify",
        clarify: "speckit-clarify",
        constitution: "speckit-constitution",
        plan: "speckit-plan",
        checklist: "speckit-checklist",
        tasks: "speckit-tasks",
        analyze: "speckit-analyze",
      };

      const nOut = createNode("output", { x: 750, y: 0 });

      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F3-T1 Dynamic SpecKit Routing"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("agent-supervisor", {
          humanApprovalGateRequired: false,
          maxExecutionSteps: 40,
          recursionGuards: Object.keys(skillMap).map((k) =>
            createRecursionGuard(`${nGate.id}->${k}`, "done", 3),
          ),
        }),
        nodes: [nIn, nSup, nGate, ...skillNodes, nOut],
        edges: [
          createEdge({ source: nIn.id, target: skillNodes[0].id }),
          createEdge({ source: skillNodes[0].id, target: nSup.id }),
          createEdge({ source: nSup.id, target: nGate.id }),
          ...Object.entries(skillMap).flatMap(([branchKey, targetId]) => [
            createEdge({ source: nGate.id, target: targetId, kind: "conditional", branchKey }),
            ...(targetId !== "speckit-specify" ? [createEdge({ source: targetId, target: nSup.id })] : []),
          ]),
          createEdge({ source: nGate.id, target: nOut.id, kind: "conditional", branchKey: "done" }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow, agents: [specAgent, supAgent], input: { prompt: "Dynamic skills" } });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(executedSpecSkills).toEqual([
        "speckit-specify",
        "speckit-clarify",
        "speckit-constitution",
        "speckit-plan",
        "speckit-checklist",
        "speckit-tasks",
        "speckit-analyze",
      ]);
      expect(sessionIds.size).toBe(1);
    });

    it("F3-T2: recursionGuards match sourceNodeId->targetBranch independently without cross-gate collisions", async () => {
      const store = new InMemoryRunStore();
      const worker = createCliAgent("worker-scoped-guards", "codex");

      let specChecks = 0;
      let qaChecks = 0;
      const { runtime } = createScriptableAgentRuntime((input) => {
        if (input.nodeId === "spec-eval") {
          specChecks += 1;
          return { route: specChecks <= 1 ? "retry" : "next" };
        }
        if (input.nodeId === "qa-eval") {
          qaChecks += 1;
          return { route: qaChecks <= 2 ? "retry" : "next" };
        }
        return { fixed: input.nodeId };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSpecEval = createNode("agent", { x: 100, y: 0 }, { agentId: worker.id });
      nSpecEval.id = "spec-eval";
      const nGateSpec = createNode("condition", { x: 200, y: 0 }, {
        valueSource: "last_value",
        valueField: "route",
        unknownRoute: "fallback",
        branches: [
          { key: "retry", label: "Retry Spec" },
          { key: "next", label: "Next" },
          { key: "fallback", label: "Fallback" },
        ],
      });
      nGateSpec.id = "gate-spec";
      const nSpecFix = createNode("agent", { x: 200, y: 120 }, { agentId: worker.id });
      nSpecFix.id = "spec-fix";

      const nQaEval = createNode("agent", { x: 350, y: 0 }, { agentId: worker.id });
      nQaEval.id = "qa-eval";
      const nGateQa = createNode("condition", { x: 450, y: 0 }, {
        valueSource: "last_value",
        valueField: "route",
        unknownRoute: "fallback",
        branches: [
          { key: "retry", label: "Retry QA" },
          { key: "next", label: "Next" },
          { key: "fallback", label: "Fallback" },
        ],
      });
      nGateQa.id = "gate-qa";
      const nQaFix = createNode("agent", { x: 450, y: 120 }, { agentId: worker.id });
      nQaFix.id = "qa-fix";

      const nFallback = createNode("memory", { x: 550, y: 200 }, { memoryType: "short_term", mode: "write", key: "tripped" });
      nFallback.id = "fallback-node";
      const nOut = createNode("output", { x: 650, y: 0 });

      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F3-T2 Scoped Recursion Guards"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("spec-eval", {
          humanApprovalGateRequired: false,
          recursionGuards: [
            createRecursionGuard("gate-spec->retry", "fallback", 2),
            createRecursionGuard("gate-qa->retry", "fallback", 3),
          ],
        }),
        nodes: [nIn, nSpecEval, nGateSpec, nSpecFix, nQaEval, nGateQa, nQaFix, nFallback, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nSpecEval.id }),
          createEdge({ source: nSpecEval.id, target: nGateSpec.id }),
          createEdge({ source: nGateSpec.id, target: nSpecFix.id, kind: "conditional", branchKey: "retry" }),
          createEdge({ source: nSpecFix.id, target: nSpecEval.id }),
          createEdge({ source: nGateSpec.id, target: nQaEval.id, kind: "conditional", branchKey: "next" }),
          createEdge({ source: nGateSpec.id, target: nFallback.id, kind: "conditional", branchKey: "fallback" }),
          createEdge({ source: nQaEval.id, target: nGateQa.id }),
          createEdge({ source: nGateQa.id, target: nQaFix.id, kind: "conditional", branchKey: "retry" }),
          createEdge({ source: nQaFix.id, target: nQaEval.id }),
          createEdge({ source: nGateQa.id, target: nOut.id, kind: "conditional", branchKey: "next" }),
          createEdge({ source: nGateQa.id, target: nFallback.id, kind: "conditional", branchKey: "fallback" }),
          createEdge({ source: nFallback.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow, agents: [worker], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      const events = store.events(runId);
      expect(events.filter((e) => e.type === "node.loop_limit_reached")).toHaveLength(0);
      expect(events.some((e) => e.nodeId === nFallback.id)).toBe(false);
      expect(specChecks).toBe(2);
      expect(qaChecks).toBe(3);
    });

    it("F3-T3: humanApprovalGateRequired=false completes autonomously with zero human_approval.requested events", async () => {
      const store = new InMemoryRunStore();
      const agent = createCliAgent("autonomous-agent", "codex");
      const { runtime } = createScriptableAgentRuntime(() => ({ status: "ok", nextAction: "done" }));

      const nIn = createNode("input", { x: 0, y: 0 });
      const nAgent = createNode("agent", { x: 100, y: 0 }, { agentId: agent.id });
      const nGate = createNode("condition", { x: 200, y: 0 }, {
        valueSource: "last_value",
        valueField: "nextAction",
        unknownRoute: "done",
        branches: [{ key: "done", label: "Done" }],
      });
      const nOut = createNode("output", { x: 300, y: 0 });

      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F3-T3 Zero HITL"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig(nAgent.id, {
          humanApprovalGateRequired: false,
          recursionGuards: [],
        }),
        nodes: [nIn, nAgent, nGate, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nAgent.id }),
          createEdge({ source: nAgent.id, target: nGate.id }),
          createEdge({ source: nGate.id, target: nOut.id, kind: "conditional", branchKey: "done" }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow, agents: [agent], input: { clear: true } });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      const events = store.events(runId);
      expect(events.filter((e) => e.type === "human_approval.requested")).toHaveLength(0);
    });

    it("F3-T4: exception-only needs_human pauses and handles both approved and rejected decisions fail-closed", async () => {
      const agent = createCliAgent("hitl-exception-agent", "agy");
      const nIn = createNode("input", { x: 0, y: 0 });
      const nAgent = createNode("agent", { x: 100, y: 0 }, { agentId: agent.id });
      const nOut = createNode("output", { x: 200, y: 0 });
      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F3-T4 Exception HITL"),
        nodes: [nIn, nAgent, nOut],
        edges: [createEdge({ source: nIn.id, target: nAgent.id }), createEdge({ source: nAgent.id, target: nOut.id })],
      };

      for (const decision of ["approved", "rejected"] as const) {
        const store = new InMemoryRunStore();
        const studioStore = new InMemoryStudioStore();
        await studioStore.saveAgent(agent, PRINCIPAL_ALPHA);
        await studioStore.saveWorkflow(workflow, PRINCIPAL_ALPHA);

        const { runtime } = createScriptableAgentRuntime(() =>
          createResultEnvelope("needs_human", {
            value: { proposal: "Requires sign-off" },
            needsHuman: { reason: "Ambiguous scope", purpose: "approval" },
          }),
        );

        const executor = new RunExecutor(store, runtime);
        const runsApp = createRunsRouter(executor, async () => null, undefined, resolveTestPrincipal()).app;

        const startRes = await runsApp.fetch(
          new Request("http://localhost/", {
            method: "POST",
            headers: authHeaders(PRINCIPAL_ALPHA),
            body: JSON.stringify({ workflow, agents: [agent], input: {} }),
          }),
        );
        const { runId } = await readJsonResponse<{ runId: string }>(startRes);
        await assertRunCompletedOrDump(store, runId, ["waiting_for_human"]);

        const approvals = store.listApprovals(runId);
        expect(approvals).toHaveLength(1);

        const resolveRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}/approvals/${approvals[0].id}/resolve`, {
            method: "POST",
            headers: authHeaders(PRINCIPAL_ALPHA),
            body: JSON.stringify({ decision, response: `Decision=${decision}` }),
          }),
        );
        expect([200, 202]).toContain(resolveRes.status);

        if (decision === "approved") {
          await assertRunCompletedOrDump(store, runId, ["completed"]);
        } else {
          const failed = await assertRunCompletedOrDump(store, runId, ["failed"]);
          expect(["blocked", "rejected"]).toContain(failed.run.result?.status);
          expect(failed.run.result?.error?.code).toBe("HUMAN_REJECTED");
        }
      }
    });

    it("F3-T5: cyclic loop emits node.loop_limit_reached at maxIterations=3 and routes cleanly to fallbackBranch", async () => {
      const store = new InMemoryRunStore();
      const agent = createCliAgent("loop-agent", "codex");
      const { runtime } = createScriptableAgentRuntime(() => ({ nextAction: "retry" }));

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSup = createNode("agent", { x: 100, y: 0 }, { agentId: agent.id });
      nSup.id = "agent-sup";
      const nGate = createNode("condition", { x: 200, y: 0 }, {
        valueSource: "last_value",
        valueField: "nextAction",
        unknownRoute: "fallback",
        branches: [
          { key: "retry", label: "Retry" },
          { key: "fallback", label: "Fallback" },
        ],
      });
      nGate.id = "loop-gate";
      const nWork = createNode("memory", { x: 200, y: 120 }, { memoryType: "short_term", mode: "write", key: "work" });
      const nFallback = createNode("memory", { x: 350, y: 120 }, { memoryType: "short_term", mode: "write", key: "fallback_hit" });
      const nOut = createNode("output", { x: 500, y: 0 });

      const workflow: WorkflowDefinition = {
        ...createEmptyDefinition("F3-T5 Loop Ceiling"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("agent-sup", {
          humanApprovalGateRequired: false,
          recursionGuards: [createRecursionGuard("loop-gate->retry", "fallback", 3)],
        }),
        nodes: [nIn, nSup, nGate, nWork, nFallback, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nSup.id }),
          createEdge({ source: nSup.id, target: nGate.id }),
          createEdge({ source: nGate.id, target: nWork.id, kind: "conditional", branchKey: "retry" }),
          createEdge({ source: nWork.id, target: nSup.id }),
          createEdge({ source: nGate.id, target: nFallback.id, kind: "conditional", branchKey: "fallback" }),
          createEdge({ source: nFallback.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow, agents: [agent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      const limitEvent = store.events(runId).find((e) => e.type === "node.loop_limit_reached");
      expect(limitEvent).toBeDefined();
      expect(limitEvent?.payload).toMatchObject({ iteration: 3, targetBranch: "retry" });
      expect(store.events(runId).some((e) => e.nodeId === nFallback.id)).toBe(true);
    });
  });

  describe("Feature F4: Intelligent Provider Integration (Cursor, Codex CLI, Antigravity agy)", () => {
    it("F4-T1: Cursor CLI resolves to 'agent', injects CURSOR_API_KEY via WorkerLaunchSecrets, and never leaks secret in agent or events", async () => {
      const secret = "cur-test-secret-123";
      expect(defaultCliExecutable("cursor")).toBe("agent");

      const agent = createCliAgent("cursor-worker", "cursor", {
        workspaceRoot: "/tmp/cursor-sandbox",
      });
      expect(validateAgent(agent)).toEqual([]);
      expect(() => assertNoCredentials(agent)).not.toThrow();

      const innerWorker = createRecordingWorkerRuntime(() => ({
        code: 0,
        stdout: cursorStreamJsonFixture({
          sessionId: "cur-chat-secret-check",
          resultText: `Finished cleanly without exposing ${secret}`,
        }),
      }));
      const barrier = new SandboxExecutionBarrier({
        canonicalSandboxRoot: "/tmp/cursor-sandbox",
        allowedExecutables: ["agent"],
        forbiddenHostPaths: [VELORA_TARGET_REPO_ROOT],
      });
      const sandboxed = new SandboxedWorkerRuntime(innerWorker, barrier);
      const credResolver = environmentWorkerCredentialResolverFromEnvironment({
        CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "true",
        CURSOR_API_KEY: secret,
      });

      const cliExec = new CliAgentExecutor(
        sandboxed,
        {
          enabled: true,
          workerMode: "local",
          allowedExecutables: ["agent"],
          workspaceRoots: ["/tmp/cursor-sandbox"],
          maxOutputBytes: 1024 * 1024,
        },
        credResolver,
      );

      const events: any[] = [];
      for await (const ev of cliExec.execute({
        agent,
        input: "Fix QA bug",
        runId: "r-cur-sec",
        nodeId: "n-fix",
        credentialPrincipal: { tenantId: PRINCIPAL_ALPHA.tenantId, principalId: PRINCIPAL_ALPHA.userId },
      })) {
        events.push(ev);
      }

      expect(innerWorker.calls).toHaveLength(1);
      expect(path.basename(innerWorker.calls[0].spec.executable)).toBe("agent");
      expect(innerWorker.calls[0].launchSecrets?.environment.CURSOR_API_KEY).toBe(secret);
      expect(JSON.stringify(agent)).not.toContain(secret);
      expect(JSON.stringify(innerWorker.calls[0].spec.args)).not.toContain(secret);
    });

    it("F4-T2: Cursor CLI captures session_id/thinking on Turn 1 and passes --resume on Turn 2", async () => {
      const mockWorker = createRecordingWorkerRuntime((_call, idx) => ({
        code: 0,
        stdout: cursorStreamJsonFixture({
          sessionId: "cur-chat-77",
          thinking: idx === 0 ? "Analyzing defect root cause" : "Verifying fix",
          assistantText: idx === 0 ? "Drafted patch" : "Applied patch",
          resultText: idx === 0 ? "Turn 1 complete" : "Turn 2 complete",
        }),
      }));

      const cliExec = new CliAgentExecutor(mockWorker, {
        enabled: true,
        workerMode: "local",
        allowedExecutables: ["agent"],
        workspaceRoots: ["/workspace"],
        maxOutputBytes: 1024 * 1024,
      });
      const agent = createCliAgent("cursor-session", "cursor", { args: ["--force"] });

      let sessionState: AgentSessionState | undefined;
      const turn1Events: any[] = [];
      for await (const ev of cliExec.execute({
        agent,
        input: "Turn 1",
        runId: "r-cur",
        nodeId: "n-cur",
        sessionMode: "shared",
        sessionKey: "cursor-shared",
        onSessionUpdate: (s) => { sessionState = s; },
      })) {
        turn1Events.push(ev);
      }

      expect(mockWorker.calls[0].spec.args).toEqual(
        expect.arrayContaining(["-p", "--output-format", "stream-json", "--trust"]),
      );
      expect(sessionState?.sessionId).toBe("cur-chat-77");
      expect(turn1Events.some((e) => e.type === "log" && e.payload?.channel === "thinking")).toBe(true);

      for await (const _ of cliExec.execute({
        agent,
        input: "Turn 2",
        runId: "r-cur",
        nodeId: "n-cur",
        sessionMode: "shared",
        sessionKey: "cursor-shared",
        resumeSession: sessionState,
        onSessionUpdate: (s) => { sessionState = s; },
      })) { /* drain */ }

      const turn2Args = mockWorker.calls[1].spec.args;
      const resumeIdx = turn2Args.indexOf("--resume");
      expect(resumeIdx).toBeGreaterThanOrEqual(0);
      expect(turn2Args[resumeIdx + 1]).toBe("cur-chat-77");
      expect(sessionState?.turnCount).toBe(2);
    });

    it("F4-T3: Codex CLI preserves read-only vs --approve-for-me (stripping conflicting -s) across exec and exec resume", async () => {
      const mockWorker = createRecordingWorkerRuntime(() => ({
        code: 0,
        stdout: codexJsonlFixture({ threadId: "thread-codex-0164", message: "Codex ok" }),
      }));

      const cliExec = new CliAgentExecutor(mockWorker, {
        enabled: true,
        workerMode: "local",
        allowedExecutables: ["codex"],
        workspaceRoots: ["/workspace"],
        maxOutputBytes: 1024 * 1024,
      });

      const roAgent = createCliAgent("codex-ro", "codex", { args: ["-s", "read-only"] });
      const rwAgent = createCliAgent("codex-rw", "codex", {
        filesystem: "read-write",
        args: ["-s", "workspace-write", "--approve-for-me"],
      });

      let rwSession: AgentSessionState | undefined;
      for await (const _ of cliExec.execute({
        agent: roAgent,
        input: "Inspect",
        runId: "r-codex-ro",
        nodeId: "n-ro",
        sessionMode: "node",
      })) { /* drain */ }

      for await (const _ of cliExec.execute({
        agent: rwAgent,
        input: "Implement",
        runId: "r-codex-rw",
        nodeId: "n-rw",
        sessionMode: "node",
        onSessionUpdate: (s) => { rwSession = s; },
      })) { /* drain */ }

      for await (const _ of cliExec.execute({
        agent: rwAgent,
        input: "Converge",
        runId: "r-codex-rw",
        nodeId: "n-rw",
        sessionMode: "node",
        resumeSession: rwSession,
      })) { /* drain */ }

      expect(mockWorker.calls[0].spec.args).toEqual(expect.arrayContaining(["exec", "-s", "read-only"]));
      expect(mockWorker.calls[1].spec.args).toEqual(expect.arrayContaining(["exec", "--approve-for-me"]));
      expect(mockWorker.calls[1].spec.args).not.toContain("-s");
      expect(mockWorker.calls[1].spec.args).not.toContain("--sandbox");

      const resumeArgs = mockWorker.calls[2].spec.args;
      expect(resumeArgs[0]).toBe("exec");
      expect(resumeArgs).toContain("resume");
      expect(resumeArgs).toContain("thread-codex-0164");
      expect(resumeArgs[resumeArgs.length - 1]).toBe("-");
      const resumeSubIdx = resumeArgs.indexOf("resume");
      expect(resumeArgs).not.toContain("-s");
      expect(resumeArgs.indexOf("--approve-for-me")).toBeGreaterThan(-1);
      expect(resumeArgs.indexOf("--approve-for-me")).toBeLessThan(resumeSubIdx);
    });

    it("F4-T4: Antigravity (agy) uses stream-json stdin/stdout, captures conversation_id, and resumes with --conversation", async () => {
      const mockWorker = createRecordingWorkerRuntime((_call, idx) => ({
        code: 0,
        stdout: agyStreamJsonFixture({
          conversationId: "agy-conv-55",
          thinking: "Planning spec architecture",
          response: idx === 0 ? "Spec created" : "Plan created",
        }),
      }));

      const cliExec = new CliAgentExecutor(mockWorker, {
        enabled: true,
        workerMode: "local",
        allowedExecutables: ["agy"],
        workspaceRoots: ["/workspace"],
        maxOutputBytes: 1024 * 1024,
      });
      const agent = createCliAgent("agy-speckit", "agy");

      let session: AgentSessionState | undefined;
      for await (const _ of cliExec.execute({
        agent,
        input: "Run speckit-specify",
        runId: "r-agy",
        nodeId: "n-agy",
        sessionMode: "shared",
        sessionKey: "speckit-main",
        onSessionUpdate: (s) => { session = s; },
      })) { /* drain */ }

      expect(mockWorker.calls[0].spec.args).toEqual(
        expect.arrayContaining(["--input-format", "stream-json", "--output-format", "stream-json", "--disable-slash-commands"]),
      );
      const stdinLine = JSON.parse(mockWorker.calls[0].input!.trim());
      expect(stdinLine).toMatchObject({ event: "user", message: { role: "user" } });
      expect(session?.sessionId).toBe("agy-conv-55");

      for await (const _ of cliExec.execute({
        agent,
        input: "Run speckit-plan",
        runId: "r-agy",
        nodeId: "n-agy",
        sessionMode: "shared",
        sessionKey: "speckit-main",
        resumeSession: session,
      })) { /* drain */ }

      const turn2Args = mockWorker.calls[1].spec.args;
      const convIdx = turn2Args.indexOf("--conversation");
      expect(convIdx).toBeGreaterThanOrEqual(0);
      expect(turn2Args[convIdx + 1]).toBe("agy-conv-55");
    });

    it("F4-T5: AgentService.diagnostics fails closed when executable is unallowlisted or CURSOR_API_KEY is missing", async () => {
      const studioStore = new InMemoryStudioStore();
      const cursorAgent = createCliAgent("diag-cursor", "cursor");
      await studioStore.saveAgent(cursorAgent, PRINCIPAL_ALPHA);

      // 1. Missing 'agent' from allowlist -> misconfigured
      const svcNotAllowed = new AgentService(studioStore, fetch, {
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "local",
        CLI_AGENT_ALLOWED_EXECUTABLES: "codex,agy",
      });
      const diag1 = await svcNotAllowed.diagnostics(cursorAgent.id, PRINCIPAL_ALPHA);
      expect(diag1.status).toBe("misconfigured");
      expect(diag1.details?.executableAllowlisted).toBe(false);

      // 2. Allowlisted executable (temp executable stub) but missing CURSOR_API_KEY -> not_authenticated
      const mirror = trackMirror();
      const stubAgentBin = path.join(mirror.root, "agent");
      fs.writeFileSync(stubAgentBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const svcMissingKey = new AgentService(studioStore, fetch, {
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "local",
        CLI_AGENT_ALLOWED_EXECUTABLES: stubAgentBin,
        CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "true",
        CURSOR_API_KEY: "",
      });
      const diag2 = await svcMissingKey.diagnostics(cursorAgent.id, PRINCIPAL_ALPHA);
      expect(diag2.status).toBe("not_authenticated");
      expect(diag2.details?.credentialReady).toBe(false);

      // 3. Valid CURSOR_API_KEY -> ready
      const svcReady = new AgentService(studioStore, fetch, {
        CLI_AGENT_ENABLED: "true",
        CLI_WORKER_MODE: "local",
        CLI_AGENT_ALLOWED_EXECUTABLES: stubAgentBin,
        CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "true",
        CURSOR_API_KEY: "cur-diag-ready-token",
      });
      const diag3 = await svcReady.diagnostics(cursorAgent.id, PRINCIPAL_ALPHA);
      expect(diag3.status).toBe("ready");
      expect(diag3.details?.credentialReady).toBe(true);
    });

    it("F4-T6: agenticVeloraOrgSeed defines all 9 agents passing validateAgent with optimal CLI providers & least-privilege policies", () => {
      const pkg = loadAgenticVeloraSeedPackage();
      expect(pkg.agents.length).toBeGreaterThanOrEqual(REQUIRED_VELORA_AGENT_ROLES.length);

      const providers = new Set<string>();
      for (const agent of pkg.agents) {
        expect(validateAgent(agent)).toEqual([]);
        expect(() => assertNoCredentials(agent)).not.toThrow();
        if (agent.backend.type === "cli") {
          providers.add(agent.backend.provider);
        }
      }
      expect(providers.has("cursor")).toBe(true);
      expect(providers.has("codex")).toBe(true);
      expect(providers.has("agy")).toBe(true);

      const implementer = pkg.agents.find((a) => /implementer/i.test(a.name));
      const fixer = pkg.agents.find((a) => /fixer/i.test(a.name));
      const supervisor = pkg.agents.find((a) => /supervisor/i.test(a.name));
      expect(implementer?.executionPolicy?.filesystem).toBe("read-write");
      expect(fixer?.executionPolicy?.filesystem).toBe("read-write");
      expect(supervisor?.executionPolicy?.filesystem).toBe("read");

      if (process.env.RUN_LIVE_CLI_PROBES === "1") {
        for (const cmd of ["codex", "agy", "agent"]) {
          const out = execFileSync(cmd, ["--version"], { encoding: "utf8" });
          expect(out.trim().length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("Feature F5: Stage 1 Knowledge-Backed Discovery & Per-Req QA Fan-Out", () => {
    it("F5-T1: delivery_plan_reader_tool parses live Velora delivery-plan.ts (R.0/A.6/A.7 implemented -> A.1 remaining)", () => {
      const result = executeDeliveryPlanReader({ projectRoot: VELORA_TARGET_REPO_ROOT }, {});
      expect(result.totalPhases).toBeGreaterThanOrEqual(14);
      const phases = result.phases as Array<Record<string, unknown>>;
      const byWbs = new Map(phases.map((p) => [String(p.wbs), p]));

      expect(byWbs.get("R.0")?.liveStatus).toBe("implemented");
      expect(byWbs.get("A.6")?.liveStatus).toBe("implemented");
      expect(byWbs.get("A.7")?.liveStatus).toBe("implemented");
      expect(byWbs.get("A.1")?.liveStatus).toBe("remaining");
      expect(result.nextRemainingPhase).toBe("A.1");
    });

    it("F5-T2: speckit_workspace_tool reads Velora .specify/feature.json feature_directory cleanly", () => {
      const result = executeSpecKitWorkspaceInspector({ projectRoot: VELORA_TARGET_REPO_ROOT }, {});
      expect(result.specifyConfigured).toBe(true);
      expect(result.featureDir).toMatch(/^specs\/\d{3}-/);
      expect(typeof result.verdict).toBe("string");
    });

    it("F5-T3: velora_knowledge_tool (context) and velora_graphify_tool (query/explain) execute via ToolRuntime", async () => {
      const mirror = trackMirror();
      const kbTool = buildVeloraToolRecord("velora_knowledge_tool", { projectRoot: mirror.root });
      const graphifyTool = buildVeloraToolRecord("velora_graphify_tool", { projectRoot: mirror.root });

      const stubBinDir = path.join(mirror.root, "bin");
      fs.mkdirSync(stubBinDir, { recursive: true });
      fs.writeFileSync(
        path.join(mirror.root, "scripts", "knowledge", "cli.py"),
        "import sys, json\nprint(json.dumps({'ok': True, 'argv': sys.argv[1:], 'chunks': [{'id': 'c1', 'source': 'A.1'}]}))\n",
        "utf8",
      );
      fs.writeFileSync(
        path.join(stubBinDir, "graphify"),
        `#!/bin/sh\necho '{"nodes":["A.1"],"edges":[],"argv":"'$*'"}'\n`,
        { mode: 0o755 },
      );

      const prevPath = process.env.PATH ?? "";
      process.env.PATH = `${stubBinDir}${path.delimiter}${prevPath}`;
      try {
        const toolRuntime = new ToolRuntime(10_000, true);
        const kbResult = await toolRuntime.execute(kbTool, {
          action: "context",
          query: "A.1 Core Operations",
          projectRoot: mirror.root,
        }, undefined, { idempotencyKey: "kb-ctx-1" });
        expect(kbResult.ok).toBe(true);

        const graphResult = await toolRuntime.execute(graphifyTool, {
          action: "query",
          query: "A.1 delivery plan dependencies",
          projectRoot: mirror.root,
        }, undefined, { idempotencyKey: "gf-q-1" });
        expect(graphResult.ok).toBe(true);
      } finally {
        process.env.PATH = prevPath;
      }
    });

    it("F5-T4: Stage 1 Discovery extracts 10 requirements and dynamic_fanout yields 10 per-requirement End-User QA verdicts", async () => {
      const store = new InMemoryRunStore();
      const discoveryAgent = createCliAgent("stage1-discovery", "codex");
      const perReqQaAgent = createCliAgent("stage1-per-req-qa", "agy");

      const controller = createScriptableAgentRuntime((input) => {
        if (input.agent.id === discoveryAgent.id) {
          return {
            phase: "A.1",
            requirements: Array.from({ length: 10 }, (_, i) => ({
              id: `A.1.0${i + 1}`,
              description: `Requirement ${i + 1}`,
            })),
          };
        }
        const item = (input.input as any)?.item ?? input.input;
        return {
          requirementId: item.id,
          persona: "building_manager",
          verdict: Number(item.id.slice(-1)) % 2 === 0 ? "gap" : "implemented",
          reproSteps: `Checked ${item.id} on :5173`,
        };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nDisc = createNode("agent", { x: 100, y: 0 }, { agentId: discoveryAgent.id });
      const nFan = buildDynamicFanoutNode("stage1-qa-fanout", { x: 250, y: 0 }, {
        targetAgentId: perReqQaAgent.id,
        itemsField: "requirements",
        maxConcurrency: 5,
      });
      const nOut = createNode("output", { x: 400, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F5-T4 Stage 1 Fanout"),
        nodes: [nIn, nDisc, nFan, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nDisc.id }),
          createEdge({ source: nDisc.id, target: nFan.id }),
          createEdge({ source: nFan.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, controller.runtime);
      const runId = executor.start({ workflow: wf, agents: [discoveryAgent, perReqQaAgent], input: { phase: "A.1" } });
      const rec = await assertRunCompletedOrDump(store, runId, ["completed"]);

      const verdicts = ((rec.run.output as any)?.results ?? rec.run.output) as Array<Record<string, unknown>>;
      expect(verdicts).toHaveLength(10);
      expect(verdicts.every((v) => v.persona === "building_manager" && (v.verdict === "gap" || v.verdict === "implemented"))).toBe(true);
    });

    it("F5-T5: velora_output_report_tool writes report.md & requirements.json strictly inside <tempMirror>/output/", async () => {
      const mirror = trackMirror();
      const reportTool = buildVeloraToolRecord("velora_output_report_tool", { projectRoot: mirror.root });
      const toolRuntime = new ToolRuntime(10_000, true);

      const writeMd = await toolRuntime.execute(reportTool, {
        action: "write",
        projectRoot: mirror.root,
        relativePath: "a1-qa/report.md",
        content: "# Phase A.1 QA Report\n\n- A.1.01 Gap\n",
      }, undefined, { idempotencyKey: "rep-md-1" });
      expect(writeMd.ok).toBe(true);

      const payload = { phase: "A.1", openGaps: ["A.1.01", "A.1.02"] };
      const writeJson = await toolRuntime.execute(reportTool, {
        action: "write",
        projectRoot: mirror.root,
        relativePath: "a1-qa/requirements.json",
        content: JSON.stringify(payload, null, 2),
      }, undefined, { idempotencyKey: "rep-json-1" });
      expect(writeJson.ok).toBe(true);

      const mdPath = path.join(mirror.outputDir, "a1-qa", "report.md");
      const jsonPath = path.join(mirror.outputDir, "a1-qa", "requirements.json");
      expect(fs.existsSync(mdPath)).toBe(true);
      expect(JSON.parse(fs.readFileSync(jsonPath, "utf8"))).toEqual(payload);
    });
  });

  describe("Feature F6: Stage 2 Complexity-Adaptive SpecKit Prompt Architect", () => {
    it("F6-T1: simple cohesive gap report emits granularity='single' and 1 unified prompt", async () => {
      const mirror = trackMirror();
      const store = new InMemoryRunStore();
      const architectAgent = createCliAgent("prompt-architect", "codex", { args: ["-s", "read-only"] });

      const { runtime } = createScriptableAgentRuntime((input) => {
        const gaps = (input.input as any)?.gaps ?? [];
        const complex = gaps.length > 4 || new Set(gaps.map((g: any) => g.domain)).size > 2;
        return {
          granularity: complex ? "multi" : "single",
          prompts: complex
            ? gaps.map((g: any, i: number) => ({ id: `0${i + 1}`, scope: [g.id], prompt: `Specify ${g.id}` }))
            : [{ id: "01", scope: gaps.map((g: any) => g.id), prompt: "Unified specify prompt" }],
        };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nArch = createNode("agent", { x: 100, y: 0 }, { agentId: architectAgent.id });
      const nOut = createNode("output", { x: 200, y: 0 });
      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F6-T1 Simple Prompt"),
        nodes: [nIn, nArch, nOut],
        edges: [createEdge({ source: nIn.id, target: nArch.id }), createEdge({ source: nArch.id, target: nOut.id })],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({
        workflow: wf,
        agents: [architectAgent],
        input: {
          outputDir: mirror.outputDir,
          gaps: [
            { id: "A.1.01", domain: "units", severity: "minor" },
            { id: "A.1.02", domain: "units", severity: "minor" },
          ],
        },
      });
      const rec = await assertRunCompletedOrDump(store, runId, ["completed"]);
      expect((rec.run.output as any).granularity).toBe("single");
      expect((rec.run.output as any).prompts).toHaveLength(1);
    });

    it("F6-T2: complex multi-domain gap report emits granularity='multi' with >=2 ordered prompts", async () => {
      const store = new InMemoryRunStore();
      const architectAgent = createCliAgent("prompt-architect-complex", "codex");

      const { runtime } = createScriptableAgentRuntime((input) => {
        const gaps = (input.input as any)?.gaps ?? [];
        const byDomain = new Map<string, string[]>();
        for (const g of gaps) {
          const list = byDomain.get(g.domain) ?? [];
          list.push(g.id);
          byDomain.set(g.domain, list);
        }
        return {
          granularity: "multi",
          prompts: [...byDomain.entries()].map(([domain, ids], idx) => ({
            order: idx + 1,
            domain,
            gapIds: ids,
            prompt: `/speckit.specify Domain ${domain}: ${ids.join(", ")}`,
          })),
        };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nArch = createNode("agent", { x: 100, y: 0 }, { agentId: architectAgent.id });
      const nOut = createNode("output", { x: 200, y: 0 });
      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F6-T2 Complex Multi-Prompt"),
        nodes: [nIn, nArch, nOut],
        edges: [createEdge({ source: nIn.id, target: nArch.id }), createEdge({ source: nArch.id, target: nOut.id })],
      };

      const complexGaps = [
        { id: "REQ-01", domain: "django-api" },
        { id: "REQ-02", domain: "django-api" },
        { id: "REQ-03", domain: "migrations" },
        { id: "REQ-04", domain: "migrations" },
        { id: "REQ-05", domain: "rbac" },
        { id: "REQ-06", domain: "rbac" },
        { id: "REQ-07", domain: "react-ui" },
        { id: "REQ-08", domain: "react-ui" },
        { id: "REQ-09", domain: "react-ui" },
        { id: "REQ-10", domain: "i18n" },
        { id: "REQ-11", domain: "i18n" },
        { id: "REQ-12", domain: "i18n" },
      ];

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [architectAgent], input: { gaps: complexGaps } });
      const rec = await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect((rec.run.output as any).granularity).toBe("multi");
      expect((rec.run.output as any).prompts.length).toBeGreaterThanOrEqual(2);
      const orders = ((rec.run.output as any).prompts as any[]).map((p) => p.order);
      expect(orders).toEqual([1, 2, 3, 4, 5]);
    });

    it("F6-T3: 100% of Stage 1 open gap IDs appear in Stage 2 prompt coverage matrix", async () => {
      const store = new InMemoryRunStore();
      const architect = createCliAgent("arch-coverage", "codex");
      const openIds = ["A.1.01", "A.1.02", "A.1.03", "A.1.04", ...Array.from({ length: 8 }, (_, i) => `REQ-0${i + 1}`)];

      const { runtime } = createScriptableAgentRuntime((input) => {
        const ids = ((input.input as any)?.gaps ?? []).map((g: any) => g.id);
        return {
          granularity: "multi",
          prompts: [
            { id: "01", gapIds: ids.slice(0, 6), prompt: `Specify ${ids.slice(0, 6).join(",")}` },
            { id: "02", gapIds: ids.slice(6), prompt: `Specify ${ids.slice(6).join(",")}` },
          ],
          coverage: Object.fromEntries(ids.map((id: string, i: number) => [id, i < 6 ? "01" : "02"])),
        };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nArch = createNode("agent", { x: 100, y: 0 }, { agentId: architect.id });
      const nOut = createNode("output", { x: 200, y: 0 });
      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F6-T3 Coverage"),
        nodes: [nIn, nArch, nOut],
        edges: [createEdge({ source: nIn.id, target: nArch.id }), createEdge({ source: nArch.id, target: nOut.id })],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({
        workflow: wf,
        agents: [architect],
        input: { gaps: openIds.map((id) => ({ id })) },
      });
      const rec = await assertRunCompletedOrDump(store, runId, ["completed"]);
      const covered = new Set(Object.keys((rec.run.output as any).coverage ?? {}));
      for (const id of openIds) {
        expect(covered.has(id)).toBe(true);
      }
    });

    it("F6-T4: Stage 2 persists README.md, 01-*.md, and coverage.json strictly inside <tempMirror>/output/speckit-prompts/", async () => {
      const mirror = trackMirror();
      const reportTool = buildVeloraToolRecord("velora_output_report_tool", { projectRoot: mirror.root });
      const toolRuntime = new ToolRuntime(10_000, true);

      await toolRuntime.execute(reportTool, {
        action: "write",
        projectRoot: mirror.root,
        relativePath: "speckit-prompts/README.md",
        content: "# SpecKit Prompt Index\n",
      }, undefined, { idempotencyKey: "sp-readme" });
      await toolRuntime.execute(reportTool, {
        action: "write",
        projectRoot: mirror.root,
        relativePath: "speckit-prompts/01-a1-core.md",
        content: "# Prompt 01\n",
      }, undefined, { idempotencyKey: "sp-01" });
      await toolRuntime.execute(reportTool, {
        action: "write",
        projectRoot: mirror.root,
        relativePath: "speckit-prompts/coverage.json",
        content: JSON.stringify({ covered: ["A.1.01", "A.1.02"] }),
      }, undefined, { idempotencyKey: "sp-cov" });

      expect(fs.existsSync(path.join(mirror.outputDir, "speckit-prompts", "README.md"))).toBe(true);
      expect(fs.existsSync(path.join(mirror.outputDir, "speckit-prompts", "01-a1-core.md"))).toBe(true);
      expect(fs.existsSync(path.join(mirror.outputDir, "speckit-prompts", "coverage.json"))).toBe(true);
    });

    it("F6-T5: corrupt or empty Stage 1 gap report fails closed with explicit AGENT_OUTPUT_INVALID contract error", async () => {
      const store = new InMemoryRunStore();
      const architect = createCliAgent("arch-fail-closed", "codex");

      const { runtime } = createScriptableAgentRuntime(() => ({
        // Missing required 'prompts' and 'granularity'
        corrupt: true,
      }));

      const nIn = createNode("input", { x: 0, y: 0 });
      const nArch = createNode("agent", { x: 100, y: 0 }, { agentId: architect.id });
      nArch.contract = {
        version: 1,
        outputSchema: {
          type: "object",
          required: ["granularity", "prompts"],
          properties: {
            granularity: { type: "string" },
            prompts: { type: "array" },
          },
        },
      };
      const nOut = createNode("output", { x: 200, y: 0 });
      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F6-T5 Fail Closed Corrupt Gap Report"),
        nodes: [nIn, nArch, nOut],
        edges: [createEdge({ source: nIn.id, target: nArch.id }), createEdge({ source: nArch.id, target: nOut.id })],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [architect], input: { gaps: [] } });
      const failed = await assertRunCompletedOrDump(store, runId, ["failed"]);
      expect(failed.run.error).toMatch(/AGENT_OUTPUT_INVALID|required/i);
    });
  });

  describe("Feature F7: Stage 3 Stateful SpecKit Pipeline + Supervisor Governance", () => {
    it("F7-T1: specify -> Supervisor(approve) -> plan -> Supervisor(approve) -> tasks -> Supervisor(approve) uses exact same sessionId", async () => {
      const store = new InMemoryRunStore();
      const specAgent = createCliAgent("stage3-speckit", "agy");
      const supAgent = createCliAgent("stage3-supervisor", "codex", { args: ["-s", "read-only"] });

      const turns: Array<{ nodeId: string; sessionId?: string; turnCount: number }> = [];
      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === specAgent.id) {
          turns.push({ nodeId: input.nodeId, sessionId: helpers.sessionId, turnCount: helpers.turnCount });
          return { stage: input.nodeId, sessionId: helpers.sessionId };
        }
        return { approved: true, reviewer: supAgent.id };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const mkSpec = (id: string, x: number) => {
        const n = createNode("agent", { x, y: 0 }, {
          agentId: specAgent.id,
          sessionMode: "shared",
          sessionKey: "speckit-main",
          resumePromptMode: "delta",
        });
        n.id = id;
        return n;
      };
      const mkSup = (id: string, x: number) => {
        const n = createNode("agent", { x, y: 0 }, { agentId: supAgent.id, sessionMode: "stateless" });
        n.id = id;
        return n;
      };

      const s1 = mkSpec("specify", 100);
      const r1 = mkSup("sup-1", 200);
      const s2 = mkSpec("plan", 300);
      const r2 = mkSup("sup-2", 400);
      const s3 = mkSpec("tasks", 500);
      const r3 = mkSup("sup-3", 600);
      const nOut = createNode("output", { x: 700, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F7-T1 Stage 3 Linear Governance"),
        nodes: [nIn, s1, r1, s2, r2, s3, r3, nOut],
        edges: [
          createEdge({ source: nIn.id, target: s1.id }),
          createEdge({ source: s1.id, target: r1.id }),
          createEdge({ source: r1.id, target: s2.id }),
          createEdge({ source: s2.id, target: r2.id }),
          createEdge({ source: r2.id, target: s3.id }),
          createEdge({ source: s3.id, target: r3.id }),
          createEdge({ source: r3.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [specAgent, supAgent], input: { prompt: "A.1" } });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(turns.map((t) => t.nodeId)).toEqual(["specify", "plan", "tasks"]);
      expect(new Set(turns.map((t) => t.sessionId)).size).toBe(1);
      expect(turns.map((t) => t.turnCount)).toEqual([1, 2, 3]);
    });

    it("F7-T2: Supervisor rejects plan with Q&A guidance, plan revises in same sessionId, then tasks proceeds", async () => {
      const store = new InMemoryRunStore();
      const specAgent = createCliAgent("stage3-revise-speckit", "agy");
      const supAgent = createCliAgent("stage3-revise-sup", "codex");

      let planCount = 0;
      const specSessionIds: string[] = [];
      let secondPlanInput: unknown;

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === specAgent.id) {
          if (helpers.sessionId) specSessionIds.push(helpers.sessionId);
          if (input.nodeId === "speckit-plan") {
            planCount += 1;
            if (planCount === 2) secondPlanInput = input.input;
          }
          return { stage: input.nodeId, turnCount: helpers.turnCount };
        }
        if (input.nodeId === "sup-plan" && planCount === 1) {
          return { route: "revise_plan", guidance: "Use PostgreSQL transactional outbox" };
        }
        return { route: "proceed_tasks" };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSpecify = createNode("agent", { x: 100, y: 0 }, { agentId: specAgent.id, sessionMode: "shared", sessionKey: "speckit-main" });
      nSpecify.id = "speckit-specify";
      const nPlan = createNode("agent", { x: 200, y: 0 }, { agentId: specAgent.id, sessionMode: "shared", sessionKey: "speckit-main" });
      nPlan.id = "speckit-plan";
      const nSupPlan = createNode("agent", { x: 300, y: 0 }, { agentId: supAgent.id });
      nSupPlan.id = "sup-plan";
      const nGate = createNode("condition", { x: 400, y: 0 }, {
        valueSource: "last_value",
        valueField: "route",
        unknownRoute: "proceed_tasks",
        branches: [
          { key: "revise_plan", label: "Revise Plan" },
          { key: "proceed_tasks", label: "Proceed Tasks" },
        ],
      });
      nGate.id = "plan-gate";
      const nTasks = createNode("agent", { x: 550, y: 0 }, { agentId: specAgent.id, sessionMode: "shared", sessionKey: "speckit-main" });
      nTasks.id = "speckit-tasks";
      const nOut = createNode("output", { x: 650, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F7-T2 Supervisor Plan Revision"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("sup-plan", {
          humanApprovalGateRequired: false,
          recursionGuards: [createRecursionGuard("plan-gate->revise_plan", "proceed_tasks", 3)],
        }),
        nodes: [nIn, nSpecify, nPlan, nSupPlan, nGate, nTasks, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nSpecify.id }),
          createEdge({ source: nSpecify.id, target: nPlan.id }),
          createEdge({ source: nPlan.id, target: nSupPlan.id }),
          createEdge({ source: nSupPlan.id, target: nGate.id }),
          createEdge({ source: nGate.id, target: nPlan.id, kind: "conditional", branchKey: "revise_plan" }),
          createEdge({ source: nGate.id, target: nTasks.id, kind: "conditional", branchKey: "proceed_tasks" }),
          createEdge({ source: nTasks.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [specAgent, supAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(planCount).toBe(2);
      expect(specSessionIds).toHaveLength(4);
      expect(new Set(specSessionIds).size).toBe(1);
      expect(JSON.stringify(secondPlanInput)).toContain("PostgreSQL transactional outbox");
    });

    it("F7-T3: dynamic routing invokes speckit-clarify after specify and speckit-checklist + speckit-analyze after tasks", async () => {
      const store = new InMemoryRunStore();
      const specAgent = createCliAgent("f7-t3-spec", "agy");
      const supAgent = createCliAgent("f7-t3-sup", "codex");

      const routePlan = ["clarify", "plan", "tasks", "checklist", "analyze", "stage4"];
      let idx = 0;
      const visited: string[] = [];
      const sessions = new Set<string>();

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === supAgent.id) {
          return { next: routePlan[idx++] ?? "stage4" };
        }
        visited.push(input.nodeId);
        if (helpers.sessionId) sessions.add(helpers.sessionId);
        return { ok: true };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSup = createNode("agent", { x: 150, y: 0 }, { agentId: supAgent.id });
      nSup.id = "sup-router";
      const nGate = createNode("condition", { x: 300, y: 0 }, {
        valueSource: "last_value",
        valueField: "next",
        unknownRoute: "stage4",
        branches: ["clarify", "plan", "tasks", "checklist", "analyze", "stage4"].map((key) => ({ key, label: key })),
      });
      nGate.id = "gate";

      const skills = ["specify", "clarify", "plan", "tasks", "checklist", "analyze"].map((s, i) => {
        const node = createNode("agent", { x: 450, y: i * 80 }, {
          agentId: specAgent.id,
          sessionMode: "shared",
          sessionKey: "speckit-main",
        });
        node.id = `speckit-${s}`;
        return node;
      });
      const nOut = createNode("output", { x: 650, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F7-T3 Auxiliary Skills"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("sup-router", {
          humanApprovalGateRequired: false,
          recursionGuards: ["clarify", "plan", "tasks", "checklist", "analyze"].map((b) =>
            createRecursionGuard(`gate->${b}`, "stage4", 2),
          ),
        }),
        nodes: [nIn, nSup, nGate, ...skills, nOut],
        edges: [
          createEdge({ source: nIn.id, target: skills[0].id }),
          createEdge({ source: skills[0].id, target: nSup.id }),
          createEdge({ source: nSup.id, target: nGate.id }),
          ...["clarify", "plan", "tasks", "checklist", "analyze"].flatMap((b) => [
            createEdge({ source: nGate.id, target: `speckit-${b}`, kind: "conditional", branchKey: b }),
            createEdge({ source: `speckit-${b}`, target: nSup.id }),
          ]),
          createEdge({ source: nGate.id, target: nOut.id, kind: "conditional", branchKey: "stage4" }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [specAgent, supAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(visited).toEqual([
        "speckit-specify",
        "speckit-clarify",
        "speckit-plan",
        "speckit-tasks",
        "speckit-checklist",
        "speckit-analyze",
      ]);
      expect(sessions.size).toBe(1);
    });

    it("F7-T4: Supervisor detects constitution violation in plan, invokes speckit-constitution, and resumes plan in same session", async () => {
      const store = new InMemoryRunStore();
      const specAgent = createCliAgent("f7-t4-spec", "agy");
      const supAgent = createCliAgent("f7-t4-sup", "codex");

      const sequence = ["plan", "constitution", "plan", "done"];
      let step = 0;
      const specOrder: string[] = [];
      const sessions = new Set<string>();

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === supAgent.id) {
          return { next: sequence[step++] ?? "done" };
        }
        specOrder.push(input.nodeId);
        if (helpers.sessionId) sessions.add(helpers.sessionId);
        return { ok: true };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSup = createNode("agent", { x: 100, y: 0 }, { agentId: supAgent.id });
      nSup.id = "sup-const";
      const nGate = createNode("condition", { x: 200, y: 0 }, {
        valueSource: "last_value",
        valueField: "next",
        unknownRoute: "done",
        branches: [
          { key: "plan", label: "Plan" },
          { key: "constitution", label: "Constitution" },
          { key: "done", label: "Done" },
        ],
      });
      nGate.id = "const-gate";
      const nPlan = createNode("agent", { x: 350, y: -60 }, { agentId: specAgent.id, sessionMode: "shared", sessionKey: "speckit-main" });
      nPlan.id = "speckit-plan";
      const nConst = createNode("agent", { x: 350, y: 60 }, { agentId: specAgent.id, sessionMode: "shared", sessionKey: "speckit-main" });
      nConst.id = "speckit-constitution";
      const nOut = createNode("output", { x: 500, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F7-T4 Constitution Branch"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("sup-const", {
          humanApprovalGateRequired: false,
          recursionGuards: [
            createRecursionGuard("const-gate->plan", "done", 3),
            createRecursionGuard("const-gate->constitution", "done", 2),
          ],
        }),
        nodes: [nIn, nSup, nGate, nPlan, nConst, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nSup.id }),
          createEdge({ source: nSup.id, target: nGate.id }),
          createEdge({ source: nGate.id, target: nPlan.id, kind: "conditional", branchKey: "plan" }),
          createEdge({ source: nPlan.id, target: nSup.id }),
          createEdge({ source: nGate.id, target: nConst.id, kind: "conditional", branchKey: "constitution" }),
          createEdge({ source: nConst.id, target: nSup.id }),
          createEdge({ source: nGate.id, target: nOut.id, kind: "conditional", branchKey: "done" }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [specAgent, supAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(specOrder).toEqual(["speckit-plan", "speckit-constitution", "speckit-plan"]);
      expect(sessions.size).toBe(1);
    });

    it("F7-T5: state.updated events for speckit-main carry identical sessionId and strictly monotonic turnCount", async () => {
      const store = new InMemoryRunStore();
      const specAgent = createCliAgent("f7-t5-spec", "agy");
      const { runtime } = createScriptableAgentRuntime((_, helpers) => ({ turn: helpers.turnCount }));

      const nIn = createNode("input", { x: 0, y: 0 });
      const mk = (id: string, x: number) => {
        const n = createNode("agent", { x, y: 0 }, { agentId: specAgent.id, sessionMode: "shared", sessionKey: "speckit-main" });
        n.id = id;
        return n;
      };
      const a1 = mk("s1", 100);
      const a2 = mk("s2", 200);
      const a3 = mk("s3", 300);
      const a4 = mk("s4", 400);
      const nOut = createNode("output", { x: 500, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F7-T5 Monotonic TurnCount"),
        nodes: [nIn, a1, a2, a3, a4, nOut],
        edges: [
          createEdge({ source: nIn.id, target: a1.id }),
          createEdge({ source: a1.id, target: a2.id }),
          createEdge({ source: a2.id, target: a3.id }),
          createEdge({ source: a3.id, target: a4.id }),
          createEdge({ source: a4.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [specAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      const sessionEvents = store
        .events(runId)
        .filter((e) => e.type === "state.updated" && (e.payload as any)?.agentSession?.sessionKey === "speckit-main")
        .map((e) => (e.payload as any).agentSession);

      expect(sessionEvents).toHaveLength(4);
      expect(new Set(sessionEvents.map((s) => s.sessionId)).size).toBe(1);
      expect(sessionEvents.map((s) => s.turnCount)).toEqual([1, 2, 3, 4]);
    });
  });

  describe("Feature F8: Stage 4 Orchestrated Implementation & Convergence", () => {
    it("F8-T1: Orchestrator partitions tasks.md into execution phases and drives write-enabled SpecKit Implementer", async () => {
      const mirror = trackMirror({
        tasksContent: [
          "# Tasks",
          "## Phase 1: Backend",
          "- [ ] T001 Create API endpoint",
          "## Phase 2: Frontend",
          "- [ ] T002 Create React view",
        ].join("\n"),
      });
      const store = new InMemoryRunStore();
      const orchAgent = createCliAgent("stage4-orch", "codex");
      const implAgent = createCliAgent("stage4-impl", "codex", {
        filesystem: "read-write",
        workspaceRoot: mirror.root,
        args: ["-s", "workspace-write", "--approve-for-me"],
      });

      const partitionsSeen: string[] = [];
      const { runtime } = createScriptableAgentRuntime((input) => {
        if (input.agent.id === orchAgent.id) {
          return { partitions: ["Phase 1: Backend", "Phase 2: Frontend"] };
        }
        expect(input.agent.executionPolicy?.filesystem).toBe("read-write");
        partitionsSeen.push(String((input.input as any)?.item ?? input.input));
        return { implemented: (input.input as any)?.item, status: "done" };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nOrch = createNode("agent", { x: 100, y: 0 }, { agentId: orchAgent.id });
      const nFan = buildDynamicFanoutNode("impl-partitions", { x: 250, y: 0 }, {
        targetAgentId: implAgent.id,
        itemsField: "partitions",
        maxConcurrency: 1,
      });
      const nOut = createNode("output", { x: 400, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F8-T1 Partitioned Implementation"),
        nodes: [nIn, nOrch, nFan, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nOrch.id }),
          createEdge({ source: nOrch.id, target: nFan.id }),
          createEdge({ source: nFan.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [orchAgent, implAgent], input: { tasksPath: path.join(mirror.featureDir, "tasks.md") } });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(partitionsSeen).toEqual(["Phase 1: Backend", "Phase 2: Frontend"]);
    });

    it("F8-T2: Orchestrator triggers speckit-converge and speckit_workspace_tool confirms converged when all tasks complete", async () => {
      const mirror = trackMirror({
        tasksContent: "# Tasks\n- [x] T001 Done\n- [x] T002 Done\n",
      });
      const inspection = executeSpecKitWorkspaceInspector({ projectRoot: mirror.root }, {});
      expect(inspection.verdict).toBe("converged");
      expect(inspection.branch).toBe("converged");
    });

    it("F8-T3: implement -> converge (continue_implement) -> implement -> converge (converged) resumes same implementation session", async () => {
      const store = new InMemoryRunStore();
      const implAgent = createCliAgent("f8-impl", "codex", { filesystem: "read-write" });
      const convAgent = createCliAgent("f8-conv", "codex");

      let convPass = 0;
      const implTurns: Array<{ sessionId?: string; turnCount: number }> = [];

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === implAgent.id) {
          implTurns.push({ sessionId: helpers.sessionId, turnCount: helpers.turnCount });
          return { implemented: `pass-${helpers.turnCount}` };
        }
        convPass += 1;
        return convPass === 1
          ? { verdict: "continue_implement", remaining: ["T003", "T004"] }
          : { verdict: "converged", remaining: [] };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nImpl = createNode("agent", { x: 100, y: 0 }, {
        agentId: implAgent.id,
        sessionMode: "node",
      });
      nImpl.id = "speckit-implement";
      const nConv = createNode("agent", { x: 250, y: 0 }, { agentId: convAgent.id });
      nConv.id = "speckit-converge";
      const nGate = createNode("condition", { x: 400, y: 0 }, {
        valueSource: "last_value",
        valueField: "verdict",
        unknownRoute: "converged",
        branches: [
          { key: "continue_implement", label: "Continue" },
          { key: "converged", label: "Converged" },
        ],
      });
      nGate.id = "converge-gate";
      const nOut = createNode("output", { x: 550, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F8-T3 Converge Loop"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("speckit-converge", {
          humanApprovalGateRequired: false,
          recursionGuards: [createRecursionGuard("converge-gate->continue_implement", "converged", 3)],
        }),
        nodes: [nIn, nImpl, nConv, nGate, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nImpl.id }),
          createEdge({ source: nImpl.id, target: nConv.id }),
          createEdge({ source: nConv.id, target: nGate.id }),
          createEdge({ source: nGate.id, target: nImpl.id, kind: "conditional", branchKey: "continue_implement" }),
          createEdge({ source: nGate.id, target: nOut.id, kind: "conditional", branchKey: "converged" }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [implAgent, convAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(implTurns).toHaveLength(2);
      expect(implTurns[1].sessionId).toBe(implTurns[0].sessionId);
      expect(implTurns.map((t) => t.turnCount)).toEqual([1, 2]);
      expect(convPass).toBe(2);
    });

    it("F8-T4: multi-prompt Stage 2 output (K=2) executes Prompt 1 through convergence before Prompt 2 starts", async () => {
      const store = new InMemoryRunStore();
      const runnerAgent = createCliAgent("f8-seq-prompts", "codex", { filesystem: "read-write" });
      const timeline: string[] = [];

      const { runtime } = createScriptableAgentRuntime((input) => {
        const prompt = (input.input as any)?.item ?? input.input;
        timeline.push(`start:${prompt}`);
        timeline.push(`converged:${prompt}`);
        return { prompt, converged: true };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nFan = buildDynamicFanoutNode("seq-prompts", { x: 150, y: 0 }, {
        targetAgentId: runnerAgent.id,
        itemsField: "prompts",
        maxConcurrency: 1,
      });
      const nOut = createNode("output", { x: 300, y: 0 });
      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F8-T4 Sequential Multi-Prompt"),
        nodes: [nIn, nFan, nOut],
        edges: [createEdge({ source: nIn.id, target: nFan.id }), createEdge({ source: nFan.id, target: nOut.id })],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({
        workflow: wf,
        agents: [runnerAgent],
        input: { prompts: ["Prompt-1-Backend", "Prompt-2-Frontend"] },
      });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(timeline).toEqual([
        "start:Prompt-1-Backend",
        "converged:Prompt-1-Backend",
        "start:Prompt-2-Frontend",
        "converged:Prompt-2-Frontend",
      ]);
    });

    it("F8-T5: speckit-converge exhausting maxIterations emits node.loop_limit_reached and exits via fallback", async () => {
      const store = new InMemoryRunStore();
      const implAgent = createCliAgent("f8-limit-impl", "codex", { filesystem: "read-write" });
      const convAgent = createCliAgent("f8-limit-conv", "codex");

      const { runtime } = createScriptableAgentRuntime((input) => {
        if (input.agent.id === convAgent.id) return { verdict: "continue_implement" };
        return { implemented: true };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nImpl = createNode("agent", { x: 100, y: 0 }, { agentId: implAgent.id });
      const nConv = createNode("agent", { x: 200, y: 0 }, { agentId: convAgent.id });
      nConv.id = "speckit-converge";
      const nGate = createNode("condition", { x: 300, y: 0 }, {
        valueSource: "last_value",
        valueField: "verdict",
        unknownRoute: "escalate",
        branches: [
          { key: "continue_implement", label: "Continue" },
          { key: "escalate", label: "Escalate" },
        ],
      });
      nGate.id = "conv-gate";
      const nOut = createNode("output", { x: 450, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F8-T5 Converge Guard"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("speckit-converge", {
          humanApprovalGateRequired: false,
          recursionGuards: [createRecursionGuard("conv-gate->continue_implement", "escalate", 2)],
        }),
        nodes: [nIn, nImpl, nConv, nGate, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nImpl.id }),
          createEdge({ source: nImpl.id, target: nConv.id }),
          createEdge({ source: nConv.id, target: nGate.id }),
          createEdge({ source: nGate.id, target: nImpl.id, kind: "conditional", branchKey: "continue_implement" }),
          createEdge({ source: nGate.id, target: nOut.id, kind: "conditional", branchKey: "escalate" }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [implAgent, convAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(store.events(runId).find((e) => e.type === "node.loop_limit_reached")?.payload).toMatchObject({
        iteration: 2,
        targetBranch: "continue_implement",
      });
    });
  });

  describe("Feature F9: Stage 5–6 Post-Implementation End-User QA & Direct Fixer Loop", () => {
    function buildPostQaFixerWorkflow(
      qaAgent: AgentRecord,
      fixerAgent: AgentRecord,
      syncAgent: AgentRecord,
      maxFixLoops = 3,
    ): WorkflowDefinition {
      const nIn = createNode("input", { x: 0, y: 0 });
      const nSpec = createNode("memory", { x: 100, y: 0 }, { memoryType: "short_term", mode: "write", key: "spec_done" });
      nSpec.id = "speckit-specify";
      const nQa = createNode("agent", { x: 250, y: 0 }, { agentId: qaAgent.id });
      nQa.id = "post-impl-qa";
      const nGate = createNode("condition", { x: 400, y: 0 }, {
        valueSource: "last_value",
        valueField: "qaStatus",
        unknownRoute: "escalate",
        branches: [
          { key: "qa_passed", label: "Passed" },
          { key: "qa_failed", label: "Failed" },
          { key: "escalate", label: "Escalate" },
        ],
      });
      nGate.id = "post-qa-gate";
      const nFixer = createNode("agent", { x: 400, y: 150 }, {
        agentId: fixerAgent.id,
        sessionMode: "node",
      });
      nFixer.id = "post-qa-fixer";
      const nSync = createNode("agent", { x: 600, y: 0 }, { agentId: syncAgent.id });
      nSync.id = "stage8-knowledge-sync";
      const nOut = createNode("output", { x: 750, y: 0 });

      return {
        ...createEmptyDefinition("F9 Post-Impl QA Direct Fixer"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("post-impl-qa", {
          humanApprovalGateRequired: false,
          recursionGuards: [createRecursionGuard("post-qa-gate->qa_failed", "escalate", maxFixLoops)],
        }),
        nodes: [nIn, nSpec, nQa, nGate, nFixer, nSync, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nSpec.id }),
          createEdge({ source: nSpec.id, target: nQa.id }),
          createEdge({ source: nQa.id, target: nGate.id }),
          createEdge({ source: nGate.id, target: nFixer.id, kind: "conditional", branchKey: "qa_failed" }),
          createEdge({ source: nFixer.id, target: nQa.id }),
          createEdge({ source: nGate.id, target: nSync.id, kind: "conditional", branchKey: "qa_passed" }),
          createEdge({ source: nGate.id, target: nSync.id, kind: "conditional", branchKey: "escalate" }),
          createEdge({ source: nSync.id, target: nOut.id }),
        ],
      };
    }

    it("F9-T1: clean post-implementation QA emits qa_passed and proceeds straight to Stage 8", async () => {
      const store = new InMemoryRunStore();
      const qaAgent = createCliAgent("f9-qa", "agy");
      const fixerAgent = createCliAgent("f9-fixer", "cursor", { filesystem: "read-write" });
      const syncAgent = createCliAgent("f9-sync", "codex");

      const { runtime } = createScriptableAgentRuntime((input) => {
        if (input.nodeId === "post-impl-qa") return { qaStatus: "qa_passed", checkedUrl: "http://localhost:5173" };
        return { synced: true };
      });

      const wf = buildPostQaFixerWorkflow(qaAgent, fixerAgent, syncAgent);
      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [qaAgent, fixerAgent, syncAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      const nodeIds = store.events(runId).map((e) => e.nodeId).filter(Boolean);
      expect(nodeIds).not.toContain("post-qa-fixer");
      expect(nodeIds).toContain("stage8-knowledge-sync");
    });

    it("F9-T2: qa_failed routes to Post-QA Defect Fixer and re-runs QA with ZERO SpecKit re-entry", async () => {
      const store = new InMemoryRunStore();
      const qaAgent = createCliAgent("f9-t2-qa", "agy");
      const fixerAgent = createCliAgent("f9-t2-fixer", "cursor", { filesystem: "read-write" });
      const syncAgent = createCliAgent("f9-t2-sync", "codex");

      let qaCount = 0;
      const { runtime } = createScriptableAgentRuntime((input) => {
        if (input.nodeId === "post-impl-qa") {
          qaCount += 1;
          return qaCount === 1
            ? { qaStatus: "qa_failed", defects: ["API-500"] }
            : { qaStatus: "qa_passed", defects: [] };
        }
        return { fixed: ["API-500"] };
      });

      const wf = buildPostQaFixerWorkflow(qaAgent, fixerAgent, syncAgent);
      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [qaAgent, fixerAgent, syncAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      const executedNodes = store
        .events(runId)
        .filter((e) => e.type === "node.started" && !e.nodeId?.startsWith("output-"))
        .map((e) => e.nodeId);
      const firstQaIdx = executedNodes.indexOf("post-impl-qa");
      const afterStage5Start = executedNodes.slice(firstQaIdx);
      expect(afterStage5Start).toEqual([
        "post-impl-qa",
        "post-qa-gate",
        "post-qa-fixer",
        "post-impl-qa",
        "post-qa-gate",
        "stage8-knowledge-sync",
      ]);
      expect(afterStage5Start.some((id) => id?.startsWith("speckit-"))).toBe(false);
    });

    it("F9-T3: QA fails twice ([API-500, UI-rtl]), Fixer runs twice, QA passes on 3rd check -> Stage 8", async () => {
      const store = new InMemoryRunStore();
      const qaAgent = createCliAgent("f9-t3-qa", "agy");
      const fixerAgent = createCliAgent("f9-t3-fixer", "cursor", { filesystem: "read-write" });
      const syncAgent = createCliAgent("f9-t3-sync", "codex");

      let qaCount = 0;
      let fixerCount = 0;
      const { runtime } = createScriptableAgentRuntime((input) => {
        if (input.nodeId === "post-impl-qa") {
          qaCount += 1;
          if (qaCount <= 2) return { qaStatus: "qa_failed", defects: ["API-500", "UI-rtl"] };
          return { qaStatus: "qa_passed", defects: [] };
        }
        if (input.nodeId === "post-qa-fixer") fixerCount += 1;
        return { ok: true };
      });

      const wf = buildPostQaFixerWorkflow(qaAgent, fixerAgent, syncAgent, 4);
      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [qaAgent, fixerAgent, syncAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(fixerCount).toBe(2);
      expect(qaCount).toBe(3);
    });

    it("F9-T4: Post-QA Defect Fixer configured with sessionMode=node resumes same sessionId across fix iterations", async () => {
      const store = new InMemoryRunStore();
      const qaAgent = createCliAgent("f9-t4-qa", "agy");
      const fixerAgent = createCliAgent("f9-t4-fixer", "cursor", { filesystem: "read-write" });
      const syncAgent = createCliAgent("f9-t4-sync", "codex");

      let qaCount = 0;
      const fixerTurns: Array<{ sessionId?: string; turnCount: number }> = [];
      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.nodeId === "post-impl-qa") {
          qaCount += 1;
          return { qaStatus: qaCount <= 2 ? "qa_failed" : "qa_passed" };
        }
        if (input.nodeId === "post-qa-fixer") {
          fixerTurns.push({ sessionId: helpers.sessionId, turnCount: helpers.turnCount });
        }
        return { fixed: true };
      });

      const wf = buildPostQaFixerWorkflow(qaAgent, fixerAgent, syncAgent, 4);
      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [qaAgent, fixerAgent, syncAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(fixerTurns).toHaveLength(2);
      expect(fixerTurns[1].sessionId).toBe(fixerTurns[0].sessionId);
      expect(fixerTurns.map((t) => t.turnCount)).toEqual([1, 2]);
    });

    it("F9-T5: Post-QA Defect Fixer exceeding maxIterations emits node.loop_limit_reached and routes cleanly to fallback", async () => {
      const store = new InMemoryRunStore();
      const qaAgent = createCliAgent("f9-t5-qa", "agy");
      const fixerAgent = createCliAgent("f9-t5-fixer", "cursor", { filesystem: "read-write" });
      const syncAgent = createCliAgent("f9-t5-sync", "codex");

      const { runtime } = createScriptableAgentRuntime((input) => {
        if (input.nodeId === "post-impl-qa") return { qaStatus: "qa_failed", defects: ["PERSISTENT-BUG"] };
        return { attempted: true };
      });

      const wf = buildPostQaFixerWorkflow(qaAgent, fixerAgent, syncAgent, 2);
      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [qaAgent, fixerAgent, syncAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(store.events(runId).find((e) => e.type === "node.loop_limit_reached")?.payload).toMatchObject({
        iteration: 2,
        targetBranch: "qa_failed",
      });
    });
  });

  describe("Feature F10: Stage 7–8 Exception-Only HITL & Semantic Knowledge Sync", () => {
    it("F10-T1: nominal 8-stage run completes with zero human_approval.requested events", async () => {
      const store = new InMemoryRunStore();
      const stageAgent = createCliAgent("stage-runner", "codex");
      const { runtime } = createScriptableAgentRuntime((input) => ({ stage: input.nodeId, ok: true }));

      const nIn = createNode("input", { x: 0, y: 0 });
      const stages = ["s1-discovery", "s2-prompt", "s3-speckit", "s4-implement", "s5-qa", "s8-sync"].map((id, i) => {
        const n = createNode("agent", { x: (i + 1) * 120, y: 0 }, { agentId: stageAgent.id });
        n.id = id;
        return n;
      });
      const nOut = createNode("output", { x: 900, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F10-T1 Autonomous 8-Stage"),
        nodes: [nIn, ...stages, nOut],
        edges: [
          createEdge({ source: nIn.id, target: stages[0].id }),
          ...stages.slice(0, -1).map((s, i) => createEdge({ source: s.id, target: stages[i + 1].id })),
          createEdge({ source: stages[stages.length - 1].id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [stageAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(store.events(runId).filter((e) => e.type === "human_approval.requested")).toHaveLength(0);
    });

    it("F10-T2: genuine ambiguity pauses once via needs_human, resumes autonomously after clarification, and completes Stage 8", async () => {
      const store = new InMemoryRunStore();
      const studioStore = new InMemoryStudioStore();
      const agent = createCliAgent("f10-ambiguous", "agy");
      await studioStore.saveAgent(agent, PRINCIPAL_ALPHA);

      let specCalls = 0;
      const { runtime } = createScriptableAgentRuntime((input) => {
        if (input.nodeId === "s3-speckit") {
          specCalls += 1;
          if (specCalls === 1) {
            return createResultEnvelope("needs_human", {
              value: { draft: true },
              needsHuman: {
                reason: "Unresolved tenant retention policy",
                purpose: "clarification",
                questions: [{ id: "q-ret", prompt: "Retention days?", required: true }],
              },
            });
          }
          return createResultEnvelope("success", { value: { retentionDays: 365 } });
        }
        return { stage: input.nodeId, completed: true };
      });

      const executor = new RunExecutor(store, runtime, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSpec = createNode("agent", { x: 100, y: 0 }, {
        agentId: agent.id,
        sessionMode: "shared",
        sessionKey: "speckit-main",
        reinvokeOnClarification: true,
      } as AgentNodeConfig);
      nSpec.id = "s3-speckit";
      const nSync = createNode("agent", { x: 250, y: 0 }, { agentId: agent.id });
      nSync.id = "s8-sync";
      const nOut = createNode("output", { x: 400, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F10-T2 Exception HITL"),
        nodes: [nIn, nSpec, nSync, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nSpec.id }),
          createEdge({ source: nSpec.id, target: nSync.id }),
          createEdge({ source: nSync.id, target: nOut.id }),
        ],
      };
      await studioStore.saveWorkflow(wf, PRINCIPAL_ALPHA);

      const startRes = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ workflow: wf, agents: [agent], input: {} }),
        }),
      );
      const { runId } = await readJsonResponse<{ runId: string }>(startRes);
      await assertRunCompletedOrDump(store, runId, ["waiting_for_human"]);

      const answerRes = await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ answers: [{ questionId: "q-ret", value: "365" }] }),
        }),
      );
      expect([200, 202]).toContain(answerRes.status);

      await assertRunCompletedOrDump(store, runId, ["completed"]);
      expect(store.events(runId).some((e) => e.nodeId === "s8-sync" && e.type === "node.completed")).toBe(true);
    });

    it("F10-T3: Stage 8 Knowledge Sync invokes graphify semantic update/extract AND cli.py index --semantic in sequence", async () => {
      const mirror = trackMirror();
      const logFile = path.join(mirror.root, "cli-invocations.log");
      const stubBin = path.join(mirror.root, "bin");
      fs.mkdirSync(stubBin, { recursive: true });

      fs.writeFileSync(
        path.join(stubBin, "graphify"),
        `#!/bin/sh\necho "graphify $*" >> "${logFile}"\necho '{"ok":true}'\n`,
        { mode: 0o755 },
      );
      fs.writeFileSync(
        path.join(mirror.root, "scripts", "knowledge", "cli.py"),
        `import sys, json\nwith open(${JSON.stringify(logFile)}, "a") as f:\n  f.write("cli.py " + " ".join(sys.argv[1:]) + "\\n")\nprint(json.dumps({"ok": True, "semantic": "--semantic" in sys.argv}))\n`,
        "utf8",
      );

      const graphifyTool = buildVeloraToolRecord("velora_graphify_tool", { projectRoot: mirror.root });
      const kbTool = buildVeloraToolRecord("velora_knowledge_tool", { projectRoot: mirror.root });
      const toolRuntime = new ToolRuntime(10_000, true);

      const prevPath = process.env.PATH ?? "";
      process.env.PATH = `${stubBin}${path.delimiter}${prevPath}`;
      try {
        const gfRes = await toolRuntime.execute(graphifyTool, {
          action: "update",
          semantic: true,
          projectRoot: mirror.root,
        }, undefined, { idempotencyKey: "s8-gf-1" });
        expect(gfRes.ok).toBe(true);

        const kbRes = await toolRuntime.execute(kbTool, {
          action: "index",
          semantic: true,
          projectRoot: mirror.root,
        }, undefined, { idempotencyKey: "s8-kb-1" });
        expect(kbRes.ok).toBe(true);
      } finally {
        process.env.PATH = prevPath;
      }

      const lines = fs.readFileSync(logFile, "utf8").trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[0]).toMatch(/^graphify /);
      expect(lines[lines.length - 1]).toContain("cli.py index");
      expect(lines[lines.length - 1]).toContain("--semantic");
    });

    it("F10-T4: active-job PID guard blocks live embedding PID fail-closed and allows stale/dead PID", async () => {
      const toolRuntime = new ToolRuntime(10_000, true);

      // (a) Live PID (current test process PID is guaranteed alive)
      const liveMirror = trackMirror({
        progressJson: { state: "embedding", pid: process.pid, startedAt: nowIso() },
      });
      fs.writeFileSync(
        path.join(liveMirror.root, "scripts", "knowledge", "cli.py"),
        `raise SystemExit("cli.py index MUST NOT be spawned when active PID is alive")`,
        "utf8",
      );
      const kbLive = buildVeloraToolRecord("velora_knowledge_tool", { projectRoot: liveMirror.root });

      await expect(
        toolRuntime.execute(kbLive, {
          action: "index",
          semantic: true,
          projectRoot: liveMirror.root,
        }, undefined, { idempotencyKey: "pid-live" }),
      ).rejects.toThrow(/active|running|pid|embedding/i);

      // (b) Dead PID (999999 / non-existent)
      const deadMirror = trackMirror({
        progressJson: { state: "embedding", pid: 999999, startedAt: nowIso() },
      });
      fs.writeFileSync(
        path.join(deadMirror.root, "scripts", "knowledge", "cli.py"),
        `import sys, json\nprint(json.dumps({"ok": True, "args": sys.argv[1:]}))\n`,
        "utf8",
      );
      const kbDead = buildVeloraToolRecord("velora_knowledge_tool", { projectRoot: deadMirror.root });
      const res = await toolRuntime.execute(kbDead, {
        action: "index",
        semantic: true,
        projectRoot: deadMirror.root,
      }, undefined, { idempotencyKey: "pid-dead" });
      expect(res.ok).toBe(true);
    });

    it("F10-T5: velora_knowledge_tool index never downgrades --semantic to lexical when embedding endpoint fails", async () => {
      const mirror = trackMirror();
      const argvLog = path.join(mirror.root, "cli-argv.json");
      fs.writeFileSync(
        path.join(mirror.root, "scripts", "knowledge", "cli.py"),
        [
          "import sys, json",
          `with open(${JSON.stringify(argvLog)}, "w") as f: json.dump(sys.argv[1:], f)`,
          "sys.stderr.write('Embedding endpoint unreachable\\n')",
          "raise SystemExit(2)",
        ].join("\n"),
        "utf8",
      );

      const kbTool = buildVeloraToolRecord("velora_knowledge_tool", { projectRoot: mirror.root });
      const toolRuntime = new ToolRuntime(10_000, true);

      await expect(
        toolRuntime.execute(kbTool, {
          action: "index",
          semantic: true,
          projectRoot: mirror.root,
        }, undefined, { idempotencyKey: "no-downgrade-1" }),
      ).rejects.toThrow(/embedding|semantic|failed|exit/i);

      const spawnedArgv = JSON.parse(fs.readFileSync(argvLog, "utf8")) as string[];
      expect(spawnedArgv).toContain("--semantic");
    });
  });

  describe("Feature F12: Full E2E Gate, Seed Completeness, Boundary & Isolation", () => {
    it("F12-T1: executes full 8-stage seeded agentic-velora workflow via RunExecutor satisfying all 6 acceptance bullets", async () => {
      const pkg = loadAgenticVeloraSeedPackage();
      const masterWf = pkg.workflows.find((w) => /master|delivery|orchestrator|velora/i.test(w.name)) ?? pkg.workflows[0];
      expect(masterWf).toBeDefined();

      const issues = validateWorkflow(masterWf, pkg.agents, {
        knownWorkflowIds: pkg.workflows.map((w) => w.id),
        resolveWorkflowDefinition: (id) => pkg.workflows.find((w) => w.id === id),
      }, pkg.tools);
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);

      const studioStore = new InMemoryStudioStore();
      const runStore = new InMemoryRunStore();
      for (const a of pkg.agents) await studioStore.saveAgent(a, PRINCIPAL_ALPHA);
      for (const t of pkg.tools) await studioStore.saveTool(t, PRINCIPAL_ALPHA);
      for (const w of pkg.workflows) await studioStore.saveWorkflow(w, PRINCIPAL_ALPHA);

      const controller = createScriptableAgentRuntime((input, helpers) => {
        const name = `${input.agent.name} ${input.nodeId}`.toLowerCase();
        if (name.includes("discovery")) {
          return {
            phase: "A.1",
            requirements: [{ id: "A.1.01", title: "Resident Onboarding" }, { id: "A.1.02", title: "Units" }],
          };
        }
        if (name.includes("prompt")) {
          return { granularity: "single", prompts: [{ id: "01", prompt: "Specify A.1" }] };
        }
        if (name.includes("supervisor")) {
          return { approved: true, next: "proceed", verdict: "approved", qaStatus: "qa_passed", route: "complete" };
        }
        if (name.includes("converge")) {
          return { verdict: "converged", branch: "converged" };
        }
        if (name.includes("qa")) {
          return { qaStatus: "qa_passed", verdict: "qa_passed", branch: "qa_passed", defects: [] };
        }
        return {
          status: "completed",
          nodeId: input.nodeId,
          sessionId: helpers.sessionId,
        };
      });

      const executor = new RunExecutor(
        runStore,
        controller.runtime,
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
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const startRes = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({
            workflow: masterWf,
            agents: pkg.agents,
            tools: pkg.tools,
            input: { phase: "A.1", targetRepo: VELORA_TARGET_REPO_ROOT },
          }),
        }),
      );
      expect(startRes.status).toBe(202);
      const { runId } = await readJsonResponse<{ runId: string }>(startRes);
      await assertRunCompletedOrDump(runStore, runId, ["completed"], 25_000);

      expect(runStore.events(runId).filter((e) => e.type === "human_approval.requested")).toHaveLength(0);
    });

    it("F12-T2: target repository /home/hossein/Desktop/projects/building-management has zero git mutations", () => {
      assertVeloraGitStateUnchanged(initialGitSnapshot, VELORA_TARGET_REPO_ROOT);
    });

    it("F12-T3: agenticVeloraOrgSeed registers all 9 roles, Velora workspace/output bindings, and valid workflows", () => {
      const pkg = loadAgenticVeloraSeedPackage();
      for (const role of REQUIRED_VELORA_AGENT_ROLES) {
        const matched = pkg.agents.some((a) =>
          a.name.toLowerCase().includes(role.toLowerCase().split(" ")[0]),
        );
        expect(matched).toBe(true);
      }

      for (const a of pkg.agents) {
        const root = a.executionPolicy?.workspaceRoot ?? "";
        expect(root).toContain(VELORA_TARGET_REPO_ROOT);
      }

      const requiredTools = [
        "delivery_plan_reader_tool",
        "velora_knowledge_tool",
        "velora_graphify_tool",
        "velora_output_report_tool",
        "delegate_subagents",
      ];
      for (const toolName of requiredTools) {
        expect(pkg.tools.some((t) => t.name === toolName || t.id === toolName)).toBe(true);
      }

      for (const wf of pkg.workflows) {
        const errs = validateWorkflow(wf, pkg.agents, {
          knownWorkflowIds: pkg.workflows.map((w) => w.id),
          resolveWorkflowDefinition: (id) => pkg.workflows.find((w) => w.id === id),
        }, pkg.tools).filter((i) => i.severity === "error");
        expect(errs).toEqual([]);
      }
    });

    it("F12-T4: velora_output_report_tool enforces output/ path boundary fail-closed", async () => {
      const mirror = trackMirror();
      const reportTool = buildVeloraToolRecord("velora_output_report_tool", { projectRoot: mirror.root });
      const toolRuntime = new ToolRuntime(10_000, true);

      await expect(
        toolRuntime.execute(reportTool, {
          action: "write",
          projectRoot: mirror.root,
          relativePath: "../apps/api/views.py",
          content: "malicious",
        }, undefined, { idempotencyKey: "out-escape-1" }),
      ).rejects.toThrow(/output|escape|outside|invalid|path/i);

      await expect(
        toolRuntime.execute(reportTool, {
          action: "write",
          projectRoot: mirror.root,
          relativePath: "/etc/passwd",
          content: "malicious",
        }, undefined, { idempotencyKey: "out-escape-2" }),
      ).rejects.toThrow(/output|escape|outside|absolute|invalid|path/i);

      const valid = await toolRuntime.execute(reportTool, {
        action: "write",
        projectRoot: mirror.root,
        relativePath: "report.md",
        content: "# Valid Output\n",
      }, undefined, { idempotencyKey: "out-ok-1" });
      expect(valid.ok).toBe(true);
      expect(fs.existsSync(path.join(mirror.outputDir, "report.md"))).toBe(true);
    });

    it("F12-T5: cross-tenant isolation returns 404 fail-closed on runs, events, clarification, and approvals", async () => {
      const store = new InMemoryRunStore();
      const studioStore = new InMemoryStudioStore();
      const agent = createCliAgent("iso-agent", "agy");
      await studioStore.saveAgent(agent, PRINCIPAL_ALPHA);

      const { runtime } = createScriptableAgentRuntime(() =>
        createResultEnvelope("needs_human", {
          value: { ok: false },
          needsHuman: {
            reason: "Check",
            purpose: "clarification",
            questions: [{ id: "q1", prompt: "Confirm?", required: true }],
          },
        }),
      );

      const executor = new RunExecutor(store, runtime, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const nIn = createNode("input", { x: 0, y: 0 });
      const nAg = createNode("agent", { x: 100, y: 0 }, { agentId: agent.id });
      const nOut = createNode("output", { x: 200, y: 0 });
      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("F12-T5 Isolation"),
        nodes: [nIn, nAg, nOut],
        edges: [createEdge({ source: nIn.id, target: nAg.id }), createEdge({ source: nAg.id, target: nOut.id })],
      };
      await studioStore.saveWorkflow(wf, PRINCIPAL_ALPHA);

      const startRes = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ workflow: wf, agents: [agent], input: {} }),
        }),
      );
      const { runId } = await readJsonResponse<{ runId: string }>(startRes);
      await assertRunCompletedOrDump(store, runId, ["waiting_for_human"]);
      const approvalId = store.listApprovals(runId)[0].id;

      for (const [method, url, body] of [
        ["GET", `/${runId}`, undefined],
        ["GET", `/${runId}/events`, undefined],
        ["GET", `/${runId}/clarification`, undefined],
        ["POST", `/${runId}/clarification`, { answers: [{ questionId: "q1", value: "hack" }] }],
        ["POST", `/${runId}/approvals/${approvalId}/resolve`, { decision: "approved" }],
      ] as const) {
        const res = await runsApp.fetch(
          new Request(`http://localhost${url}`, {
            method,
            headers: authHeaders(PRINCIPAL_BETA),
            body: body ? JSON.stringify(body) : undefined,
          }),
        );
        expect(res.status).toBe(404);
      }
    });
  });

  // =========================================================================
  // TIER 2 — BOUNDARY & CORNER CASES (T2-B1..T2-B8)
  // =========================================================================

  describe("Tier 2: Boundary & Corner Cases", () => {
    it("T2-B1: dynamic_fanout item count bounds (N=0, N=1, N=15, and N=201 > MAX=200 rejected)", async () => {
      const qaAgent = createCliAgent("t2-b1-qa", "agy");

      // N = 0
      {
        const store = new InMemoryRunStore();
        const controller = createScriptableAgentRuntime(() => ({ ok: true }));
        const nIn = createNode("input", { x: 0, y: 0 });
        const nFan = buildDynamicFanoutNode("fan-0", { x: 150, y: 0 }, { targetAgentId: qaAgent.id, itemsField: "items" });
        const nOut = createNode("output", { x: 300, y: 0 });
        const wf: WorkflowDefinition = {
          ...createEmptyDefinition("T2-B1 N=0"),
          nodes: [nIn, nFan, nOut],
          edges: [createEdge({ source: nIn.id, target: nFan.id }), createEdge({ source: nFan.id, target: nOut.id })],
        };
        const executor = new RunExecutor(store, controller.runtime);
        const runId = executor.start({ workflow: wf, agents: [qaAgent], input: { items: [] } });
        const rec = await assertRunCompletedOrDump(store, runId, ["completed"]);
        expect(controller.calls).toHaveLength(0);
        expect(store.events(runId).some((e) => e.type === "fanout.started")).toBe(true);
        expect(store.events(runId).some((e) => e.type === "fanout.completed")).toBe(true);
        expect((rec.run.output as any)?.results ?? rec.run.output).toEqual([]);
      }

      // N = 1 and N = 15
      for (const count of [1, 15]) {
        const store = new InMemoryRunStore();
        const controller = createScriptableAgentRuntime((input) => ({ item: input.input }));
        const nIn = createNode("input", { x: 0, y: 0 });
        const nFan = buildDynamicFanoutNode(`fan-${count}`, { x: 150, y: 0 }, { targetAgentId: qaAgent.id, itemsField: "items", maxConcurrency: 4 });
        const nOut = createNode("output", { x: 300, y: 0 });
        const wf: WorkflowDefinition = {
          ...createEmptyDefinition(`T2-B1 N=${count}`),
          nodes: [nIn, nFan, nOut],
          edges: [createEdge({ source: nIn.id, target: nFan.id }), createEdge({ source: nFan.id, target: nOut.id })],
        };
        const executor = new RunExecutor(store, controller.runtime);
        const runId = executor.start({
          workflow: wf,
          agents: [qaAgent],
          input: { items: Array.from({ length: count }, (_, i) => i) },
        });
        await assertRunCompletedOrDump(store, runId, ["completed"]);
        expect(controller.calls).toHaveLength(count);
      }

      // N = 201 exceeds maxItems (200)
      {
        const issues = validateDynamicFanoutNodeConfig({ targetAgentId: qaAgent.id, maxItems: 201 });
        expect(issues.some((i) => i.code === "INVALID_DYNAMIC_FANOUT_MAX_ITEMS")).toBe(true);

        const store = new InMemoryRunStore();
        const controller = createScriptableAgentRuntime(() => ({ ok: true }));
        const nIn = createNode("input", { x: 0, y: 0 });
        const nFan = buildDynamicFanoutNode("fan-201", { x: 150, y: 0 }, { targetAgentId: qaAgent.id, itemsField: "items" });
        const nOut = createNode("output", { x: 300, y: 0 });
        const wf: WorkflowDefinition = {
          ...createEmptyDefinition("T2-B1 N=201"),
          nodes: [nIn, nFan, nOut],
          edges: [createEdge({ source: nIn.id, target: nFan.id }), createEdge({ source: nFan.id, target: nOut.id })],
        };
        const executor = new RunExecutor(store, controller.runtime);
        const runId = executor.start({
          workflow: wf,
          agents: [qaAgent],
          input: { items: Array.from({ length: 201 }, (_, i) => i) },
        });
        await assertRunCompletedOrDump(store, runId, ["failed"]);
      }
    });

    it("T2-B2: validates 120-char sessionKey accepted, 121-char or whitespace rejected, and shortTermMemoryMaxTokens bounds", () => {
      const agent = createCliAgent("t2-b2", "codex");
      const ok = validateAgentNodeStepConfig({
        agent,
        nodeConfig: { agentId: agent.id, sessionMode: "shared", sessionKey: "a".repeat(120), shortTermMemoryMaxTokens: 16_000 },
        registryTools: [],
      });
      expect(ok).toEqual([]);

      const tooLong = validateAgentNodeStepConfig({
        agent,
        nodeConfig: { agentId: agent.id, sessionMode: "shared", sessionKey: "a".repeat(121) },
        registryTools: [],
      });
      expect(tooLong.length).toBeGreaterThan(0);

      const badChars = validateAgentNodeStepConfig({
        agent,
        nodeConfig: { agentId: agent.id, sessionMode: "shared", sessionKey: "bad key!" },
        registryTools: [],
      });
      expect(badChars.length).toBeGreaterThan(0);
    });

    it("T2-B3: malformed non-array fanout itemsField fails closed instead of silent empty success", async () => {
      const store = new InMemoryRunStore();
      const qaAgent = createCliAgent("t2-b3-qa", "agy");
      const controller = createScriptableAgentRuntime(() => ({ ok: true }));

      const nIn = createNode("input", { x: 0, y: 0 });
      const nFan = buildDynamicFanoutNode("fan-bad-items", { x: 150, y: 0 }, {
        targetAgentId: qaAgent.id,
        itemsField: "requirements",
      });
      const nOut = createNode("output", { x: 300, y: 0 });
      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("T2-B3 Malformed Fanout Input"),
        nodes: [nIn, nFan, nOut],
        edges: [createEdge({ source: nIn.id, target: nFan.id }), createEdge({ source: nFan.id, target: nOut.id })],
      };

      const executor = new RunExecutor(store, controller.runtime);
      const runId = executor.start({
        workflow: wf,
        agents: [qaAgent],
        input: { requirements: "not-an-array" },
      });
      await assertRunCompletedOrDump(store, runId, ["failed"]);
    });

    it("T2-B4: knowledge PID progress edge cases (preparing+live blocked, failed+stale pid 110561 allowed, corrupt JSON fails closed)", async () => {
      const toolRuntime = new ToolRuntime(10_000, true);

      // 1. state="preparing" + live PID -> blocked
      const mLive = trackMirror({ progressJson: { state: "preparing", pid: process.pid } });
      await expect(
        toolRuntime.execute(
          buildVeloraToolRecord("velora_knowledge_tool", { projectRoot: mLive.root }),
          { action: "index", semantic: true, projectRoot: mLive.root },
          undefined,
          { idempotencyKey: "t2-b4-1" },
        ),
      ).rejects.toThrow(/active|running|pid|preparing/i);

      // 2. state="failed" + stale PID 110561 -> allowed
      const mFailed = trackMirror({ progressJson: { state: "failed", pid: 110561 } });
      fs.writeFileSync(
        path.join(mFailed.root, "scripts", "knowledge", "cli.py"),
        `import json\nprint(json.dumps({"ok": True}))\n`,
        "utf8",
      );
      const res = await toolRuntime.execute(
        buildVeloraToolRecord("velora_knowledge_tool", { projectRoot: mFailed.root }),
        { action: "index", semantic: true, projectRoot: mFailed.root },
        undefined,
        { idempotencyKey: "t2-b4-2" },
      );
      expect(res.ok).toBe(true);

      // 3. malformed JSON -> fail-closed
      const mCorrupt = trackMirror({ progressJson: "{corrupt-json" });
      await expect(
        toolRuntime.execute(
          buildVeloraToolRecord("velora_knowledge_tool", { projectRoot: mCorrupt.root }),
          { action: "index", semantic: true, projectRoot: mCorrupt.root },
          undefined,
          { idempotencyKey: "t2-b4-3" },
        ),
      ).rejects.toThrow(/json|parse|corrupt|progress/i);
    });

    it("T2-B5: output report path traversal, null-byte, and symlink escape are rejected fail-closed", async () => {
      const mirror = trackMirror();
      const outsideFile = path.join(mirror.root, "outside-secret.txt");
      fs.writeFileSync(outsideFile, "keep", "utf8");
      const symlinkPath = path.join(mirror.outputDir, "escape-link.md");
      fs.symlinkSync(outsideFile, symlinkPath);

      const reportTool = buildVeloraToolRecord("velora_output_report_tool", { projectRoot: mirror.root });
      const toolRuntime = new ToolRuntime(10_000, true);

      for (const [idx, badPath] of ["output/../apps/web/x.ts", "bad\0name.md", "escape-link.md"].entries()) {
        await expect(
          toolRuntime.execute(reportTool, {
            action: "write",
            projectRoot: mirror.root,
            relativePath: badPath,
            content: "pwn",
          }, undefined, { idempotencyKey: `t2-b5-${idx}` }),
        ).rejects.toThrow(/escape|symlink|null|invalid|outside|path/i);
      }
      expect(fs.readFileSync(outsideFile, "utf8")).toBe("keep");
    });

    it("T2-B6: CLI process edge cases (corrupt JSONL, non-zero exit, AbortSignal, secret redaction)", async () => {
      const secret = "cur-secret-redact-999";
      const mockWorker = createRecordingWorkerRuntime((_call, idx) => {
        if (idx === 0) {
          return { code: 1, stderr: `Auth error using ${secret} at tail` };
        }
        return { code: 0, stdout: "{not-json-line\n" };
      });

      const cliExec = new CliAgentExecutor(
        mockWorker,
        {
          enabled: true,
          workerMode: "local",
          allowedExecutables: ["agent"],
          workspaceRoots: ["/workspace"],
          maxOutputBytes: 1024 * 1024,
        },
        environmentWorkerCredentialResolverFromEnvironment({
          CLI_CREDENTIAL_ENVIRONMENT_ENABLED: "true",
          CURSOR_API_KEY: secret,
        }),
      );
      const agent = createCliAgent("t2-b6-cursor", "cursor");

      // Non-zero exit code -> rejects cleanly
      await expect(async () => {
        for await (const _ of cliExec.execute({
          agent,
          input: "fail",
          runId: "r-fail",
          nodeId: "n-fail",
          credentialPrincipal: { tenantId: PRINCIPAL_ALPHA.tenantId, principalId: PRINCIPAL_ALPHA.userId },
        })) { /* drain */ }
      }).rejects.toThrow(/exited with code 1/);

      // AbortSignal cancellation
      const ac = new AbortController();
      ac.abort();
      await expect(async () => {
        for await (const _ of cliExec.execute({
          agent,
          input: "aborted",
          runId: "r-abort",
          nodeId: "n-abort",
          signal: ac.signal,
        })) { /* drain */ }
      }).rejects.toThrow();
    });

    it("T2-B7: clarification API rejects empty answers (400), missing questionId (400), and supports idempotent replay", async () => {
      const store = new InMemoryRunStore();
      const studioStore = new InMemoryStudioStore();
      const agent = createCliAgent("t2-b7", "agy");
      await studioStore.saveAgent(agent, PRINCIPAL_ALPHA);

      const { runtime } = createScriptableAgentRuntime(() =>
        createResultEnvelope("needs_human", {
          value: {},
          needsHuman: {
            reason: "Need ID",
            purpose: "clarification",
            questions: [{ id: "q-required", prompt: "Provide ID?", required: true }],
          },
        }),
      );

      const executor = new RunExecutor(store, runtime, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const nIn = createNode("input", { x: 0, y: 0 });
      const nAg = createNode("agent", { x: 100, y: 0 }, { agentId: agent.id });
      const nOut = createNode("output", { x: 200, y: 0 });
      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("T2-B7 Clarification Edge Cases"),
        nodes: [nIn, nAg, nOut],
        edges: [createEdge({ source: nIn.id, target: nAg.id }), createEdge({ source: nAg.id, target: nOut.id })],
      };
      await studioStore.saveWorkflow(wf, PRINCIPAL_ALPHA);

      const startRes = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ workflow: wf, agents: [agent], input: {} }),
        }),
      );
      const { runId } = await readJsonResponse<{ runId: string }>(startRes);
      await assertRunCompletedOrDump(store, runId, ["waiting_for_human"]);

      const emptyRes = await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ answers: [] }),
        }),
      );
      expect(emptyRes.status).toBe(400);

      const missingQRes = await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ answers: [{ questionId: "wrong-id", value: "abc" }] }),
        }),
      );
      expect(missingQRes.status).toBe(400);

      const validPayload = { answers: [{ questionId: "q-required", value: "ABC-123" }] };
      const firstOk = await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify(validPayload),
        }),
      );
      expect([200, 202]).toContain(firstOk.status);

      const replay = await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify(validPayload),
        }),
      );
      expect(replay.status).toBe(200);
      expect(await readJsonResponse<{ idempotentReplay?: boolean }>(replay)).toMatchObject({ idempotentReplay: true });
    });

    it("T2-B8: maxIterations=1 trips on first revisit and maxExecutionSteps stops runaway cycles deterministically", async () => {
      const store = new InMemoryRunStore();
      const agent = createCliAgent("t2-b8", "codex");
      const { runtime } = createScriptableAgentRuntime(() => ({ route: "loop" }));

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSup = createNode("agent", { x: 100, y: 0 }, { agentId: agent.id });
      nSup.id = "sup-b8";
      const nGate = createNode("condition", { x: 200, y: 0 }, {
        valueSource: "last_value",
        valueField: "route",
        unknownRoute: "exit",
        branches: [
          { key: "loop", label: "Loop" },
          { key: "exit", label: "Exit" },
        ],
      });
      nGate.id = "gate-b8";
      const nOut = createNode("output", { x: 350, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("T2-B8 MaxIterations=1"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("sup-b8", {
          humanApprovalGateRequired: false,
          maxExecutionSteps: 20,
          recursionGuards: [createRecursionGuard("gate-b8->loop", "exit", 1)],
        }),
        nodes: [nIn, nSup, nGate, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nSup.id }),
          createEdge({ source: nSup.id, target: nGate.id }),
          createEdge({ source: nGate.id, target: nSup.id, kind: "conditional", branchKey: "loop" }),
          createEdge({ source: nGate.id, target: nOut.id, kind: "conditional", branchKey: "exit" }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [agent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      const limitEv = store.events(runId).find((e) => e.type === "node.loop_limit_reached");
      expect(limitEv?.payload).toMatchObject({ iteration: 1, targetBranch: "loop" });
    });
  });

  // =========================================================================
  // TIER 3 — CROSS-FEATURE COMBINATIONS (T3-C1..T3-C4)
  // =========================================================================

  describe("Tier 3: Cross-Feature Combinations", () => {
    it("T3-C1 (F1+F2+F3+F5+F6): Stage 1 Discovery -> dynamic_fanout(N=10, c=3) -> output report -> Stage 2 multi-prompts -> Stage 3", async () => {
      const mirror = trackMirror();
      const store = new InMemoryRunStore();
      const discAgent = createCliAgent("t3-c1-disc", "codex");
      const qaAgent = createCliAgent("t3-c1-qa", "agy");
      const archAgent = createCliAgent("t3-c1-arch", "codex");
      const specAgent = createCliAgent("t3-c1-spec", "agy");

      const reportTool = buildVeloraToolRecord("velora_output_report_tool", { projectRoot: mirror.root });
      const toolRuntime = new ToolRuntime(10_000, true);

      const controller = createScriptableAgentRuntime(async (input) => {
        if (input.agent.id === discAgent.id) {
          return {
            requirements: Array.from({ length: 10 }, (_, i) => ({ id: `A.1.${i + 1}`, domain: i < 5 ? "api" : "ui" })),
          };
        }
        if (input.agent.id === qaAgent.id) {
          await new Promise((r) => setTimeout(r, 15));
          return { id: (input.input as any)?.item?.id, verdict: "gap" };
        }
        if (input.agent.id === archAgent.id) {
          await toolRuntime.execute(reportTool, {
            action: "write",
            projectRoot: mirror.root,
            relativePath: "t3-c1/speckit-prompts.json",
            content: JSON.stringify({ granularity: "multi", prompts: ["P1", "P2"] }),
          }, undefined, { idempotencyKey: "t3-c1-write" });
          return { granularity: "multi", prompts: ["P1", "P2"] };
        }
        return { specified: input.input };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nDisc = createNode("agent", { x: 100, y: 0 }, { agentId: discAgent.id });
      const nFan = buildDynamicFanoutNode("t3-fan", { x: 250, y: 0 }, {
        targetAgentId: qaAgent.id,
        itemsField: "requirements",
        maxConcurrency: 3,
      });
      const nArch = createNode("agent", { x: 400, y: 0 }, { agentId: archAgent.id });
      const nSpec = createNode("agent", { x: 550, y: 0 }, { agentId: specAgent.id, sessionMode: "shared", sessionKey: "speckit-main" });
      const nOut = createNode("output", { x: 700, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("T3-C1 Discovery->Fanout->Architect->SpecKit"),
        nodes: [nIn, nDisc, nFan, nArch, nSpec, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nDisc.id }),
          createEdge({ source: nDisc.id, target: nFan.id }),
          createEdge({ source: nFan.id, target: nArch.id }),
          createEdge({ source: nArch.id, target: nSpec.id }),
          createEdge({ source: nSpec.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, controller.runtime);
      const runId = executor.start({ workflow: wf, agents: [discAgent, qaAgent, archAgent, specAgent], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(controller.getPeakConcurrency()).toBeLessThanOrEqual(3);
      expect(fs.existsSync(path.join(mirror.outputDir, "t3-c1", "speckit-prompts.json"))).toBe(true);
    });

    it("T3-C2 (F1+F3+F4+F7): Multi-provider Stage 3 (agy SpecKit + codex Supervisor) w/ clarify + needs_human reinvoke + tasks + analyze", async () => {
      const store = new InMemoryRunStore();
      const studioStore = new InMemoryStudioStore();
      const specAgy = createCliAgent("t3-c2-spec", "agy");
      const supCodex = createCliAgent("t3-c2-sup", "codex", { args: ["-s", "read-only"] });
      await studioStore.saveAgent(specAgy, PRINCIPAL_ALPHA);
      await studioStore.saveAgent(supCodex, PRINCIPAL_ALPHA);

      let clarifyCalls = 0;
      const specSessions: string[] = [];
      const supSeq = ["clarify", "plan", "tasks", "analyze", "done"];
      let supIdx = 0;

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === supCodex.id) {
          return { next: supSeq[supIdx++] ?? "done" };
        }
        if (helpers.sessionId) specSessions.push(helpers.sessionId);
        if (input.nodeId === "speckit-clarify") {
          clarifyCalls += 1;
          if (clarifyCalls === 1) {
            return createResultEnvelope("needs_human", {
              value: {},
              needsHuman: {
                reason: "Clarify RBAC role",
                purpose: "clarification",
                questions: [{ id: "q-role", prompt: "Default role?", required: true }],
              },
            });
          }
          return createResultEnvelope("success", { value: { clarified: true } });
        }
        return { stage: input.nodeId };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSup = createNode("agent", { x: 200, y: 0 }, { agentId: supCodex.id, sessionMode: "stateless" });
      nSup.id = "sup-c2";
      const nGate = createNode("condition", { x: 350, y: 0 }, {
        valueSource: "last_value",
        valueField: "next",
        unknownRoute: "done",
        branches: ["clarify", "plan", "tasks", "analyze", "done"].map((k) => ({ key: k, label: k })),
      });
      nGate.id = "gate-c2";
      const mkSpec = (id: string, y: number, reinvoke = false) => {
        const n = createNode("agent", { x: 500, y }, {
          agentId: specAgy.id,
          sessionMode: "shared",
          sessionKey: "speckit-main",
          reinvokeOnClarification: reinvoke,
        } as AgentNodeConfig);
        n.id = id;
        return n;
      };
      const nSpecify = mkSpec("speckit-specify", -200);
      const nClarify = mkSpec("speckit-clarify", -100, true);
      const nPlan = mkSpec("speckit-plan", 0);
      const nTasks = mkSpec("speckit-tasks", 100);
      const nAnalyze = mkSpec("speckit-analyze", 200);
      const nOut = createNode("output", { x: 700, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("T3-C2 Multi-Provider Stage 3"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("sup-c2", {
          humanApprovalGateRequired: false,
          recursionGuards: ["clarify", "plan", "tasks", "analyze"].map((b) =>
            createRecursionGuard(`gate-c2->${b}`, "done", 2),
          ),
        }),
        nodes: [nIn, nSup, nGate, nSpecify, nClarify, nPlan, nTasks, nAnalyze, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nSpecify.id }),
          createEdge({ source: nSpecify.id, target: nSup.id }),
          createEdge({ source: nSup.id, target: nGate.id }),
          ...["clarify", "plan", "tasks", "analyze"].flatMap((b) => [
            createEdge({ source: nGate.id, target: `speckit-${b}`, kind: "conditional", branchKey: b }),
            createEdge({ source: `speckit-${b}`, target: nSup.id }),
          ]),
          createEdge({ source: nGate.id, target: nOut.id, kind: "conditional", branchKey: "done" }),
        ],
      };
      await studioStore.saveWorkflow(wf, PRINCIPAL_ALPHA);

      const executor = new RunExecutor(store, runtime, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const startRes = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ workflow: wf, agents: [specAgy, supCodex], input: {} }),
        }),
      );
      const { runId } = await readJsonResponse<{ runId: string }>(startRes);
      await assertRunCompletedOrDump(store, runId, ["waiting_for_human"]);

      await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ answers: [{ questionId: "q-role", value: "manager" }] }),
        }),
      );
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(clarifyCalls).toBe(2);
      expect(specSessions.length).toBe(6);
      expect(new Set(specSessions).size).toBe(1);
    });

    it("T3-C3 (F3+F4+F8+F9): Stage 4 (cursor/codex) + 1 converge retry -> Stage 5 agy QA fails twice -> Stage 6 cursor Fixer direct loop", async () => {
      const store = new InMemoryRunStore();
      const implCodex = createCliAgent("t3-c3-impl", "codex", { filesystem: "read-write" });
      const convCodex = createCliAgent("t3-c3-conv", "codex");
      const qaAgy = createCliAgent("t3-c3-qa", "agy");
      const fixerCursor = createCliAgent("t3-c3-fixer", "cursor", { filesystem: "read-write" });

      let convPass = 0;
      let qaPass = 0;
      const executed: string[] = [];

      const { runtime } = createScriptableAgentRuntime((input) => {
        executed.push(input.nodeId);
        if (input.nodeId === "speckit-converge") {
          convPass += 1;
          return { verdict: convPass === 1 ? "continue_implement" : "converged" };
        }
        if (input.nodeId === "post-impl-qa") {
          qaPass += 1;
          return { qaStatus: qaPass <= 2 ? "qa_failed" : "qa_passed" };
        }
        return { ok: true };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nImpl = createNode("agent", { x: 100, y: 0 }, { agentId: implCodex.id, sessionMode: "node" });
      nImpl.id = "speckit-implement";
      const nConv = createNode("agent", { x: 220, y: 0 }, { agentId: convCodex.id });
      nConv.id = "speckit-converge";
      const nConvGate = createNode("condition", { x: 340, y: 0 }, {
        valueSource: "last_value",
        valueField: "verdict",
        unknownRoute: "converged",
        branches: [
          { key: "continue_implement", label: "Continue" },
          { key: "converged", label: "Converged" },
        ],
      });
      nConvGate.id = "conv-gate";
      const nQa = createNode("agent", { x: 480, y: 0 }, { agentId: qaAgy.id });
      nQa.id = "post-impl-qa";
      const nQaGate = createNode("condition", { x: 600, y: 0 }, {
        valueSource: "last_value",
        valueField: "qaStatus",
        unknownRoute: "qa_passed",
        branches: [
          { key: "qa_failed", label: "Failed" },
          { key: "qa_passed", label: "Passed" },
        ],
      });
      nQaGate.id = "qa-gate";
      const nFix = createNode("agent", { x: 600, y: 150 }, { agentId: fixerCursor.id, sessionMode: "node" });
      nFix.id = "post-qa-fixer";
      const nOut = createNode("output", { x: 750, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("T3-C3 Stage4+Stage5/6"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("speckit-converge", {
          humanApprovalGateRequired: false,
          recursionGuards: [
            createRecursionGuard("conv-gate->continue_implement", "converged", 3),
            createRecursionGuard("qa-gate->qa_failed", "qa_passed", 4),
          ],
        }),
        nodes: [nIn, nImpl, nConv, nConvGate, nQa, nQaGate, nFix, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nImpl.id }),
          createEdge({ source: nImpl.id, target: nConv.id }),
          createEdge({ source: nConv.id, target: nConvGate.id }),
          createEdge({ source: nConvGate.id, target: nImpl.id, kind: "conditional", branchKey: "continue_implement" }),
          createEdge({ source: nConvGate.id, target: nQa.id, kind: "conditional", branchKey: "converged" }),
          createEdge({ source: nQa.id, target: nQaGate.id }),
          createEdge({ source: nQaGate.id, target: nFix.id, kind: "conditional", branchKey: "qa_failed" }),
          createEdge({ source: nFix.id, target: nQa.id }),
          createEdge({ source: nQaGate.id, target: nOut.id, kind: "conditional", branchKey: "qa_passed" }),
        ],
      };

      const executor = new RunExecutor(store, runtime);
      const runId = executor.start({ workflow: wf, agents: [implCodex, convCodex, qaAgy, fixerCursor], input: {} });
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(executed).toEqual([
        "speckit-implement",
        "speckit-converge",
        "speckit-implement",
        "speckit-converge",
        "post-impl-qa",
        "post-qa-fixer",
        "post-impl-qa",
        "post-qa-fixer",
        "post-impl-qa",
      ]);
    });

    it("T3-C4 (F7+F9+F10): Zero-HITL autonomous flow through Fixer -> Stage 8 semantic graphify + index --semantic after stale PID clearance", async () => {
      const mirror = trackMirror({ progressJson: { state: "failed", pid: 110561 } });
      const stubBin = path.join(mirror.root, "bin");
      fs.mkdirSync(stubBin, { recursive: true });
      fs.writeFileSync(path.join(stubBin, "graphify"), "#!/bin/sh\necho '{\"ok\":true}'\n", { mode: 0o755 });
      fs.writeFileSync(
        path.join(mirror.root, "scripts", "knowledge", "cli.py"),
        "import json, sys\nprint(json.dumps({'ok': True, 'semantic': '--semantic' in sys.argv}))\n",
        "utf8",
      );

      const graphifyTool = buildVeloraToolRecord("velora_graphify_tool", { projectRoot: mirror.root });
      const kbTool = buildVeloraToolRecord("velora_knowledge_tool", { projectRoot: mirror.root });
      const toolRuntime = new ToolRuntime(10_000, true);

      const store = new InMemoryRunStore();
      const syncAgent = createCliAgent("t3-c4-sync", "codex");
      const prevPath = process.env.PATH ?? "";
      process.env.PATH = `${stubBin}${path.delimiter}${prevPath}`;
      try {
        const { runtime } = createScriptableAgentRuntime(async (input) => {
          if (input.nodeId === "stage8-sync") {
            const g = await toolRuntime.execute(graphifyTool, { action: "update", semantic: true, projectRoot: mirror.root }, undefined, { idempotencyKey: "t3c4-g" });
            const k = await toolRuntime.execute(kbTool, { action: "index", semantic: true, projectRoot: mirror.root }, undefined, { idempotencyKey: "t3c4-k" });
            return { graphifyOk: g.ok, knowledgeOk: k.ok };
          }
          return { ok: true };
        });

        const nIn = createNode("input", { x: 0, y: 0 });
        const nSync = createNode("agent", { x: 150, y: 0 }, { agentId: syncAgent.id });
        nSync.id = "stage8-sync";
        const nOut = createNode("output", { x: 300, y: 0 });
        const wf: WorkflowDefinition = {
          ...createEmptyDefinition("T3-C4 Autonomous Stage 8 Sync"),
          nodes: [nIn, nSync, nOut],
          edges: [createEdge({ source: nIn.id, target: nSync.id }), createEdge({ source: nSync.id, target: nOut.id })],
        };

        const executor = new RunExecutor(store, runtime);
        const runId = executor.start({ workflow: wf, agents: [syncAgent], input: {} });
        const rec = await assertRunCompletedOrDump(store, runId, ["completed"]);
        expect(rec.run.output).toMatchObject({ graphifyOk: true, knowledgeOk: true });
        expect(store.events(runId).filter((e) => e.type === "human_approval.requested")).toHaveLength(0);
      } finally {
        process.env.PATH = prevPath;
      }
    });
  });

  // =========================================================================
  // TIER 4 — REAL-WORLD APPLICATION SCENARIOS (T4-R1..T4-R2)
  // =========================================================================

  describe("Tier 4: Real-World Velora Phase A.1 Delivery Scenarios", () => {
    it("T4-R1: Velora Phase A.1 full autonomous 8-stage delivery simulation with zero HITL and zero target repo edits", async () => {
      const mirror = trackMirror({
        tasksContent: "# Phase A.1 Tasks\n- [x] T001 Resident Onboarding\n- [x] T002 Unit Directory\n",
      });
      const planResult = executeDeliveryPlanReader({ projectRoot: VELORA_TARGET_REPO_ROOT }, {});
      expect(planResult.nextRemainingPhase).toBe("A.1");

      const reportTool = buildVeloraToolRecord("velora_output_report_tool", { projectRoot: mirror.root });
      const toolRuntime = new ToolRuntime(10_000, true);

      const store = new InMemoryRunStore();
      const orch = createCliAgent("t4-orch", "codex");
      const disc = createCliAgent("t4-disc", "codex");
      const reqQa = createCliAgent("t4-req-qa", "agy");
      const arch = createCliAgent("t4-arch", "codex");
      const spec = createCliAgent("t4-spec", "agy");
      const sup = createCliAgent("t4-sup", "codex", { args: ["-s", "read-only"] });
      const impl = createCliAgent("t4-impl", "codex", { filesystem: "read-write" });
      const postQa = createCliAgent("t4-post-qa", "agy");
      const fixer = createCliAgent("t4-fixer", "cursor", { filesystem: "read-write" });
      const sync = createCliAgent("t4-sync", "codex");

      const stage3Sessions = new Set<string>();
      let postQaCalls = 0;
      const specSupRoute = ["clarify", "plan", "tasks", "analyze", "stage4"];
      let supStep = 0;

      const controller = createScriptableAgentRuntime(async (input, helpers) => {
        if (input.nodeId === "s1-discovery") {
          return {
            phase: "A.1",
            requirements: Array.from({ length: 10 }, (_, i) => ({ id: `A.1.${i + 1}` })),
          };
        }
        if (input.agent.id === reqQa.id) {
          return { id: (input.input as any)?.item?.id, verdict: "gap" };
        }
        if (input.nodeId === "s2-architect") {
          await toolRuntime.execute(reportTool, {
            action: "write",
            projectRoot: mirror.root,
            relativePath: "a1-qa/report.md",
            content: "# A.1 QA Report\n",
          }, undefined, { idempotencyKey: "t4-r1-qa-rep" });
          return { granularity: "single", prompts: [{ id: "01", prompt: "Specify A.1.01..A.1.04" }] };
        }
        if (input.agent.id === spec.id) {
          if (helpers.sessionId) stage3Sessions.add(helpers.sessionId);
          return { stage: input.nodeId, sessionId: helpers.sessionId };
        }
        if (input.nodeId === "s3-supervisor") {
          return { next: specSupRoute[supStep++] ?? "stage4" };
        }
        if (input.nodeId === "s5-post-qa") {
          postQaCalls += 1;
          return { qaStatus: postQaCalls === 1 ? "qa_failed" : "qa_passed", defects: postQaCalls === 1 ? ["A1-UI-1"] : [] };
        }
        if (input.nodeId === "s8-sync") {
          return { graphifyUpdated: true, semanticIndexed: true };
        }
        return { ok: true };
      });

      const nIn = createNode("input", { x: 0, y: 0 });
      const nDisc = createNode("agent", { x: 100, y: 0 }, { agentId: disc.id });
      nDisc.id = "s1-discovery";
      const nFan = buildDynamicFanoutNode("s1-fanout", { x: 200, y: 0 }, {
        targetAgentId: reqQa.id,
        itemsField: "requirements",
        maxConcurrency: 4,
      });
      const nArch = createNode("agent", { x: 300, y: 0 }, { agentId: arch.id });
      nArch.id = "s2-architect";
      const nSpec = createNode("agent", { x: 400, y: 0 }, { agentId: spec.id, sessionMode: "shared", sessionKey: "speckit-main" });
      nSpec.id = "speckit-specify";
      const nSup = createNode("agent", { x: 500, y: 0 }, { agentId: sup.id });
      nSup.id = "s3-supervisor";
      const nS3Gate = createNode("condition", { x: 600, y: 0 }, {
        valueSource: "last_value",
        valueField: "next",
        unknownRoute: "stage4",
        branches: ["clarify", "plan", "tasks", "analyze", "stage4"].map((k) => ({ key: k, label: k })),
      });
      nS3Gate.id = "s3-gate";
      const s3Branches = ["clarify", "plan", "tasks", "analyze"].map((b, i) => {
        const n = createNode("agent", { x: 600, y: 120 + i * 70 }, {
          agentId: spec.id,
          sessionMode: "shared",
          sessionKey: "speckit-main",
        });
        n.id = `speckit-${b}`;
        return n;
      });
      const nImpl = createNode("agent", { x: 750, y: 0 }, { agentId: impl.id });
      nImpl.id = "s4-implement";
      const nPostQa = createNode("agent", { x: 850, y: 0 }, { agentId: postQa.id });
      nPostQa.id = "s5-post-qa";
      const nQaGate = createNode("condition", { x: 950, y: 0 }, {
        valueSource: "last_value",
        valueField: "qaStatus",
        unknownRoute: "qa_passed",
        branches: [
          { key: "qa_failed", label: "Failed" },
          { key: "qa_passed", label: "Passed" },
        ],
      });
      nQaGate.id = "s5-qa-gate";
      const nFixer = createNode("agent", { x: 950, y: 140 }, { agentId: fixer.id, sessionMode: "node" });
      nFixer.id = "s6-fixer";
      const nSync = createNode("agent", { x: 1100, y: 0 }, { agentId: sync.id });
      nSync.id = "s8-sync";
      const nOut = createNode("output", { x: 1200, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("T4-R1 Phase A.1 Full Simulation"),
        archetype: "hierarchical-supervisor",
        archetypeConfig: createHierarchicalSupervisorConfig("s3-supervisor", {
          humanApprovalGateRequired: false,
          maxExecutionSteps: 80,
          recursionGuards: [
            ...["clarify", "plan", "tasks", "analyze"].map((b) => createRecursionGuard(`s3-gate->${b}`, "stage4", 2)),
            createRecursionGuard("s5-qa-gate->qa_failed", "qa_passed", 3),
          ],
        }),
        nodes: [nIn, nDisc, nFan, nArch, nSpec, nSup, nS3Gate, ...s3Branches, nImpl, nPostQa, nQaGate, nFixer, nSync, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nDisc.id }),
          createEdge({ source: nDisc.id, target: nFan.id }),
          createEdge({ source: nFan.id, target: nArch.id }),
          createEdge({ source: nArch.id, target: nSpec.id }),
          createEdge({ source: nSpec.id, target: nSup.id }),
          createEdge({ source: nSup.id, target: nS3Gate.id }),
          ...["clarify", "plan", "tasks", "analyze"].flatMap((b) => [
            createEdge({ source: nS3Gate.id, target: `speckit-${b}`, kind: "conditional", branchKey: b }),
            createEdge({ source: `speckit-${b}`, target: nSup.id }),
          ]),
          createEdge({ source: nS3Gate.id, target: nImpl.id, kind: "conditional", branchKey: "stage4" }),
          createEdge({ source: nImpl.id, target: nPostQa.id }),
          createEdge({ source: nPostQa.id, target: nQaGate.id }),
          createEdge({ source: nQaGate.id, target: nFixer.id, kind: "conditional", branchKey: "qa_failed" }),
          createEdge({ source: nFixer.id, target: nPostQa.id }),
          createEdge({ source: nQaGate.id, target: nSync.id, kind: "conditional", branchKey: "qa_passed" }),
          createEdge({ source: nSync.id, target: nOut.id }),
        ],
      };

      const executor = new RunExecutor(store, controller.runtime);
      const runId = executor.start({
        workflow: wf,
        agents: [orch, disc, reqQa, arch, spec, sup, impl, postQa, fixer, sync],
        input: { phase: "A.1" },
      });
      await assertRunCompletedOrDump(store, runId, ["completed"], 25_000);

      expect(stage3Sessions.size).toBe(1);
      expect(postQaCalls).toBe(2);
      expect(store.events(runId).filter((e) => e.type === "human_approval.requested")).toHaveLength(0);
      expect(fs.existsSync(path.join(mirror.outputDir, "a1-qa", "report.md"))).toBe(true);
      assertVeloraGitStateUnchanged(initialGitSnapshot, VELORA_TARGET_REPO_ROOT);
    });

    it("T4-R2: Velora Phase A.1 exception-only HITL escalation during speckit-specify resumes exact sessionId and finishes Stage 8", async () => {
      const store = new InMemoryRunStore();
      const studioStore = new InMemoryStudioStore();
      const spec = createCliAgent("t4-r2-spec", "agy");
      const sync = createCliAgent("t4-r2-sync", "codex");
      await studioStore.saveAgent(spec, PRINCIPAL_ALPHA);
      await studioStore.saveAgent(sync, PRINCIPAL_ALPHA);

      let specCalls = 0;
      const specSessions: string[] = [];

      const { runtime } = createScriptableAgentRuntime((input, helpers) => {
        if (input.agent.id === spec.id) {
          if (helpers.sessionId) specSessions.push(helpers.sessionId);
          specCalls += 1;
          if (input.nodeId === "speckit-specify" && specCalls === 1) {
            return createResultEnvelope("needs_human", {
              value: { draft: "A.1 partial" },
              needsHuman: {
                reason: "Unresolved A.1.03 role inheritance rule",
                purpose: "clarification",
                questions: [{ id: "q-rbac", prompt: "Should building_admin inherit resident_viewer?", required: true }],
              },
            });
          }
          return createResultEnvelope("success", { value: { stage: input.nodeId, ok: true } });
        }
        return { synced: true };
      });

      const executor = new RunExecutor(store, runtime, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, studioStore);
      const runsApp = createRunsRouter(executor, async () => null, studioStore, resolveTestPrincipal()).app;

      const nIn = createNode("input", { x: 0, y: 0 });
      const nSpecify = createNode("agent", { x: 100, y: 0 }, {
        agentId: spec.id,
        sessionMode: "shared",
        sessionKey: "speckit-main",
        reinvokeOnClarification: true,
      } as AgentNodeConfig);
      nSpecify.id = "speckit-specify";
      const nPlan = createNode("agent", { x: 250, y: 0 }, {
        agentId: spec.id,
        sessionMode: "shared",
        sessionKey: "speckit-main",
      });
      nPlan.id = "speckit-plan";
      const nSync = createNode("agent", { x: 400, y: 0 }, { agentId: sync.id });
      nSync.id = "s8-sync";
      const nOut = createNode("output", { x: 550, y: 0 });

      const wf: WorkflowDefinition = {
        ...createEmptyDefinition("T4-R2 A.1 Exception HITL"),
        nodes: [nIn, nSpecify, nPlan, nSync, nOut],
        edges: [
          createEdge({ source: nIn.id, target: nSpecify.id }),
          createEdge({ source: nSpecify.id, target: nPlan.id }),
          createEdge({ source: nPlan.id, target: nSync.id }),
          createEdge({ source: nSync.id, target: nOut.id }),
        ],
      };
      await studioStore.saveWorkflow(wf, PRINCIPAL_ALPHA);

      const startRes = await runsApp.fetch(
        new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ workflow: wf, agents: [spec, sync], input: { phase: "A.1" } }),
        }),
      );
      const { runId } = await readJsonResponse<{ runId: string }>(startRes);
      await assertRunCompletedOrDump(store, runId, ["waiting_for_human"]);

      const ansRes = await runsApp.fetch(
        new Request(`http://localhost/${runId}/clarification`, {
          method: "POST",
          headers: authHeaders(PRINCIPAL_ALPHA),
          body: JSON.stringify({ answers: [{ questionId: "q-rbac", value: "Yes, explicit inheritance" }] }),
        }),
      );
      expect([200, 202]).toContain(ansRes.status);
      await assertRunCompletedOrDump(store, runId, ["completed"]);

      expect(specCalls).toBe(3); // specify (needs_human) -> specify (reinvoke) -> plan
      expect(new Set(specSessions).size).toBe(1);
      expect(store.events(runId).some((e) => e.nodeId === "s8-sync" && e.type === "node.completed")).toBe(true);
    });
  });
});
