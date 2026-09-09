import type { MemoryBackgroundJobs } from "../contracts";
export interface MemoryBackgroundJobsOptions {
    capacity?: number;
    concurrency?: number;
    onError?: (error: Error) => void;
}
/** Bounded outstanding jobs. drain reports sanitized failures after all accepted work settles. */
export declare class BoundedMemoryBackgroundJobs implements MemoryBackgroundJobs {
    private readonly options;
    private readonly queue;
    private running;
    private failures;
    private readonly waiters;
    private readonly capacity;
    private readonly concurrency;
    constructor(options?: MemoryBackgroundJobsOptions);
    enqueue(task: () => Promise<void>): boolean;
    private pump;
    drain(): Promise<void>;
}
export { BoundedMemoryBackgroundJobs as DefaultMemoryBackgroundJobs };
