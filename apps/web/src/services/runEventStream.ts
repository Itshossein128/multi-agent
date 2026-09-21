import type { RunEvent } from "@multi-agent/types";
import { runService } from "./runService";

export function createRunEventStream(runId: string, handlers: { onEvent: (event: RunEvent) => void; onStatus?: (status: "connecting" | "live" | "error" | "closed") => void }) {
  let sequence = 0; let closed = false; let source: EventSource | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let attempts = 0;
  const connect = () => {
    if (closed) return;
    handlers.onStatus?.("connecting");
    source = new EventSource(runService.eventsUrl(runId, sequence));
    source.onopen = () => { attempts = 0; handlers.onStatus?.("live"); };
    source.addEventListener("run-event", (message) => {
      let event: RunEvent;
      try { event = JSON.parse((message as MessageEvent).data) as RunEvent; } catch { return; }
      if (event.sequence <= sequence) return;
      sequence = event.sequence; handlers.onEvent(event); handlers.onStatus?.("live");
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.type)) { closed = true; source?.close(); handlers.onStatus?.("closed"); }
    });
    source.onerror = () => {
      source?.close(); handlers.onStatus?.("error");
      if (!closed) {
        const delay = Math.min(5000, 250 * 2 ** Math.min(attempts++, 4));
        timer = setTimeout(connect, delay);
      }
    };
  };
  connect();
  return { close: () => { closed = true; if (timer) clearTimeout(timer); source?.close(); handlers.onStatus?.("closed"); } };
}
