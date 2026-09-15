import { createAgentRecord, createEdge, createEmptyDefinition, createNode, createToolRecord, nowIso, type Run } from "@multi-agent/types";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { validateWorkflow } from "../apps/server/src/compiler/validation";
import { InMemoryRunStore } from "../apps/server/src/runtime/runStore";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunApiService } from "../apps/server/src/api/runs/runApiService";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";

function linearAgentWorkflow() {
  const agent = createAgentRecord({ name: "Retryable" });
  const input = createNode("input", { x: 0, y: 0 });
  const worker = createNode("agent", { x: 1, y: 0 }, { agentId: agent.id });
  const output = createNode("output", { x: 2, y: 0 });
  const workflow = {
    ...createEmptyDefinition(),
    nodes: [input, worker, output],
    edges: [createEdge({ source: input.id, target: worker.id }), createEdge({ source: worker.id, target: output.id })],
  };
  return { agent, input, worker, output, workflow };
}

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("node retry is bounded, observable, and completes the node exactly once", async () => {
  const fixture = linearAgentWorkflow();
  fixture.worker.retryPolicy = { maxAttempts: 3, backoffMs: 0, backoffMultiplier: 2 };
  let attempts = 0;
  const events: { type: string; payload?: unknown }[] = [];
  const compiled = compileWorkflow(fixture.workflow, [fixture.agent], {
    runtime: {
      async *execute(input) {
        attempts += 1;
        if (attempts < 3) {
          yield { type: "agent.failed" as const, timestamp: nowIso(), runId: input.runId, nodeId: input.nodeId, agentId: input.agent.id, payload: { error: "temporary" } };
          return;
        }
        yield { type: "agent.completed" as const, timestamp: nowIso(), runId: input.runId, nodeId: input.nodeId, agentId: input.agent.id, payload: { content: "recovered" } };
      },
    },
    onAgentEvent: (event) => events.push(event),
  });

  const state = await compiled.graph.invoke({ input: { request: "retry" } });
  expect(state.output).toEqual({ content: "recovered" });
  expect(attempts).toBe(3);
  expect(events.filter((event) => event.type === "node.retrying")).toHaveLength(2);
  expect(events.filter((event) => event.type === "node.failed")).toHaveLength(2);
  expect(events.filter((event) => event.type === "node.completed" && (event.payload as { nodeType?: string }).nodeType === "agent")).toHaveLength(1);
});

test("cancellation interrupts retry backoff before another attempt", async () => {
  const fixture = linearAgentWorkflow();
  fixture.worker.retryPolicy = { maxAttempts: 3, backoffMs: 5_000 };
  const controller = new AbortController();
  let attempts = 0;
  const compiled = compileWorkflow(fixture.workflow, [fixture.agent], {
    signal: controller.signal,
    runtime: {
      async *execute(input) {
        attempts += 1;
        yield { type: "agent.failed" as const, timestamp: nowIso(), runId: input.runId, nodeId: input.nodeId, agentId: input.agent.id, payload: { error: "temporary" } };
      },
    },
    onAgentEvent: (event) => { if (event.type === "node.retrying") controller.abort(); },
  });
  await expect(compiled.graph.invoke({ input: {} })).rejects.toThrow(/cancel/i);
  expect(attempts).toBe(1);
});

test("branch cancellation skips only the selected conditional branch", async () => {
  const agent = createAgentRecord({ name: "branch-worker" });
  const input = createNode("input", { x: 0, y: 0 });
  const condition = createNode("condition", { x: 1, y: 0 });
  condition.config = { branches: [{ key: "slow", label: "Slow" }, { key: "fast", label: "Fast" }] };
  const worker = createNode("agent", { x: 2, y: 0 }, { agentId: agent.id });
  const output = createNode("output", { x: 3, y: 0 });
  const workflow = {
    ...createEmptyDefinition(), nodes: [input, condition, worker, output], edges: [
      createEdge({ source: input.id, target: condition.id }),
      createEdge({ source: condition.id, target: worker.id, kind: "conditional", branchKey: "slow" }),
      createEdge({ source: condition.id, target: worker.id, kind: "conditional", branchKey: "fast" }),
      createEdge({ source: worker.id, target: output.id }),
    ],
  };
  const controller = new AbortController();
  const events: { type: string; payload?: unknown }[] = [];
  let startedResolve!: () => void;
  const started = new Promise<void>((resolve) => { startedResolve = resolve; });
  const compiled = compileWorkflow(workflow, [agent], {
    branchSignals: new Map([["slow", controller.signal]]),
    agentRunner: async (_agent, _state, meta) => {
      startedResolve();
      return new Promise((resolve) => {
        if (meta.signal?.aborted) resolve({ ok: true });
        else meta.signal?.addEventListener("abort", () => resolve({ ok: true }), { once: true });
      });
    },
    onAgentEvent: (event) => events.push(event),
  });
  const execution = compiled.graph.invoke({ input: { branch: "slow" } });
  await started;
  controller.abort();
  await expect(execution).resolves.toBeDefined();
  expect(events.some((event) => event.type === "branch.skipped" && (event.payload as { branchKey?: string })?.branchKey === "slow")).toBe(true);
  expect(events.some((event) => event.type === "node.completed" && (event.payload as { nodeType?: string })?.nodeType === "agent")).toBe(false);
});

test("branch cancellation is exposed only for declared workflow branches", () => {
  const condition = createNode("condition", { x: 0, y: 0 });
  condition.config = { branches: [{ key: "slow", label: "Slow" }] };
  const workflow = { ...createEmptyDefinition(), nodes: [condition], edges: [] };
  const store = new InMemoryRunStore();
  const principal = { userId: "branch-user", tenantId: "branch-tenant" };
  store.create({ id: "branch-api-run", workflowId: workflow.id, status: "running", startedAt: nowIso(), input: {}, metadata: {}, ownerId: principal.userId, tenantId: principal.tenantId }, undefined, { workflow, agents: [] }, principal);
  const executor = new RunExecutor(store, { async *execute() { /* no agent is invoked */ } });
  const service = new RunApiService(executor, async () => null, undefined, async () => principal);
  expect(service.cancelBranch("branch-api-run", "slow")).toEqual({ runId: "branch-api-run", branchKey: "slow", status: "cancelling" });
  expect(store.events("branch-api-run").at(-1)?.type).toBe("branch.cancelled");
  expect(() => service.cancelBranch("branch-api-run", "unknown")).toThrow(/active|cancelled/i);
});

test("parallel work obeys the live concurrency ceiling and fan-in preserves branch results", async () => {
  const agents = Array.from({ length: 4 }, (_, index) => createAgentRecord({ name: `branch-${index}` }));
  const input = createNode("input", { x: 0, y: 0 });
  const workers = agents.map((agent, index) => createNode("agent", { x: 1, y: index }, { agentId: agent.id }));
  const output = createNode("output", { x: 2, y: 0 });
  const workflow = {
    ...createEmptyDefinition(), nodes: [input, ...workers, output], edges: [
      ...workers.map((worker) => createEdge({ source: input.id, target: worker.id })),
      ...workers.map((worker) => createEdge({ source: worker.id, target: output.id })),
    ],
  };
  let active = 0;
  let maximum = 0;
  const compiled = compileWorkflow(workflow, agents, {
    guardrails: { maxWorkflowSteps: 100, maxConcurrentBranches: 2, maxNodeRetryAttempts: 3, maxNodeRetryBackoffMs: 100 },
    runtime: {
      async *execute(execution) {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        yield { type: "agent.completed" as const, timestamp: nowIso(), runId: execution.runId, nodeId: execution.nodeId, agentId: execution.agent.id, payload: { content: execution.agent.name } };
      },
    },
  });
  const state = await compiled.graph.invoke({ input: {} });
  expect(maximum).toBe(2);
  expect((state.output as { branches: Record<string, string> }).branches).toEqual(
    Object.fromEntries(workers.map((worker, index) => [worker.id, agents[index].name])),
  );
});

test("authoritative validation rejects unknown nodes, unsafe retries, and unsupported tools", () => {
  const fixture = linearAgentWorkflow();
  (fixture.worker as { type: string }).type = "mystery";
  expect(validateWorkflow(fixture.workflow, [fixture.agent]).map((issue) => issue.code)).toContain("UNKNOWN_NODE_TYPE");

  const safe = linearAgentWorkflow();
  safe.agent.backend = { type: "cli", provider: "codex", executable: "codex" };
  safe.worker.retryPolicy = { maxAttempts: 2, backoffMs: 0 };
  expect(validateWorkflow(safe.workflow, [safe.agent]).map((issue) => issue.code)).toContain("UNSAFE_NODE_RETRY");

  const tool = createToolRecord({ category: "mcp" });
  const toolNode = createNode("tool", { x: 1, y: 0 }, { toolId: tool.id });
  const toolWorkflow = { ...createEmptyDefinition(), nodes: [createNode("input", { x: 0, y: 0 }), toolNode, createNode("output", { x: 2, y: 0 })], edges: [] };
  expect(validateWorkflow(toolWorkflow, [], {}, [tool]).map((issue) => issue.code)).toContain("UNSUPPORTED_TOOL_CATEGORY");
});

test("run storage redacts and bounds payloads while retaining a terminal event", () => {
  const store = new InMemoryRunStore({ maxEventPayloadBytes: 256, maxRunPayloadBytes: 256, maxEventsPerRun: 2 });
  const run: Run = { id: "run-safe", workflowId: "wf", status: "running", startedAt: nowIso(), metadata: {} };
  store.create(run);
  store.append(run.id, { id: "e1", runId: run.id, type: "log", timestamp: nowIso(), sequence: 0, payload: { url: "https://user:password@example.test/a?access_token=secret", content: "x".repeat(2_000) } });
  store.append(run.id, { id: "e2", runId: run.id, type: "log", timestamp: nowIso(), sequence: 0, payload: {} });
  store.append(run.id, { id: "e3", runId: run.id, type: "log", timestamp: nowIso(), sequence: 0, payload: {} });
  store.append(run.id, { id: "e4", runId: run.id, type: "run.completed", timestamp: nowIso(), sequence: 0, payload: { output: "done" } });

  const serialized = JSON.stringify(store.events(run.id));
  expect(serialized).not.toContain("password");
  expect(serialized).not.toContain("access_token=secret");
  expect(store.events(run.id).some((event) => event.payload.eventLimitReached === true)).toBe(true);
  expect(store.events(run.id).at(-1)?.type).toBe("run.completed");

  store.update(run.id, { status: "completed", completedAt: nowIso() });
  store.update(run.id, { status: "waiting_for_human" });
  expect(store.get(run.id)?.run.status).toBe("completed");
});

test("run APIs execute principal-scoped registry records instead of tampered client copies", async () => {
  const principal = { userId: "owner", tenantId: "tenant" };
  const fixture = linearAgentWorkflow();
  fixture.agent.systemPrompt = "authoritative prompt";
  fixture.workflow.name = "authoritative workflow";
  const studio = new InMemoryStudioStore();
  await studio.saveAgent({ ...fixture.agent, ...principal, ownerId: principal.userId }, principal);
  await studio.saveWorkflow({ ...fixture.workflow, ...principal, ownerId: principal.userId }, principal);
  const runs = new InMemoryRunStore();
  const executor = new RunExecutor(runs, {
    async *execute(input) {
      yield { type: "agent.completed" as const, timestamp: nowIso(), runId: input.runId, nodeId: input.nodeId, agentId: input.agent.id, payload: { content: "ok" } };
    },
  });
  const service = new RunApiService(executor, async () => null, studio, async () => principal);
  const runId = await service.startRun({
    workflow: { ...fixture.workflow, name: "tampered workflow" },
    agents: [{ ...fixture.agent, systemPrompt: "tampered prompt" }],
    input: {},
  }, new Request("http://localhost/runs"), principal);

  expect(runs.getWorkflowSnapshot?.(runId)?.name).toBe("authoritative workflow");
  expect(runs.getAgentSnapshot?.(runId)?.[0].systemPrompt).toBe("authoritative prompt");
  await waitFor(() => runs.get(runId)?.run.status === "completed");
  expect(runs.events(runId).map((event) => event.type)).toEqual(expect.arrayContaining(["node.started", "node.completed", "edge.traversed"]));
});

test("whole-run retry updates the linked task and clears stale terminal fields", async () => {
  const principal = { userId: "task-owner", tenantId: "task-tenant" };
  const fixture = linearAgentWorkflow();
  const studio = new InMemoryStudioStore();
  const runs = new InMemoryRunStore();
  let execution = 0;
  const executor = new RunExecutor(runs, {
    async *execute(input) {
      execution += 1;
      if (execution === 1) {
        yield { type: "agent.failed" as const, timestamp: nowIso(), runId: input.runId, nodeId: input.nodeId, agentId: input.agent.id, payload: { error: "first run failed" } };
        return;
      }
      yield { type: "agent.completed" as const, timestamp: nowIso(), runId: input.runId, nodeId: input.nodeId, agentId: input.agent.id, payload: { content: "ok" } };
    },
  });
  const firstRunId = executor.start({ workflow: fixture.workflow, agents: [fixture.agent], input: {}, taskId: "task-linked" }, undefined, principal);
  await waitFor(() => runs.get(firstRunId)?.run.status === "failed");
  await studio.saveTask({
    id: "task-linked", title: "Linked task", description: "", priority: "medium", status: "failed",
    assignedAgent: fixture.agent.id, assignedAgents: [fixture.agent.id], dependencies: [], runId: firstRunId,
    output: "stale", lastError: "first run failed", retryCount: 4, paused: true, createdAt: nowIso(), completedAt: nowIso(),
    ownerId: principal.userId, tenantId: principal.tenantId,
  }, principal);
  const service = new RunApiService(executor, async () => null, studio, async () => principal);
  const retried = await service.retry(firstRunId, new Request(`http://localhost/runs/${firstRunId}/retry`), principal);
  const task = await studio.getTask("task-linked", principal);
  expect(task).toMatchObject({ runId: retried.runId, status: "running", retryCount: 5, output: null, lastError: null, paused: false, completedAt: null });
  await waitFor(() => runs.get(retried.runId)?.run.status === "completed");
});
