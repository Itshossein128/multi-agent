import type { MemoryAccessContext, MemoryConsolidator, MemoryNamespace } from "../contracts";
/** Explicit optional boundary. Semantic merging requires a separately selected policy. */
export declare class NoopMemoryConsolidator implements MemoryConsolidator {
    consolidate(access: MemoryAccessContext, namespace: MemoryNamespace): Promise<{
        merged: number;
    }>;
}
