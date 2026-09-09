import type { MemoryBackgroundJobs } from "../contracts";
export interface MemoryBackgroundJobsOptions { capacity?: number; concurrency?: number; onError?: (error: Error) => void }
/** Bounded outstanding jobs. drain reports sanitized failures after all accepted work settles. */
export class BoundedMemoryBackgroundJobs implements MemoryBackgroundJobs {
  private readonly queue: (() => Promise<void>)[] = [];
  private running = 0;
  private failures = 0;
  private readonly waiters: (() => void)[] = [];
  private readonly capacity: number;
  private readonly concurrency: number;
  constructor(private readonly options: MemoryBackgroundJobsOptions = {}) {
    this.capacity = options.capacity ?? 100; this.concurrency = options.concurrency ?? 2;
    if (![this.capacity, this.concurrency].every(n => Number.isInteger(n) && n > 0)) throw new Error("Invalid memory queue bounds");
  }
  enqueue(task: () => Promise<void>): boolean {
    if (this.queue.length + this.running >= this.capacity) return false;
    this.queue.push(task); this.pump(); return true;
  }
  private pump(): void {
    while (this.queue.length && this.running < this.concurrency) {
      const task = this.queue.shift()!; this.running++;
      void Promise.resolve().then(task).catch(() => {
        this.failures++;
        try { this.options.onError?.(new Error("Memory background job failed")); } catch { /* Observers cannot break draining. */ }
      }).finally(() => {
        this.running--; this.pump();
        if (!this.running && !this.queue.length) for (const resolve of this.waiters.splice(0)) resolve();
      });
    }
  }
  async drain(): Promise<void> {
    if (this.running || this.queue.length) await new Promise<void>(resolve => this.waiters.push(resolve));
    const failures = this.failures; this.failures = 0;
    if (failures) throw new Error(`${failures} memory background job(s) failed`);
  }
}
export { BoundedMemoryBackgroundJobs as DefaultMemoryBackgroundJobs };
