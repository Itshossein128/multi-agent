"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RunEvent } from "@multi-agent/types";
import { formatDateTime } from "@/lib/formatDateTime";
import { ReadableContent } from "@/components/runs/ReadableContent";

type DetailView = "readable" | "raw";

/** One normalized timeline for run and agent inspection. Payloads are sanitized by the server. */
export function ExecutionTimeline({ events, emptyMessage = "No execution events yet." }: { events: RunEvent[]; emptyMessage?: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<DetailView>("readable");
  const listRef = useRef<HTMLOListElement>(null);
  const followTail = useRef(true);
  const ordered = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events]);
  const effectiveSelectedId = ordered.some((event) => event.id === selectedId)
    ? selectedId
    : ordered.at(-1)?.id ?? null;
  const selected = ordered.find((event) => event.id === effectiveSelectedId);
  const normalized = useMemo(
    () => (selected ? normalizePayload(selected.payload) : null),
    [selected],
  );
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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{selected.type}</h3>
        <div className="inline-flex rounded-md border border-zinc-700 p-0.5" role="group" aria-label="Payload view">
          {(["readable", "raw"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={detailView === mode}
              onClick={() => setDetailView(mode)}
              className="rounded px-2 py-1 text-[11px] capitalize text-zinc-400 hover:text-zinc-100 aria-pressed:bg-zinc-800 aria-pressed:text-zinc-100"
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 break-all text-xs text-zinc-300">
        {Object.entries({
          Timestamp: formatDateTime(selected.timestamp), Run: selected.runId, Node: selected.nodeId, Agent: selected.agentId, Tool: selected.toolId,
          "Duration (ms)": selected.payload.durationMs
        }).map(([label, value]) => value !== undefined && <div key={label} className="contents"><dt>{label}</dt><dd>{String(value)}</dd></div>)}
      </dl>
      {detailView === "readable" && normalized ? (
        <div className="mt-3 space-y-3">
          {normalized.sections.map((section) => (
            <div key={section.label}>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">{section.label}</p>
              <ReadableContent text={section.text} />
            </div>
          ))}
          {normalized.meta && Object.keys(normalized.meta).length > 0 && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">Metadata</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-950/80 p-3 text-xs text-zinc-400">{JSON.stringify(normalized.meta, null, 2)}</pre>
            </div>
          )}
          {normalized.sections.length === 0 && !normalized.meta && (
            <p className="text-xs text-zinc-500">No payload fields.</p>
          )}
        </div>
      ) : (
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-950/80 p-3 text-xs text-zinc-300">{JSON.stringify(selected.payload, null, 2)}</pre>
      )}
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

const TEXT_KEYS = ["content", "output", "error", "message", "text", "log", "stdout", "stderr", "summary"] as const;
const META_SKIP = new Set(["durationMs", ...TEXT_KEYS]);

type NormalizedPayload = {
  sections: Array<{ label: string; text: string }>;
  meta: Record<string, unknown> | null;
};

/** Pull nested log/output strings out of JSON so newlines render as readable text. */
function normalizePayload(payload: Record<string, unknown>): NormalizedPayload {
  const sections: Array<{ label: string; text: string }> = [];
  const used = new Set<string>();

  for (const key of TEXT_KEYS) {
    if (!(key in payload)) continue;
    const extracted = extractText(payload[key], key);
    if (!extracted) continue;
    sections.push(extracted);
    used.add(key);
  }

  // Nested shapes like { output: { content: "..." } } when top-level output wasn't plain text.
  if (!used.has("output") && isRecord(payload.output)) {
    for (const key of TEXT_KEYS) {
      if (!(key in payload.output)) continue;
      const extracted = extractText(payload.output[key], `output.${key}`);
      if (!extracted) continue;
      sections.push(extracted);
      used.add("output");
      break;
    }
  }

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (META_SKIP.has(key) && used.has(key)) continue;
    if (key === "durationMs") continue;
    if (used.has(key) && isRecord(value)) {
      const rest = { ...value };
      for (const textKey of TEXT_KEYS) delete rest[textKey];
      if (Object.keys(rest).length) meta[key] = rest;
      continue;
    }
    if (used.has(key)) continue;
    meta[key] = value;
  }

  if (sections.length === 0 && Object.keys(meta).length === 0) {
    const fallback = formatValue(payload);
    if (fallback) sections.push({ label: "Payload", text: fallback });
  }

  return { sections, meta: Object.keys(meta).length ? meta : null };
}

function extractText(value: unknown, label: string): { label: string; text: string } | null {
  if (typeof value === "string") {
    const text = decodeEscapedNewlines(value).trim();
    return text ? { label, text } : null;
  }
  if (isRecord(value) && typeof value.content === "string") {
    const text = decodeEscapedNewlines(value.content).trim();
    return text ? { label: `${label}.content`, text } : null;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    const text = value.map((item) => decodeEscapedNewlines(item)).join("\n").trim();
    return text ? { label, text } : null;
  }
  return null;
}

function formatValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return decodeEscapedNewlines(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function decodeEscapedNewlines(value: string): string {
  // Some payloads store literal "\n" sequences instead of real newlines.
  return value.includes("\\n") && !value.includes("\n")
    ? value.replaceAll("\\n", "\n").replaceAll("\\t", "\t")
    : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
