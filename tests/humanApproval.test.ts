import { createEdge, createEmptyDefinition, createNode, type WorkflowDefinition } from "@multi-agent/types";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { createRunsRouter } from "../apps/server/src/api/runs";

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function linearWorkflow(approvalConfig: Partial<{ message: string; approvalType: "manual" | "timeout"; timeoutSeconds: number }> = {}): WorkflowDefinition {
  const input = createNode("input", { x: 0, y: 0 });
  const approval = createNode("approval", { x: 1, y: 0 });
  approval.config = { message: "Approve to continue?", approvalType: "manual", timeoutSeconds: 300, ...approvalConfig };
  const output = createNode("output", { x: 2, y: 0 });
  return {
    ...createEmptyDefinition(),
    nodes: [input, approval, output],
    edges: [createEdge({ source: input.id, target: approval.id }), createEdge({ source: approval.id, target: output.id })],
  };
}

function branchingWorkflow() {
  const input = createNode("input", { x: 0, y: 0 });
  const approval = createNode("approval", { x: 1, y: 0 });
  const approvedNode = createNode("memory", { x: 2, y: -1 });
  approvedNode.config = { memoryType: "short_term", mode: "write", key: "marker" };
  const rejectedNode = createNode("memory", { x: 2, y: 1 });
  rejectedNode.config = { memoryType: "short_term", mode: "write", key: "marker" };
  const output = createNode("output", { x: 3, y: 0 });
  const workflow: WorkflowDefinition = {
    ...createEmptyDefinition(),
    nodes: [input, approval, approvedNode, rejectedNode, output],
    edges: [
      createEdge({ source: input.id, target: approval.id }),
      createEdge({ source: approval.id, target: approvedNode.id, kind: "conditional", branchKey: "approved" }),
      createEdge({ source: approval.id, target: rejectedNode.id, kind: "conditional", branchKey: "rejected" }),
      createEdge({ source: approvedNode.id, target: output.id }),
      createEdge({ source: rejectedNode.id, target: output.id }),
    ],
  };
  return { workflow, approvedNode, rejectedNode };
}

describe("Phase 7 human-in-the-loop approvals", () => {
  test("a run pauses at an approval node, surfaces the request, and resumes on approval", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const { app } = createRunsRouter(
      executor,
      undefined,
      undefined,
      async () => ({ userId: "test-user", tenantId: "test-tenant" }),
    );
    const workflow = linearWorkflow({ message: "Ship it?" });

    const startResponse = await app.request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow, agents: [], input: {} }) });
    expect(startResponse.status).toBe(202);
    const { runId } = await startResponse.json() as { runId: string };

    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    const approvalsResponse = await app.request(`http://localhost/${runId}/approvals`);
    const approvals = await approvalsResponse.json() as { id: string; status: string; message: string }[];
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ status: "requested", message: "Ship it?" });
    expect(store.events(runId).map((event) => event.type)).toContain("human_approval.requested");

    const resolveResponse = await app.request(`http://localhost/${runId}/approvals/${approvals[0].id}/resolve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approved", response: "looks good" }) });
    expect(resolveResponse.status).toBe(202);

    await waitFor(() => store.get(runId)?.run.status === "completed");
    expect(store.get(runId)?.run.output).toMatchObject({ decision: "approved", response: "looks good" });
    const eventTypes = store.events(runId).map((event) => event.type);
    expect(eventTypes).toContain("human_approval.resolved");
    expect(eventTypes).toContain("run.completed");
    expect((await app.request(`http://localhost/${runId}/approvals`)).status).toBe(200);
    const finalApprovals = await (await app.request(`http://localhost/${runId}/approvals`)).json() as { status: string }[];
    expect(finalApprovals[0].status).toBe("approved");
  });

  test("rejecting an approval routes execution through the rejected conditional branch", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const { workflow, rejectedNode, approvedNode } = branchingWorkflow();

    const runId = executor.start({ workflow, agents: [], input: {} });
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    const [approval] = store.listApprovals(runId);

    executor.resolveApproval(runId, approval.id, { decision: "rejected" });
    await waitFor(() => store.get(runId)?.run.status === "completed");

    // Compiler lifecycle events carry the stable node identity; raw LangGraph
    // task frames remain diagnostic logs.
    const nodeIds = store.events(runId).map((event) => event.nodeId).filter((id): id is string => Boolean(id));
    expect(nodeIds).toContain(rejectedNode.id);
    expect(nodeIds).not.toContain(approvedNode.id);
  });

  test("resolving an already-resolved approval fails", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const workflow = linearWorkflow();
    const runId = executor.start({ workflow, agents: [], input: {} });
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    const [approval] = store.listApprovals(runId);
    executor.resolveApproval(runId, approval.id, { decision: "approved" });
    expect(() => executor.resolveApproval(runId, approval.id, { decision: "approved" })).toThrow(/already been resolved/);
  });

  test("a timeout-type approval auto-resolves as approved without a manual decision", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const workflow = linearWorkflow({ approvalType: "timeout", timeoutSeconds: 0.02 });
    const runId = executor.start({ workflow, agents: [], input: {} });
    await waitFor(() => store.get(runId)?.run.status === "completed", 5000);
    const [approval] = store.listApprovals(runId);
    expect(approval.status).toBe("approved");
  });

  test("cancelling a run while waiting for human input resolves cleanly", async () => {
    const store = new RunStore();
    const executor = new RunExecutor(store);
    const workflow = linearWorkflow();
    const runId = executor.start({ workflow, agents: [], input: {} });
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    expect(executor.cancel(runId)).toBe(true);
    expect(store.get(runId)?.run.status).toBe("cancelled");
    expect(store.listApprovals(runId)[0].status).toBe("cancelled");
  });

  test("cancelling a run with memoryAccess while waiting for human input triggers episodic memory processing", async () => {
    const store = new RunStore();
    const episodeService = { processRun: jest.fn(async () => ({ created: false, reason: "trivial" })) };
    const executor = new RunExecutor(store, undefined, undefined, undefined, undefined, undefined, episodeService as never);
    const workflow = linearWorkflow();
    const memoryAccess = {
      principalId: "user-1",
      tenantId: "tenant-1",
      readableNamespaces: [{ scope: "project" as const, id: "proj-1" }],
      writableNamespaces: [{ scope: "project" as const, id: "proj-1" }],
    };
    const runId = executor.start({ workflow, agents: [], input: {} }, memoryAccess);
    await waitFor(() => store.get(runId)?.run.status === "waiting_for_human");
    expect(executor.cancel(runId)).toBe(true);
    expect(store.get(runId)?.run.status).toBe("cancelled");
    await waitFor(() => store.get(runId)?.episodicMemoryStatus === "processed");
    expect(episodeService.processRun).toHaveBeenCalledTimes(1);
    expect(episodeService.processRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId, succeeded: false, error: "Run was cancelled while waiting for a human." }),
      memoryAccess,
    );
  });

  test("cancelling a queued run with memoryAccess triggers episodic memory processing", async () => {
    const origConcurrency = process.env.WORKFLOW_MAX_CONCURRENT_RUNS;
    process.env.WORKFLOW_MAX_CONCURRENT_RUNS = "1";
    const store = new RunStore();
    const episodeService = { processRun: jest.fn(async () => ({ created: false, reason: "trivial" })) };
    // Create an agent runtime that blocks so the first run holds the active execution lock
    let unblockActiveRun: () => void = () => {};
    const blockingRuntime = {
      async *execute() {
        await new Promise<void>((resolve) => { unblockActiveRun = resolve; });
        yield* [];
      },
    };
    const executor = new RunExecutor(store, blockingRuntime as never, undefined, undefined, undefined, undefined, episodeService as never);
    const workflow = linearWorkflow();
    const memoryAccess = {
      principalId: "user-1",
      tenantId: "tenant-1",
      readableNamespaces: [{ scope: "project" as const, id: "proj-1" }],
      writableNamespaces: [{ scope: "project" as const, id: "proj-1" }],
    };
    const runId1 = executor.start({ workflow, agents: [], input: {} }, memoryAccess);
    const runId2 = executor.start({ workflow, agents: [], input: {} }, memoryAccess);
    expect(store.get(runId2)?.run.status).toBe("queued");

    expect(executor.cancel(runId2)).toBe(true);
    expect(store.get(runId2)?.run.status).toBe("cancelled");
    await waitFor(() => store.get(runId2)?.episodicMemoryStatus === "processed");
    expect(episodeService.processRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: runId2, succeeded: false, error: "Run was cancelled while queued." }),
      memoryAccess,
    );

    unblockActiveRun();
    executor.cancel(runId1);
    if (origConcurrency !== undefined) process.env.WORKFLOW_MAX_CONCURRENT_RUNS = origConcurrency;
    else delete process.env.WORKFLOW_MAX_CONCURRENT_RUNS;
  });
});
