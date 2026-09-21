import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunStoreContract } from "../../runtime/runStore";

export function streamRunEvents(context: Context, store: RunStoreContract, runId: string, after: number) {
  return streamSSE(context, async (stream) => {
    let sequence = after;
    let resolve: (() => void) | undefined;
    let wakeVersion = 0;
    const wake = () => { wakeVersion += 1; resolve?.(); };
    const unsubscribe = store.subscribe(runId, wake);
    stream.onAbort(wake);
    try {
      while (!stream.aborted) {
        const pending = store.events(runId, sequence);
        for (const event of pending) {
          await stream.writeSSE({ id: String(event.sequence), event: "run-event", data: JSON.stringify(event) });
          sequence = event.sequence;
        }
        if (store.events(runId, sequence).length) continue;
        const status = store.get(runId)?.run.status;
        if (!status || status === "completed" || status === "failed" || status === "cancelled" || stream.aborted) break;
        // Subscribe before the first read, but also guard the check-to-wait
        // window: an event can arrive after the empty read and before the
        // promise installs its resolver.
        const observedVersion = wakeVersion;
        await new Promise<void>((done) => {
          resolve = done;
          if (wakeVersion !== observedVersion) done();
        });
        resolve = undefined;
      }
    } finally {
      unsubscribe();
    }
  });
}
