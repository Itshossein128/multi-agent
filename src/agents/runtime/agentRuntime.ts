import { AgentExecutorFactory } from "./agentExecutorFactory";
import type { AgentExecutionEvent, AgentExecutionInput } from "./types";
import type { RuntimeMemoryDependencies } from "../../memory/contracts";
import type { HistoryEntry } from "./shortTermMemory";
import { validateAgent, nowIso } from "@multi-agent/types";
import { RuntimeMemory } from "./runtimeMemory";
import { boundHistory, boundedInteger, boundText, historyKey } from "./shortTermMemory";
import { ExecutionTelemetry } from "../../observability/telemetry";
import { assertExecutionPolicy, ExecutionPolicyError } from "./executionPolicy";
import type { WorkerRuntime } from "./workerRuntime";
import { ContainerWorkerRuntime, LocalProcessWorkerRuntime, containerWorkerPolicyFromEnvironment } from "./workerRuntime";
import { cliRuntimePolicyFromEnvironment } from "./cliAgentExecutor";
import { boundJsonValue, boundedBytesFromEnvironment } from "../../runtime/boundedValue";
import { NO_WORKER_CREDENTIALS, type WorkerCredentialResolver } from "./workerCredentials";
import { DefaultContextAssembler, type ContextAssembler } from "./contextAssembler";

/** Shared executor boundary, with injected long-term services and caller-owned short-term state. */
export class AgentRuntime {
  private readonly executorFactory: Pick<AgentExecutorFactory, "create">;
  private readonly maxExecutionMs: number;
  constructor(
    executorFactory: Pick<AgentExecutorFactory, "create"> | undefined = undefined,
    private readonly memoryDependencies?: RuntimeMemoryDependencies,
    readonly telemetry: ExecutionTelemetry = ExecutionTelemetry.disabled(),
    maxExecutionMs = configuredAgentTimeout(),
    workerRuntime?: WorkerRuntime,
    private readonly maxOutputBytes = boundedBytesFromEnvironment(process.env.AGENT_MAX_OUTPUT_BYTES, 256 * 1024),
    credentialResolver: WorkerCredentialResolver = NO_WORKER_CREDENTIALS,
  ) {
    const cliPolicy = cliRuntimePolicyFromEnvironment();
    const defaultWorker = cliPolicy.workerMode === "container"
      ? new ContainerWorkerRuntime(cliPolicy, containerWorkerPolicyFromEnvironment())
      : new LocalProcessWorkerRuntime(cliPolicy);
    this.executorFactory = executorFactory ?? new AgentExecutorFactory(telemetry, workerRuntime ?? defaultWorker, cliPolicy, credentialResolver);
    this.maxExecutionMs = maxExecutionMs;
  }

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    const errors = validateAgent(input.agent);
    if (input.agent.enabled === false) errors.push("Agent is disabled. Enable it before execution.");
    if (errors.length) {
      yield { type: "agent.failed", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: errors.join(" ") } };
      throw new Error(errors.join(" "));
    }
    try {
      assertExecutionPolicy(input.agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "agent.failed", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: message } };
      throw error instanceof ExecutionPolicyError ? error : new ExecutionPolicyError(message);
    }
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(this.maxExecutionMs)]) : AbortSignal.timeout(this.maxExecutionMs);
    signal.throwIfAborted();
    input = { ...input, signal };
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
    const longTerm = new RuntimeMemory(input, this.memoryDependencies, this.telemetry);    // Caller context cannot smuggle memory into the executor when long-term access is disabled/denied.
    let memoryContext: string | undefined;
    let memoryEvents: unknown[] | undefined;
    if (longTerm.enabled) {
      const read = await longTerm.read();
      for (const event of read.events) yield event;
      longTerm.assertResult(read.events);
      memoryContext = read.context;
      memoryEvents = read.events;
    }

    // Assemble context through the central ContextAssembler
    const assembler = new DefaultContextAssembler({ memoryDependencies: this.memoryDependencies, now: () => Date.now() });
    const assembled = await assembler.assemble({
      runId: input.runId,
      workflowId: input.workflowId ?? "",
      nodeId: input.nodeId,
      agentId: input.agent.id,
      agent: input.agent,
      task: input.input,
      systemPrompt: input.agent.systemPrompt,
      history: history as HistoryEntry[],
      longTermMemoryContext: memoryContext,
      longTermMemoryEvents: memoryEvents,
      previousOutput: input.context?.previousOutput,
      branchState: typeof input.context?.branch === "string" ? input.context.branch : undefined,
      runtimeState: input.context?.memory && typeof input.context.memory === "object"
        ? input.context.memory as Record<string, unknown> : undefined,
      memoryAccess: input.memoryAccess,
      model: input.agent.backend.type === "api"
        ? { provider: input.agent.backend.provider, model: input.agent.backend.model }
        : undefined,
    });

    const executor = this.executorFactory.create(input.agent.backend);
    let output: unknown;
    let completion: AgentExecutionEvent | undefined;
    let failed = false;
    for await (const event of executor.execute({ ...input, context: { ...input.context, history, memoryContext }, assembledContext: assembled })) {
      input.signal?.throwIfAborted();
      if (event.type === "agent.completed") {
        const eventPayload = event.payload as { content?: unknown } | undefined;
        output = boundJsonValue(eventPayload?.content ?? event.payload, this.maxOutputBytes);
        completion = {
          ...event,
          payload: eventPayload && "content" in eventPayload ? { ...eventPayload, content: output } : output,
        };
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

function configuredAgentTimeout() {
  const value = Number(process.env.AGENT_MAX_DURATION_MS ?? 120_000);
  return Number.isInteger(value) && value >= 1_000 && value <= 60 * 60_000 ? value : 120_000;
}
