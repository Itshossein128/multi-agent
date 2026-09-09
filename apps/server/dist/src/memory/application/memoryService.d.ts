import type { Memory, MemoryAccessContext, MemoryListQuery, MemoryRetrievalQuery, MemoryRetriever, MemoryService, MemoryStore, MemoryWritePolicy, MemoryWriteResult, RememberMemoryInput, UpdateMemoryInput } from "../contracts";
import { HybridMemoryRetrieverOptions } from "./hybridMemoryRetriever";
export interface DefaultMemoryServiceOptions extends HybridMemoryRetrieverOptions {
    retriever?: MemoryRetriever;
    writePolicy?: MemoryWritePolicy;
    defaultTtlMs?: number;
}
export declare class DefaultMemoryService implements MemoryService {
    private readonly store;
    private readonly options;
    private readonly retriever;
    private readonly policy;
    constructor(store: MemoryStore, options?: DefaultMemoryServiceOptions);
    private now;
    private embedding;
    private authorized;
    /** Exact indexed identity queries; no namespace/table scans, including for expired retry records. */
    private identityMatches;
    remember(input: RememberMemoryInput, access: MemoryAccessContext): Promise<MemoryWriteResult>;
    recall(query: MemoryRetrievalQuery, access: MemoryAccessContext): Promise<import("node_modules/@multi-agent/types/dist/memory").MemoryRetrievalResult>;
    get(id: string, access: MemoryAccessContext): Promise<Memory | null>;
    update(id: string, patch: UpdateMemoryInput, access: MemoryAccessContext): Promise<Memory>;
    forget(id: string, access: MemoryAccessContext): Promise<void>;
    list(query: MemoryListQuery, access: MemoryAccessContext): Promise<Memory[]>;
}
