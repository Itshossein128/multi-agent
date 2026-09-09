"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DefaultMemoryBackgroundJobs = exports.BoundedMemoryBackgroundJobs = void 0;
/** Bounded outstanding jobs. drain reports sanitized failures after all accepted work settles. */
class BoundedMemoryBackgroundJobs {
    options;
    queue = [];
    running = 0;
    failures = 0;
    waiters = [];
    capacity;
    concurrency;
    constructor(options = {}) {
        this.options = options;
        this.capacity = options.capacity ?? 100;
        this.concurrency = options.concurrency ?? 2;
        if (![this.capacity, this.concurrency].every(n => Number.isInteger(n) && n > 0))
            throw new Error("Invalid memory queue bounds");
    }
    enqueue(task) {
        if (this.queue.length + this.running >= this.capacity)
            return false;
        this.queue.push(task);
        this.pump();
        return true;
    }
    pump() {
        while (this.queue.length && this.running < this.concurrency) {
            const task = this.queue.shift();
            this.running++;
            void Promise.resolve().then(task).catch(() => {
                this.failures++;
                try {
                    this.options.onError?.(new Error("Memory background job failed"));
                }
                catch { /* Observers cannot break draining. */ }
            }).finally(() => {
                this.running--;
                this.pump();
                if (!this.running && !this.queue.length)
                    for (const resolve of this.waiters.splice(0))
                        resolve();
            });
        }
    }
    async drain() {
        if (this.running || this.queue.length)
            await new Promise(resolve => this.waiters.push(resolve));
        const failures = this.failures;
        this.failures = 0;
        if (failures)
            throw new Error(`${failures} memory background job(s) failed`);
    }
}
exports.BoundedMemoryBackgroundJobs = BoundedMemoryBackgroundJobs;
exports.DefaultMemoryBackgroundJobs = BoundedMemoryBackgroundJobs;
//# sourceMappingURL=memoryBackgroundJobs.js.map