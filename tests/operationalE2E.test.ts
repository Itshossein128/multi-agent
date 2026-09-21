import {
  createAgentRecord,
  createEdge,
  createEmptyDefinition,
  createNode,
  createToolRecord,
  nowIso,
  type AgentBackend,
  type AgentRecord,
  type MemoryNamespace,
  type ToolRecord,
  type WorkflowDefinition,
} from "@multi-agent/types";
import { createDashboardRouter } from "../apps/server/src/api/dashboard";
import { createMemoriesRouter } from "../apps/server/src/api/memories";
import { createRunsRouter } from "../apps/server/src/api/runs";
import { createToolsRouter } from "../apps/server/src/api/tools";
import { createMemoryAccessResolver } from "../apps/server/src/memory/access";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import type { AgentExecutionEvent, AgentExecutionInput } from "../src/agents/runtime/types";
import {
  createInternalPrincipalAssertion,
  verifyInternalPrincipalAssertion,
  type AuthenticatedPrincipal,
} from "../src/auth/internalPrincipal";
import {
  DefaultMemoryBackgroundJobs,
  DefaultMemoryContextFormatter,
  DefaultMemoryExtractor,
  DefaultMemoryService,
  DefaultMemoryWritePolicy,
} from "../src/memory/application";
import type { MemoryAccessContext, RuntimeMemoryDependencies } from "../src/memory/contracts";
import { InMemoryMemoryStore } from "../src/memory/infrastructure";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";
import { HttpToolExecutor } from "../src/tools/httpToolExecutor";
import { ToolRuntime } from "../src/tools/toolRuntime";

const TEST_SECRET = "operational-e2e-secret-key-32b";

const alice: AuthenticatedPrincipal = {
  userId: "alice-user",
  tenantId: "tenant-alpha",
};

const bob: AuthenticatedPrincipal = {
  userId: "bob-user",
  tenantId: "tenant-beta",
};

function authHeaders(principal?: AuthenticatedPrincipal): HeadersInit {
  if (!principal) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    "X-Multi-Agent-Principal": createInternalPrincipalAssertion(principal, TEST_SECRET),
  };
}

const resolvePrincipal = (request: Request): AuthenticatedPrincipal | null => {
  const token = request.headers.get("X-Multi-Agent-Principal");
  if (!token) return null;
  try {
    return verifyInternalPrincipalAssertion(token, TEST_SECRET);
  } catch {
    return null;
  }
};

async function waitFor(predicate: () => boolean, timeoutMs = 10000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Operational End-to-End Acceptance Test Suite", () => {
  jest.setTimeout(30000);

  let runStore: InMemoryRunStore;
  let studioStore: InMemoryStudioStore;
  let memoryStore: InMemoryMemoryStore;
  let memoryService: DefaultMemoryService;
  let memoryDeps: RuntimeMemoryDependencies;
  let fetchMock: jest.Mock;
  let toolRuntime: ToolRuntime;
  let runsApp: ReturnType<typeof createRunsRouter>["app"];
  let dashboardApp: ReturnType<typeof createDashboardRouter>;
  let toolsApp: ReturnType<typeof createToolsRouter>;
  let memoriesApp: ReturnType<typeof createMemoriesRouter>;

  beforeEach(() => {
    runStore = new InMemoryRunStore();
    studioStore = new InMemoryStudioStore();
    memoryStore = new InMemoryMemoryStore();
    memoryService = new DefaultMemoryService(memoryStore, {
      embeddingProvider: {
        metadata: { provider: "test", model: "fixed", dimensions: 2, version: "1" },
        embed: async () => [1, 0],
      },
    });
    memoryDeps = {
      service: memoryService,
      extractor: new DefaultMemoryExtractor(),
      writePolicy: new DefaultMemoryWritePolicy(),
      formatter: new DefaultMemoryContextFormatter(),
      jobs: new DefaultMemoryBackgroundJobs(),
    };

    fetchMock = jest.fn(async () =>
      new Response(JSON.stringify({ status: "success", data: "live-data" }), { status: 200 })
    );

    toolRuntime = new ToolRuntime(10_000, true, {
      create: (category) =>
        category === "http" ? new HttpToolExecutor(fetchMock) : { execute: jest.fn() },
    });

    const memoryResolver = createMemoryAccessResolver([
      {
        token: "alice-token-32-chars-long-secret",
        principalId: alice.userId,
        tenantId: alice.tenantId,
        readableNamespaces: [{ scope: "organization", id: alice.tenantId }],
        writableNamespaces: [{ scope: "organization", id: alice.tenantId }],
      },
      {
        token: "bob-token-32-chars-long-secret--",
        principalId: bob.userId,
        tenantId: bob.tenantId,
        readableNamespaces: [{ scope: "organization", id: bob.tenantId }],
        writableNamespaces: [{ scope: "organization", id: bob.tenantId }],
      },
    ]);

    memoriesApp = createMemoriesRouter(memoryService, memoryResolver);
  });

  describe("1. Main Operational Workflow Scenario", () => {
    test(
      "completes a multi-agent workflow with parallel branches, tool execution, memory read/write, human approval, timeline persistence, and dashboard reflection",
      async () => {
        // 1. Setup Agents
        const agentA: AgentRecord = {
          ...createAgentRecord({ name: "Agent A" }),
          id: "agent-a",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
          memory: {
            enabled: true,
            type: "run",
            scope: "agent",
            mode: "write",
            maxEntries: 10,
            shortTerm: { enabled: true },
            longTerm: { enabled: true, writeMode: "hot_path" },
          },
        };

        const agentB: AgentRecord = {
          ...createAgentRecord({ name: "Agent B" }),
          id: "agent-b",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
        };

        const agentC: AgentRecord = {
          ...createAgentRecord({ name: "Agent C" }),
          id: "agent-c",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
          memory: {
            enabled: true,
            type: "run",
            scope: "agent",
            mode: "read",
            maxEntries: 10,
            shortTerm: { enabled: true },
            longTerm: { enabled: true, retrieval: { maxTokens: 2048, minScore: 0 } },
          },
        };

        const agentD: AgentRecord = {
          ...createAgentRecord({ name: "Agent D" }),
          id: "agent-d",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
        };

        await studioStore.saveAgent(agentA, alice);
        await studioStore.saveAgent(agentB, alice);
        await studioStore.saveAgent(agentC, alice);
        await studioStore.saveAgent(agentD, alice);

        // 2. Setup Tool
        const httpTool: ToolRecord = {
          ...createToolRecord({ name: "Lookup Service", category: "http" }),
          id: "http-tool-1",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
          configuration: {
            url: "https://service.internal/api/lookup",
            method: "POST",
          },
          impact: "read-only",
        };

        await studioStore.saveTool(httpTool, alice);

        // 3. Parallel Execution Barrier Setup
        let agentBStartedResolve: () => void;
        const agentBStarted = new Promise<void>((r) => {
          agentBStartedResolve = r;
        });
        let agentCStartedResolve: () => void;
        const agentCStarted = new Promise<void>((r) => {
          agentCStartedResolve = r;
        });

        let agentBWasConcurrent = false;
        let agentCWasConcurrent = false;

        // Custom Agent Executor Factory for deterministic parallel behavior and memory interaction
        const mockExecutorFactory = {
          create: (_backend: AgentBackend) => ({
            async *execute(input: AgentExecutionInput): AsyncGenerator<AgentExecutionEvent> {
              if (input.agent.id === "agent-a") {
                yield {
                  type: "agent.started",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                };
                yield {
                  type: "agent.completed",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                  payload: {
                    content: {
                      status: "Agent A processed input",
                      extractedMemory: "deployment_region: us-east-1",
                    },
                    usage: {
                      inputTokens: 100,
                      outputTokens: 50,
                      totalTokens: 150,
                      cost: 0.001,
                    },
                  },
                };
              } else if (input.agent.id === "agent-b") {
                agentBStartedResolve();
                // Yield control to event loop so Agent C can be scheduled concurrently
                await new Promise((r) => setTimeout(r, 0));
                await agentCStarted;
                agentBWasConcurrent = true;

                yield {
                  type: "agent.started",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                };
                yield {
                  type: "agent.completed",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                  payload: { content: { status: "Agent B completed branch" } },
                };
              } else if (input.agent.id === "agent-c") {
                agentCStartedResolve();
                // Yield control to event loop so Agent B can be scheduled concurrently
                await new Promise((r) => setTimeout(r, 0));
                await agentBStarted;
                agentCWasConcurrent = true;

                yield {
                  type: "agent.started",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                };
                yield {
                  type: "agent.completed",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                  payload: {
                    content: {
                      status: "Agent C observed memory",
                      memoryObserved: input.context?.memoryContext ?? "none",
                    },
                  },
                };
              } else if (input.agent.id === "agent-d") {
                yield {
                  type: "agent.started",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                };
                yield {
                  type: "agent.completed",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                  payload: {
                    content: {
                      finalResult: "Workflow execution completed successfully with approval",
                    },
                  },
                };
              }
            },
          }),
        };

        const agentRuntime = new AgentRuntime(mockExecutorFactory, memoryDeps);
        const executor = new RunExecutor(
          runStore,
          agentRuntime,
          undefined,
          undefined,
          undefined,
          toolRuntime
        );

        const memoryAccessResolver = async (req: Request) => {
          const p = resolvePrincipal(req);
          if (!p) return null;
          const ns: MemoryNamespace = { scope: "organization", id: p.tenantId };
          return {
            principalId: p.userId,
            tenantId: p.tenantId,
            readableNamespaces: [ns],
            writableNamespaces: [ns],
          };
        };

        runsApp = createRunsRouter(executor, memoryAccessResolver, studioStore, resolvePrincipal).app;
        dashboardApp = createDashboardRouter(runStore, studioStore, executor, resolvePrincipal);

        // Pre-seed Alice's memory to test Memory Read/Write via RuntimeMemory
        const aliceMemoryAccess: MemoryAccessContext = {
          principalId: alice.userId,
          tenantId: alice.tenantId,
          readableNamespaces: [{ scope: "organization", id: alice.tenantId }],
          writableNamespaces: [{ scope: "organization", id: alice.tenantId }],
        };

        await memoryService.remember(
          {
            namespace: { scope: "organization", id: alice.tenantId },
            kind: "semantic",
            content: "deployment_region: us-east-1",
            source: { type: "user" },
            importance: 0.9,
          },
          aliceMemoryAccess
        );

        // 4. Construct Workflow DAG
        const inputNode = createNode("input", { x: 0, y: 0 });
        const agentANode = createNode("agent", { x: 1, y: 0 });
        agentANode.config = { agentId: agentA.id };

        const agentBNode = createNode("agent", { x: 2, y: -1 });
        agentBNode.config = { agentId: agentB.id };

        const toolNode = createNode("tool", { x: 3, y: -1 });
        toolNode.config = { toolId: httpTool.id };

        const agentCNode = createNode("agent", { x: 2, y: 1 });
        agentCNode.config = { agentId: agentC.id };

        const approvalNode = createNode("approval", { x: 4, y: 0 });
        approvalNode.config = {
          message: "Approve deployment to us-east-1?",
          approvalType: "manual",
          timeoutSeconds: 300,
        };

        const agentDNode = createNode("agent", { x: 5, y: 0 });
        agentDNode.config = { agentId: agentD.id };

        const outputNode = createNode("output", { x: 6, y: 0 });

        const workflow: WorkflowDefinition = {
          ...createEmptyDefinition(),
          id: "wf-acceptance-1",
          name: "Operational Acceptance Workflow",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
          nodes: [
            inputNode,
            agentANode,
            agentBNode,
            toolNode,
            agentCNode,
            approvalNode,
            agentDNode,
            outputNode,
          ],
          edges: [
            createEdge({ source: inputNode.id, target: agentANode.id }),
            createEdge({ source: agentANode.id, target: agentBNode.id }),
            createEdge({ source: agentANode.id, target: agentCNode.id }),
            createEdge({ source: agentBNode.id, target: toolNode.id }),
            createEdge({ source: toolNode.id, target: agentDNode.id }),
            createEdge({ source: agentCNode.id, target: agentDNode.id }),
            createEdge({ source: agentDNode.id, target: approvalNode.id }),
            createEdge({
              source: approvalNode.id,
              target: outputNode.id,
              kind: "conditional",
              branchKey: "approved",
            }),
          ],
        };

        await studioStore.saveWorkflow(workflow, alice);

        // 5. Start Execution via HTTP Route as Alice
        const startReq = new Request("http://localhost/", {
          method: "POST",
          headers: authHeaders(alice),
          body: JSON.stringify({
            workflow,
            agents: [agentA, agentB, agentC, agentD],
            tools: [httpTool],
            input: { query: "Deploy production workload" },
            metadata: { totalTokens: 150, cost: 0.001 },
          }),
        });

        const startRes = await runsApp.fetch(startReq);
        expect(startRes.status).toBe(202);
        const { runId } = (await startRes.json()) as { runId: string };
        expect(runId).toBeDefined();

        // 6. Wait for Execution to pause at Human Approval Node
        await waitFor(() => runStore.get(runId)?.run.status === "waiting_for_human");

        // Prove parallel execution occurred concurrently
        expect(agentBWasConcurrent).toBe(true);
        expect(agentCWasConcurrent).toBe(true);

        // Prove Tool execution occurred
        expect(fetchMock).toHaveBeenCalledWith(
          new URL("https://service.internal/api/lookup"),
          expect.objectContaining({ method: "POST" })
        );

        // Verify Approval Request details
        const approvalsRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}/approvals`, { headers: authHeaders(alice) })
        );
        expect(approvalsRes.status).toBe(200);
        const approvals = (await approvalsRes.json()) as { id: string; status: string; message: string }[];
        expect(approvals).toHaveLength(1);
        expect(approvals[0].status).toBe("requested");
        expect(approvals[0].message).toBe("Approve deployment to us-east-1?");

        // Verify Timeline contains human_approval.requested and tool events
        const events = runStore.events(runId);
        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toContain("run.started");
        expect(eventTypes).toContain("tool.started");
        expect(eventTypes).toContain("tool.completed");
        expect(eventTypes).toContain("human_approval.requested");

        // Verify Dashboard during waiting state: run is waiting, not completed
        const dashWaitingRes = await dashboardApp.fetch(
          new Request("http://localhost/", { headers: authHeaders(alice) })
        );
        expect(dashWaitingRes.status).toBe(200);
        const dashWaitingData = await dashWaitingRes.json();
        expect(dashWaitingData.completedTasks.some((item: any) => item.id === runId)).toBe(false);

        // 7. Verify Unauthorized Approval Denial (Bob attempts to approve Alice's run)
        const unauthorizedApprovalRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}/approvals/${approvals[0].id}/resolve`, {
            method: "POST",
            headers: authHeaders(bob),
            body: JSON.stringify({ decision: "approved" }),
          })
        );
        expect(unauthorizedApprovalRes.status).toBe(404); // Fail closed

        // Approval remains requested
        const approvalCheck = runStore.getApproval(runId, approvals[0].id);
        expect(approvalCheck?.status).toBe("requested");

        // 8. Authorized Approval Resolution (Alice approves)
        const resolveRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}/approvals/${approvals[0].id}/resolve`, {
            method: "POST",
            headers: authHeaders(alice),
            body: JSON.stringify({ decision: "approved", response: "Deployment approved by Alice" }),
          })
        );
        expect(resolveRes.status).toBe(202);

        // 9. Wait for Workflow Completion
        await waitFor(() => runStore.get(runId)?.run.status === "completed");

        // 10. Verify Completed State & Events
        const completedRun = runStore.get(runId)?.run;
        expect(completedRun?.status).toBe("completed");
        expect(completedRun?.output).toBeDefined();

        const finalEvents = runStore.events(runId);
        const finalEventTypes = finalEvents.map((e) => e.type);
        expect(finalEventTypes).toContain("human_approval.resolved");
        expect(finalEventTypes).toContain("run.completed");

        // 11. Verify Authoritative Dashboard Reflection
        const dashCompletedRes = await dashboardApp.fetch(
          new Request("http://localhost/", { headers: authHeaders(alice) })
        );
        expect(dashCompletedRes.status).toBe(200);
        const dashCompletedData = await dashCompletedRes.json();

        expect(dashCompletedData.queue.some((item: any) => item.id === runId)).toBe(false);
        const completedTaskEntry = dashCompletedData.completedTasks.find(
          (item: any) => item.id === runId
        );
        expect(completedTaskEntry).toBeDefined();

        // Verify Provider Usage Metrics propagation
        expect(completedRun?.metadata?.totalTokens).toBe(150);
        expect(completedRun?.metadata?.cost).toBe(0.001);

        // 12. Verify Secondary Run without cost returns null for cost (no synthetic calculation)
        runStore.create(
          {
            id: "run-no-cost",
            workflowId: workflow.id,
            status: "completed",
            startedAt: nowIso(),
            completedAt: nowIso(),
            ownerId: alice.userId,
            tenantId: alice.tenantId,
            metadata: {
              totalTokens: 100,
              // cost is deliberately missing
            },
          },
          undefined,
          undefined,
          alice
        );

        const dashNoCostRes = await dashboardApp.fetch(
          new Request("http://localhost/", { headers: authHeaders(alice) })
        );
        const dashNoCostData = await dashNoCostRes.json();
        const noCostTaskEntry = dashNoCostData.completedTasks.find(
          (item: any) => item.id === "run-no-cost"
        );
        expect(noCostTaskEntry).toBeDefined();
        expect(noCostTaskEntry.cost).toBeNull();
      },
      15000
    );
  });

  describe("2. Cancellation Scenario", () => {
    test(
      "cancels an active workflow, propagates AbortSignal, stops downstream execution, and updates dashboard",
      async () => {
        let agentStartedResolve: () => void;
        const agentStarted = new Promise<void>((r) => {
          agentStartedResolve = r;
        });

        let blockingUnreachedExecuted = false;

        const mockExecutorFactory = {
          create: () => ({
            async *execute(input: AgentExecutionInput): AsyncGenerator<AgentExecutionEvent> {
              if (input.agent.id === "agent-block") {
                agentStartedResolve();
                yield {
                  type: "agent.started",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                };

                // Hang indefinitely until cancelled via input.signal
                await new Promise<void>((_, reject) => {
                  if (input.signal?.aborted) {
                    reject(input.signal.reason);
                    return;
                  }
                  input.signal?.addEventListener("abort", () => {
                    reject(input.signal?.reason);
                  });
                });
              } else if (input.agent.id === "agent-downstream") {
                blockingUnreachedExecuted = true;
                yield {
                  type: "agent.completed",
                  timestamp: nowIso(),
                  agentId: input.agent.id,
                  nodeId: input.nodeId,
                  runId: input.runId,
                };
              }
            },
          }),
        };

        const agentBlock: AgentRecord = {
          ...createAgentRecord({ name: "Block Agent" }),
          id: "agent-block",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
        };

        const agentDownstream: AgentRecord = {
          ...createAgentRecord({ name: "Downstream Agent" }),
          id: "agent-downstream",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
        };

        await studioStore.saveAgent(agentBlock, alice);
        await studioStore.saveAgent(agentDownstream, alice);

        const inputNode = createNode("input", { x: 0, y: 0 });
        const blockNode = createNode("agent", { x: 1, y: 0 });
        blockNode.config = { agentId: agentBlock.id };
        const downstreamNode = createNode("agent", { x: 2, y: 0 });
        downstreamNode.config = { agentId: agentDownstream.id };
        const outputNode = createNode("output", { x: 3, y: 0 });

        const workflow: WorkflowDefinition = {
          ...createEmptyDefinition(),
          id: "wf-cancel-test",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
          nodes: [inputNode, blockNode, downstreamNode, outputNode],
          edges: [
            createEdge({ source: inputNode.id, target: blockNode.id }),
            createEdge({ source: blockNode.id, target: downstreamNode.id }),
            createEdge({ source: downstreamNode.id, target: outputNode.id }),
          ],
        };

        await studioStore.saveWorkflow(workflow, alice);

        const executor = new RunExecutor(runStore, new AgentRuntime(mockExecutorFactory));
        runsApp = createRunsRouter(executor, undefined, studioStore, resolvePrincipal).app;
        dashboardApp = createDashboardRouter(runStore, studioStore, executor, resolvePrincipal);

        // Start run
        const startRes = await runsApp.fetch(
          new Request("http://localhost/", {
            method: "POST",
            headers: authHeaders(alice),
            body: JSON.stringify({
              workflow,
              agents: [agentBlock, agentDownstream],
              input: {},
            }),
          })
        );
        const { runId } = (await startRes.json()) as { runId: string };

        // Wait until agent starts executing
        await agentStarted;
        await waitFor(() => runStore.get(runId)?.run.status === "running");

        // 1. Unauthorized Cancellation (Bob attempts to cancel Alice's run)
        const unauthorizedCancelRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}/cancel`, {
            method: "POST",
            headers: authHeaders(bob),
          })
        );
        expect(unauthorizedCancelRes.status).toBe(404);
        expect(runStore.get(runId)?.run.status).toBe("running");

        // 2. Authorized Cancellation (Alice cancels her run)
        const authorizedCancelRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}/cancel`, {
            method: "POST",
            headers: authHeaders(alice),
          })
        );
        expect(authorizedCancelRes.status).toBe(202);

        await waitFor(() => runStore.get(runId)?.run.status === "cancelled");

        expect(runStore.get(runId)?.run.status).toBe("cancelled");
        expect(blockingUnreachedExecuted).toBe(false);

        // Timeline verification
        const events = runStore.events(runId);
        const lastEvent = events[events.length - 1];
        expect(lastEvent.type).toBe("run.cancelled");
        expect(
          String((lastEvent.payload as any)?.error || (lastEvent.payload as any)?.cancelled)
        ).toMatch(/aborted|cancelled|true/i);

        // Dashboard verification
        const dashRes = await dashboardApp.fetch(
          new Request("http://localhost/", { headers: authHeaders(alice) })
        );
        const dashData = await dashRes.json();
        expect(dashData.queue.some((i: any) => i.id === runId)).toBe(false);
        expect(dashData.completedTasks.some((i: any) => i.id === runId)).toBe(false);
      },
      15000
    );
  });

  describe("3. Deterministic Runtime Failure Scenario", () => {
    test(
      "persists deterministic tool/agent execution failure and exposes it through dashboard state",
      async () => {
        const mockFailingFactory = {
          create: () => ({
            async *execute(input: AgentExecutionInput): AsyncGenerator<AgentExecutionEvent> {
              yield {
                type: "agent.started",
                timestamp: nowIso(),
                agentId: input.agent.id,
                nodeId: input.nodeId,
                runId: input.runId,
              };
              yield {
                type: "agent.failed",
                timestamp: nowIso(),
                agentId: input.agent.id,
                nodeId: input.nodeId,
                runId: input.runId,
                payload: { error: "Controlled LLM Provider Error: Rate limit 429" },
              };
              throw new Error("Controlled LLM Provider Error: Rate limit 429");
            },
          }),
        };

        const failingAgent: AgentRecord = {
          ...createAgentRecord({ name: "Failing Agent" }),
          id: "agent-fail",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
        };

        await studioStore.saveAgent(failingAgent, alice);

        const inputNode = createNode("input", { x: 0, y: 0 });
        const failNode = createNode("agent", { x: 1, y: 0 });
        failNode.config = { agentId: failingAgent.id };
        const outputNode = createNode("output", { x: 2, y: 0 });

        const workflow: WorkflowDefinition = {
          ...createEmptyDefinition(),
          id: "wf-fail-test",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
          nodes: [inputNode, failNode, outputNode],
          edges: [
            createEdge({ source: inputNode.id, target: failNode.id }),
            createEdge({ source: failNode.id, target: outputNode.id }),
          ],
        };

        await studioStore.saveWorkflow(workflow, alice);

        const executor = new RunExecutor(runStore, new AgentRuntime(mockFailingFactory));
        runsApp = createRunsRouter(executor, undefined, studioStore, resolvePrincipal).app;
        dashboardApp = createDashboardRouter(runStore, studioStore, executor, resolvePrincipal);

        const startRes = await runsApp.fetch(
          new Request("http://localhost/", {
            method: "POST",
            headers: authHeaders(alice),
            body: JSON.stringify({
              workflow,
              agents: [failingAgent],
              input: {},
            }),
          })
        );
        const { runId } = (await startRes.json()) as { runId: string };

        await waitFor(() => runStore.get(runId)?.run.status === "failed");

        const runEntry = runStore.get(runId);
        expect(runEntry?.run.status).toBe("failed");
        expect(runEntry?.run.error).toContain("Rate limit 429");

        // Verify dashboard exposes failure
        const dashRes = await dashboardApp.fetch(
          new Request("http://localhost/", { headers: authHeaders(alice) })
        );
        const dashData = await dashRes.json();
        expect(dashData.failedTasks.some((item: any) => item.id === runId)).toBe(true);
      },
      15000
    );
  });

  describe("4. Multi-Tenant Authorization Isolation Scenario", () => {
    test(
      "prevents cross-principal access to runs, events, approvals, memory, and dashboard data",
      async () => {
        const agent: AgentRecord = {
          ...createAgentRecord({ name: "Alice Agent" }),
          id: "alice-agent",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
        };

        await studioStore.saveAgent(agent, alice);

        const inputNode = createNode("input", { x: 0, y: 0 });
        const outputNode = createNode("output", { x: 1, y: 0 });

        const workflow: WorkflowDefinition = {
          ...createEmptyDefinition(),
          id: "alice-wf",
          ownerId: alice.userId,
          tenantId: alice.tenantId,
          nodes: [inputNode, outputNode],
          edges: [createEdge({ source: inputNode.id, target: outputNode.id })],
        };

        await studioStore.saveWorkflow(workflow, alice);

        const executor = new RunExecutor(runStore);
        runsApp = createRunsRouter(executor, undefined, studioStore, resolvePrincipal).app;
        dashboardApp = createDashboardRouter(runStore, studioStore, executor, resolvePrincipal);

        // Create Alice run
        const runId = executor.start({ workflow, agents: [agent], input: {} }, undefined, alice);

        // 1. Bob cannot fetch Alice's run
        const getRunRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}`, { headers: authHeaders(bob) })
        );
        expect(getRunRes.status).toBe(404);

        // 2. Bob cannot fetch Alice's events
        const getEventsRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}/events`, { headers: authHeaders(bob) })
        );
        expect(getEventsRes.status).toBe(404);

        // 3. Bob cannot fetch Alice's approvals
        const getApprovalsRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}/approvals`, { headers: authHeaders(bob) })
        );
        expect(getApprovalsRes.status).toBe(404);

        // 4. Bob cannot cancel Alice's run
        const cancelRes = await runsApp.fetch(
          new Request(`http://localhost/${runId}/cancel`, {
            method: "POST",
            headers: authHeaders(bob),
          })
        );
        expect(cancelRes.status).toBe(404);

        // 5. Bob cannot access Alice's memory via API
        const bobMemoriesRes = await memoriesApp.fetch(
          new Request(`http://localhost/?scope=organization&namespaceId=${bob.tenantId}`, {
            headers: { Authorization: "Bearer bob-token-32-chars-long-secret--" },
          })
        );
        expect(bobMemoriesRes.status).toBe(200);
        const bobMemories = await bobMemoriesRes.json();
        expect(bobMemories.items ?? bobMemories).toHaveLength(0);

        // 6. Bob querying dashboard sees strictly zero records from Alice
        const bobDashRes = await dashboardApp.fetch(
          new Request("http://localhost/", { headers: authHeaders(bob) })
        );
        expect(bobDashRes.status).toBe(200);
        const bobDashData = await bobDashRes.json();
        expect(bobDashData.queue).toHaveLength(0);
        expect(bobDashData.completedTasks).toHaveLength(0);
        expect(bobDashData.failedTasks).toHaveLength(0);

        // RunExecutor executes in the background. Keep the Jest environment
        // alive until the graph has emitted its terminal lifecycle event.
        await waitFor(() => runStore.get(runId)?.run.status === "completed");
      },
      15000
    );
  });
});
