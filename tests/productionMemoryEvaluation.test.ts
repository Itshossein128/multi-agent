import { createAgentRecord } from "@multi-agent/types";
import { createMemoryComposition } from "../apps/server/src/memory/composition";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

test("default production memory composition records a real runtime evaluation", async () => {
  process.env.MEMORY_STORE = "in-memory";
  process.env.MEMORY_EVALUATION_ENABLED = "true";
  process.env.MEMORY_EVALUATION_SAMPLE_RATE = "1";
  const composition = createMemoryComposition();
  const namespace = { scope: "project" as const, id: "evaluation-project" };
  const access = { principalId: "owner", tenantId: "evaluation-tenant", agentId: "agent-evaluation", workflowId: "workflow-evaluation", readableNamespaces: [namespace], writableNamespaces: [namespace] };
  await composition.service!.remember({ namespace, kind: "semantic", content: "The project package manager is pnpm.", source: { type: "user" } }, access);
  await composition.service!.remember({ namespace, kind: "semantic", content: "The project package manager is npm.", metadata: { __reliability_verification_status: "stale" }, source: { type: "user" } }, access);
  await composition.service!.remember({ namespace, kind: "semantic", content: "The project package manager is yarn.", metadata: { __reliability_verification_status: "disputed" }, source: { type: "user" } }, access);
  const agent = { ...createAgentRecord(), id: "agent-evaluation", enabled: true, backend: { type: "api" as const, provider: "openai" as const, model: "test" }, memory: { enabled: true, type: "run" as const, scope: "agent" as const, mode: "read" as const, maxEntries: 5, shortTerm: { enabled: false }, longTerm: { enabled: true, readableNamespaces: [namespace], writableNamespace: namespace, retrieval: { maxTokens: 2048 } } } };
  const seen: any[] = [];
  const runtime = new AgentRuntime({ create: () => ({ async *execute(input: any) {
    seen.push(input);
    yield { type: "agent.completed", timestamp: new Date().toISOString(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: "ok" } };
  } }) }, composition.runtime);
  for await (const _event of runtime.execute({ agent, input: "Which package manager does the project use?", runId: "evaluation-run", nodeId: "node", workflowId: "workflow-evaluation", memoryAccess: access })) { /* production path */ }

  const traces = composition.evaluationSink!.getTraces();
  const invocation = composition.evaluationSink!.getInvocations().find(item => item.runId === "evaluation-run");
  expect(seen[0].context.memoryContext).toContain("The project package manager is pnpm.");
  expect(traces.some(trace => trace.runId === "evaluation-run" && trace.candidateCount >= 3 && trace.conflict?.groups === 1 && trace.conflict.suppressed === 2)).toBe(true);
  expect(invocation).toMatchObject({ runId: "evaluation-run", retrievedMemoryCount: 1, injectedMemoryCount: 1, memoryTokens: expect.any(Number), retrievalCalls: 1, conflictGroups: 1, conflictSuppressed: 2, securityViolations: 0 });
  expect(invocation!.memoryLatencyMs).toEqual(expect.any(Number));
  expect(composition.evaluationSink!.getPopulationMetrics().securityViolations).toBe(0);
  await composition.close();
});

test("evaluation sink failure cannot fail memory retrieval or the runtime", async () => {
  process.env.MEMORY_STORE = "in-memory";
  process.env.MEMORY_EVALUATION_ENABLED = "true";
  const composition = createMemoryComposition();
  const original = composition.evaluationSink!.getInvocations;
  composition.evaluationSink!.recordInvocation = () => { throw new Error("sink unavailable"); };
  const namespace = { scope: "project" as const, id: "evaluation-project" };
  const access = { principalId: "owner", tenantId: "evaluation-tenant", agentId: "agent-evaluation", workflowId: "workflow-evaluation", readableNamespaces: [namespace], writableNamespaces: [namespace] };
  await expect(composition.service!.recall({ text: "package manager", namespaces: [namespace] }, access)).resolves.toBeDefined();
  expect(original).toBeDefined();
  await composition.close();
});
