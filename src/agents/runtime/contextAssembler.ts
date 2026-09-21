import type { AgentRecord } from "@multi-agent/types";
import { serializeHandoffForContext, type AgentHandoff } from "./handoff";
import type { MemoryAccessContext } from "../../memory/contracts";
import { DefaultMemoryContextFormatter } from "../../memory/application/memoryContextFormatter";
import { type ShortTermHistories, type HistoryEntry, boundHistory, boundedInteger, boundText, historyKey } from "./shortTermMemory";
import type { RuntimeMemoryDependencies } from "../../memory/contracts";

// ─── Context Source Types ────────────────────────────────────────────────────

export type ContextSource =
  | "system"
  | "task"
  | "history"
  | "long_term_memory"
  | "handoff"
  | "runtime_state"
  | "previous_output"
  | "metadata";

// ─── Context Item ────────────────────────────────────────────────────────────

export interface ContextItem {
  /** Stable identifier for deduplication and diagnostics. */
  id: string;
  /** Where this context came from. */
  source: ContextSource;
  /** Higher priority = included first when budget is tight. */
  priority: number;
  /** The actual content to be serialized by the executor. */
  content: unknown;
  /** Estimated tokens consumed by this item. */
  estimatedTokens: number;
  /** If true, this item must never be pruned by the assembler. */
  required?: boolean;
  /** Provider-specific provenance metadata (not sent to model). */
  metadata?: Record<string, unknown>;
}

// Handoff context request fields
export interface ContextAssemblyRequest {
  runId: string;
  workflowId: string;
  nodeId: string;
  agentId: string;
  agent: AgentRecord;
  task: unknown;
  systemPrompt?: string;
  history?: HistoryEntry[];
  longTermMemoryContext?: string;
  longTermMemoryEvents?: unknown[];
  handoffs?: Record<string, AgentHandoff>;
  previousOutput?: unknown;
  branchState?: string;
  runtimeState?: Record<string, unknown>;
  memoryAccess?: MemoryAccessContext;
  model?: {
    provider?: string;
    model?: string;
    contextWindowTokens?: number;
  };
  metadata?: Record<string, unknown>;
}

// ─── Assembled Context ───────────────────────────────────────────────────────

export interface AssembledContext {
  /** Selected items in priority order, ready for executor serialization. */
  items: ContextItem[];
  /** Token budget accounting. */
  budget: {
    maxTokens: number;
    reservedOutputTokens: number;
    availableInputTokens: number;
    usedTokens: number;
    droppedTokens: number;
  };
  /** Items that were dropped due to budget constraints. */
  droppedItems: { id: string; source: ContextSource; reason: string }[];
  /** Assembly diagnostics. */
  diagnostics: {
    itemCount: number;
    droppedItemCount: number;
    sources: Record<ContextSource, { count: number; tokens: number }>;
  };
}

// ─── Token Estimator ─────────────────────────────────────────────────────────

export interface TokenEstimator {
  estimate(value: unknown): number;
}

/** UTF-8 byte count as a conservative token upper bound. Safe, deterministic, no dependencies. */
export class Utf8ByteEstimator implements TokenEstimator {
  estimate(value: unknown): number {
    if (value === undefined || value === null) return 0;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return Math.ceil(Buffer.byteLength(text, "utf8") * 0.25); // bytes → ~tokens heuristic
  }
}

// ─── Default Token Budget ────────────────────────────────────────────────────

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_RESERVED_OUTPUT = 8_000;

function resolveInputBudget(model?: { contextWindowTokens?: number }, reservedOutput?: number): number {
  const window = model?.contextWindowTokens && model.contextWindowTokens > 0
    ? model.contextWindowTokens
    : DEFAULT_CONTEXT_WINDOW;
  const output = reservedOutput ?? DEFAULT_RESERVED_OUTPUT;
  return Math.max(1024, window - output);
}

// ─── Priority Constants ──────────────────────────────────────────────────────

export const PRIORITY = {
  SYSTEM: 100,
  TASK: 90,
  HANDOFF: 70,
  RUNTIME_STATE: 60,
  LONG_TERM_MEMORY: 50,
  HISTORY: 40,
  PREVIOUS_OUTPUT: 30,
  METADATA: 10,
} as const;

// ─── ContextAssembler ────────────────────────────────────────────────────────

export interface ContextAssembler {
  assemble(request: ContextAssemblyRequest): Promise<AssembledContext>;
}

export interface DefaultContextAssemblerOptions {
  estimator?: TokenEstimator;
  defaultInputBudget?: number;
  memoryDependencies?: RuntimeMemoryDependencies;
  now?: () => number;
}

export class DefaultContextAssembler implements ContextAssembler {
  private readonly estimator: TokenEstimator;
  private readonly defaultInputBudget: number;
  private readonly memoryDeps?: RuntimeMemoryDependencies;

  constructor(private readonly options: DefaultContextAssemblerOptions = {}) {
    this.estimator = options.estimator ?? new Utf8ByteEstimator();
    this.defaultInputBudget = options.defaultInputBudget ?? resolveInputBudget();
    this.memoryDeps = options.memoryDependencies;
  }

  async assemble(request: ContextAssemblyRequest): Promise<AssembledContext> {
    const inputBudget = request.model?.contextWindowTokens
      ? resolveInputBudget(request.model)
      : this.defaultInputBudget;
    const reservedOutput = DEFAULT_RESERVED_OUTPUT;

    // 1. Acquire all context items
    const items: ContextItem[] = [];

    // System instructions — always required, highest priority
    const systemText = request.systemPrompt || "You are a helpful workflow agent.";
    items.push({
      id: `system:${request.agentId}`,
      source: "system",
      priority: PRIORITY.SYSTEM,
      content: { type: "system", text: systemText },
      estimatedTokens: this.estimator.estimate(systemText),
      required: true,
    });

    // Current task — always required
    const taskText = typeof request.task === "string"
      ? request.task
      : JSON.stringify(request.task ?? {});
    items.push({
      id: `task:${request.nodeId}`,
      source: "task",
      priority: PRIORITY.TASK,
      content: { type: "task", text: taskText },
      estimatedTokens: this.estimator.estimate(taskText),
      required: true,
    });

    // Structured handoffs from predecessor agents
    if (request.handoffs) {
      const handoffEntries = Object.entries(request.handoffs)
        .sort(([a], [b]) => a.localeCompare(b)); // deterministic ordering
      for (const [sourceNodeId, handoff] of handoffEntries) {
        const handoffText = serializeHandoffForContext(handoff);
        items.push({
          id: `handoff:${sourceNodeId}:${handoff.id}`,
          source: "handoff",
          priority: PRIORITY.HANDOFF,
          content: { type: "handoff", handoff, text: handoffText },
          estimatedTokens: this.estimator.estimate(handoffText),
          required: false,
          metadata: {
            handoffId: handoff.id,
            sourceNodeId,
            sourceAgentId: handoff.sourceAgentId,
            status: handoff.status,
            findingCount: handoff.findings.length,
            decisionCount: handoff.decisions.length,
          },
        });
      }
    }

    // Runtime state (memory, branch) — if present, as separate items
    if (request.runtimeState) {
      const stateText = JSON.stringify(request.runtimeState);
      if (stateText !== "{}") {
        items.push({
          id: `runtime:${request.nodeId}`,
          source: "runtime_state",
          priority: PRIORITY.RUNTIME_STATE,
          content: { type: "runtime_state", data: request.runtimeState },
          estimatedTokens: this.estimator.estimate(stateText),
          metadata: { keys: Object.keys(request.runtimeState) },
        });
      }
    }

    // Branch state — if present
    if (request.branchState) {
      items.push({
        id: `branch:${request.nodeId}:${request.branchState}`,
        source: "runtime_state",
        priority: PRIORITY.RUNTIME_STATE,
        content: { type: "branch_state", value: request.branchState },
        estimatedTokens: this.estimator.estimate(request.branchState),
      });
    }

    // Long-term memory — retrieve from memory service if available
    if (request.longTermMemoryContext) {
      items.push({
        id: `memory:${request.agentId}:${request.nodeId}`,
        source: "long_term_memory",
        priority: PRIORITY.LONG_TERM_MEMORY,
        content: { type: "long_term_memory", text: request.longTermMemoryContext },
        estimatedTokens: this.estimator.estimate(request.longTermMemoryContext),
        metadata: { events: request.longTermMemoryEvents },
      });
    }

    // Short-term history — bounded entries
    if (request.history && request.history.length > 0) {
      const historyText = request.history.map(h =>
        `USER: ${typeof h.input === "string" ? h.input : JSON.stringify(h.input)}\nASSISTANT: ${typeof h.output === "string" ? h.output : JSON.stringify(h.output)}`
      ).join("\n\n");
      items.push({
        id: `history:${request.agentId}:${request.runId}`,
        source: "history",
        priority: PRIORITY.HISTORY,
        content: { type: "history", entries: request.history },
        estimatedTokens: this.estimator.estimate(historyText),
        metadata: { entryCount: request.history.length },
      });
    }

    // Previous output — only if no handoffs exist (raw fallback)
    // When structured handoffs are available, raw output is not included as context
    // to prevent context bloat. Raw output remains in run events for observability.
    if (request.previousOutput !== undefined && !request.handoffs) {
      const prevText = typeof request.previousOutput === "string"
        ? request.previousOutput
        : JSON.stringify(request.previousOutput);
      items.push({
        id: `prev:${request.nodeId}`,
        source: "previous_output",
        priority: PRIORITY.PREVIOUS_OUTPUT,
        content: { type: "previous_output", text: prevText },
        estimatedTokens: this.estimator.estimate(prevText),
      });
    }

    // Metadata — lowest priority
    if (request.metadata && Object.keys(request.metadata).length > 0) {
      const metaText = JSON.stringify(request.metadata);
      items.push({
        id: `meta:${request.nodeId}`,
        source: "metadata",
        priority: PRIORITY.METADATA,
        content: { type: "metadata", data: request.metadata },
        estimatedTokens: this.estimator.estimate(metaText),
      });
    }

    // 2. Sort by priority (descending), then deterministic tie-break by ID
    items.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    // 3. Select items within budget
    const selected: ContextItem[] = [];
    const dropped: AssembledContext["droppedItems"] = [];
    const sourceStats: Record<string, { count: number; tokens: number }> = {};
    let usedTokens = 0;
    let droppedTokens = 0;

    for (const item of items) {
      if (item.required || usedTokens + item.estimatedTokens <= inputBudget) {
        selected.push(item);
        usedTokens += item.estimatedTokens;
        const src = sourceStats[item.source] ?? { count: 0, tokens: 0 };
        src.count++;
        src.tokens += item.estimatedTokens;
        sourceStats[item.source] = src;
      } else if (item.required) {
        // Required item exceeds budget — include it anyway (better than losing system/task)
        selected.push(item);
        usedTokens += item.estimatedTokens;
        const src = sourceStats[item.source] ?? { count: 0, tokens: 0 };
        src.count++;
        src.tokens += item.estimatedTokens;
        sourceStats[item.source] = src;
      } else {
        dropped.push({ id: item.id, source: item.source, reason: "budget_exceeded" });
        droppedTokens += item.estimatedTokens;
      }
    }

    // 4. Build diagnostics
    const sources: Record<ContextSource, { count: number; tokens: number }> = {
      system: sourceStats["system"] ?? { count: 0, tokens: 0 },
      task: sourceStats["task"] ?? { count: 0, tokens: 0 },
      history: sourceStats["history"] ?? { count: 0, tokens: 0 },
      long_term_memory: sourceStats["long_term_memory"] ?? { count: 0, tokens: 0 },
      handoff: sourceStats["handoff"] ?? { count: 0, tokens: 0 },
      runtime_state: sourceStats["runtime_state"] ?? { count: 0, tokens: 0 },
      previous_output: sourceStats["previous_output"] ?? { count: 0, tokens: 0 },
      metadata: sourceStats["metadata"] ?? { count: 0, tokens: 0 },
    };

    return {
      items: selected,
      budget: {
        maxTokens: inputBudget,
        reservedOutputTokens: reservedOutput,
        availableInputTokens: inputBudget,
        usedTokens,
        droppedTokens,
      },
      droppedItems: dropped,
      diagnostics: {
        itemCount: selected.length,
        droppedItemCount: dropped.length,
        sources: sources as Record<ContextSource, { count: number; tokens: number }>,
      },
    };
  }
}
