import type { Memory, MemoryStoreQuery } from "../contracts";
import { MemoryConflictError } from "../contracts";
export declare class MemoryVersionConflictError extends MemoryConflictError {
    constructor();
}
export declare class MemoryDuplicateError extends MemoryConflictError {
    constructor();
}
export declare const MAX_MEMORY_CANDIDATES = 500;
export declare function bounds(query: Pick<MemoryStoreQuery, "limit" | "offset">): {
    limit: number;
    offset: number;
};
export declare function validateEmbedding(vector?: number[], metadata?: Memory["embeddingMetadata"]): void;
export declare function validateMemory(memory: Memory): void;
export declare function validateScope(tenantId: string, namespaces?: Memory["namespace"][]): void;
/** Matches JSONB containment for JSON objects/arrays and scalar values. */
export declare function contains(value: unknown, filter: unknown): boolean;
export declare function cosine(a: number[], b: number[]): number;
