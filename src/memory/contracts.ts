import type { Memory, MemoryNamespace, MemoryKind, MemoryEmbeddingMetadata, RememberMemoryInput, MemoryRetrievalQuery, MemoryRetrievalResult } from "@multi-agent/types";
export type { Memory, MemoryNamespace, MemoryKind, MemoryEmbeddingMetadata, RememberMemoryInput, MemoryRetrievalQuery, MemoryRetrievalResult } from "@multi-agent/types";

/** Phase 8 evaluation/telemetry types (observational; never memory content). */
export type {
  MemoryRetrievalTrace, MemorySelectionDiagnostic, MemoryInvocationEvaluation, MemoryTokenAccounting,
  MemoryContextBudgetMetrics, MemoryUsefulnessLabel, MemoryFeedbackInput, MemoryFeedbackRecord,
  MemoryFeedbackSummary, MemoryEffectivenessView, MemorySelectionStage, MemoryDropReason,
  MemoryPopulationMetrics, MemoryMetricName, MemoryInvocationOutcomeSignal,
  DeterministicRelevanceRule, MemoryInjectionRecord, MemoryDecisionExplanation,
  MemoryEvaluationSink, MemoryEvaluationRecorderContext,
} from "./application/memoryEvaluation";
export {
  InMemoryMemoryEvaluationSink, MemoryEvaluationRecorder, MemoryFeedbackLedger,
  evaluateMemoryRelevance, explainMemoryDecision, computePopulationMetrics,
  emptyPopulationMetrics, aggregateByKind, aggregateByAgent, MEMORY_METRIC_DEFINITIONS,
} from "./application/memoryEvaluation";

/** Constructed by trusted server authentication/policy, never deserialized from request data. */
export interface MemoryAccessContext {
  principalId: string; tenantId: string;
  agentId?: string; workflowId?: string;
  readableNamespaces: MemoryNamespace[]; writableNamespaces: MemoryNamespace[];
}
export interface MemoryStoreQuery {
  tenantId: string; namespaces: MemoryNamespace[]; kinds?: MemoryKind[];
  filters?: Record<string, unknown>; status?: Memory["status"]; includeExpired?: boolean;
  text?: string; embedding?: number[]; embeddingMetadata?: MemoryEmbeddingMetadata;
  contentHash?: string; idempotencyKey?: string; subject?: string;
  limit: number; offset?: number;
}
export interface MemoryStore {
  /** Serializes writes under a tenant+namespace key; all callback operations commit or roll back together. */
  transaction<T>(key: string, operation: (store: MemoryStore) => Promise<T>): Promise<T>;
  insert(memory: Memory): Promise<void>;
  update(memory: Memory, expectedVersion: number): Promise<void>;
  delete(tenantId: string, id: string): Promise<void>;
  get(tenantId: string, id: string): Promise<Memory | null>;
  search(query: MemoryStoreQuery): Promise<Memory[]>;
  /** Optional internal maintenance discovery; never exposed to untrusted callers. */
  listNamespaces?(limit?: number): Promise<Array<{ tenantId: string; namespace: MemoryNamespace }>>;
}
export interface EmbeddingProvider {
  readonly metadata: MemoryEmbeddingMetadata;
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: string[]): Promise<number[][]>;
}
export interface MemoryWriteResult { memory: Memory; action: "inserted" | "updated" | "duplicate" }
export type UpdateMemoryInput = Partial<Pick<Memory, "content" | "importance" | "confidence" | "structuredData" | "metadata" | "expiresAt" | "status" | "subject" | "procedure" | "trigger" | "title" | "situation" | "action" | "result" | "lesson" | "success">> & { expectedVersion?: number };
export interface MemoryListQuery { namespaces: MemoryNamespace[]; kinds?: MemoryKind[]; limit?: number; offset?: number; status?: Memory["status"]; filters?: Record<string, unknown> }
export interface MemoryService {
  remember(input: RememberMemoryInput, access: MemoryAccessContext): Promise<MemoryWriteResult>;
  recall(query: MemoryRetrievalQuery, access: MemoryAccessContext): Promise<MemoryRetrievalResult>;
  get(id: string, access: MemoryAccessContext): Promise<Memory | null>;
  update(id: string, patch: UpdateMemoryInput, access: MemoryAccessContext): Promise<Memory>;
  forget(id: string, access: MemoryAccessContext): Promise<void>;
  list(query: MemoryListQuery, access: MemoryAccessContext): Promise<Memory[]>;
}
export interface MemoryConsolidationScheduler {
  schedule(access: MemoryAccessContext, namespace: MemoryNamespace): boolean;
  recover(): Promise<number>;
}
export interface MemoryRetriever { retrieve(query: MemoryRetrievalQuery, access: MemoryAccessContext): Promise<MemoryRetrievalResult> }
export interface MemoryCandidate extends RememberMemoryInput { explicit?: boolean; id?: string }
export interface MemoryExtractionInput { input: unknown; output: unknown; agentId: string; runId: string; nodeId: string; workflowId?: string; namespace: MemoryNamespace }
export interface MemoryExtractor { extract(input: MemoryExtractionInput): Promise<MemoryCandidate[]> }
export interface MemoryWriteDecision { remember: boolean; importance?: number; reason: string }
export interface MemoryWritePolicy { shouldRemember(candidate: MemoryCandidate): Promise<MemoryWriteDecision> }
export interface MemoryContextFormatter { format(result: MemoryRetrievalResult, maxTokens: number): string }
export type ConsolidationDecisionType = "keep_both" | "ignore_new" | "merge" | "supersede";
export interface ConsolidationDecision {
  type: ConsolidationDecisionType;
  canonicalMemoryId?: string;
  relatedMemoryIds: string[];
  reason: string;
  confidence?: number;
  mergedMemory?: MemoryCandidate;
}
export interface ConsolidationConfig {
  exactDuplicateThreshold?: number;
  semanticCandidateThreshold?: number;
  autoMergeThreshold?: number;
  reviewThreshold?: number;
  candidateSearchLimit?: number;
  embeddingSearchLimit?: number;
}
export interface MemoryConsolidationJudge {
  decide(incoming: MemoryCandidate, existing: Memory[]): Promise<ConsolidationDecision>;
}
export interface ConsolidationDiagnostics {
  candidatesEvaluated: number;
  exactDuplicates: number;
  semanticCandidates: number;
  merged: number;
  superseded: number;
  ignored: number;
  keptSeparate: number;
  judgeFailures: number;
  latencyMs: number;
}
export interface ConsolidationResult {
  merged: number;
  diagnostics: ConsolidationDiagnostics;
}
export interface MemoryConsolidator {
  consolidate(access: MemoryAccessContext, namespace: MemoryNamespace): Promise<ConsolidationResult>;
}
export interface ConsolidationBackfillOptions {
  dryRun?: boolean;
  batchSize?: number;
  limit?: number;
}
export interface ConsolidationBackfillResult {
  processed: number;
  merged: number;
  superseded: number;
  ignored: number;
  keptBoth: number;
  errors: number;
  diagnostics: ConsolidationDiagnostics;
}
export interface MemoryBackgroundJobs { enqueue(task: () => Promise<void>): boolean; drain(): Promise<void> }
export interface RuntimeMemoryDependencies {
  service: MemoryService; extractor: MemoryExtractor; writePolicy: MemoryWritePolicy;
  formatter: MemoryContextFormatter; jobs: MemoryBackgroundJobs;
  /** Optional Phase 8 observational evaluation. Absent → zero runtime impact. */
  evaluation?: MemoryEvaluationRuntime;
}

/**
 * Evaluation hooks attached to runtime memory dependencies. Everything is
 * optional and observational: when unset, no telemetry is recorded and runtime
 * behavior is identical (Step 37/38).
 */
export interface MemoryEvaluationRuntime {
  recorder: import("./application/memoryEvaluation").MemoryEvaluationRecorder;
  /** Deterministic relevance rules for usefulness labels in eval scenarios. */
  relevanceRules?: import("./application/memoryEvaluation").DeterministicRelevanceRule;
}

export class MemoryAccessDeniedError extends Error { constructor(message = "Memory access denied.") { super(message); this.name = "MemoryAccessDeniedError"; } }
export class MemoryValidationError extends Error { constructor(message: string) { super(message); this.name = "MemoryValidationError"; } }
export class MemoryConflictError extends Error { constructor(message = "Memory changed; reload and retry.") { super(message); this.name = "MemoryConflictError"; } }
export class MemoryConsolidationError extends Error { constructor(message: string) { super(message); this.name = "MemoryConsolidationError"; } }
