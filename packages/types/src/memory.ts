/** Long-term memory is scoped backend data, separate from execution history. */
export type MemoryKind = "semantic" | "episodic" | "procedural";
export interface MemoryNamespace { scope: "agent" | "workflow" | "project" | "organization" | "user"; id: string }
export type MemoryVisibility = "private" | "workflow" | "project" | "organization" | "shared";
export interface MemorySource {
  type: "user" | "agent" | "tool" | "workflow" | "system" | "human_feedback";
  runId?: string; nodeId?: string; agentId?: string; workflowId?: string; toolId?: string;
}
export interface MemoryEmbeddingMetadata { provider: string; model: string; dimensions: number; version: string }
export interface Memory {
  id: string; tenantId: string; namespace: MemoryNamespace; kind: MemoryKind;
  visibility: MemoryVisibility; content: string; subject?: string;
  structuredData?: Record<string, unknown>;
  situation?: string; action?: string; result?: string; lesson?: string; success?: boolean;
  title?: string; procedure?: string; trigger?: string;
  importance: number; confidence?: number; source: MemorySource;
  status: "active" | "superseded" | "archived";
  supersedesMemoryId?: string; supersededByMemoryId?: string;
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
  supersedesMemoryId?: string;
}
export interface MemoryRetrievalQuery {
  text: string; namespaces: MemoryNamespace[]; kinds?: MemoryKind[];
  limit?: number; minScore?: number; maxTokens?: number; filters?: Record<string, unknown>;
}
export interface MemorySearchResult {
  memory: Memory; score: number; tokenCount: number;
  scores: { semantic: number; lexical: number; recency: number; importance: number; context: number };
  /** Reliability multiplier applied during ranking (Phase 7/8 diagnostics only). */
  reliabilityFactor?: number;
}
export type MemoryRetrievalMode = "hybrid" | "vector" | "lexical" | "fallback";
export interface MemoryRetrievalDiagnostics {
  latencyMs: number; embeddingLatencyMs: number; candidateCount: number; selectedCount: number;
  deduplicatedCount: number; warnings: string[];
  retrievalMode?: MemoryRetrievalMode;
  /** Candidate counts per memory kind. */
  kinds?: Partial<Record<MemoryKind, number>>;
  candidates: { memoryId: string; score: number; reason: string; kind?: MemoryKind;
    /** Reliability multiplier in [0,1] applied by the retriever (Phase 7), when known. */
    reliabilityFactor?: number; scores: MemorySearchResult["scores"] }[];
}
export interface MemoryRetrievalResult { results: MemorySearchResult[]; diagnostics: MemoryRetrievalDiagnostics }

export function isMemoryNamespace(value: unknown): value is MemoryNamespace {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ["agent", "workflow", "project", "organization", "user"].includes(String(item.scope))
    && typeof item.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(item.id)
    && Object.keys(item).every((key) => key === "scope" || key === "id");
}
