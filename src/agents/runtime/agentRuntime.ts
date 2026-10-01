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
import { NO_API_CREDENTIALS, type ApiProviderCredentialResolver } from "../../security/providerCredentials";
import { DefaultContextAssembler, type ContextAssembler } from "./contextAssembler";
import { splitWorkingMemoryUpdates, visibleWorkingMemoryEntries, type WorkingMemoryEntries } from "./workingMemory";
import { emptyTokens } from "./runtimeMemory";
import type { MemoryTokenAccounting } from "../../memory/application/memoryEvaluation";

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
    private readonly    maxOutputBytes = boundedBytesFromEnvironment(process.env.AGENT_MAX_OUTPUT_BYTES, 256 * 1024),
    credentialResolver: WorkerCredentialResolver = NO_WORKER_CREDENTIALS,
    apiCredentialResolver: ApiProviderCredentialResolver = NO_API_CREDENTIALS,
  ) {
    const cliPolicy = cliRuntimePolicyFromEnvironment();
    const defaultWorker = cliPolicy.workerMode === "container"
      ? new ContainerWorkerRuntime(cliPolicy, containerWorkerPolicyFromEnvironment())
      : new LocalProcessWorkerRuntime(cliPolicy);
    this.executorFactory = executorFactory ?? new AgentExecutorFactory(telemetry, workerRuntime ?? defaultWorker, cliPolicy, credentialResolver, apiCredentialResolver);
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
    // Agent-private working memory never crosses the runtime boundary: the
    // executing agent receives workflow-scoped entries plus its own private
    // entries only, so another agent's private knowledge cannot leak into a
    // prompt, an executor payload or the assembled context.
    input = {
      ...input,
      workingMemory: Object.fromEntries(
        visibleWorkingMemoryEntries(input.workingMemory, { agentId: input.agent.id, runId: input.runId }).map((entry) => [entry.id, entry]),
      ) as WorkingMemoryEntries,
    };
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
    let retrievedMemoryCount = 0;
    let selectedMemoryCount = 0;
    let injectedMemoryCount = 0;
    let injectedTokens = 0;
    let tokensByKind: MemoryTokenAccounting = emptyTokens();
    let injectedMemoryIds: string[] = [];
    let memoryLatencyMs = 0;
    let retrievalDiagnostics: import("@multi-agent/types").MemoryRetrievalDiagnostics | undefined;
    if (longTerm.enabled) {
      const memoryStart = Date.now();
      const read = await longTerm.read();
      memoryLatencyMs = Date.now() - memoryStart;
      retrievalDiagnostics = read.retrievalDiagnostics;
      for (const event of read.events) yield event;
      longTerm.assertResult(read.events);
      memoryContext = read.context;
      memoryEvents = read.events;
      // Phase 8: invocation-level memory counts from the completed memory.read event.
      for (const event of read.events) {
        if (event.type !== "memory.read") continue;
        const payload = event.payload as { retrievedCount?: number; selectedCount?: number; memoryIds?: string[] } | undefined;
        retrievedMemoryCount += payload?.retrievedCount ?? 0;
        selectedMemoryCount += payload?.selectedCount ?? 0;
        injectedMemoryIds = payload?.memoryIds ?? [];
        injectedMemoryCount = injectedMemoryIds.length;
      }
      injectedTokens = read.injectedTokens ?? 0;
      tokensByKind = read.tokensByKind ?? emptyTokens();
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
      longTermMemoryMeta: injectedMemoryIds.length ? { memoryIds: injectedMemoryIds, tokens: injectedTokens, tokensByKind } : undefined,
      handoffs: input.handoffs,
      workingMemory: input.workingMemory,
      previousOutput: input.context?.previousOutput,
      branchState: typeof input.context?.branch === "string" ? input.context.branch : undefined,
      runtimeState: {
        ...(input.context?.memory && typeof input.context.memory === "object" ? input.context.memory as Record<string, unknown> : {}),
        ...(input.runtimeState ?? {}),
      },
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
        // Working memory is a runtime-consumed channel. It is removed exactly once,
        // at the executor boundary, so it can never reach conversation history,
        // long-term extraction, handoff or node values. The untrusted candidates
        // are delivered separately to the owner that validates them.
        const { remainder, updates } = splitWorkingMemoryUpdates(eventPayload?.content ?? event.payload);
        if (updates.length) input.onWorkingMemoryUpdate?.(updates);
        output = boundJsonValue(remainder, this.maxOutputBytes);
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
    // Phase 8: record the invocation-level memory evaluation summary. Observational only.
    const evaluationRuntime = this.memoryDependencies?.evaluation;
    if (longTerm.enabled && evaluationRuntime) {
      evaluationRuntime.recorder.recordInvocation(
        { runId: input.runId, invocationId: `${input.runId}:${input.nodeId}`, agentId: input.agent.id, nodeId: input.nodeId },
        {
          retrievedMemoryCount,
          selectedMemoryCount,
          injectedMemoryCount,
          memoryTokens: injectedTokens,
          tokensByKind,
          contextTokensBySource: assembled.diagnostics.sources,
          contextDroppedTokens: assembled.budget.droppedTokens,
          retrievalCalls: retrievalDiagnostics ? 1 : 0,
          memoryLatencyMs,
          conflictGroups: retrievalDiagnostics?.conflict?.groups,
          conflictSuppressed: retrievalDiagnostics?.conflict?.suppressed,
          securityViolations: retrievalDiagnostics?.securityViolations,
          outcome: "success",
        },
      );
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
