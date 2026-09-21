import type { MemoryService, RuntimeMemoryDependencies } from "../../../../src/memory/contracts";
import { DefaultMemoryService, DefaultMemoryExtractor, DefaultMemoryWritePolicy, DefaultMemoryContextFormatter, DefaultMemoryBackgroundJobs } from "../../../../src/memory/application";
import { PostgresMemoryStore, InMemoryMemoryStore, type PgPool } from "../../../../src/memory/infrastructure";
import { createPostgresPool, type ManagedPool } from "../infrastructure/postgresPool";
import { embeddingProviderFromEnvironment } from "./embeddingProvider";
import { log } from "../logging";

export interface MemoryComposition {
  service?: MemoryService; runtime?: RuntimeMemoryDependencies;
  close(): Promise<void>;
}
/** No migrations at startup; durable storage never silently falls back to a Map. */
export function createMemoryComposition(): MemoryComposition {
  const connectionString = process.env.MEMORY_DATABASE_URL;
  const mode = process.env.MEMORY_STORE ?? (connectionString ? "postgres" : "disabled");
  if (mode === "disabled") { log.info("memory.store", { mode: "disabled" }); return { close: async () => {} }; }
  if (!["postgres", "in-memory"].includes(mode)) throw new Error("Invalid MEMORY_STORE mode.");
  if (mode === "postgres" && !connectionString) throw new Error("MEMORY_DATABASE_URL is required for PostgreSQL memory.");
  if (mode === "in-memory" && process.env.NODE_ENV === "production") throw new Error("Volatile memory storage is not supported in production.");
  let pool: ManagedPool | undefined;
  if (mode === "postgres") {
    pool = createPostgresPool(connectionString, { statementTimeoutMs: 5000 });
  }
  const vectorEnabled = process.env.MEMORY_VECTOR_ENABLED === "true";
  const store = pool ? new PostgresMemoryStore(pool, { vectorEnabled }) : new InMemoryMemoryStore();
  const embeddingProvider = embeddingProviderFromEnvironment();
  const embeddingConfigured = !!embeddingProvider;
  const ttlDays = Number(process.env.MEMORY_DEFAULT_TTL_DAYS ?? 90);
  if (!Number.isFinite(ttlDays) || ttlDays < 0 || ttlDays > 36500) throw new Error("Invalid MEMORY_DEFAULT_TTL_DAYS.");
  const service = new DefaultMemoryService(store, { embeddingProvider, defaultTtlMs: ttlDays === 0 ? undefined : ttlDays * 86400000 });
  const jobs = new DefaultMemoryBackgroundJobs({ onError: () => console.warn("Background memory operation failed.") });
  const runtime: RuntimeMemoryDependencies = { service, jobs, extractor: new DefaultMemoryExtractor(), writePolicy: new DefaultMemoryWritePolicy(), formatter: new DefaultMemoryContextFormatter() };

  // Startup observability: log memory configuration without secrets.
  log.info("memory.compose", {
    mode,
    vectorEnabled,
    embeddingConfigured,
    embeddingProvider: embeddingConfigured ? process.env.MEMORY_EMBEDDING_PROVIDER : undefined,
    embeddingModel: embeddingConfigured ? process.env.MEMORY_EMBEDDING_MODEL : undefined,
    embeddingDimensions: embeddingConfigured ? Number(process.env.MEMORY_EMBEDDING_DIMENSIONS) || undefined : undefined,
    ttlDays,
  });
  if (vectorEnabled && !embeddingConfigured) {
    log.warn("memory.vector.misconfigured", { message: "MEMORY_VECTOR_ENABLED=true but no embedding provider configured; vector retrieval will fail at query time" });
  }

  return { service, runtime, close: async () => { try { await jobs.drain(); } finally { await pool?.end(); } } };
}
