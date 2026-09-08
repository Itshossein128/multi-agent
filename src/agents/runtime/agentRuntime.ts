import { AgentExecutorFactory, agentExecutorFactory } from "./agentExecutorFactory";
import type { AgentExecutionEvent, AgentExecutionInput } from "./types";
import { validateAgent, nowIso } from "@multi-agent/types";

/**
 * Thin runtime boundary: resolve an executor from the agent backend, then stream events.
 * Kept inside the existing server process — not a distributed service.
 */
export class AgentRuntime {
  constructor(private readonly executorFactory: AgentExecutorFactory = agentExecutorFactory) {}

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    const errors = validateAgent(input.agent);
    if (input.agent.enabled === false) errors.push("Agent is disabled. Enable it before execution.");
    if (errors.length) {
      yield { type: "agent.failed", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: errors.join(" ") } };
      throw new Error(errors.join(" "));
    }
    input.signal?.throwIfAborted();
    const memory = input.agent.memory;
    const key = JSON.stringify([input.runId, input.agent.id, memory?.scope === "node" ? input.nodeId : "agent"]);
    const store = input.memoryStore ?? new Map<string, { input: unknown; output: unknown }[]>();
    const history = memory?.enabled && memory.mode !== "write" ? (store.get(key) ?? []).slice(-memory.maxEntries) : [];
    if (memory?.enabled && memory.mode !== "write") yield { type: "memory.read", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { entries: history.length, scope: memory.scope } };
    const executor = this.executorFactory.create(input.agent.backend);
    let output: unknown;
    let completed = false;
    for await (const event of executor.execute({ ...input, context: { ...input.context, history } })) {
      input.signal?.throwIfAborted();
      if (event.type === "agent.completed") { output = (event.payload as { content?: unknown })?.content ?? event.payload; completed = true; }
      yield event;
    }
    if (completed && memory?.enabled && memory.mode !== "read") {
      store.set(key, [...(store.get(key) ?? []), { input: input.input, output }].slice(-memory.maxEntries));
      yield { type: "memory.write", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { entries: store.get(key)!.length, scope: memory.scope } };
    }
  }
}
