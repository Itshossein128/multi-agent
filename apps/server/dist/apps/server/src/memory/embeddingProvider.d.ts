import type { EmbeddingProvider, MemoryEmbeddingMetadata } from "../../../../src/memory/contracts";
export interface HttpEmbeddingConfig {
    endpoint: string;
    provider: string;
    model: string;
    dimensions: number;
    version: string;
    apiKey?: string;
    timeoutMs?: number;
    cacheSize?: number;
}
/** Server-configured OpenAI-compatible JSON transport; independent of execution backend. */
export declare class HttpEmbeddingProvider implements EmbeddingProvider {
    private readonly config;
    private readonly transport;
    readonly metadata: MemoryEmbeddingMetadata;
    private readonly cache;
    private readonly endpoint;
    constructor(config: HttpEmbeddingConfig, transport?: typeof fetch);
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
}
export declare function embeddingProviderFromEnvironment(): EmbeddingProvider | undefined;
