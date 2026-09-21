import type { AgentRecord, RunEvent, WorkflowDefinition, RunStatus } from "@multi-agent/types";
import { GraphRunner } from "../apps/server/src/runtime/graphRunner";
import type { RunStoreContract, RunEntry } from "../apps/server/src/runtime/store/contracts";
import type { ApprovalManager, PausedContext } from "../apps/server/src/runtime/approvalManager";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

// ── Lightweight mock helpers ─────────────────────────────────────────────

interface MockStoreState {
  runStatus: string;
  output: Record<string, unknown> | undefined;
  eventLog: RunEvent[];
  pausedContextData: RunEntry["pausedContext"];
}

function createMockStore(): RunStoreContract & { state: MockStoreState } {
  const state: MockStoreState = {
    runStatus: "running",
    output: undefined,
    eventLog: [],
    pausedContextData: undefined,
  };

  const store: RunStoreContract & { state: MockStoreState } = {
    state,

    create: jest.fn(),
    getMemoryOwner: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    subscribe: jest.fn().mockReturnValue(() => {}),
    cancel: jest.fn(),
    addApproval: jest.fn(),
    getApproval: jest.fn(),
    listApprovals: jest.fn().mockReturnValue([]),
    updateApproval: jest.fn(),
    setApprovalTimer: jest.fn(),
    clearApprovalTimer: jest.fn(),

    get(runId: string) {
      return {
        run: { id: runId, status: state.runStatus, output: state.output } as never,
        events: state.eventLog.filter((e) => e.runId === runId),
        listeners: new Set(),
        abort: new AbortController(),
        approvals: [],
        approvalTimers: new Map(),
      } as never;
    },

    append(_runId: string, event: RunEvent) {
      state.eventLog.push(event);
      return event;
    },

    events(_runId: string, _after?: number) {
      return state.eventLog;
    },

    update(_runId: string, patch: Record<string, unknown>) {
      if (patch.status) state.runStatus = patch.status as string;
      if (patch.output) state.output = patch.output as Record<string, unknown>;
      return { id: _runId, status: state.runStatus } as never;
    },

    signal(_runId: string) {
      return new AbortController().signal;
    },

    setPausedContext(_runId: string, context: RunEntry["pausedContext"] | null) {
      state.pausedContextData = context ?? undefined;
    },
  };

  return store;
}

function createMockApprovalManager(): ApprovalManager {
  return {
    handleApprovalRequested: jest.fn(),
    resolveApproval: jest.fn(),
    rearmApprovalTimers: jest.fn(),
  } as unknown as ApprovalManager;
}

function createMockCheckpointers(): Map<string, BaseCheckpointSaver> {
  return new Map();
}

function createMockWorkflow(): WorkflowDefinition {
  return {
    id: "wf-1",
    name: "Test Workflow",
    updatedAt: "2026-01-01T00:00:00Z",
    nodes: [] as never,
    edges: [] as never,
    metadata: {},
  } as WorkflowDefinition;
}

describe("GraphRunner", () => {
  describe("runGraph", () => {
    test("processes events and marks run as completed", async () => {
      const store = createMockStore();
      const pausedContext = new Map<string, PausedContext>();
      const checkpointers = createMockCheckpointers();
      const runner = new GraphRunner(store, pausedContext, checkpointers);
      const approvalManager = createMockApprovalManager();

      const mockGraph = {
        streamEvents: jest.fn(async function* () {
          yield { method: "values", params: { data: { output: { result: "done" } } } };
        }),
        getState: jest.fn(async () => ({ next: [] })),
      };

      const compiled = { graph: mockGraph, agentByNode: new Map(), issues: [] };

      await runner.runGraph("run-1", compiled, {}, createMockWorkflow(), [], approvalManager);

      expect(store.state.runStatus).toBe("completed");
      expect(store.state.output).toEqual({ result: "done" });
      const eventTypes = store.state.eventLog.map((e) => e.type);
      expect(eventTypes).toContain("run.completed");
    });

    test("handles interrupt events and delegates to approval manager", async () => {
      const store = createMockStore();
      const pausedContext = new Map<string, PausedContext>();
      const checkpointers = createMockCheckpointers();
      const runner = new GraphRunner(store, pausedContext, checkpointers);
      const approvalManager = createMockApprovalManager();

      const mockGraph = {
        streamEvents: jest.fn(async function* () {
          yield {
            method: "updates",
            params: {
              node: "__interrupt__",
              data: {
                values: [{ id: "approval-1", value: { nodeId: "n1", message: "Go?" } }],
              },
            },
          };
        }),
        getState: jest.fn(async () => ({ next: ["__interrupt__"] })),
      };

      const compiled = { graph: mockGraph, agentByNode: new Map(), issues: [] };

      await runner.runGraph("run-1", compiled, {}, createMockWorkflow(), [], approvalManager);

      expect(approvalManager.handleApprovalRequested).toHaveBeenCalledWith("run-1", {
        id: "approval-1",
        value: { nodeId: "n1", message: "Go?" },
      });
      expect(pausedContext.has("run-1")).toBe(true);
      expect(store.state.pausedContextData).toBeDefined();
    });

    test("pauses run when graph state has pending next nodes", async () => {
      const store = createMockStore();
      const pausedContext = new Map<string, PausedContext>();
      const checkpointers = createMockCheckpointers();
      const runner = new GraphRunner(store, pausedContext, checkpointers);
      const approvalManager = createMockApprovalManager();

      const mockGraph = {
        streamEvents: jest.fn(async function* () {
          yield { method: "values", params: { data: {} } };
        }),
        getState: jest.fn(async () => ({ next: ["waiting_node"] })),
      };

      const compiled = { graph: mockGraph, agentByNode: new Map(), issues: [] };
      const workflow = createMockWorkflow();
      const agents = [{ id: "agent-1" }] as AgentRecord[];

      await runner.runGraph("run-1", compiled, {}, workflow, agents, approvalManager);

      expect(pausedContext.has("run-1")).toBe(true);
      const ctx = pausedContext.get("run-1");
      expect(ctx?.workflow).toBe(workflow);
      expect(ctx?.agents).toBe(agents);
    });

    test("cleans up pause state when graph completes", async () => {
      const store = createMockStore();
      const pausedContext = new Map<string, PausedContext>();
      const checkpointers = createMockCheckpointers();
      const runner = new GraphRunner(store, pausedContext, checkpointers);
      const approvalManager = createMockApprovalManager();

      pausedContext.set("run-1", { workflow: createMockWorkflow(), agents: [] });

      const mockGraph = {
        streamEvents: jest.fn(async function* () {
          yield { method: "values", params: { data: { output: {} } } };
        }),
        getState: jest.fn(async () => ({ next: [] })),
      };

      const compiled = { graph: mockGraph, agentByNode: new Map(), issues: [] };

      await runner.runGraph("run-1", compiled, {}, createMockWorkflow(), [], approvalManager);

      expect(pausedContext.has("run-1")).toBe(false);
      expect(checkpointers.has("run-1")).toBe(false);
    });

    test("passes options through to streamEvents", async () => {
      const store = createMockStore();
      const pausedContext = new Map<string, PausedContext>();
      const checkpointers = createMockCheckpointers();
      const runner = new GraphRunner(store, pausedContext, checkpointers);
      const approvalManager = createMockApprovalManager();
      const abortController = new AbortController();

      const mockGraph = {
        streamEvents: jest.fn(async function* () {
          yield { method: "values", params: { data: {} } };
        }),
        getState: jest.fn(async () => ({ next: [] })),
      };

      const compiled = { graph: mockGraph, agentByNode: new Map(), issues: [] };

      await runner.runGraph(
        "run-1",
        compiled,
        { input: "test" },
        createMockWorkflow(),
        [],
        approvalManager,
        undefined,
        undefined,
        undefined,
        abortController.signal,
        undefined,
        50,
      );

      const callArgs = mockGraph.streamEvents.mock.calls[0] as unknown[];
      expect(callArgs).toHaveLength(2);
      const opts = callArgs[1] as Record<string, unknown>;
      expect(opts).toMatchObject({
        version: "v3",
        streamMode: ["tasks", "updates", "values", "messages"],
        recursionLimit: 50,
      });
    });
  });
});
