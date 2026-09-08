import type { RunEvent } from "@multi-agent/types";
import { runService } from "./runService";

export function createRunEventStream(runId: string, handlers: { onEvent: (event: RunEvent) => void; onStatus?: (status: "connecting" | "live" | "error" | "closed") => void }) {
  let sequence = 0; let closed = false; let source: EventSource | null = null; let timer: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    if (closed) return;
    handlers.onStatus?.("connecting");
    source = new EventSource(runService.eventsUrl(runId, sequence));
    source.addEventListener("run-event", (message) => { const event = JSON.parse((message as MessageEvent).data) as RunEvent; sequence = Math.max(sequence, event.sequence); handlers.onEvent(event); handlers.onStatus?.("live"); });
    source.onerror = () => { source?.close(); handlers.onStatus?.("error"); if (!closed) timer = setTimeout(connect, Math.min(5000, 500 + sequence * 0)); };
  };
  connect();
  return { close: () => { closed = true; if (timer) clearTimeout(timer); source?.close(); handlers.onStatus?.("closed"); } };
}
