import { createAgentRecord, createEdge, createEmptyDefinition, createNode, nowIso, type AgentRecord, type WorkflowDefinition } from "@multi-agent/types";
import { RunExecutor } from "../apps/server/src/runtime/runExecutor";
import { RunStore } from "../apps/server/src/runtime/runStore";

async function waitFor(predicate: () => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function workflow(agentId: string): { workflow: WorkflowDefinition; agent: AgentRecord } {
  const agent = { ...createAgentRecord({ name: "scheduler-agent" }), id: agentId };
  const input = createNode("input", { x: 0, y: 0 });
  const agentNode = createNode("agent", { x: 1, y: 0 }, { agentId });
  const output = createNode("output", { x: 2, y: 0 });
  return {
    agent,
    workflow: { ...createEmptyDefinition("scheduler"), nodes: [input, agentNode, output], edges: [createEdge({ source: input.id, target: agentNode.id }), createEdge({ source: agentNode.id, target: output.id })] },
  };
}

test("RunExecutor drains queued runs through a bounded scheduler", async () => {
  const previous = process.env.WORKFLOW_MAX_CONCURRENT_RUNS;
  process.env.WORKFLOW_MAX_CONCURRENT_RUNS = "1";
  try {
    let active = 0;
    let peak = 0;
    const runtime = {
      async *execute(input: { agent: AgentRecord; runId: string; nodeId: string }) {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 35));
        yield { type: "agent.completed" as const, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { content: { ok: true } } };
        active -= 1;
      },
    };
    const store = new RunStore();
    const executor = new RunExecutor(store, runtime);
    const first = workflow("scheduler-agent-1");
    const second = workflow("scheduler-agent-2");
    const firstId = executor.start({ workflow: first.workflow, agents: [first.agent], input: {} });
    const secondId = executor.start({ workflow: second.workflow, agents: [second.agent], input: {} });
    await waitFor(() => store.get(firstId)?.run.status === "completed" && store.get(secondId)?.run.status === "completed");
    expect(peak).toBe(1);
  } finally {
    if (previous === undefined) delete process.env.WORKFLOW_MAX_CONCURRENT_RUNS;
    else process.env.WORKFLOW_MAX_CONCURRENT_RUNS = previous;
  }
});
