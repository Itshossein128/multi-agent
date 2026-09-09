import type { EmbeddingProvider, MemoryEmbeddingMetadata } from "../contracts";
export declare function validVector(vector: number[], dimensions: number): boolean;
export declare function sameEmbedding(a: MemoryEmbeddingMetadata | undefined, b: MemoryEmbeddingMetadata): boolean;
/** A failed or slow embedding service never disables lexical memory. */
export declare function embedSafely(provider: EmbeddingProvider | undefined, text: string, timeoutMs: number): Promise<number[] | undefined>;
