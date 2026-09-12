import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunStoreContract } from "../../runtime/runStore";

export function streamRunEvents(context: Context, store: RunStoreContract, runId: string, after: number) {
  return streamSSE(context, async (stream) => {
    let sequence = after;
    let resolve: (() => void) | undefined;
    const wake = () => resolve?.();
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
        if (status === "completed" || status === "failed" || status === "cancelled" || stream.aborted) break;
        await new Promise<void>((done) => { resolve = done; });
        resolve = undefined;
      }
    } finally {
      unsubscribe();
    }
  });
}
