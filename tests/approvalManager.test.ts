import type { ApprovalRequest, RunEvent } from "@multi-agent/types";
import { ApprovalManager } from "../apps/server/src/runtime/approvalManager";
import type { ApprovalManagerDependencies } from "../apps/server/src/runtime/approvalManager";
import type { RunStoreContract } from "../apps/server/src/runtime/store/contracts";
import { runtimeGuardrailsFromEnvironment } from "../apps/server/src/runtime/guardrails";

// ── Lightweight mock helpers ─────────────────────────────────────────────

interface MockStoreState {
  runStatus: string;
  approvalMap: Map<string, Map<string, ApprovalRequest>>;
  eventLog: RunEvent[];
  timers: Map<string, Map<string, NodeJS.Timeout>>;
}

function createMockStore(): RunStoreContract & { state: MockStoreState } {
  const state: MockStoreState = {
    runStatus: "running",
    approvalMap: new Map(),
    eventLog: [],
    timers: new Map(),
  };

  const store: RunStoreContract & { state: MockStoreState } = {
    state,

    create: jest.fn(),
    getMemoryOwner: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    subscribe: jest.fn().mockReturnValue(() => {}),
    cancel: jest.fn(),

    get(runId: string) {
      return {
        run: { id: runId, status: state.runStatus } as never,
        events: state.eventLog.filter((e) => e.runId === runId),
        listeners: new Set(),
        abort: new AbortController(),
        approvals: Array.from(state.approvalMap.get(runId)?.values() ?? []),
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
      return { id: _runId, status: state.runStatus } as never;
    },

    addApproval(runId: string, approval: ApprovalRequest, _timeoutSeconds?: number) {
      if (!state.approvalMap.has(runId)) state.approvalMap.set(runId, new Map());
      state.approvalMap.get(runId)!.set(approval.id, approval);
    },

    getApproval(runId: string, approvalId: string) {
      return state.approvalMap.get(runId)?.get(approvalId);
    },

    listApprovals(runId: string) {
      return Array.from(state.approvalMap.get(runId)?.values() ?? []);
    },

    updateApproval(runId: string, approvalId: string, patch: Partial<ApprovalRequest>) {
      const existing = state.approvalMap.get(runId)?.get(approvalId);
      if (!existing) return undefined;
      const updated = { ...existing, ...patch };
      state.approvalMap.get(runId)!.set(approvalId, updated);
      return updated;
    },

    setApprovalTimer(runId: string, approvalId: string, timer: NodeJS.Timeout) {
      if (!state.timers.has(runId)) state.timers.set(runId, new Map());
      state.timers.get(runId)!.set(approvalId, timer);
    },

    clearApprovalTimer(runId: string, approvalId: string) {
      const timer = state.timers.get(runId)?.get(approvalId);
      if (timer) clearTimeout(timer);
      state.timers.get(runId)?.delete(approvalId);
    },

    signal(_runId: string) {
      return new AbortController().signal;
    },
  };

  return store;
}

/** Minimal async-iterable stub for agentRuntime.execute */
async function* agentExecuteStub() {
  yield { type: "agent.completed", payload: { content: "ok" } } as never;
}

function createMockDeps(store: RunStoreContract): ApprovalManagerDependencies {
  return {
    store,
    checkpointers: new Map(),
    pausedContext: new Map(),
    branchControllers: new Map(),
    agentRuntime: { execute: agentExecuteStub },
    guardrails: runtimeGuardrailsFromEnvironment(),
    credentialPrincipalForRun: () => undefined,
    appendAgentEvent: () => {},
    runGraph: async () => {},
    signal: () => new AbortController().signal,
    fail: () => {},
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("ApprovalManager", () => {
  describe("handleApprovalRequested", () => {
    test("creates approval record and updates run status", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: {
          nodeId: "node-approval",
          message: "Ship it?",
          approvalType: "manual",
          timeoutSeconds: 300,
        },
      });

      const approval = store.getApproval("run-1", "approval-1");
      expect(approval).toBeDefined();
      expect(approval!.status).toBe("requested");
      expect(approval!.message).toBe("Ship it?");
      expect(approval!.nodeId).toBe("node-approval");
      expect(store.state.runStatus).toBe("waiting_for_human");
    });

    test("appends run.paused and human_approval.requested events", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: {
          nodeId: "node-1",
          message: "Continue?",
          approvalType: "manual",
          timeoutSeconds: 300,
        },
      });

      const eventTypes = store.state.eventLog.map((e) => e.type);
      expect(eventTypes).toContain("run.paused");
      expect(eventTypes).toContain("human_approval.requested");
    });

    test("sets timeout timer for timeout-type approvals", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: {
          nodeId: "node-1",
          message: "Auto-approve?",
          approvalType: "timeout",
          timeoutSeconds: 0.01,
        },
      });

      expect(store.state.timers.get("run-1")?.has("approval-1")).toBe(true);
    });

    test("does not set timer for manual approvals", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: {
          nodeId: "node-1",
          message: "Manual?",
          approvalType: "manual",
          timeoutSeconds: 300,
        },
      });

      // No timer entry should exist for this run at all
      expect(store.state.timers.get("run-1")).toBeUndefined();
    });
  });

  describe("resolveApproval", () => {
    test("resolves an approval and updates status to approved", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: { nodeId: "n1", message: "Go?", approvalType: "manual", timeoutSeconds: 300 },
      });

      manager.resolveApproval("run-1", "approval-1", { decision: "approved" });

      const approval = store.getApproval("run-1", "approval-1");
      expect(approval!.status).toBe("approved");
      expect(approval!.resolvedAt).toBeDefined();
      expect(store.state.runStatus).toBe("running");
    });

    test("appends resolved, approved, and resumed events", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: { nodeId: "n1", message: "Go?", approvalType: "manual", timeoutSeconds: 300 },
      });

      manager.resolveApproval("run-1", "approval-1", { decision: "approved" });

      const eventTypes = store.state.eventLog.map((e) => e.type);
      expect(eventTypes).toContain("human_approval.approved");
      expect(eventTypes).toContain("human_approval.resolved");
      expect(eventTypes).toContain("run.resumed");
    });

    test("handles rejection", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: { nodeId: "n1", message: "Go?", approvalType: "manual", timeoutSeconds: 300 },
      });

      manager.resolveApproval("run-1", "approval-1", { decision: "rejected" });

      const approval = store.getApproval("run-1", "approval-1");
      expect(approval!.status).toBe("rejected");
      const eventTypes = store.state.eventLog.map((e) => e.type);
      expect(eventTypes).toContain("human_approval.rejected");
    });

    test("throws when approval not found", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      expect(() => manager.resolveApproval("run-1", "missing", { decision: "approved" })).toThrow(/not found/);
    });

    test("throws when approval already resolved", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: { nodeId: "n1", message: "Go?", approvalType: "manual", timeoutSeconds: 300 },
      });

      manager.resolveApproval("run-1", "approval-1", { decision: "approved" });
      expect(() => manager.resolveApproval("run-1", "approval-1", { decision: "approved" })).toThrow(/already been resolved/);
    });

    test("clears the approval timer on resolve", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: { nodeId: "n1", message: "Go?", approvalType: "timeout", timeoutSeconds: 300 },
      });

      expect(store.state.timers.get("run-1")?.has("approval-1")).toBe(true);
      manager.resolveApproval("run-1", "approval-1", { decision: "approved" });
      expect(store.state.timers.get("run-1")?.has("approval-1")).toBe(false);
    });
  });

  describe("rearmApprovalTimers", () => {
    test("re-arms pending approvals with remaining timeout", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: { nodeId: "n1", message: "Go?", approvalType: "timeout", timeoutSeconds: 10 },
      });

      // Simulate timer cleared (e.g., after restart)
      store.state.timers.get("run-1")?.delete("approval-1");
      expect(store.state.timers.get("run-1")?.has("approval-1")).toBe(false);

      manager.rearmApprovalTimers("run-1");
      expect(store.state.timers.get("run-1")?.has("approval-1")).toBe(true);
    });

    test("skips already-resolved approvals", () => {
      const store = createMockStore();
      const deps = createMockDeps(store);
      const manager = new ApprovalManager(deps);

      manager.handleApprovalRequested("run-1", {
        id: "approval-1",
        value: { nodeId: "n1", message: "Go?", approvalType: "timeout", timeoutSeconds: 10 },
      });

      manager.resolveApproval("run-1", "approval-1", { decision: "approved" });
      store.state.timers.get("run-1")?.delete("approval-1");

      manager.rearmApprovalTimers("run-1");
      expect(store.state.timers.get("run-1")?.has("approval-1")).toBe(false);
    });
  });
});
