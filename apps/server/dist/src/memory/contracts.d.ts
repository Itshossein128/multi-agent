import type { Memory, MemoryNamespace, MemoryKind, MemoryEmbeddingMetadata, RememberMemoryInput, MemoryRetrievalQuery, MemoryRetrievalResult } from "@multi-agent/types";
export type { Memory, MemoryNamespace, MemoryKind, MemoryEmbeddingMetadata, RememberMemoryInput, MemoryRetrievalQuery, MemoryRetrievalResult } from "@multi-agent/types";
/** Constructed by trusted server authentication/policy, never deserialized from request data. */
export interface MemoryAccessContext {
    principalId: string;
    tenantId: string;
    agentId?: string;
    workflowId?: string;
    readableNamespaces: MemoryNamespace[];
    writableNamespaces: MemoryNamespace[];
}
export interface MemoryStoreQuery {
    tenantId: string;
    namespaces: MemoryNamespace[];
    kinds?: MemoryKind[];
    filters?: Record<string, unknown>;
    status?: Memory["status"];
    includeExpired?: boolean;
    text?: string;
    embedding?: number[];
    embeddingMetadata?: MemoryEmbeddingMetadata;
    contentHash?: string;
    idempotencyKey?: string;
    subject?: string;
    limit: number;
    offset?: number;
}
export interface MemoryStore {
    /** Serializes writes under a tenant+namespace key; all callback operations commit or roll back together. */
    transaction<T>(key: string, operation: (store: MemoryStore) => Promise<T>): Promise<T>;
    insert(memory: Memory): Promise<void>;
    update(memory: Memory, expectedVersion: number): Promise<void>;
    delete(tenantId: string, id: string): Promise<void>;
    get(tenantId: string, id: string): Promise<Memory | null>;
    search(query: MemoryStoreQuery): Promise<Memory[]>;
}
export interface EmbeddingProvider {
    readonly metadata: MemoryEmbeddingMetadata;
    embed(text: string): Promise<number[]>;
    embedBatch?(texts: string[]): Promise<number[][]>;
}
export interface MemoryWriteResult {
    memory: Memory;
    action: "inserted" | "updated" | "duplicate";
}
export type UpdateMemoryInput = Partial<Pick<Memory, "content" | "importance" | "confidence" | "structuredData" | "metadata" | "expiresAt" | "status" | "subject" | "procedure" | "trigger" | "title" | "situation" | "action" | "result" | "lesson" | "success">> & {
    expectedVersion?: number;
};
export interface MemoryListQuery {
    namespaces: MemoryNamespace[];
    kinds?: MemoryKind[];
    limit?: number;
    offset?: number;
    status?: Memory["status"];
    filters?: Record<string, unknown>;
}
export interface MemoryService {
    remember(input: RememberMemoryInput, access: MemoryAccessContext): Promise<MemoryWriteResult>;
    recall(query: MemoryRetrievalQuery, access: MemoryAccessContext): Promise<MemoryRetrievalResult>;
    get(id: string, access: MemoryAccessContext): Promise<Memory | null>;
    update(id: string, patch: UpdateMemoryInput, access: MemoryAccessContext): Promise<Memory>;
    forget(id: string, access: MemoryAccessContext): Promise<void>;
    list(query: MemoryListQuery, access: MemoryAccessContext): Promise<Memory[]>;
}
export interface MemoryRetriever {
    retrieve(query: MemoryRetrievalQuery, access: MemoryAccessContext): Promise<MemoryRetrievalResult>;
}
export interface MemoryCandidate extends RememberMemoryInput {
    explicit?: boolean;
}
export interface MemoryExtractionInput {
    input: unknown;
    output: unknown;
    agentId: string;
    runId: string;
    nodeId: string;
    workflowId?: string;
    namespace: MemoryNamespace;
}
export interface MemoryExtractor {
    extract(input: MemoryExtractionInput): Promise<MemoryCandidate[]>;
}
export interface MemoryWriteDecision {
    remember: boolean;
    importance?: number;
    reason: string;
}
export interface MemoryWritePolicy {
    shouldRemember(candidate: MemoryCandidate): Promise<MemoryWriteDecision>;
}
export interface MemoryContextFormatter {
    format(result: MemoryRetrievalResult, maxTokens: number): string;
}
export interface MemoryConsolidator {
    consolidate(access: MemoryAccessContext, namespace: MemoryNamespace): Promise<{
        merged: number;
    }>;
}
export interface MemoryBackgroundJobs {
    enqueue(task: () => Promise<void>): boolean;
    drain(): Promise<void>;
}
export interface RuntimeMemoryDependencies {
    service: MemoryService;
    extractor: MemoryExtractor;
    writePolicy: MemoryWritePolicy;
    formatter: MemoryContextFormatter;
    jobs: MemoryBackgroundJobs;
}
export declare class MemoryAccessDeniedError extends Error {
    constructor(message?: string);
}
export declare class MemoryValidationError extends Error {
    constructor(message: string);
}
export declare class MemoryConflictError extends Error {
    constructor(message?: string);
}
