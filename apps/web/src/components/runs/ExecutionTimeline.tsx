"use client";

import { useState } from "react";
import type { RunEvent } from "@multi-agent/types";
import { formatDateTime } from "@/lib/formatDateTime";

/** One normalized timeline for run and agent inspection. Payloads are sanitized by the server. */
export function ExecutionTimeline({ events, emptyMessage = "No execution events yet." }: { events: RunEvent[]; emptyMessage?: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = events.find((event) => event.id === selectedId);
  return <div className="space-y-3">
    {!events.length && <p className="text-sm text-zinc-400">{emptyMessage}</p>}
    <ol className="max-h-96 space-y-2 overflow-auto" aria-label="Execution timeline">
      {events.map((event) => <li key={event.id}>
        <button type="button" aria-pressed={event.id === selectedId} onClick={() => setSelectedId(event.id)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-left text-xs hover:border-indigo-400 focus-visible:outline-2 focus-visible:outline-indigo-400 aria-pressed:border-indigo-400">
          <span className={event.type.endsWith("failed") ? "text-red-300" : "text-zinc-100"}>{event.type}</span>
          <span className="float-right text-zinc-400">#{event.sequence}</span>
          <time className="mt-1 block text-zinc-400" dateTime={event.timestamp}>{formatDateTime(event.timestamp)}</time>
          {event.nodeId && <span className="mt-1 block break-all text-zinc-400">Node: {event.nodeId}</span>}
        </button>
      </li>)}
    </ol>
    {selected && <section className="rounded-lg border border-zinc-700 p-3" aria-label="Event detail">
      <h3 className="mb-2 text-sm font-semibold">{selected.type}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 break-all text-xs text-zinc-300">
        {Object.entries({
          Timestamp: formatDateTime(selected.timestamp), Run: selected.runId, Node: selected.nodeId, Agent: selected.agentId, Tool: selected.toolId,
          "Duration (ms)": selected.payload.durationMs
        }).map(([label, value]) => value !== undefined && <div key={label} className="contents"><dt>{label}</dt><dd>{String(value)}</dd></div>)}
      </dl>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-300">{JSON.stringify(selected.payload, null, 2)}</pre>
    </section>}
  </div>;
}
