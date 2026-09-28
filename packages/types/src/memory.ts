/** Long-term memory is scoped backend data, separate from execution history. */
export type MemoryKind = "semantic" | "episodic" | "procedural";
export interface MemoryNamespace { scope: "agent" | "workflow" | "project" | "organization" | "user"; id: string }
export type MemoryVisibility = "private" | "workflow" | "project" | "organization" | "shared";
export interface MemorySource {
  type: "user" | "agent" | "tool" | "workflow" | "system" | "human_feedback";
  runId?: string; nodeId?: string; agentId?: string; workflowId?: string; toolId?: string;
}
export interface MemoryEmbeddingMetadata { provider: string; model: string; dimensions: number; version: string }
export type MemoryTemporalScope = "current" | "historical" | "future" | "unknown";
export interface MemoryTemporalQuery {
  mode: "current" | "as_of" | "history" | "range";
  at?: string;
  from?: string;
  to?: string;
}
export interface MemoryTransition {
  oldValue: string;
  newValue: string;
  effectiveAt: string;
}
export interface Memory {
  id: string; tenantId: string; namespace: MemoryNamespace; kind: MemoryKind;
  visibility: MemoryVisibility; content: string; subject?: string;
  structuredData?: Record<string, unknown>;
  situation?: string; action?: string; result?: string; lesson?: string; success?: boolean;
  title?: string; procedure?: string; trigger?: string;
  importance: number; confidence?: number; source: MemorySource;
  status: "active" | "superseded" | "archived";
  supersedesMemoryId?: string; supersededByMemoryId?: string;
  /** Evolution keeps the replaced fact historically authoritative; supersession is reserved for correction/invalidation. */
  replacesMemoryId?: string; replacedByMemoryId?: string;
  /** Valid-time interval is [validFrom, validUntil); record time remains createdAt/updatedAt. */
  validFrom?: string; validUntil?: string; observedAt?: string;
  temporalScope?: MemoryTemporalScope;
  transition?: MemoryTransition;
  createdAt: string; updatedAt: string; expiresAt?: string;
  embedding?: number[]; embeddingMetadata?: MemoryEmbeddingMetadata;
  metadata?: Record<string, unknown>; idempotencyKey?: string; contentHash: string; version: number;
  lastAccessedAt?: string; accessCount?: number; reinforcementCount?: number;
}
export interface LongTermMemoryConfig {
  enabled: boolean;
  readableNamespaces?: MemoryNamespace[];
  writableNamespace?: MemoryNamespace;
  kinds?: MemoryKind[];
  retrieval?: { maxMemories?: number; maxTokens?: number; minScore?: number };
  writeMode?: "hot_path" | "background";
  required?: boolean;
}
export interface RememberMemoryInput {
  namespace: MemoryNamespace; kind: MemoryKind; content: string; visibility?: MemoryVisibility;
  importance?: number; confidence?: number; source: MemorySource; subject?: string;
  structuredData?: Record<string, unknown>; situation?: string; action?: string; result?: string;
  lesson?: string; success?: boolean; title?: string; procedure?: string; trigger?: string;
  expiresAt?: string; metadata?: Record<string, unknown>; idempotencyKey?: string;
  supersedesMemoryId?: string; replacesMemoryId?: string;
  validFrom?: string; validUntil?: string; observedAt?: string;
  temporalScope?: MemoryTemporalScope; transition?: MemoryTransition;
}
export interface MemoryRetrievalQuery {
  text: string; namespaces: MemoryNamespace[]; kinds?: MemoryKind[];
  limit?: number; minScore?: number; maxTokens?: number; filters?: Record<string, unknown>;
  /** Normally derived once from text by the retriever; callers may provide an already interpreted query. */
  temporal?: MemoryTemporalQuery;
}
export interface MemorySearchResult {
  memory: Memory; score: number; tokenCount: number;
  scores: { semantic: number; lexical: number; recency: number; importance: number; context: number; structured?: number };
  /** Reliability multiplier applied during ranking (Phase 7/8 diagnostics only). */
  reliabilityFactor?: number;
  /** Phase 7 vocabulary and matching signals contributing to retrieval. */
  matchReasons?: string[];
}
/** Phase 8: Fact identity representing a subject, property dimension, and value. */
export interface SemanticFactIdentity {
  subject: string;
  property: string;
  value: string;
  cardinality?: "single" | "multi";
  temporalScope?: MemoryTemporalScope;
  timeReference?: string;
  confidence?: number;
  source?: "explicit" | "structured_data" | "subject_inference" | "pattern_inference" | "legacy_rule";
}

/** Phase 9: Candidate origin channel */
export type CandidateSource =
  | "lexical"
  | "expanded_lexical"
  | "semantic"
  | "structured"
  | "alias"
  | "concept"
  | "multiple";

export interface CandidateSourceStats {
  lexicalCandidates: number;
  semanticCandidates: number;
  structuredCandidates: number;
  expandedTermCandidates: number;
  multiSignalCandidates: number;
}

export type QueryIntent =
  | "current_fact"
  | "historical_experience"
  | "procedure"
  | "architecture_fact"
  | "entity_lookup"
  | "general";

export type MemoryRetrievalMode = "hybrid" | "vector" | "lexical" | "fallback";
export interface MemoryRetrievalDiagnostics {
  latencyMs: number; embeddingLatencyMs: number; candidateCount: number; selectedCount: number;
  deduplicatedCount: number; warnings: string[];
  retrievalMode?: MemoryRetrievalMode;
  formattingLatencyMs?: number;
  securityViolations?: number;
  filteredCounts?: { unauthorized: number; expired: number; superseded: number; invalidated: number };
  conflict?: {
    groups: number; candidates: number; suppressed: number; staleSuppressed: number; disputedSuppressed: number; unresolved: number;
    suppressedByKind?: Partial<Record<MemoryKind, number>>;
    /** Phase 8: Fact-level conflict accounting */
    detected?: number;
    resolved?: number;
    falseSuppressed?: number;
  };
  /** Candidate counts per memory kind. */
  kinds?: Partial<Record<MemoryKind, number>>;
  /** Phase 9: Candidate source breakdown and precision accounting */
  candidateSources?: CandidateSourceStats;
  candidatePrecision?: number;
  candidateFalsePositiveRate?: number;
  queryIntent?: QueryIntent;
  temporalMode?: MemoryTemporalQuery["mode"];
  queryTime?: string;
  temporal?: { matched: number; dropped: number; overlapUnresolved: number; historicalMatches: number };
  /** Phase 10: Live embedding telemetry */
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  vectorSearchMs?: number;
  embeddingCacheHit?: boolean;
  embeddingErrorCode?: string;
  candidates: {
    memoryId: string; score: number; reason: string; kind?: MemoryKind; conflictGroupId?: string; suppressedByMemoryId?: string;
    dropReason?: "exact_duplicate" | "explicit_superseded" | "invalidated" | "budget_dropped" | "conflict_suppressed" | "candidate_pruned_low_confidence" | "budget_diversity_drop" | "cross_source_duplicate" | "not_yet_valid" | "no_longer_current" | "outside_as_of_time" | "unknown_validity_for_historical_query" | "outside_requested_range" | "temporal_overlap_unresolved";
    verificationStatus?: string; freshnessStatus?: string;
    /** Reliability multiplier in [0,1] applied by the retriever (Phase 7), when known. */
    reliabilityFactor?: number; scores: MemorySearchResult["scores"]; matchReasons?: string[];
    /** Phase 8: Semantic fact identity fields for explainability */
    factSubject?: string; factProperty?: string; factValue?: string;
    validFrom?: string; validUntil?: string; temporalMatch?: boolean; temporalDropReason?: string;
    /** Phase 9: Candidate provenance and multi-signal classification */
    candidateSource?: CandidateSource;
    sources?: string[];
  }[];
}
export interface MemoryRetrievalResult { results: MemorySearchResult[]; diagnostics: MemoryRetrievalDiagnostics }

export function isMemoryNamespace(value: unknown): value is MemoryNamespace {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ["agent", "workflow", "project", "organization", "user"].includes(String(item.scope))
    && typeof item.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(item.id)
    && Object.keys(item).every((key) => key === "scope" || key === "id");
}
