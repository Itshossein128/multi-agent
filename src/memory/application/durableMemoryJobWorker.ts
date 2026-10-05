import type { MemoryAccessContext, MemoryConsolidator } from "../contracts";
import type { DurableMemoryJob, MemoryJobKind, PostgresMemoryJobStore } from "../infrastructure";

export interface DurableMemoryJobWorkerOptions { workerId: string; batchSize?: number; leaseMs?: number; maxAttempts?: number; onEvent?: (event: Record<string, unknown>) => void }
export type DurableMemoryJobHandler = (job: DurableMemoryJob, access: MemoryAccessContext) => Promise<void>;
const internalAccess = (job: DurableMemoryJob): MemoryAccessContext => ({ principalId: "memory-maintenance", tenantId: job.tenantId, readableNamespaces: [job.namespace], writableNamespaces: [job.namespace] });
function classifyError(e: unknown): { code: string; retryable: boolean } {
  const pg = e as { code?: string; message?: string };
  // Serialization/deadlock and transport failures are safe to replay because
  // the underlying memory writes have stable identities/version checks.
  if (["40001", "40P01", "57P01", "ECONNRESET", "ETIMEDOUT"].includes(pg.code ?? "")) return { code: "transient_database_or_network", retryable: true };
  if (e instanceof Error && /access|validation|unsupported|authorization|invalid payload/i.test(e.message)) return { code: "permanent_error", retryable: false };
  return { code: "transient_error", retryable: true };
}
/** Small, bounded worker; it owns no correctness state outside PostgreSQL leases. */
export class DurableMemoryJobWorker {
  private stopping = false;
  constructor(private readonly store: PostgresMemoryJobStore, private handlers: Partial<Record<MemoryJobKind, DurableMemoryJobHandler>>, private readonly options: DurableMemoryJobWorkerOptions) {}
  /** Handlers are installed before polling during server composition. */
  setHandlers(handlers: Partial<Record<MemoryJobKind, DurableMemoryJobHandler>>): void { this.handlers = { ...this.handlers, ...handlers }; }
  stop(): void { this.stopping = true; }
  async pollOnce(): Promise<number> {
    if (this.stopping) return 0;
    const jobs = await this.store.claim(this.options.workerId, this.options.batchSize ?? 10, this.options.leaseMs ?? 30_000);
    for (const job of jobs) {
      const started = Date.now(); this.options.onEvent?.({ event: "memory.job.claimed", jobId: job.id, jobKind: job.kind, tenantId: job.tenantId, namespace: job.namespace.id, attempt: job.attempts, workerId: this.options.workerId });
      try {
        const handler = this.handlers[job.kind];
        if (!handler) throw new Error("unsupported handler version");
        await handler(job, internalAccess(job));
        if (await this.store.complete(job.id, this.options.workerId)) this.options.onEvent?.({ event: "memory.job.completed", jobId: job.id, jobKind: job.kind, attempt: job.attempts, workerId: this.options.workerId, durationMs: Date.now()-started });
      } catch (error) {
        const { code, retryable } = classifyError(error);
        const status = await this.store.fail(job.id, this.options.workerId, code, retryable, this.options.maxAttempts ?? 3);
        this.options.onEvent?.({ event: status === "dead" ? "memory.job.dead" : "memory.job.retry", jobId: job.id, jobKind: job.kind, attempt: job.attempts, workerId: this.options.workerId, errorCode: code, durationMs: Date.now()-started });
      }
    }
    return jobs.length;
  }
}
