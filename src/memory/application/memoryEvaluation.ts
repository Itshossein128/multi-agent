import type { Memory, MemoryKind, MemoryNamespace, MemoryRetrievalResult, MemorySearchResult } from "@multi-agent/types";
import { nowIso } from "@multi-agent/types";
import type { MemoryAccessContext } from "../contracts";
import { MemoryValidationError } from "../contracts";
import { extractReliability, type MemoryFreshnessPolicy } from "./memoryReliability";

// ─── Evaluation Labels ───────────────────────────────────────────────────────

/** Usefulness labels. Deliberately separate from truth/reliability semantics. */
export type MemoryUsefulnessLabel = "useful" | "neutral" | "irrelevant" | "harmful" | "unknown";

/**
 * Deterministic relevance evaluation for a selected memory.
 * Returns `unknown` when no ground truth exists — never inferred from model
 * confidence or retrieval score (Step 70: no evaluation hallucination).
 */
export interface DeterministicRelevanceRule {
  /** Memories whose id, subject or trigger contains one of these markers count as relevant. */
  relevantMarkers?: string[];
  /** Memories matching these markers are labelled harmful (stale/incorrect/injection-like). */
  harmfulMarkers?: string[];
}

export function evaluateMemoryRelevance(
  memory: Pick<Memory, "id" | "kind" | "subject" | "trigger" | "title">,
  rules: DeterministicRelevanceRule | undefined,
): MemoryUsefulnessLabel {
  if (!rules || (!rules.relevantMarkers?.length && !rules.harmfulMarkers?.length)) return "unknown";
  const haystack = [memory.id, memory.subject, memory.trigger, memory.title].filter(Boolean).join(" ").toLowerCase();
  if (rules.harmfulMarkers?.some(marker => haystack.includes(marker.toLowerCase()))) return "harmful";
  if (rules.relevantMarkers?.some(marker => haystack.includes(marker.toLowerCase()))) return "useful";
  return "irrelevant";
}

// ─── Stage Distinction: retrieved → selected → injected ──────────────────────

export type MemorySelectionStage = "retrieved" | "selected" | "injected" | "dropped";

/** Why a candidate memory did not reach the model context. */
export type MemoryDropReason =
  | "not_retrieved" | "low_score" | "budget" | "scope_denied" | "stale" | "invalidated"
  | "superseded" | "kind_disabled" | "duplicate" | "formatter_dropped";

// ─── Retrieval Trace ─────────────────────────────────────────────────────────

export interface MemoryRetrievalTrace {
  runId: string;
  /** Per-node invocation identifier within the run. */
  invocationId: string;
  agentId: string;
  nodeId: string;
  queryType: string;
  candidateCount: number;
  selectedCount: number;
  latencyMs: number;
  embeddingLatencyMs?: number;
  retrievalMode: "hybrid" | "vector" | "lexical" | "fallback";
  kinds: Partial<Record<MemoryKind, number>>;
  tenantId?: string;
  at: string;
}

// ─── Per-Memory Selection Diagnostic ─────────────────────────────────────────

/**
 * One entry per candidate memory. Uses only scoring signals the retriever
 * actually computes (semantic, lexical, recency, importance, context plus the
 * Phase 7 reliability factor). No fabricated metrics.
 */
export interface MemorySelectionDiagnostic {
  memoryId: string;
  kind: MemoryKind;
  semanticScore?: number;
  lexicalScore?: number;
  recencyScore?: number;
  importanceScore?: number;
  contextScore?: number;
  /** Reliability multiplier in [0,1] applied during ranking (Phase 7). */
  reliabilityScore?: number;
  finalScore: number;
  /** retrieved → selected → injected; dropped memories keep their dropReason. */
  stage: MemorySelectionStage;
  selected: boolean;
  dropReason?: MemoryDropReason;
  estimatedTokens?: number;
  verificationStatus?: string;
  freshnessStatus?: string;
}

// ─── Token Accounting by Kind ────────────────────────────────────────────────

export interface MemoryTokenAccounting {
  semantic: number;
  episodic: number;
  procedural: number;
}

export interface MemoryContextBudgetMetrics {
  tokensRetrieved: MemoryTokenAccounting;
  tokensSelected: MemoryTokenAccounting;
  tokensInjected: MemoryTokenAccounting;
  tokensDropped: MemoryTokenAccounting;
}

// ─── Invocation-Level Evaluation Summary ─────────────────────────────────────

export type MemoryInvocationOutcomeSignal =
  | "success" | "failure" | "blocked" | "retry" | "human_correction"
  | "test_pass" | "test_fail" | "tool_failure" | "handoff_failed" | "workflow_completed";

export interface MemoryInvocationEvaluation {
  runId: string;
  invocationId: string;
  agentId?: string;
  nodeId?: string;
  retrievedMemoryCount: number;
  selectedMemoryCount: number;
  injectedMemoryCount: number;
  memoryTokens: number;
  tokensByKind: MemoryTokenAccounting;
  /** Full per-source context distribution from the ContextAssembler (Step 64). */
  contextTokensBySource?: Record<string, { count: number; tokens: number }>;
  contextDroppedTokens?: number;
  relevantCount?: number;
  irrelevantCount?: number;
  harmfulCount?: number;
  unknownCount?: number;
  outcome?: string;
  at: string;
}

// ─── Feedback (usefulness ≠ truth) ───────────────────────────────────────────

export interface MemoryFeedbackInput {
  memoryId: string;
  label: MemoryUsefulnessLabel;
  /** Who provided the feedback (principal id). Recorded for provenance. */
  providedBy: string;
  runId?: string;
  invocationId?: string;
  reason?: string;
}

export interface MemoryFeedbackRecord extends Required<Omit<MemoryFeedbackInput, "reason" | "runId" | "invocationId">> {
  runId?: string;
  invocationId?: string;
  reason?: string;
  at: string;
}

export interface MemoryFeedbackSummary {
  memoryId: string;
  timesInjected: number;
  useful: number;
  neutral: number;
  irrelevant: number;
  harmful: number;
  lastFeedbackAt?: string;
  lastInjectedAt?: string;
}

/**
 * Feedback aggregation per memory. Usefulness feedback is presentation and
 * tuning evidence only — it never mutates confidence, verification status or
 * reinforcement counts (Step 10/54/55: feedback ≠ truth, ≠ reinforcement).
 */
export class MemoryFeedbackLedger {
  private readonly records = new Map<string, MemoryFeedbackRecord>();
  private readonly injections = new Map<string, number>();
  private readonly lastInjected = new Map<string, string>();

  record(feedback: MemoryFeedbackInput): MemoryFeedbackRecord {
    if (!feedback.memoryId?.trim()) throw new MemoryValidationError("Memory feedback requires a memory id");
    if (!["useful", "neutral", "irrelevant", "harmful", "unknown"].includes(feedback.label)) throw new MemoryValidationError("Invalid memory feedback label");
    if (!feedback.providedBy?.trim()) throw new MemoryValidationError("Memory feedback requires provenance");
    const record: MemoryFeedbackRecord = { ...feedback, memoryId: feedback.memoryId, label: feedback.label, providedBy: feedback.providedBy, at: nowIso() };
    this.records.set(`${feedback.memoryId}:${record.at}:${this.records.size}`, record);
    return record;
  }

  recordInjection(memoryId: string): void {
    this.injections.set(memoryId, (this.injections.get(memoryId) ?? 0) + 1);
    this.lastInjected.set(memoryId, nowIso());
  }

  summary(memoryId: string): MemoryFeedbackSummary {
    const counts = { useful: 0, neutral: 0, irrelevant: 0, harmful: 0 };
    let lastFeedbackAt: string | undefined;
    for (const record of this.records.values()) {
      if (record.memoryId !== memoryId) continue;
      if (record.label in counts) counts[record.label as keyof typeof counts] += 1;
      if (!lastFeedbackAt || record.at > lastFeedbackAt) lastFeedbackAt = record.at;
    }
    return { memoryId, timesInjected: this.injections.get(memoryId) ?? 0, ...counts, lastFeedbackAt, lastInjectedAt: this.lastInjected.get(memoryId) };
  }
}

// ─── Per-Memory Effectiveness View (Step 56) ─────────────────────────────────

export interface MemoryEffectivenessView {
  memoryId: string;
  kind: MemoryKind;
  retrievals: number;
  injections: number;
  usefulFeedback: number;
  irrelevantFeedback: number;
  harmfulFeedback: number;
  lastUsedAt?: string;
}

// ─── Metrics Registry ────────────────────────────────────────────────────────

/**
 * Metric definitions. Every rate has an explicit numerator/denominator — no
 * vague indicators. Population counters are zero-safe (0/0 → 0).
 */
export const MEMORY_METRIC_DEFINITIONS = {
  retrieval_hit_rate: "invocations with ≥1 memory retrieved / invocations with retrieval",
  empty_retrieval_rate: "invocations with 0 retrieved memories / invocations with retrieval",
  fallback_rate: "retrievals with retrievalMode=fallback / retrievals",
  stale_memory_rate: "injected memories with freshness stale|expired / injected memories",
  disputed_memory_rate: "injected memories with verificationStatus disputed / injected memories",
  duplicate_candidate_rate: "deduplicated candidates / candidates before deduplication",
  context_drop_rate: "memories selected by the retriever but not injected / selected memories",
  context_pollution_rate: "injected memories labelled irrelevant / injected memories with a known label",
  harmful_memory_rate: "injected memories labelled harmful / injected memories with a known label",
  memory_miss_rate: "expected relevant memories not retrieved / expected relevant memories (fixture ground truth only)",
  memory_over_retrieval_rate: "injected memories labelled irrelevant or unknown / injected memories",
  precision_at_k: "relevant retrieved in top k / k (fixture ground truth only)",
  recall_at_k: "expected relevant retrieved / total expected relevant (fixture ground truth only)",
  memory_token_share: "memory tokens / total assembled input tokens",
  invalidated_memory_injection_rate: "invalidated memories injected / injected memories — must always be 0",
} as const;

export type MemoryMetricName = keyof typeof MEMORY_METRIC_DEFINITIONS;

// ─── Aggregate Population Metrics ────────────────────────────────────────────

export interface MemoryPopulationMetrics {
  invocations: number;
  retrievals: number;
  retrievedCount: number;
  selectedCount: number;
  injectedCount: number;
  droppedAfterSelectionCount: number;
  emptyRetrievals: number;
  fallbackRetrievals: number;
  staleInjections: number;
  disputedInjections: number;
  invalidatedInjections: number;
  duplicateCandidates: number;
  knownLabelCount: number;
  irrelevantInjections: number;
  harmfulInjections: number;
  usefulInjections: number;
  memoryTokens: number;
  totalInputTokens: number;
}

export function emptyPopulationMetrics(): MemoryPopulationMetrics {
  return { invocations: 0, retrievals: 0, retrievedCount: 0, selectedCount: 0, injectedCount: 0, droppedAfterSelectionCount: 0, emptyRetrievals: 0, fallbackRetrievals: 0, staleInjections: 0, disputedInjections: 0, invalidatedInjections: 0, duplicateCandidates: 0, knownLabelCount: 0, irrelevantInjections: 0, harmfulInjections: 0, usefulInjections: 0, memoryTokens: 0, totalInputTokens: 0 };
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function computePopulationMetrics(metrics: MemoryPopulationMetrics): Record<string, number> {
  return {
    retrieval_hit_rate: rate(metrics.invocations - metrics.emptyRetrievals, metrics.invocations),
    empty_retrieval_rate: rate(metrics.emptyRetrievals, metrics.invocations),
    fallback_rate: rate(metrics.fallbackRetrievals, metrics.retrievals),
    stale_memory_rate: rate(metrics.staleInjections, metrics.injectedCount),
    disputed_memory_rate: rate(metrics.disputedInjections, metrics.injectedCount),
    invalidated_memory_injection_rate: rate(metrics.invalidatedInjections, metrics.injectedCount),
    duplicate_candidate_rate: rate(metrics.duplicateCandidates, metrics.retrievedCount + metrics.duplicateCandidates),
    context_drop_rate: rate(metrics.droppedAfterSelectionCount, metrics.selectedCount),
    context_pollution_rate: rate(metrics.irrelevantInjections, metrics.knownLabelCount),
    harmful_memory_rate: rate(metrics.harmfulInjections, metrics.knownLabelCount),
    memory_token_share: rate(metrics.memoryTokens, metrics.totalInputTokens),
    injected_count: metrics.injectedCount,
    retrieved_count: metrics.retrievedCount,
    selected_count: metrics.selectedCount,
    useful_injected_count: metrics.usefulInjections,
  };
}

// ─── In-Memory Evaluation Sink ───────────────────────────────────────────────

export interface MemoryEvaluationSink {
  recordRetrieval(trace: MemoryRetrievalTrace): void;
  recordSelections(invocationId: string, selections: MemorySelectionDiagnostic[]): void;
  recordInjection(invocationId: string, event: { runId: string; memoryIds: string[]; tokens: number; tokensByKind: MemoryTokenAccounting }): void;
  recordInvocation(evaluation: MemoryInvocationEvaluation): void;
  /** Optional read-back for merging selection stages; absent in minimal sinks. */
  getInvocation?(invocationId: string): { evaluation: MemoryInvocationEvaluation; selections: MemorySelectionDiagnostic[] } | undefined;
}

export interface MemoryEvaluationOptions {
  /** Keep 100% of events; evaluation-only runs should stay unsampled (Step 36). */
  sampleRate?: number;
  /** Bounded retention window in milliseconds (Step 35). */
  retentionMs?: number;
  now?: () => number;
}

interface StoredInvocation {
  evaluation: MemoryInvocationEvaluation;
  selections: MemorySelectionDiagnostic[];
}

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 5000;

/**
 * Observational in-memory sink. Records IDs, scores, counts, statuses and
 * latencies — never memory content (Step 34). Sampling keeps 100% of events
 * carrying labels/outcomes and samples ordinary traces at `sampleRate`.
 */
export class InMemoryMemoryEvaluationSink implements MemoryEvaluationSink {
  private readonly traces: MemoryRetrievalTrace[] = [];
  private readonly invocations = new Map<string, StoredInvocation>();
  /** Selections buffered before the invocation summary is recorded. */
  private readonly pendingSelections = new Map<string, MemorySelectionDiagnostic[]>();
  private readonly injections: { invocationId: string; runId: string; memoryIds: string[]; tokens: number; tokensByKind: MemoryTokenAccounting; at: string }[] = [];
  private readonly nowFn: () => number;
  private readonly retentionMs: number;
  private readonly sampleRate: number;

  constructor(options: MemoryEvaluationOptions = {}) {
    this.nowFn = options.now ?? Date.now;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.sampleRate = options.sampleRate === undefined ? 1 : Math.max(0, Math.min(1, options.sampleRate));
  }

  private sampled(): boolean {
    return this.sampleRate >= 1 || Math.random() < this.sampleRate;
  }

  private prune(): void {
    const cutoff = this.nowFn() - this.retentionMs;
    while (this.traces.length && Date.parse(this.traces[0].at) < cutoff) this.traces.shift();
    for (const [key, stored] of this.invocations) if (Date.parse(stored.evaluation.at) < cutoff) this.invocations.delete(key);
    while (this.injections.length && Date.parse(this.injections[0].at) < cutoff) this.injections.shift();
    while (this.traces.length > MAX_EVENTS) this.traces.shift();
    while (this.injections.length > MAX_EVENTS) this.injections.shift();
    while (this.invocations.size > MAX_EVENTS) {
      const oldest = [...this.invocations.entries()].sort((a, b) => a[1].evaluation.at.localeCompare(b[1].evaluation.at))[0];
      if (!oldest) break;
      this.invocations.delete(oldest[0]);
    }
  }

  recordRetrieval(trace: MemoryRetrievalTrace): void {
    this.prune();
    if (this.sampleRate < 1 && !this.sampled()) return;
    // The sink owns the event clock so retention pruning is testable and consistent.
    this.traces.push({ ...trace, at: new Date(this.nowFn()).toISOString() });
  }

  recordSelections(invocationId: string, selections: MemorySelectionDiagnostic[]): void {
    const stored = this.invocations.get(invocationId);
    if (stored) stored.selections = selections;
    else this.pendingSelections.set(invocationId, selections);
  }

  recordInjection(invocationId: string, event: { runId: string; memoryIds: string[]; tokens: number; tokensByKind: MemoryTokenAccounting }): void {
    this.prune();
    this.injections.push({ invocationId, ...event, at: new Date(this.nowFn()).toISOString() });
    const stored = this.invocations.get(invocationId);
    if (stored) stored.evaluation.injectedMemoryCount = event.memoryIds.length;
  }

  /** Upsert the per-invocation evaluation summary. */
  recordInvocation(evaluation: MemoryInvocationEvaluation): void {
    this.prune();
    const stamped = { ...evaluation, at: new Date(this.nowFn()).toISOString() };
    const existing = this.invocations.get(evaluation.invocationId);
    const pending = this.pendingSelections.get(evaluation.invocationId);
    if (existing) {
      existing.evaluation = stamped;
      if (pending) existing.selections = pending;
    } else {
      this.invocations.set(evaluation.invocationId, { evaluation: stamped, selections: pending ?? [] });
    }
    this.pendingSelections.delete(evaluation.invocationId);
  }

  /** Attach selection diagnostics for an invocation (created before the summary exists). */
  attachSelections(invocationId: string, selections: MemorySelectionDiagnostic[]): void {
    this.recordSelections(invocationId, selections);
  }

  /** Read pending selections that have not yet been attached to an invocation summary. */
  peekSelections(invocationId: string): MemorySelectionDiagnostic[] | undefined {
    const stored = this.invocations.get(invocationId);
    if (stored) return stored.selections;
    return this.pendingSelections.get(invocationId);
  }

  getTraces(): readonly MemoryRetrievalTrace[] { return [...this.traces]; }
  getInjections(): readonly { invocationId: string; runId: string; memoryIds: string[]; tokens: number; tokensByKind: MemoryTokenAccounting; at: string }[] { return [...this.injections]; }
  getInvocation(invocationId: string): { evaluation: MemoryInvocationEvaluation; selections: MemorySelectionDiagnostic[] } | undefined {
    const stored = this.invocations.get(invocationId);
    return stored ? { evaluation: { ...stored.evaluation }, selections: stored.selections.map(s => ({ ...s })) } : undefined;
  }
  getInvocations(): readonly MemoryInvocationEvaluation[] { return [...this.invocations.values()].map(s => ({ ...s.evaluation })); }
}

// ─── Evaluation Recorder (runtime-facing, observational) ─────────────────────

export interface MemoryEvaluationRecorderContext {
  runId: string;
  invocationId: string;
  agentId: string;
  nodeId: string;
  queryType?: string;
  relevanceRules?: DeterministicRelevanceRule;
  freshnessPolicy?: MemoryFreshnessPolicy;
}

export interface MemoryInjectionRecord {
  memory: Pick<Memory, "id" | "kind" | "subject" | "trigger" | "title" | "updatedAt">;
  tokenCount: number;
}

/**
 * Facade the runtime calls during retrieval/context assembly. Every method is
 * fail-soft: evaluation must never alter retrieval behavior or break execution
 * (Step 38: observe, not control).
 */
export class MemoryEvaluationRecorder {
  /** Usefulness labels computed at injection time, keyed by invocationId → memoryId. */
  private readonly labels = new Map<string, Map<string, MemoryUsefulnessLabel>>();

  constructor(private readonly sink?: MemoryEvaluationSink, private readonly ledger?: MemoryFeedbackLedger) {}

  recordRetrieval(context: MemoryEvaluationRecorderContext, result: MemoryRetrievalResult): void {
    if (!this.sink) return;
    try {
      const diagnostics = result.diagnostics;
      this.sink.recordRetrieval({
        runId: context.runId, invocationId: context.invocationId, agentId: context.agentId, nodeId: context.nodeId,
        queryType: context.queryType ?? "agent_task",
        candidateCount: diagnostics.candidateCount,
        selectedCount: diagnostics.selectedCount,
        latencyMs: diagnostics.latencyMs,
        embeddingLatencyMs: diagnostics.embeddingLatencyMs,
        retrievalMode: diagnostics.retrievalMode ?? "hybrid",
        kinds: { ...diagnostics.kinds },
        at: nowIso(),
      });
      const selections = diagnostics.candidates.map(candidate => {
        const selected = result.results.find(r => r.memory.id === candidate.memoryId);
        const scores = candidate.scores;
        // The retriever drops eligible candidates only via its token-budget/limit
        // selection, so an eligible candidate missing from results is a budget drop.
        const dropReason: MemoryDropReason | undefined = selected ? undefined
          : candidate.reason === "invalidated" ? "invalidated"
          : candidate.reason === "eligible" ? "budget"
          : "low_score";
        return {
          memoryId: candidate.memoryId,
          kind: candidate.kind ?? ("semantic" as MemoryKind),
          semanticScore: scores.semantic,
          lexicalScore: scores.lexical,
          recencyScore: scores.recency,
          importanceScore: scores.importance,
          contextScore: scores.context,
          reliabilityScore: candidate.reliabilityFactor,
          finalScore: candidate.score,
          stage: selected ? ("selected" as const) : ("dropped" as const),
          selected: Boolean(selected),
          dropReason,
          estimatedTokens: selected?.tokenCount,
        } satisfies MemorySelectionDiagnostic;
      });
      this.sink.recordSelections(context.invocationId, selections);
    } catch { /* Observational only; never propagate evaluation failures. */ }
  }

  recordInjection(context: Pick<MemoryEvaluationRecorderContext, "runId" | "invocationId" | "agentId" | "nodeId" | "relevanceRules">, injected: MemoryInjectionRecord[], freshnessPolicy?: MemoryFreshnessPolicy): { labels: MemoryUsefulnessLabel[]; tokensByKind: MemoryTokenAccounting } {
    const labels: MemoryUsefulnessLabel[] = [];
    const tokensByKind: MemoryTokenAccounting = { semantic: 0, episodic: 0, procedural: 0 };
    if (!this.sink || !injected.length) return { labels, tokensByKind };
    try {
      const labelMap = new Map<string, MemoryUsefulnessLabel>();
      for (const record of injected) {
        tokensByKind[record.memory.kind] = (tokensByKind[record.memory.kind] ?? 0) + record.tokenCount;
        const label = evaluateMemoryRelevance(record.memory, context.relevanceRules);
        labelMap.set(record.memory.id, label);
        labels.push(label);
        this.ledger?.recordInjection(record.memory.id);
      }
      this.labels.set(context.invocationId, labelMap);
      this.sink.recordInjection(context.invocationId, {
        runId: context.runId,
        memoryIds: injected.map(record => record.memory.id),
        tokens: injected.reduce((sum, record) => sum + record.tokenCount, 0),
        tokensByKind,
      });
      const selections: MemorySelectionDiagnostic[] = injected.map(record => {
        const reliability = extractReliability(record.memory as Memory);
        const freshness = freshnessPolicy?.evaluate(record.memory as Memory);
        return {
          memoryId: record.memory.id,
          kind: record.memory.kind,
          finalScore: 0,
          stage: "injected" as const,
          selected: true,
          estimatedTokens: record.tokenCount,
          verificationStatus: reliability.verificationStatus,
          freshnessStatus: freshness?.status,
        } satisfies MemorySelectionDiagnostic;
      });
      // Merge injected stages onto the retrieval-time selections. The sink keeps
      // pending selections for invocations whose summary was not yet recorded.
      const existing = this.sink.getInvocation?.(context.invocationId)?.selections
        ?? (this.sink as { peekSelections?(id: string): MemorySelectionDiagnostic[] | undefined }).peekSelections?.(context.invocationId)
        ?? [];
      const merged = [...existing.filter(s => s.stage !== "injected"), ...selections];
      this.sink.recordSelections(context.invocationId, merged);
    } catch { /* Observational only. */ }
    return { labels, tokensByKind };
  }

  recordInvocation(context: Pick<MemoryEvaluationRecorderContext, "runId" | "invocationId" | "agentId" | "nodeId">, summary: {
    retrievedMemoryCount: number; selectedMemoryCount: number; injectedMemoryCount: number; memoryTokens: number;
    tokensByKind: MemoryTokenAccounting; outcome?: string;
    contextTokensBySource?: Record<string, { count: number; tokens: number }>;
    contextDroppedTokens?: number;
  }): void {
    if (!this.sink) return;
    try {
      const counts = { useful: 0, irrelevant: 0, harmful: 0, unknown: 0 };
      for (const label of this.labels.get(context.invocationId)?.values() ?? []) {
        if (label === "useful") counts.useful += 1;
        else if (label === "irrelevant") counts.irrelevant += 1;
        else if (label === "harmful") counts.harmful += 1;
        else counts.unknown += 1;
      }
      this.labels.delete(context.invocationId);
      this.sink.recordInvocation({
        runId: context.runId, invocationId: context.invocationId, agentId: context.agentId, nodeId: context.nodeId,
        retrievedMemoryCount: summary.retrievedMemoryCount,
        selectedMemoryCount: summary.selectedMemoryCount,
        injectedMemoryCount: summary.injectedMemoryCount,
        memoryTokens: summary.memoryTokens,
        tokensByKind: summary.tokensByKind,
        contextTokensBySource: summary.contextTokensBySource,
        contextDroppedTokens: summary.contextDroppedTokens,
        relevantCount: counts.useful,
        irrelevantCount: counts.irrelevant,
        harmfulCount: counts.harmful,
        unknownCount: counts.unknown,
        outcome: summary.outcome,
        at: nowIso(),
      });
    } catch { /* Observational only. */ }
  }
}

// ─── Drop Explanation API (debug-level) ──────────────────────────────────────

export interface MemoryDecisionExplanation {
  memoryId: string;
  kind: MemoryKind;
  stage: MemorySelectionStage;
  scores: {
    semantic?: number; lexical?: number; recency?: number; importance?: number;
    context?: number; reliability?: number; final: number;
  };
  selected: boolean;
  dropReason?: MemoryDropReason;
  estimatedTokens?: number;
  verificationStatus?: string;
  freshnessStatus?: string;
  explanation: string;
}

function explainStage(selection: MemorySelectionDiagnostic): string {
  switch (selection.stage) {
    case "injected": return `Selected by the retriever and injected into model context (${selection.estimatedTokens ?? "?"} tokens).`;
    case "selected": return "Selected by the retriever but not confirmed injected into the final context.";
    case "dropped": return `Not retrieved into results (${selection.dropReason ?? "low_score"}).`;
    default: return "Retrieved as a candidate only.";
  }
}

/** Debug-level "why was memory X selected/dropped?" without exposing memory content. */
export function explainMemoryDecision(selections: MemorySelectionDiagnostic[], memoryId: string): MemoryDecisionExplanation | undefined {
  const selection = selections.find(s => s.memoryId === memoryId);
  if (!selection) return undefined;
  return {
    memoryId: selection.memoryId,
    kind: selection.kind,
    stage: selection.stage,
    scores: { semantic: selection.semanticScore, lexical: selection.lexicalScore, recency: selection.recencyScore, importance: selection.importanceScore, context: selection.contextScore, reliability: selection.reliabilityScore, final: selection.finalScore },
    selected: selection.selected,
    dropReason: selection.dropReason,
    estimatedTokens: selection.estimatedTokens,
    verificationStatus: selection.verificationStatus,
    freshnessStatus: selection.freshnessStatus,
    explanation: explainStage(selection),
  };
}

// ─── Aggregation Helpers (agent / workflow / kind ROI) ───────────────────────

export function aggregateByKind(invocations: readonly MemoryInvocationEvaluation[]): Record<MemoryKind, { retrieved: number; injected: number; tokens: number }> {
  const aggregate: Record<MemoryKind, { retrieved: number; injected: number; tokens: number }> = { semantic: { retrieved: 0, injected: 0, tokens: 0 }, episodic: { retrieved: 0, injected: 0, tokens: 0 }, procedural: { retrieved: 0, injected: 0, tokens: 0 } };
  for (const invocation of invocations) {
    for (const kind of ["semantic", "episodic", "procedural"] as MemoryKind[]) aggregate[kind].tokens += invocation.tokensByKind[kind] ?? 0;
  }
  return aggregate;
}

export function aggregateByAgent(invocations: readonly MemoryInvocationEvaluation[]): Record<string, { invocations: number; injected: number; memoryTokens: number }> {
  const aggregate: Record<string, { invocations: number; injected: number; memoryTokens: number }> = {};
  for (const invocation of invocations) {
    const key = invocation.agentId ?? "unknown";
    aggregate[key] ??= { invocations: 0, injected: 0, memoryTokens: 0 };
    aggregate[key].invocations += 1;
    aggregate[key].injected += invocation.injectedMemoryCount;
    aggregate[key].memoryTokens += invocation.memoryTokens;
  }
  return aggregate;
}
