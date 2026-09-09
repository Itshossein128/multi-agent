import { AgentExecutorFactory, agentExecutorFactory } from "./agentExecutorFactory";
import type { AgentExecutionEvent, AgentExecutionInput } from "./types";
import type { RuntimeMemoryDependencies } from "../../memory/contracts";
import { validateAgent, nowIso } from "@multi-agent/types";
import { RuntimeMemory } from "./runtimeMemory";
import { boundHistory, boundedInteger, boundText, historyKey } from "./shortTermMemory";

/** Shared executor boundary, with injected long-term services and caller-owned short-term state. */
export class AgentRuntime {
  constructor(private readonly executorFactory: AgentExecutorFactory = agentExecutorFactory, private readonly memoryDependencies?: RuntimeMemoryDependencies) {}

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    const errors = validateAgent(input.agent);
    if (input.agent.enabled === false) errors.push("Agent is disabled. Enable it before execution.");
    if (errors.length) {
      yield { type: "agent.failed", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: errors.join(" ") } };
      throw new Error(errors.join(" "));
    }
    input.signal?.throwIfAborted();
    const memory = input.agent.memory;
    const shortEnabled = memory?.enabled && memory.shortTerm?.enabled !== false;
    const key = historyKey(input);
    const store = input.memoryStore ?? new Map<string, { input: unknown; output: unknown }[]>();
    const maxEntries = boundedInteger(memory?.maxEntries, 20, 100);
    const maxTokens = boundedInteger(memory?.shortTerm?.maxTokens, 4096, 16384);
    const checkpointEntries = input.shortTermHistories?.[key]?.entries ?? [];
    const prior = input.shortTermHistories ? checkpointEntries : (store.get(key) ?? []).map((entry, i) => ({ ...entry, id: String(i) }));
    const history = shortEnabled && memory?.mode !== "write"
      ? boundHistory({ entries: prior, maxEntries, maxTokens }).entries.map(({ input, output }) => ({ input, output })) : [];
    if (shortEnabled && memory?.mode !== "write") yield { type: "memory.read", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { entries: history.length, scope: memory?.scope, tier: "short_term" } };
    const longTerm = new RuntimeMemory(input, this.memoryDependencies);
    // Caller context cannot smuggle memory into the executor when long-term access is disabled/denied.
    let memoryContext: string | undefined;
    if (longTerm.enabled) {
      const read = await longTerm.read();
      for (const event of read.events) yield event;
      longTerm.assertResult(read.events);
      memoryContext = read.context;
    }
    const executor = this.executorFactory.create(input.agent.backend);
    let output: unknown;
    let completion: AgentExecutionEvent | undefined;
    let failed = false;
    for await (const event of executor.execute({ ...input, context: { ...input.context, history, memoryContext } })) {
      input.signal?.throwIfAborted();
      if (event.type === "agent.completed") {
        output = (event.payload as { content?: unknown })?.content ?? event.payload;
        completion = event;
        // Hold success until required memory writes have succeeded.
        continue;
      }
      if (event.type === "agent.failed") failed = true;
      yield event;
    }
    input.signal?.throwIfAborted();
    if (!completion || failed) return;
    if (longTerm.enabled) {
      const events = await longTerm.afterSuccess(output);
      for (const event of events) yield event;
      longTerm.assertResult(events);
    }
    yield completion;
    input.signal?.throwIfAborted();
    if (shortEnabled && memory?.mode !== "read") {
      if (input.shortTermHistories) {
        const prefix = `${input.nodeId}:`;
        const index = checkpointEntries.filter(e => e.id.startsWith(prefix)).reduce((n, e) => Math.max(n, Number(e.id.slice(prefix.length)) || 0), 0) + 1;
        const clip = (value: unknown) => {
          const serialized = JSON.stringify(value ?? null);
          return Buffer.byteLength(serialized) <= maxTokens / 4 ? value : boundText(serialized, Math.floor(maxTokens / 4));
        };
        input.onShortTermUpdate?.({ [key]: { entries: [{ id: `${prefix}${index}`, input: clip(input.input), output: clip(output) }], maxEntries, maxTokens } });
      } else {
        // Preserve the public Phase 5 Map contract for standalone callers.
        store.set(key, maxEntries ? [...(store.get(key) ?? []), { input: input.input, output }].slice(-maxEntries) : []);
      }
      yield { type: "memory.write", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { entries: Math.min(prior.length + 1, maxEntries), scope: memory?.scope, tier: "short_term" } };
    }
  }
}
