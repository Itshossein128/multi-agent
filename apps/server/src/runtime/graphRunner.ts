import type { EpisodeService, EpisodeExtractionInput } from "../../../../src/memory/application";
import { log } from "../logging";
import type { AgentRecord, WorkflowDefinition } from "@multi-agent/types";
import { createResultEnvelope, type NodeResultEnvelope } from "@multi-agent/types";
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
    private readonly episodeService?: EpisodeService,
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
    let nodeOutcomes: Record<string, NodeResultEnvelope> | undefined;
    let streamHandoffs: Record<string, unknown> | undefined;
    let streamWorkingMemory: Record<string, unknown> | undefined;
    let pendingHuman: PausedContext["pendingHuman"];
    for await (const raw of stream as AsyncIterable<unknown>) {
      const rawRecord = raw as { method?: string; params?: { data?: unknown; node?: string } };
      if (rawRecord.method === "updates" && rawRecord.params?.node === "__interrupt__") {
        const values = (rawRecord.params.data as { values?: { id: string; value: unknown }[] } | undefined)?.values ?? [];
        for (const item of values) {
          approvalManager.handleApprovalRequested(runId, item);
          const payload = item.value as { nodeId?: string; context?: { kind?: string; envelope?: NodeResultEnvelope } };
          if (payload.context?.kind === "agent_needs_human" && payload.nodeId && payload.context.envelope) {
            pendingHuman = { nodeId: payload.nodeId, envelope: payload.context.envelope };
          }
        }
        continue;
      }
      if (rawRecord.method === "values" && rawRecord.params?.data && typeof rawRecord.params.data === "object") {
        const values = rawRecord.params.data as { output?: Record<string, unknown>; nodeOutcomes?: Record<string, NodeResultEnvelope> };
        if (values.output) output = values.output;
        if (values.nodeOutcomes) nodeOutcomes = values.nodeOutcomes;
        for (const event of adapter.adapt(raw, runId, workflow, agents)) {
          if (event.type === "agent.completed" && event.payload) {
            const payload = event.payload as Record<string, unknown>;
            if (payload.handoffs && typeof payload.handoffs === "object") {
              if (!streamHandoffs) streamHandoffs = {};
              Object.assign(streamHandoffs, payload.handoffs);
            }
          }
        }
      }
      for (const event of adapter.adapt(raw, runId, workflow, agents)) {
        if (!event.type.startsWith("agent.")) this.store.append(runId, event);
      }
    }
    this.store.signal(runId)?.throwIfAborted();
    const state = await compiled.graph.getState({ configurable: { thread_id: runId } } as never);
    if ((state as { next: string[] }).next.length > 0) {
      const context = { workflow, agents, tools, memoryAccess, stepBudget, ...(pendingHuman ? { pendingHuman } : {}) };
      this.pausedContext.set(runId, context);
      this.store.setPausedContext?.(runId, context);
      return;
    }
    this.pausedContext.delete(runId);
    this.checkpointers.delete(runId);
    this.store.setPausedContext?.(runId, null);
    const { nowIso, uid } = await import("@multi-agent/types");
    // The output node's structured result is the run's deterministic result;
    // fall back to a synthesized success envelope carrying the raw output.
    const outputNodeId = workflow.nodes.find((node) => node.type === "output")?.id;
    const outputOutcome = outputNodeId ? nodeOutcomes?.[outputNodeId] : undefined;
    const result = outputOutcome?.status === "success"
      ? outputOutcome
      : createResultEnvelope("success", {
          value: output,
          ...(outputOutcome?.evidence ? { evidence: outputOutcome.evidence } : {}),
        });
    this.store.update(runId, { status: "completed", completedAt: nowIso(), output, result });
    this.store.append(runId, {
      id: uid("event"), runId, type: "run.completed", timestamp: nowIso(), sequence: 0,
      payload: { output, resultStatus: result.status },
    });

    // Episodic memory extraction on successful completion
    const entry = this.store.get(runId);
    const effectiveAccess = memoryAccess ?? (entry?.memoryOwner ? { principalId: entry.memoryOwner.principalId, tenantId: entry.memoryOwner.tenantId, readableNamespaces: [{ scope: "project", id: entry.memoryOwner.tenantId }], writableNamespaces: [{ scope: "project", id: entry.memoryOwner.tenantId }] } : undefined);
    if (this.episodeService && effectiveAccess && effectiveAccess.writableNamespaces.length > 0) {
      try {
        const stateValues = (state as any)?.values;
        let handoffs = stateValues?.handoffs ?? streamHandoffs;
        let workingMemory = stateValues?.workingMemory ?? streamWorkingMemory;

        if ((!handoffs || Object.keys(handoffs).length === 0) && output && typeof output === "object" && (output as any).handoffs) {
          handoffs = (output as any).handoffs;
        }

        const primaryAgentId = agents[0]?.id ?? "unknown";

        // Check handoffs
        let hasHandoffDecisionsOrWarnings = false;
        if (handoffs) {
          const hList = Object.values(handoffs) as Array<Record<string, unknown>>;
          hasHandoffDecisionsOrWarnings = hList.some(h => (Array.isArray(h.warnings) && h.warnings.length > 0) || (Array.isArray(h.decisions) && h.decisions.length > 0));
        }

        // If no handoff warnings/decisions, check node outcomes for agent completed payload handoffs
        if (!hasHandoffDecisionsOrWarnings && nodeOutcomes) {
          const synthesizedHandoffs: Record<string, unknown> = {};
          for (const [nodeId, outcome] of Object.entries(nodeOutcomes)) {
            const agentNode = workflow.nodes.find(n => n.id === nodeId && n.type === "agent");
            if (agentNode && outcome.status === "success" && outcome.value) {
              const val = outcome.value as Record<string, unknown>;
              synthesizedHandoffs[nodeId] = {
                id: `synthetic-handoff-${nodeId}`,
                version: 1,
                sourceNodeId: nodeId,
                sourceAgentId: (agentNode.config as any)?.agentId ?? primaryAgentId,
                status: "success",
                summary: typeof val.content === "string" ? val.content : JSON.stringify(val),
                findings: [],
                decisions: [{ decision: "Executed agent task" }],
                assumptions: [],
                remainingWork: [],
                warnings: [],
              };
            }
          }
          if (Object.keys(synthesizedHandoffs).length > 0) {
            handoffs = synthesizedHandoffs;
          }
        }
        const extractionInput: EpisodeExtractionInput = {
          runId,
          workflowId: workflow.id,
          nodeId: outputNodeId ?? "output",
          agentId: primaryAgentId,
          task: entry?.run.input ?? input,
          output,
          succeeded: true,
          handoffs,
          workingMemory,
          startedAt: entry?.run.startedAt,
          completedAt: entry?.run.completedAt,
          approvals: entry?.approvals?.map(a => ({ decision: a.status })),
          namespace: effectiveAccess.writableNamespaces[0],
        };

        const epResult = await this.episodeService.processRun(extractionInput, effectiveAccess);
        log.info("memory.episodic.extracted", { runId, created: epResult.created, reason: epResult.reason, memoryId: epResult.memoryId });
      } catch (err) {
        log.warn("memory.episodic.extraction_failed", { runId, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}
