/** Long-term memory is scoped backend data, separate from execution history. */
export type MemoryKind = "semantic" | "episodic" | "procedural";
export interface MemoryNamespace {
    scope: "agent" | "workflow" | "project" | "organization" | "user";
    id: string;
}
export type MemoryVisibility = "private" | "workflow" | "project" | "organization" | "shared";
export interface MemorySource {
    type: "user" | "agent" | "tool" | "workflow" | "system" | "human_feedback";
    runId?: string;
    nodeId?: string;
    agentId?: string;
    workflowId?: string;
    toolId?: string;
}
export interface MemoryEmbeddingMetadata {
    provider: string;
    model: string;
    dimensions: number;
    version: string;
}
export interface Memory {
    id: string;
    tenantId: string;
    namespace: MemoryNamespace;
    kind: MemoryKind;
    visibility: MemoryVisibility;
    content: string;
    subject?: string;
    structuredData?: Record<string, unknown>;
    situation?: string;
    action?: string;
    result?: string;
    lesson?: string;
    success?: boolean;
    title?: string;
    procedure?: string;
    trigger?: string;
    importance: number;
    confidence?: number;
    source: MemorySource;
    status: "active" | "superseded" | "archived";
    supersedesMemoryId?: string;
    supersededByMemoryId?: string;
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
    embedding?: number[];
    embeddingMetadata?: MemoryEmbeddingMetadata;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
    contentHash: string;
    version: number;
    lastAccessedAt?: string;
    accessCount?: number;
    reinforcementCount?: number;
}
export interface LongTermMemoryConfig {
    enabled: boolean;
    readableNamespaces?: MemoryNamespace[];
    writableNamespace?: MemoryNamespace;
    kinds?: MemoryKind[];
    retrieval?: {
        maxMemories?: number;
        maxTokens?: number;
        minScore?: number;
    };
    writeMode?: "hot_path" | "background";
    required?: boolean;
}
export interface RememberMemoryInput {
    namespace: MemoryNamespace;
    kind: MemoryKind;
    content: string;
    visibility?: MemoryVisibility;
    importance?: number;
    confidence?: number;
    source: MemorySource;
    subject?: string;
    structuredData?: Record<string, unknown>;
    situation?: string;
    action?: string;
    result?: string;
    lesson?: string;
    success?: boolean;
    title?: string;
    procedure?: string;
    trigger?: string;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
    supersedesMemoryId?: string;
}
export interface MemoryRetrievalQuery {
    text: string;
    namespaces: MemoryNamespace[];
    kinds?: MemoryKind[];
    limit?: number;
    minScore?: number;
    maxTokens?: number;
    filters?: Record<string, unknown>;
}
export interface MemorySearchResult {
    memory: Memory;
    score: number;
    tokenCount: number;
    scores: {
        semantic: number;
        lexical: number;
        recency: number;
        importance: number;
        context: number;
    };
}
export interface MemoryRetrievalDiagnostics {
    latencyMs: number;
    embeddingLatencyMs: number;
    candidateCount: number;
    selectedCount: number;
    deduplicatedCount: number;
    warnings: string[];
    candidates: {
        memoryId: string;
        score: number;
        reason: string;
        scores: MemorySearchResult["scores"];
    }[];
}
export interface MemoryRetrievalResult {
    results: MemorySearchResult[];
    diagnostics: MemoryRetrievalDiagnostics;
}
export declare function isMemoryNamespace(value: unknown): value is MemoryNamespace;
