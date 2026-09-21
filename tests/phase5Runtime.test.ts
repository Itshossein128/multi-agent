import { createAgentRecord, createNode, createEdge, createEmptyDefinition, modelSettingsSchema, validateAgent } from "@multi-agent/types";
import { compileWorkflow } from "../apps/server/src/compiler/workflowCompiler";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import { AgentExecutorFactory } from "../src/agents/runtime/agentExecutorFactory";
import { ApiAgentExecutor } from "../src/agents/runtime/apiAgentExecutor";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";
import { createRunsRouter } from "../apps/server/src/api/runs";
import type { AgentExecutionInput, AgentExecutionEvent } from "../src/agents/runtime/types";

async function collect(events: AsyncIterable<AgentExecutionEvent>) { const result = []; for await (const event of events) result.push(event); return result; }
const complete = (input: AgentExecutionInput): AgentExecutionEvent => ({ type: "agent.completed", timestamp: new Date().toISOString(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "answer" } });

test("compiled workflows share agent memory between sequential instances and preserve text output", async () => {
  const agent = { ...createAgentRecord(), memory: { enabled: true, type: "run" as const, scope: "agent" as const, mode: "read_write" as const, maxEntries: 5 } };
  const nodes = [createNode("input", { x: 0, y: 0 }), createNode("agent", { x: 1, y: 0 }, { agentId: agent.id }), createNode("agent", { x: 2, y: 0 }, { agentId: agent.id }), createNode("output", { x: 3, y: 0 })];
  const workflow = { ...createEmptyDefinition(), nodes, edges: nodes.slice(1).map((node, index) => createEdge({ source: nodes[index].id, target: node.id })) };
  const histories: unknown[] = [];
  const spy = jest.spyOn(AgentExecutorFactory.prototype, "create").mockReturnValue({ async *execute(input) { histories.push(input.context?.history); yield complete(input); } });
  try {
    const compiled = compileWorkflow(workflow, [agent], { runId: "compiled-test" });
    const result = await compiled.graph.invoke({ input: { question: "hi" } });
    expect(result.output).toEqual({ content: "answer" });
    expect(histories).toEqual([[], [{ input: { question: "hi" }, output: "answer" }]]);
    expect(() => compileWorkflow(workflow, [{ ...agent, enabled: false }])).toThrow(/disabled/);
  } finally { spy.mockRestore(); }
});

test("disabled agents fail before executor creation", async () => {
  const create = jest.fn();
  const runtime = new AgentRuntime({ create } as unknown as AgentExecutorFactory);
  await expect(collect(runtime.execute({ agent: { ...createAgentRecord(), enabled: false }, input: {}, runId: "r", nodeId: "n" }))).rejects.toThrow(/disabled/);
  expect(create).not.toHaveBeenCalled();
});

test("memory is bounded and isolated by run and node, with read/write modes enforced", async () => {
  const histories: unknown[] = [];
  const runtime = new AgentRuntime({ create: () => ({ async *execute(input: AgentExecutionInput) {
    histories.push(input.context?.history); yield complete(input);
  } }) } as unknown as AgentExecutorFactory);
  const agent = { ...createAgentRecord(), memory: { enabled: true, type: "run" as const, scope: "agent" as const, mode: "read_write" as const, maxEntries: 1 } };
  const memoryStore = new Map<string, { input: unknown; output: unknown }[]>();
  const base = { agent, memoryStore, input: "first", runId: "r1", nodeId: "n1" };
  const events = await collect(runtime.execute(base));
  await collect(runtime.execute({ ...base, input: "second", nodeId: "n2" }));
  await collect(runtime.execute({ ...base, input: "third", nodeId: "n3" }));
  await collect(runtime.execute({ ...base, runId: "r2" }));
  await collect(runtime.execute({ ...base, agent: { ...agent, memory: { ...agent.memory, scope: "node" } } }));
  const before = JSON.stringify([...memoryStore]);
  await collect(runtime.execute({ ...base, agent: { ...agent, memory: { ...agent.memory, mode: "read" } } }));
  expect(JSON.stringify([...memoryStore])).toBe(before);
  await collect(runtime.execute({ ...base, agent: { ...agent, memory: { ...agent.memory, mode: "write" } } }));
  expect(histories).toEqual([[], [{ input: "first", output: "answer" }], [{ input: "second", output: "answer" }], [], [], [{ input: "third", output: "answer" }], []]);
  expect(events.map((event) => event.type)).toEqual(["memory.read", "agent.completed", "memory.write"]);
});

test("model schemas validate settings and executor forwards settings, history and cancellation", async () => {
  const settings = { temperature: 0.3, maxTokens: 512 };
  const agent = createAgentRecord({ backend: { type: "api", provider: "openai", model: "gpt-4o", settings } });
  expect(validateAgent(agent)).toEqual([]);
  expect(modelSettingsSchema({ type: "api", provider: "openai", model: "o3" }).map((field) => field.key)).toEqual(["maxTokens"]);
  expect(validateAgent({ ...agent, backend: { type: "api", provider: "anthropic", model: "claude", settings: { temperature: 1.5 } } })).not.toEqual([]);
  const invoke = jest.fn(async () => ({ content: "ok" }));
  const getModel = jest.fn(() => ({ invoke }));
  const signal = new AbortController().signal;
  await collect(new ApiAgentExecutor(() => ({ getModel })).execute({ agent, runId: "r", nodeId: "n", input: "new", signal, context: { history: [{ input: "old", output: "reply" }] } }));
  expect(getModel).toHaveBeenCalledWith("openai", { model: "gpt-4o", settings });
  expect(invoke).toHaveBeenCalledWith(expect.arrayContaining([{ role: "assistant", content: "reply" }]), { signal });
});

test("single-agent endpoint records a real run and normalized output without a workflow", async () => {
  const store = new RunStore();
  const executor = new RunExecutor(store, { async *execute(input) { yield complete(input); } });
  const { app } = createRunsRouter(
    executor,
    undefined,
    undefined,
    async () => ({ userId: "test-user", tenantId: "test-tenant" }),
  );
  const agent = createAgentRecord();
  const response = await app.request("http://localhost/agent-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent, input: { question: "hi" } }) });
  expect(response.status).toBe(202);
  const { runId } = await response.json() as { runId: string };
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(store.get(runId)?.run).toMatchObject({ status: "completed", output: { content: "answer" } });
  expect(store.events(runId).map((event) => event.type)).toEqual(["run.created", "run.started", "agent.completed", "run.completed"]);
  for (const invalid of [{ ...agent, enabled: false }, { ...agent, metadata: { apiKey: "private-value" } }]) {
    const rejected = await app.request("http://localhost/agent-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent: invalid, input: {} }) });
    expect(rejected.status).toBe(400);
  }
  expect(store.list(agent.id)).toHaveLength(1);
  const replay = await app.request(`http://localhost/${runId}/events`);
  expect(await replay.text()).toContain("run.completed");
  expect(store.get(runId)?.listeners.size).toBe(0);
});
