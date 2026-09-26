import type { MemoryService, RuntimeMemoryDependencies, MemoryBackgroundJobs, MemoryConsolidationScheduler, MemoryEvaluationRuntime } from "../../../../src/memory/contracts";
import { DefaultMemoryService, DefaultMemoryExtractor, DefaultMemoryWritePolicy, DefaultMemoryContextFormatter, DefaultMemoryBackgroundJobs, DefaultEpisodeService, DefaultProceduralService, RealMemoryConsolidator, BoundedMemoryConsolidationScheduler, InMemoryMemoryEvaluationSink, MemoryEvaluationRecorder, StructuredMemoryEvaluationSink, type EpisodeService, type ProceduralService } from "../../../../src/memory/application";
import { PostgresMemoryStore, InMemoryMemoryStore, type PgPool } from "../../../../src/memory/infrastructure";
import { createPostgresPool, type ManagedPool } from "../infrastructure/postgresPool";
import { embeddingProviderFromEnvironment } from "./embeddingProvider";
import { log } from "../logging";

export interface MemoryComposition {
  service?: MemoryService; runtime?: RuntimeMemoryDependencies; episodeService?: EpisodeService; proceduralService?: ProceduralService; jobs?: MemoryBackgroundJobs; consolidationScheduler?: MemoryConsolidationScheduler; evaluationSink?: InMemoryMemoryEvaluationSink;
  recover(): Promise<number>;
  close(): Promise<void>;
}
/** No migrations at startup; durable storage never silently falls back to a Map. */
export function createMemoryComposition(): MemoryComposition {
  const connectionString = process.env.MEMORY_DATABASE_URL;
  const mode = process.env.MEMORY_STORE ?? (connectionString ? "postgres" : "disabled");
  if (mode === "disabled") { log.info("memory.store", { mode: "disabled" }); return { recover: async () => 0, close: async () => {} }; }
  if (!["postgres", "in-memory"].includes(mode)) throw new Error("Invalid MEMORY_STORE mode.");
  if (mode === "postgres" && !connectionString) throw new Error("MEMORY_DATABASE_URL is required for PostgreSQL memory.");
  if (mode === "in-memory" && process.env.NODE_ENV === "production") throw new Error("Volatile memory storage is not supported in production.");
  let pool: ManagedPool | undefined;
  if (mode === "postgres") {
    pool = createPostgresPool(connectionString!, { statementTimeoutMs: 5000 });
  }
  const vectorEnabled = process.env.MEMORY_VECTOR_ENABLED === "true";
  const store = pool ? new PostgresMemoryStore(pool, { vectorEnabled }) : new InMemoryMemoryStore();
  const embeddingProvider = embeddingProviderFromEnvironment();
  const embeddingConfigured = !!embeddingProvider;
  const ttlDays = Number(process.env.MEMORY_DEFAULT_TTL_DAYS ?? 90);
  if (!Number.isFinite(ttlDays) || ttlDays < 0 || ttlDays > 36500) throw new Error("Invalid MEMORY_DEFAULT_TTL_DAYS.");
  const jobs = new DefaultMemoryBackgroundJobs({ onError: () => console.warn("Background memory operation failed.") });
  const evaluationEnabled = process.env.MEMORY_EVALUATION_ENABLED !== "false";
  const evaluationSampleRateValue = Number(process.env.MEMORY_EVALUATION_SAMPLE_RATE ?? 1);
  const evaluationSampleRate = Number.isFinite(evaluationSampleRateValue) ? Math.max(0, Math.min(1, evaluationSampleRateValue)) : 1;
  const retentionDaysValue = Number(process.env.MEMORY_EVALUATION_RETENTION_DAYS ?? 1);
  const evaluationRetentionMs = (Number.isFinite(retentionDaysValue) ? Math.max(1, Math.min(30, retentionDaysValue)) : 1) * 86400000;
  const evaluationSink = evaluationEnabled ? new InMemoryMemoryEvaluationSink({ sampleRate: evaluationSampleRate, retentionMs: evaluationRetentionMs }) : undefined;
  const evaluationRuntime: MemoryEvaluationRuntime | undefined = evaluationSink ? {
    recorder: new MemoryEvaluationRecorder(new StructuredMemoryEvaluationSink(evaluationSink, (event) => {
      const security = event.securityViolations ?? 0;
      const context = {
        runId: event.runId,
        invocationId: event.invocationId,
        agentId: event.agentId,
        nodeId: event.nodeId,
        candidateCount: event.candidateCount,
        selectedCount: event.selectedCount,
        suppressedCount: event.suppressedCount,
        conflictGroups: event.conflictGroups,
        staleConflictSuppressed: event.staleConflictSuppressed,
        disputedConflictSuppressed: event.disputedConflictSuppressed,
        unauthorizedFiltered: event.unauthorizedFiltered,
        expiredFiltered: event.expiredFiltered,
        supersededFiltered: event.supersededFiltered,
        invalidatedFiltered: event.invalidatedFiltered,
        securityViolations: security,
        embeddingLatencyMs: event.embeddingLatencyMs,
        formattingLatencyMs: event.formattingLatencyMs,
        fallbackMode: event.fallbackMode,
        latencyMs: event.latencyMs,
        memoryTokenCount: event.memoryTokens,
        reasonCodes: event.reasonCounts ? JSON.stringify(event.reasonCounts) : undefined,
      };
      if (security > 0 || event.event.endsWith("security_violation")) log.error(event.event, context);
      else log.info(event.event, context);
    }, evaluationSampleRate)),
  } : undefined;
  const consolidator = new RealMemoryConsolidator({ store, embeddingProvider });
  const consolidationScheduler = new BoundedMemoryConsolidationScheduler(store, consolidator, jobs, {
    onDiagnostic: (event) => log.info("memory.consolidation", event),
  });
  const service = new DefaultMemoryService(store, { embeddingProvider, defaultTtlMs: ttlDays === 0 ? undefined : ttlDays * 86400000, consolidationScheduler });
  const proceduralService = new DefaultProceduralService(service, {
    onDiagnostic: (diagnostic) => log.info("memory.procedural.evidence", {
      namespaceScope: diagnostic.namespace.scope,
      namespaceId: diagnostic.namespace.id,
      qualifyingEpisodes: diagnostic.qualifyingEpisodes,
      distinctRuns: diagnostic.distinctRuns,
      reason: diagnostic.reason,
    }),
  });
  const episodeService = new DefaultEpisodeService(service);
  const runtime: RuntimeMemoryDependencies = { service, jobs, extractor: new DefaultMemoryExtractor(), writePolicy: new DefaultMemoryWritePolicy(), formatter: new DefaultMemoryContextFormatter(), evaluation: evaluationRuntime };

  // Startup observability: log memory configuration without secrets.
  log.info("memory.compose", {
    mode,
    vectorEnabled,
    embeddingConfigured,
    embeddingProvider: embeddingConfigured ? process.env.MEMORY_EMBEDDING_PROVIDER : undefined,
    embeddingModel: embeddingConfigured ? process.env.MEMORY_EMBEDDING_MODEL : undefined,
    embeddingDimensions: embeddingConfigured ? Number(process.env.MEMORY_EMBEDDING_DIMENSIONS) || undefined : undefined,
    ttlDays,
    evaluationEnabled,
    evaluationSampleRate: evaluationEnabled ? evaluationSampleRate : undefined,
    evaluationRetentionDays: evaluationEnabled ? evaluationRetentionMs / 86400000 : undefined,
  });
  if (vectorEnabled && !embeddingConfigured) {
    log.warn("memory.vector.misconfigured", { message: "MEMORY_VECTOR_ENABLED=true but no embedding provider configured; vector retrieval will fail at query time" });
  }

  return { service, runtime, episodeService, proceduralService, jobs, consolidationScheduler, evaluationSink, recover: () => consolidationScheduler.recover(), close: async () => { try { await jobs.drain(); } finally { await pool?.end(); } } };
}
