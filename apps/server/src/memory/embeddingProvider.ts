import type { EmbeddingProvider, MemoryEmbeddingMetadata } from "../../../../src/memory/contracts";

export interface HttpEmbeddingConfig {
  endpoint: string; provider: string; model: string; dimensions: number; version: string;
  apiKey?: string; timeoutMs?: number; cacheSize?: number;
}
/** Server-configured OpenAI-compatible JSON transport; independent of execution backend. */
export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly metadata: MemoryEmbeddingMetadata;
  private readonly cache = new Map<string, number[]>();
  private readonly endpoint: URL;
  constructor(private readonly config: HttpEmbeddingConfig, private readonly transport: typeof fetch = fetch) {
    this.endpoint = new URL(config.endpoint);
    if (!["http:", "https:"].includes(this.endpoint.protocol) || this.endpoint.username || this.endpoint.password || !config.provider || !config.model || !config.version || !Number.isInteger(config.dimensions) || config.dimensions < 1 || config.dimensions > 4096) throw new Error("Invalid server embedding configuration.");
    if (config.cacheSize !== undefined && (!Number.isInteger(config.cacheSize) || config.cacheSize < 0 || config.cacheSize > 1024)) throw new Error("Invalid embedding cache size.");
    if (config.timeoutMs !== undefined && (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 30000)) throw new Error("Invalid embedding timeout.");
    this.metadata = { provider: config.provider, model: config.model, dimensions: config.dimensions, version: config.version };
  }
  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return [...cached];
    return (await this.embedBatch([text]))[0];
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    if (texts.length > 32 || texts.some((text) => typeof text !== "string" || text.length > 16000)) throw new Error("Embedding batch exceeds configured limits.");
    const response = await this.transport(this.endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.config.model, input: texts, encoding_format: "float" }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 1500),
    });
    if (!response.ok) throw new Error("Embedding service unavailable.");
    const body = await response.json() as { data?: { index: number; embedding: number[] }[] };
    if (!Array.isArray(body.data) || body.data.length !== texts.length) throw new Error("Embedding service returned an invalid batch.");
    const ordered = body.data.slice().sort((a, b) => a.index - b.index);
    const vectors = ordered.map((item, index) => {
      if (item.index !== index || !Array.isArray(item.embedding) || item.embedding.length !== this.metadata.dimensions || !item.embedding.every(Number.isFinite) || !item.embedding.some((value) => value !== 0)) throw new Error("Embedding dimensions or values are invalid.");
      return [...item.embedding];
    });
    texts.forEach((text, index) => {
      this.cache.set(text, vectors[index]);
      while (this.cache.size > (this.config.cacheSize ?? 256)) this.cache.delete(this.cache.keys().next().value!);
    });
    return vectors.map((vector) => [...vector]);
  }
}

export function embeddingProviderFromEnvironment(): EmbeddingProvider | undefined {
  if (process.env.MEMORY_EMBEDDINGS_ENABLED !== "true") return undefined;
  return new HttpEmbeddingProvider({
    endpoint: process.env.MEMORY_EMBEDDING_URL ?? "",
    provider: process.env.MEMORY_EMBEDDING_PROVIDER ?? "openai-compatible",
    model: process.env.MEMORY_EMBEDDING_MODEL ?? "",
    dimensions: Number(process.env.MEMORY_EMBEDDING_DIMENSIONS),
    version: process.env.MEMORY_EMBEDDING_VERSION ?? "1",
    apiKey: process.env.MEMORY_EMBEDDING_API_KEY,
  });
}
