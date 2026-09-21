import type { AgentRecord, WorkflowDefinition } from "@multi-agent/types";
import { LangGraphEventAdapter } from "../adapters/langGraphEventAdapter";
import type { RunStoreContract } from "./store/contracts";
import type { ApprovalManager, PausedContext } from "./approvalManager";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface CompiledResult {
  graph: any;
  agentByNode: Map<string, unknown>;
  issues: unknown[];
}

/**
 * Handles graph event streaming: reads LangGraph events, dispatches
 * approval interrupts, and finalizes run output or pause state.
 */
export class GraphRunner {
  constructor(
    private readonly store: RunStoreContract,
    private readonly pausedContext: Map<string, PausedContext>,
    private readonly checkpointers: Map<string, BaseCheckpointSaver>,
  ) {}

  /**
   * Stream a compiled graph to completion (or pause), processing events
   * and detecting approval interrupts along the way.
   */
  async runGraph(
    runId: string,
    compiled: CompiledResult,
    input: unknown,
    workflow: WorkflowDefinition,
    agents: AgentRecord[],
    approvalManager: ApprovalManager,
    memoryAccess?: import("../../../../src/memory/contracts").MemoryAccessContext,
    tools?: import("@multi-agent/types").ToolRecord[],
    stepBudget?: { count: number },
    signal?: AbortSignal,
    branchControllers?: Map<string, AbortController>,
    recursionLimit?: number,
  ) {
    const adapter = new LangGraphEventAdapter();
    const stream = await compiled.graph.streamEvents(input as never, { version: "v3", streamMode: ["tasks", "updates", "values", "messages"], signal, recursionLimit: recursionLimit ?? 100, configurable: { thread_id: runId } } as never);
    let output: Record<string, unknown> | undefined;
    for await (const raw of stream as AsyncIterable<unknown>) {
      const rawRecord = raw as { method?: string; params?: { data?: unknown; node?: string } };
      if (rawRecord.method === "updates" && rawRecord.params?.node === "__interrupt__") {
        const values = (rawRecord.params.data as { values?: { id: string; value: unknown }[] } | undefined)?.values ?? [];
        for (const item of values) approvalManager.handleApprovalRequested(runId, item);
        continue;
      }
      if (rawRecord.method === "values" && rawRecord.params?.data && typeof rawRecord.params.data === "object") {
        const values = rawRecord.params.data as { output?: Record<string, unknown> };
        if (values.output) output = values.output;
      }
      for (const event of adapter.adapt(raw, runId, workflow, agents)) {
        if (!event.type.startsWith("agent.")) this.store.append(runId, event);
      }
    }
    this.store.signal(runId)?.throwIfAborted();
    const state = await compiled.graph.getState({ configurable: { thread_id: runId } } as never);
    if ((state as { next: string[] }).next.length > 0) {
      const context = { workflow, agents, tools, memoryAccess, stepBudget };
      this.pausedContext.set(runId, context);
      this.store.setPausedContext?.(runId, context);
      return;
    }
    this.pausedContext.delete(runId);
    this.checkpointers.delete(runId);
    this.store.setPausedContext?.(runId, null);
    const { nowIso, uid } = await import("@multi-agent/types");
    this.store.update(runId, { status: "completed", completedAt: nowIso(), output });
    this.store.append(runId, { id: uid("event"), runId, type: "run.completed", timestamp: nowIso(), sequence: 0, payload: { output } });
  }
}
