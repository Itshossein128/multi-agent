import type { MemoryAccessContext, MemoryBackgroundJobs, MemoryConsolidationScheduler, MemoryConsolidator, MemoryNamespace, MemoryStore } from "../contracts";

type Scope = { access: MemoryAccessContext; namespace: MemoryNamespace };

/**
 * Coalesces post-commit consolidation work by tenant/namespace. The durable
 * memory store remains authoritative: recovery re-enqueues every known scope,
 * so an interrupted in-memory job cannot lose maintenance permanently.
 */
export class BoundedMemoryConsolidationScheduler implements MemoryConsolidationScheduler {
  private readonly pending = new Set<string>();
  private readonly dirty = new Set<string>();
  constructor(
    private readonly store: MemoryStore,
    private readonly consolidator: MemoryConsolidator,
    private readonly jobs: MemoryBackgroundJobs,
    private readonly options: { onDiagnostic?: (event: Record<string, string | number | boolean>) => void; recoveryLimit?: number } = {},
  ) {}

  private key(access: MemoryAccessContext, namespace: MemoryNamespace): string { return JSON.stringify([access.tenantId, namespace.scope, namespace.id]); }

  schedule(access: MemoryAccessContext, namespace: MemoryNamespace): boolean {
    const key = this.key(access, namespace);
    if (this.pending.has(key)) { this.dirty.add(key); return true; }
    this.pending.add(key);
    const task = async () => {
      const started = Date.now();
      let result: Awaited<ReturnType<MemoryConsolidator["consolidate"]>> | undefined;
      try {
        result = await this.consolidator.consolidate(access, namespace);
        this.options.onDiagnostic?.({ event: "completed", tenantId: access.tenantId, namespace: namespace.id, merged: result.merged, candidates: result.diagnostics.candidatesEvaluated, semanticCandidates: result.diagnostics.semanticCandidates, exactDuplicates: result.diagnostics.exactDuplicates, ignored: result.diagnostics.ignored, keptBoth: result.diagnostics.keptSeparate, superseded: result.diagnostics.superseded, judgeFailures: result.diagnostics.judgeFailures, latencyMs: result.diagnostics.latencyMs });
      } catch (error) {
        this.options.onDiagnostic?.({ event: "failed", tenantId: access.tenantId, namespace: namespace.id, reason: "consolidation_failed", latencyMs: Date.now() - started });
        throw error;
      } finally {
        this.pending.delete(key);
        if (this.dirty.delete(key)) this.schedule(access, namespace);
      }
    };
    const accepted = this.jobs.enqueue(task);
    if (!accepted) {
      this.pending.delete(key);
      this.options.onDiagnostic?.({ event: "rejected", tenantId: access.tenantId, namespace: namespace.id, reason: "queue_full" });
    } else {
      this.options.onDiagnostic?.({ event: "scheduled", tenantId: access.tenantId, namespace: namespace.id });
    }
    return accepted;
  }

  async recover(): Promise<number> {
    const scopes = await this.store.listNamespaces?.(this.options.recoveryLimit ?? 1000) ?? [];
    let scheduled = 0;
    for (const scope of scopes) {
      const access: MemoryAccessContext = {
        principalId: "memory-maintenance",
        tenantId: scope.tenantId,
        readableNamespaces: [scope.namespace],
        writableNamespaces: [scope.namespace],
      };
      if (this.schedule(access, scope.namespace)) scheduled++;
    }
    this.options.onDiagnostic?.({ event: "recovery_scheduled", scopes: scheduled });
    return scheduled;
  }
}
