import { createAgentRecord, createEdge, createEmptyDefinition, createNode, nowIso } from "@multi-agent/types";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { createRunsRouter } from "../apps/server/src/api/runs";
import { createStudioRouter } from "../apps/server/src/api/studio";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { InMemoryStudioStore } from "../src/studio/infrastructure/in-memory-studio-store";

const principal = async () => ({ userId: "phase45-user", tenantId: "phase45-tenant" });

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("compiled workflows emit stable node, state, and traversed-edge events", async () => {
  const input = createNode("input", { x: 0, y: 0 });
  const condition = createNode("condition", { x: 1, y: 0 });
  condition.config = { branches: [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] };
  const output = createNode("output", { x: 2, y: 0 });
  const edge1 = createEdge({ source: input.id, target: condition.id });
  const edge2 = createEdge({ source: condition.id, target: output.id, kind: "conditional", branchKey: "yes" });
  const workflow = { ...createEmptyDefinition(), nodes: [input, condition, output], edges: [edge1, edge2] };
  const events: { type: string; payload?: unknown; nodeId?: string }[] = [];
  const graph = compileWorkflow(workflow, [], { onAgentEvent: (event) => events.push(event) });
  await graph.graph.invoke({ input: { branch: "yes" } });
  expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["node.started", "node.completed", "state.updated", "edge.traversed"]));
  expect(events.some((event) => (event.payload as { edgeId?: string })?.edgeId === edge2.id)).toBe(true);
  expect(events.some((event) => (event.payload as { edgeId?: string })?.edgeId === edge1.id)).toBe(true);
});

test("real LangGraph fan-out and fan-in execute without serializing the branches", async () => {
  const agentA = createAgentRecord({ name: "A" });
  const agentB = createAgentRecord({ name: "B" });
  const input = createNode("input", { x: 0, y: 0 });
  const nodeA = createNode("agent", { x: 1, y: -1 }, { agentId: agentA.id });
  const nodeB = createNode("agent", { x: 1, y: 1 }, { agentId: agentB.id });
  const output = createNode("output", { x: 2, y: 0 });
  const workflow = { ...createEmptyDefinition(), nodes: [input, nodeA, nodeB, output], edges: [
    createEdge({ source: input.id, target: nodeA.id }), createEdge({ source: input.id, target: nodeB.id }),
    createEdge({ source: nodeA.id, target: output.id }), createEdge({ source: nodeB.id, target: output.id }),
  ] };
  const started: string[] = [];
  const graph = compileWorkflow(workflow, [agentA, agentB], {
    runtime: { async *execute(input) { started.push(input.agent.name); yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: input.agent.name } }; } },
  });
  await graph.graph.invoke({ input: { request: "fan out" } });
  expect(started.sort()).toEqual(["A", "B"]);
});

test("condition nodes can drive a bounded loop from the previous node value", async () => {
  const agent = createAgentRecord({ name: "Loop body" });
  const input = createNode("input", { x: 0, y: 0 });
  const condition = createNode("condition", { x: 1, y: 0 });
  condition.config = { branches: [{ key: "loop", label: "Loop" }, { key: "exit", label: "Exit" }] };
  const body = createNode("agent", { x: 2, y: 0 }, { agentId: agent.id });
  const output = createNode("output", { x: 3, y: 0 });
  const workflow = { ...createEmptyDefinition(), nodes: [input, condition, body, output], edges: [
    createEdge({ source: input.id, target: condition.id }),
    createEdge({ source: condition.id, target: body.id, kind: "conditional", branchKey: "loop" }),
    createEdge({ source: condition.id, target: output.id, kind: "conditional", branchKey: "exit" }),
    createEdge({ source: body.id, target: condition.id }),
  ] };
  let executions = 0;
  const graph = compileWorkflow(workflow, [agent], {
    runtime: { async *execute(input) { executions += 1; yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: { branch: "exit" } } }; } },
  });
  await graph.graph.invoke({ input: {} });
  expect(executions).toBe(1);
});

test("cancellation has a terminal status and a distinct terminal event", async () => {
  const store = new RunStore();
  const agent = createAgentRecord();
  const input = createNode("input", { x: 0, y: 0 });
  const agentNode = createNode("agent", { x: 1, y: 0 }, { agentId: agent.id });
  const output = createNode("output", { x: 2, y: 0 });
  const workflow = { ...createEmptyDefinition(), nodes: [input, agentNode, output], edges: [createEdge({ source: input.id, target: agentNode.id }), createEdge({ source: agentNode.id, target: output.id })] };
  const runtime = {
    async *execute(input: { signal?: AbortSignal; agent: typeof agent; runId: string; nodeId: string }) {
      yield { type: "agent.started" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId };
      await new Promise<void>((resolve, reject) => {
        if (input.signal?.aborted) return reject(new Error("aborted"));
        input.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  };
  const executor = new RunExecutor(store, runtime);
  const runId = executor.start({ workflow, agents: [agent], input: {} }, undefined, await principal());
  await waitFor(() => store.events(runId).some((event) => event.type === "agent.started"));
  expect(executor.cancel(runId)).toBe(true);
  await waitFor(() => store.get(runId)?.run.status === "cancelled");
  expect(store.events(runId).at(-1)?.type).toBe("run.cancelled");
  expect(executor.cancel(runId)).toBe(false);
});

test("failed runs can be retried from their immutable definition snapshot", async () => {
  const store = new RunStore();
  const agent = createAgentRecord();
  const input = createNode("input", { x: 0, y: 0 });
  const agentNode = createNode("agent", { x: 1, y: 0 }, { agentId: agent.id });
  const output = createNode("output", { x: 2, y: 0 });
  const workflow = { ...createEmptyDefinition(), nodes: [input, agentNode, output], edges: [createEdge({ source: input.id, target: agentNode.id }), createEdge({ source: agentNode.id, target: output.id })] };
  let attempts = 0;
  const runtime = {
    async *execute(input: { agent: typeof agent; runId: string; nodeId: string }) {
      attempts += 1;
      if (attempts === 1) {
        yield { type: "agent.failed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: "transient" } };
        return;
      }
      yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "recovered" } };
    },
  };
  const executor = new RunExecutor(store, runtime);
  const firstRunId = executor.start({ workflow, agents: [agent], input: { request: "retry" } });
  await waitFor(() => store.get(firstRunId)?.run.status === "failed");
  const retriedRunId = executor.retry(firstRunId);
  expect(retriedRunId).not.toBe(firstRunId);
  await waitFor(() => store.get(retriedRunId)?.run.status === "completed");
  expect(store.get(retriedRunId)?.run.input).toEqual({ request: "retry" });
  expect(store.events(retriedRunId).map((event) => event.type)).toContain("run.created");
});

test("agent diagnostics are server-side and do not expose credentials", async () => {
  const store = new InMemoryStudioStore();
  const agent = createAgentRecord({ backend: { type: "api", provider: "unknown-provider", model: "unknown-model" } });
  await store.saveAgent({ ...agent, ownerId: "phase45-user", tenantId: "phase45-tenant" }, await principal());
  const app = createStudioRouter(store, principal);
  const response = await app.request(`http://localhost/agents/${agent.id}/diagnostics`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expect.objectContaining({ status: "unsupported", backend: { type: "api", provider: "unknown-provider", model: "unknown-model" } }));
  expect(JSON.stringify(await (await app.request(`http://localhost/agents/${agent.id}/diagnostics`)).json())).not.toContain("API_KEY");
  const local = createAgentRecord({ backend: { type: "local", provider: "unknown-local", model: "model" } });
  await store.saveAgent({ ...local, ownerId: "phase45-user", tenantId: "phase45-tenant" }, await principal());
  expect(await (await app.request(`http://localhost/agents/${local.id}/diagnostics`)).json()).toEqual(expect.objectContaining({ status: "unsupported" }));
});

test("container CLI diagnostics validate image and inner command without requiring a host executable", async () => {
  const keys = [
    "CLI_AGENT_ENABLED", "CLI_WORKER_MODE", "CLI_WORKER_IMAGE", "CLI_AGENT_ALLOWED_EXECUTABLES",
    "CLI_CREDENTIAL_ENVIRONMENT_ENABLED", "CLI_CODEX_CREDENTIAL_ENV_VAR", "OPENAI_API_KEY",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.CLI_AGENT_ENABLED = "true";
    process.env.CLI_WORKER_MODE = "container";
    process.env.CLI_WORKER_IMAGE = `registry.example/agent@sha256:${"a".repeat(64)}`;
    process.env.CLI_AGENT_ALLOWED_EXECUTABLES = "/usr/local/bin/codex";
    process.env.CLI_CREDENTIAL_ENVIRONMENT_ENABLED = "true";
    process.env.CLI_CODEX_CREDENTIAL_ENV_VAR = "OPENAI_API_KEY";
    process.env.OPENAI_API_KEY = "dummy-diagnostic-secret";

    const store = new InMemoryStudioStore();
    const agent = createAgentRecord({ backend: { type: "cli", provider: "codex", executable: "/usr/local/bin/codex" } });
    await store.saveAgent({ ...agent, ownerId: "phase45-user", tenantId: "phase45-tenant" }, await principal());
    const app = createStudioRouter(store, principal);
    const response = await app.request(`http://localhost/agents/${agent.id}/diagnostics`);

    expect(response.status).toBe(200);
    const diagnostic = await response.json();
    expect(diagnostic).toEqual(expect.objectContaining({
      status: "unknown",
      message: expect.stringMatching(/Digest-pinned worker image and container executable are configured/),
    }));
    expect(JSON.stringify(diagnostic)).not.toContain("dummy-diagnostic-secret");
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("SSE replay honors the requested sequence after a completed run", async () => {
  const store = new RunStore();
  const executor = new RunExecutor(store, { async *execute(input) { yield { type: "agent.completed", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "ok" } }; } });
  const app = createRunsRouter(executor, undefined, undefined, principal).app;
  const agent = createAgentRecord();
  const input = createNode("input", { x: 0, y: 0 });
  const agentNode = createNode("agent", { x: 1, y: 0 }, { agentId: agent.id });
  const output = createNode("output", { x: 2, y: 0 });
  const workflow = { ...createEmptyDefinition(), nodes: [input, agentNode, output], edges: [createEdge({ source: input.id, target: agentNode.id }), createEdge({ source: agentNode.id, target: output.id })] };
  const start = await app.request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workflow, agents: [agent], input: {} }) });
  const { runId } = await start.json() as { runId: string };
  await waitFor(() => store.get(runId)?.run.status === "completed");
  const response = await app.request(`http://localhost/${runId}/events?sequence=2`);
  const body = await response.text();
  expect(body).not.toContain('"sequence":1,"payload"');
  expect(body).toContain("run.completed");
});
