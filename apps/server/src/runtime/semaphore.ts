function abortError(): Error {
  const error = new Error("Execution cancelled");
  error.name = "AbortError";
  return error;
}

/**
 * A counting semaphore that supports AbortSignal cancellation.
 * Limits concurrent execution to a fixed number of slots.
 */
export class AbortableSemaphore {
  private active = 0;
  private readonly waiters: Array<{
    signal?: AbortSignal;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
    onAbort?: () => void;
  }> = [];

  constructor(private readonly limit: number) { }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(this.releaseOnce());
    }
    return new Promise((resolve, reject) => {
      const waiter = { signal, resolve, reject } as (typeof this.waiters)[number];
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(abortError());
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.dispatch();
    };
  }

  private dispatch(): void {
    while (this.active < this.limit && this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.signal?.removeEventListener("abort", waiter.onAbort!);
      if (waiter.signal?.aborted) {
        waiter.reject(abortError());
        continue;
      }
      this.active += 1;
      waiter.resolve(this.releaseOnce());
    }
  }
}
