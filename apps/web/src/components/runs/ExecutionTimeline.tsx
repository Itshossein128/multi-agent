"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RunEvent } from "@multi-agent/types";
import { formatDateTime } from "@/lib/formatDateTime";

/** One normalized timeline for run and agent inspection. Payloads are sanitized by the server. */
export function ExecutionTimeline({ events, emptyMessage = "No execution events yet." }: { events: RunEvent[]; emptyMessage?: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const followTail = useRef(true);
  const ordered = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events]);
  const effectiveSelectedId = ordered.some((event) => event.id === selectedId)
    ? selectedId
    : ordered.at(-1)?.id ?? null;
  const selected = ordered.find((event) => event.id === effectiveSelectedId);
  useEffect(() => {
    const list = listRef.current;
    if (list && followTail.current) list.scrollTop = list.scrollHeight;
  }, [ordered.length]);
  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    followTail.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  };
  return <div className="space-y-3">
    {!events.length && <p className="text-sm text-zinc-400">{emptyMessage}</p>}
    <ol ref={listRef} onScroll={onScroll} className="max-h-96 space-y-2 overflow-auto" aria-label="Execution timeline">
      {ordered.map((event, index) => <li key={event.id}>
        <button type="button" aria-pressed={event.id === effectiveSelectedId} onClick={() => setSelectedId(event.id)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-left text-xs hover:border-indigo-400 focus-visible:outline-2 focus-visible:outline-indigo-400 aria-pressed:border-indigo-400">
          <span className={event.type.endsWith("failed") || event.type === "run.cancelled" ? "text-red-300" : event.type.endsWith("completed") ? "text-emerald-300" : event.type.includes("requested") || event.type === "run.paused" ? "text-amber-300" : "text-zinc-100"}>{eventLabel(event.type)}</span>
          <span className="float-right text-zinc-400">#{event.sequence}</span>
          <time className="mt-1 block text-zinc-400" dateTime={event.timestamp}>{formatDateTime(event.timestamp)}</time>
          <span className="mt-1 block text-zinc-400">{eventStatus(event.type)}{durationFor(event, ordered, index) ? ` · ${durationFor(event, ordered, index)}` : ""}</span>
          {event.nodeId && <span className="mt-1 block break-all text-zinc-400">Node: {event.nodeId}{event.agentId ? ` · Agent: ${event.agentId}` : ""}{event.toolId ? ` · Tool: ${event.toolId}` : ""}</span>}
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

function eventLabel(type: string): string {
  return type.split(".").map((part) => part.replaceAll("_", " ")).join(" · ");
}

function eventStatus(type: string): string {
  if (type.endsWith("failed") || type === "run.cancelled") return "Failed / cancelled";
  if (type.endsWith("completed")) return "Completed";
  if (type.endsWith("started")) return "Running";
  if (type.includes("requested") || type === "run.paused") return "Waiting";
  return "Recorded";
}

function durationFor(event: RunEvent, events: RunEvent[], index: number): string | undefined {
  const raw = event.payload.durationMs;
  const milliseconds = typeof raw === "number" && Number.isFinite(raw) ? raw : (() => {
    if (!event.type.endsWith("completed") && !event.type.endsWith("failed")) return undefined;
    const start = [...events.slice(0, index)].reverse().find((candidate) => candidate.type === event.type.replace(/completed$|failed$/, "started") && candidate.nodeId === event.nodeId && candidate.agentId === event.agentId);
    if (!start) return undefined;
    const value = Date.parse(event.timestamp) - Date.parse(start.timestamp);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  })();
  return milliseconds === undefined ? undefined : `${(milliseconds / 1000).toFixed(1)}s`;
}
