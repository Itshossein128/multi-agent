import type { EmbeddingProvider } from "../../../../src/memory/contracts";
import {
  HttpEmbeddingConfig,
  HttpEmbeddingProvider,
  createEmbeddingProvider,
} from "../../../../src/memory/application/embeddingProvider";

export type { HttpEmbeddingConfig };
export { HttpEmbeddingProvider, createEmbeddingProvider };

export function embeddingProviderFromEnvironment(): EmbeddingProvider | undefined {
  if (process.env.MEMORY_EMBEDDINGS_ENABLED !== "true") return undefined;
  return new HttpEmbeddingProvider({
    endpoint: process.env.MEMORY_EMBEDDING_URL ?? "",
    provider: process.env.MEMORY_EMBEDDING_PROVIDER ?? "openai-compatible",
    model: process.env.MEMORY_EMBEDDING_MODEL ?? "",
    dimensions: Number(process.env.MEMORY_EMBEDDING_DIMENSIONS),
    version: process.env.MEMORY_EMBEDDING_VERSION ?? "1",
    apiKey: process.env.MEMORY_EMBEDDING_API_KEY,
    timeoutMs: Number(process.env.MEMORY_EMBEDDING_TIMEOUT_MS) || undefined,
    cacheSize: Number(process.env.MEMORY_EMBEDDING_CACHE_SIZE) || undefined,
  });
}
