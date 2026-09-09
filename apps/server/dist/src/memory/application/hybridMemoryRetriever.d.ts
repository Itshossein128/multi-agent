import type { EmbeddingProvider, MemoryAccessContext, MemoryRetrievalQuery, MemoryRetrievalResult, MemoryRetriever, MemoryStore } from "../contracts";
import type { MemorySearchResult } from "@multi-agent/types";
import { DefaultMemoryContextFormatter } from "./memoryContextFormatter";
type Scores = MemorySearchResult["scores"];
export interface HybridMemoryRetrieverOptions {
    embeddingProvider?: EmbeddingProvider;
    embeddingTimeoutMs?: number;
    candidateLimit?: number;
    weights?: Partial<Scores>;
    semanticRelevanceThreshold?: number;
    recencyHalfLifeDays?: number;
    formatter?: DefaultMemoryContextFormatter;
    now?: () => number;
}
export declare class HybridMemoryRetriever implements MemoryRetriever {
    private readonly store;
    private readonly options;
    private readonly formatter;
    private readonly weights;
    constructor(store: MemoryStore, options?: HybridMemoryRetrieverOptions);
    retrieve(query: MemoryRetrievalQuery, access: MemoryAccessContext): Promise<MemoryRetrievalResult>;
}
export {};
