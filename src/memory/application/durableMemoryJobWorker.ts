import type { MemoryAccessContext, MemoryConsolidator } from "../contracts";
import type { DurableMemoryJob, MemoryJobKind, PostgresMemoryJobStore } from "../infrastructure";

export interface DurableMemoryJobWorkerOptions { workerId: string; batchSize?: number; leaseMs?: number; maxAttempts?: number; onEvent?: (event: Record<string, unknown>) => void }
export type DurableMemoryJobHandler = (job: DurableMemoryJob, access: MemoryAccessContext) => Promise<void>;
const internalAccess = (job: DurableMemoryJob): MemoryAccessContext => ({ principalId: "memory-maintenance", tenantId: job.tenantId, readableNamespaces: [job.namespace], writableNamespaces: [job.namespace] });
const errorCode = (e: unknown) => e instanceof Error && /access|validation|unsupported/i.test(e.message) ? "permanent_error" : "transient_error";
/** Small, bounded worker; it owns no correctness state outside PostgreSQL leases. */
export class DurableMemoryJobWorker {
  private stopping = false;
  constructor(private readonly store: PostgresMemoryJobStore, private readonly handlers: Partial<Record<MemoryJobKind, DurableMemoryJobHandler>>, private readonly options: DurableMemoryJobWorkerOptions) {}
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
        const code = errorCode(error), retryable = code === "transient_error";
        const status = await this.store.fail(job.id, this.options.workerId, code, retryable, this.options.maxAttempts ?? 3);
        this.options.onEvent?.({ event: status === "dead" ? "memory.job.dead" : "memory.job.retry", jobId: job.id, jobKind: job.kind, attempt: job.attempts, workerId: this.options.workerId, errorCode: code, durationMs: Date.now()-started });
      }
    }
    return jobs.length;
  }
}
