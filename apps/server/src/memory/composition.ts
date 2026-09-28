import type { MemoryService, RuntimeMemoryDependencies, MemoryBackgroundJobs, MemoryConsolidationScheduler, MemoryEvaluationRuntime } from "../../../../src/memory/contracts";
import { DefaultMemoryService, DefaultMemoryExtractor, DefaultMemoryWritePolicy, DefaultMemoryContextFormatter, DefaultMemoryBackgroundJobs, DefaultEpisodeService, DefaultProceduralService, RealMemoryConsolidator, BoundedMemoryConsolidationScheduler, DurableMemoryJobWorker, InMemoryMemoryEvaluationSink, MemoryEvaluationRecorder, StructuredMemoryEvaluationSink, type EpisodeService, type ProceduralService, type DurableMemoryJobHandler } from "../../../../src/memory/application";
import { PostgresMemoryStore, PostgresMemoryJobStore, InMemoryMemoryStore, type PgPool } from "../../../../src/memory/infrastructure";
import { createPostgresPool, type ManagedPool } from "../infrastructure/postgresPool";
import { embeddingProviderFromEnvironment } from "./embeddingProvider";
import { log } from "../logging";

export interface MemoryComposition {
  service?: MemoryService; runtime?: RuntimeMemoryDependencies; episodeService?: EpisodeService; proceduralService?: ProceduralService; jobs?: MemoryBackgroundJobs; consolidationScheduler?: MemoryConsolidationScheduler; evaluationSink?: InMemoryMemoryEvaluationSink;
  durableJobs?: PostgresMemoryJobStore;
  startDurableWorkers(handlers: Partial<Record<"episodic_extraction" | "procedural_learning", DurableMemoryJobHandler>>): void;
  recover(): Promise<number>;
  close(): Promise<void>;
}
/** No migrations at startup; durable storage never silently falls back to a Map. */
export function createMemoryComposition(): MemoryComposition {
  const connectionString = process.env.MEMORY_DATABASE_URL;
  const mode = process.env.MEMORY_STORE ?? (connectionString ? "postgres" : "disabled");
  if (mode === "disabled") { log.info("memory.store", { mode: "disabled" }); return { startDurableWorkers: () => {}, recover: async () => 0, close: async () => {} }; }
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
        temporalMode: event.temporalMode,
        queryTime: event.queryTime,
        temporalMatched: event.temporalMatched,
        temporalDropped: event.temporalDropped,
        temporalOverlapUnresolved: event.temporalOverlapUnresolved,
      };
      if (security > 0 || event.event.endsWith("security_violation")) log.error(event.event, context);
      else log.info(event.event, context);
    }, evaluationSampleRate)),
  } : undefined;
  const consolidator = new RealMemoryConsolidator({ store, embeddingProvider });
  const durableJobs = pool ? new PostgresMemoryJobStore(pool) : undefined;
  const workerId = process.env.MEMORY_JOB_WORKER_ID ?? `memory-${process.pid}`;
  const durableWorker = durableJobs ? new DurableMemoryJobWorker(durableJobs, {
    consolidation: async (job, access) => { await consolidator.consolidate(access, job.namespace); },
  }, { workerId, onEvent: event => log.info(String(event.event), {
    jobId: typeof event.jobId === "string" ? event.jobId : undefined,
    jobKind: typeof event.jobKind === "string" ? event.jobKind : undefined,
    tenantId: typeof event.tenantId === "string" ? event.tenantId : undefined,
    namespace: typeof event.namespace === "string" ? event.namespace : undefined,
    attempt: typeof event.attempt === "number" ? event.attempt : undefined,
    workerId: typeof event.workerId === "string" ? event.workerId : undefined,
    durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined,
    errorCode: typeof event.errorCode === "string" ? event.errorCode : undefined,
  }) }) : undefined;
  const pollMs = Math.max(100, Math.min(60_000, Number(process.env.MEMORY_JOB_POLL_MS ?? 1000) || 1000));
  let poller: NodeJS.Timeout | undefined;
  const startDurableWorkers = (handlers: Partial<Record<"episodic_extraction" | "procedural_learning", DurableMemoryJobHandler>>) => {
    if (!durableWorker || poller) return;
    durableWorker.setHandlers(handlers);
    const poll = () => { void durableWorker.pollOnce().catch(() => log.warn("memory.job.poll_failed", { workerId })); };
    poll();
    poller = setInterval(poll, pollMs);
  };
  const consolidationScheduler = new BoundedMemoryConsolidationScheduler(store, consolidator, jobs, {
    onDiagnostic: (event) => log.info("memory.consolidation", event),
    durableEnqueue: durableJobs ? async (access, namespace) => {
      const result = await durableJobs.enqueue({ kind: "consolidation", idempotencyKey: `namespace:${access.tenantId}:${namespace.scope}:${namespace.id}:v1`, tenantId: access.tenantId, namespace });
      if (result.duplicate) log.info("memory.job.idempotent_replay", { jobId: result.job.id, jobKind: result.job.kind, tenantId: access.tenantId, namespace: namespace.id });
    } : undefined,
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

  return { service, runtime, episodeService, proceduralService, jobs, consolidationScheduler, evaluationSink, durableJobs, startDurableWorkers,
    recover: async () => {
      const reconciled = durableJobs ? await durableJobs.reconcileTerminalRuns(Number(process.env.MEMORY_JOB_RECONCILE_LIMIT ?? 100)) : 0;
      if (reconciled) log.info("memory.work_intent.reconciled", { recovered: reconciled });
      return reconciled + await consolidationScheduler.recover();
    }, close: async () => { if (poller) clearInterval(poller); durableWorker?.stop(); try { await jobs.drain(); } finally { await pool?.end(); } } };
}
