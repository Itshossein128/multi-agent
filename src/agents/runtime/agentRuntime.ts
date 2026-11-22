import { AgentExecutorFactory } from "./agentExecutorFactory";
import type { AgentExecutionEvent, AgentExecutionInput } from "./types";
import type { RuntimeMemoryDependencies } from "../../memory/contracts";
import type { HistoryEntry } from "./shortTermMemory";
import { validateAgent, nowIso } from "@multi-agent/types";
import { RuntimeMemory } from "./runtimeMemory";
import {
  boundHistory,
  boundedInteger,
  boundText,
  DEFAULT_SHORT_TERM_MEMORY_MAX_TOKENS,
  historyKey,
  MAX_SHORT_TERM_MEMORY_MAX_TOKENS,
  SHARED_SESSION_DEFAULT_SHORT_TERM_MEMORY_MAX_TOKENS,
} from "./shortTermMemory";
import { ExecutionTelemetry } from "../../observability/telemetry";
import { assertExecutionPolicy, ExecutionPolicyError, withResolvedWorkspaceRoot } from "./executionPolicy";
import type { WorkerRuntime } from "./workerRuntime";
import { ContainerWorkerRuntime, LocalProcessWorkerRuntime, containerWorkerPolicyFromEnvironment } from "./workerRuntime";
import { cliRuntimePolicyFromEnvironment } from "./cliAgentExecutor";
import { boundJsonValue, boundedBytesFromEnvironment } from "../../runtime/boundedValue";
import { NO_WORKER_CREDENTIALS, type WorkerCredentialResolver } from "./workerCredentials";
import { NO_API_CREDENTIALS, type ApiProviderCredentialResolver } from "../../security/providerCredentials";
import { DefaultContextAssembler, type ContextAssembler } from "./contextAssembler";
import { splitWorkingMemoryUpdates, visibleWorkingMemoryEntries, type WorkingMemoryEntries } from "./workingMemory";
import { emptyTokens } from "./runtimeMemory";
import { configuredAgentTimeout } from "./agentTimeout";
import { SandboxedWorkerRuntime } from "../../security/workerRuntimeBarrier";
import type { MemoryTokenAccounting } from "../../memory/application/memoryEvaluation";
import { sanitizeForTelemetry } from "./apiAgentExecutor";

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
    const innerWorker = cliPolicy.workerMode === "container"
      ? new ContainerWorkerRuntime(cliPolicy, containerWorkerPolicyFromEnvironment())
      : new LocalProcessWorkerRuntime(cliPolicy);
    const defaultWorker = new SandboxedWorkerRuntime(innerWorker);
    this.executorFactory = executorFactory ?? new AgentExecutorFactory(telemetry, workerRuntime ?? defaultWorker, cliPolicy, credentialResolver, apiCredentialResolver);
    this.maxExecutionMs = maxExecutionMs;
  }

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    const agent = withResolvedWorkspaceRoot(input.agent);
    input = { ...input, agent };
    const errors = validateAgent(agent);
    if (agent.enabled === false) errors.push("Agent is disabled. Enable it before execution.");
    if (errors.length) {
      yield { type: "agent.failed", timestamp: nowIso(), agentId: agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: errors.join(" ") } };
      throw new Error(errors.join(" "));
    }
    try {
      assertExecutionPolicy(agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "agent.failed", timestamp: nowIso(), agentId: agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: message } };
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
    const sessionContinuationEnabled = input.sessionMode === "node" || input.sessionMode === "shared";
    const shortEnabled =
      (memory?.enabled && memory.shortTerm?.enabled !== false) ||
      (sessionContinuationEnabled && input.agent.backend.type !== "cli");
    const key = historyKey(input);
    const store = input.memoryStore ?? new Map<string, { input: unknown; output: unknown }[]>();
    const maxEntries = boundedInteger(memory?.maxEntries, 20, 100);
    const priorHistoryMaxTokens =
      input.sessionMode === "shared" ? input.shortTermHistories?.[key]?.maxTokens : undefined;
    const defaultMaxTokens =
      input.sessionMode === "shared"
        ? SHARED_SESSION_DEFAULT_SHORT_TERM_MEMORY_MAX_TOKENS
        : DEFAULT_SHORT_TERM_MEMORY_MAX_TOKENS;
    const maxTokens = boundedInteger(
      input.shortTermMemoryMaxTokens ??
        (input.sessionMode === "shared"
          ? (priorHistoryMaxTokens ?? memory?.shortTerm?.maxTokens)
          : memory?.shortTerm?.maxTokens),
      defaultMaxTokens,
      MAX_SHORT_TERM_MEMORY_MAX_TOKENS,
    );
    const checkpointEntries = input.shortTermHistories?.[key]?.entries ?? [];
    const prior = input.shortTermHistories
      ? checkpointEntries
      : (store.get(key) ?? []).map((entry, i) => ({ ...(entry as { input: unknown; output: unknown; toolSummary?: string }), id: String(i) }));
    const history = shortEnabled && memory?.mode !== "write"
      ? boundHistory({ entries: prior, maxEntries, maxTokens }).entries.map(({ input, output, toolSummary }) => ({
          input,
          output,
          ...(toolSummary ? { toolSummary } : {}),
        }))
      : [];
    if (memory?.enabled && memory.shortTerm?.enabled !== false && memory?.mode !== "write") {
      yield { type: "memory.read", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { entries: history.length, scope: memory?.scope, tier: "short_term" } };
    }
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
      taskInstruction: input.taskInstruction,
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
    let durableMemoryOutput: unknown;
    let completion: AgentExecutionEvent | undefined;
    let observedToolSummary: string | undefined;
    const fallbackToolCalls = new Map<string, { iteration: number; name: string; args: unknown; status?: string; detail?: string }>();
    let failed = false;
    let executorUpdatedSession = false;
    const wrappedSessionUpdate = input.onSessionUpdate
      ? (session: import("@multi-agent/types").AgentSessionState) => {
          executorUpdatedSession = true;
          input.onSessionUpdate!(session);
        }
      : undefined;
    for await (const event of executor.execute({
      ...input,
      onSessionUpdate: wrappedSessionUpdate,
      context: { ...input.context, history, memoryContext },
      assembledContext: assembled,
    })) {
      input.signal?.throwIfAborted();
      if (event.type === "tool.started" && fallbackToolCalls.size < 25) {
        const p = event.payload as { toolCallId?: string; toolId?: string; name?: string; arguments?: unknown; iteration?: number } | undefined;
        const callId = p?.toolCallId ?? `call_${fallbackToolCalls.size}`;
        fallbackToolCalls.set(callId, {
          iteration: typeof p?.iteration === "number" ? p.iteration : fallbackToolCalls.size + 1,
          name: p?.name ?? p?.toolId ?? "tool",
          args: sanitizeForTelemetry(p?.arguments),
        });
      } else if (event.type === "tool.completed") {
        const p = event.payload as { toolCallId?: string; output?: unknown } | undefined;
        const existing = p?.toolCallId ? fallbackToolCalls.get(p.toolCallId) : undefined;
        if (existing) {
          existing.status = "ok";
          existing.detail = JSON.stringify(sanitizeForTelemetry(p?.output ?? {}));
        }
      } else if (event.type === "tool.failed") {
        const p = event.payload as { toolCallId?: string; name?: string; toolId?: string; error?: unknown; iteration?: number } | undefined;
        const callId = p?.toolCallId ?? `call_${fallbackToolCalls.size}`;
        const existing = fallbackToolCalls.get(callId);
        const sanitizedErr = sanitizeForTelemetry(p?.error ?? "failed");
        const errText = typeof sanitizedErr === "string" ? sanitizedErr : JSON.stringify(sanitizedErr);
        if (existing) {
          existing.status = "error";
          existing.detail = errText;
        } else if (fallbackToolCalls.size < 25) {
          fallbackToolCalls.set(callId, {
            iteration: typeof p?.iteration === "number" ? p.iteration : fallbackToolCalls.size + 1,
            name: p?.name ?? p?.toolId ?? "tool",
            args: undefined,
            status: "error",
            detail: errText,
          });
        }
      }
      if (event.type === "agent.completed") {
        const eventPayload = event.payload as { content?: unknown; toolSummary?: unknown } | undefined;
        if (typeof eventPayload?.toolSummary === "string" && eventPayload.toolSummary.trim()) {
          const sanitizedSummary = sanitizeForTelemetry(eventPayload.toolSummary.trim());
          observedToolSummary = typeof sanitizedSummary === "string" ? sanitizedSummary : String(sanitizedSummary);
        } else if (fallbackToolCalls.size > 0) {
          observedToolSummary = [...fallbackToolCalls.values()]
            .map((c) => {
              const sanitizedArgs = sanitizeForTelemetry(c.args ?? {});
              const sanitizedDetail = c.detail !== undefined ? sanitizeForTelemetry(c.detail) : "";
              const argsText = JSON.stringify(sanitizedArgs ?? {}).slice(0, 180);
              const detailStr = typeof sanitizedDetail === "string" ? sanitizedDetail : JSON.stringify(sanitizedDetail ?? "");
              const detailText = detailStr.slice(0, 240);
              return `[${c.iteration}] ${c.name}(${argsText}) -> ${c.status ?? "done"}${detailText ? `: ${detailText}` : ""}`;
            })
            .join("\n");
        }
        // Working memory is a runtime-consumed channel. It is removed exactly once,
        // at the executor boundary, so it can never reach conversation history,
        // long-term extraction, handoff or node values. The untrusted candidates
        // are delivered separately to the owner that validates them.
        const { remainder, updates, memoryCandidates } = splitWorkingMemoryUpdates(eventPayload?.content ?? event.payload);
        if (updates.length) input.onWorkingMemoryUpdate?.(updates);
        durableMemoryOutput = memoryCandidates ? boundJsonValue({ memoryCandidates }, this.maxOutputBytes) : undefined;
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
      const events = await longTerm.afterSuccess(durableMemoryOutput ?? output);
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
    if (sessionContinuationEnabled && input.onSessionUpdate && !executorUpdatedSession) {
      const now = nowIso();
      const effectiveSessionKey = input.sessionMode === "shared"
        ? (input.sessionKey?.trim() || input.nodeId)
        : input.nodeId;
      const providerLabel = "provider" in input.agent.backend && input.agent.backend.provider
        ? input.agent.backend.provider
        : input.agent.backend.type;
      input.onSessionUpdate({
        sessionId: input.resumeSession?.sessionId ?? `${providerLabel}-session-${input.runId}-${effectiveSessionKey}`,
        sessionKey: effectiveSessionKey,
        provider: providerLabel,
        agentId: input.agent.id,
        nodeId: input.nodeId,
        turnCount: (input.resumeSession?.turnCount ?? 0) + 1,
        createdAt: input.resumeSession?.createdAt ?? now,
        updatedAt: now,
      });
    }
    if (shortEnabled && memory?.mode !== "read") {
      const toolSummaryBudget = Math.min(8192, Math.floor(maxTokens / 6));
      const clippedToolSummary = observedToolSummary && toolSummaryBudget > 0
        ? boundText(observedToolSummary, toolSummaryBudget)
        : undefined;
      if (input.shortTermHistories) {
        const prefix = `${input.nodeId}:`;
        const index = checkpointEntries.filter(e => e.id.startsWith(prefix)).reduce((n, e) => Math.max(n, Number(e.id.slice(prefix.length)) || 0), 0) + 1;
        const clip = (value: unknown) => {
          const serialized = JSON.stringify(value ?? null);
          return Buffer.byteLength(serialized) <= maxTokens / 4 ? value : boundText(serialized, Math.floor(maxTokens / 4));
        };
        input.onShortTermUpdate?.({
          [key]: {
            entries: [{
              id: `${prefix}${index}`,
              input: clip(input.input),
              output: clip(output),
              ...(clippedToolSummary ? { toolSummary: clippedToolSummary } : {}),
            }],
            maxEntries,
            maxTokens,
          },
        });
      } else {
        // Preserve the public Phase 5 Map contract for standalone callers.
        const storeEntry: { input: unknown; output: unknown; toolSummary?: string } = {
          input: input.input,
          output,
          ...(clippedToolSummary ? { toolSummary: clippedToolSummary } : {}),
        };
        store.set(key, maxEntries ? [...(store.get(key) ?? []), storeEntry].slice(-maxEntries) : []);
      }
      if (memory?.enabled && memory.shortTerm?.enabled !== false) {
        yield { type: "memory.write", timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { entries: Math.min(prior.length + 1, maxEntries), scope: memory?.scope, tier: "short_term" } };
      }
    }
  }
}
