"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { RunEvent } from "@multi-agent/types";
import { formatDateTime } from "@/lib/formatDateTime";
import { ReadableContent } from "@/components/runs/ReadableContent";
import {
  buildNodeOutcomeLookup,
  decodeEscapedNewlines,
  explainRunError,
  extractLatestAgentBlockerContext,
  formatAnyValueForReading,
  humanizeEventLabel,
  humanizeKey,
  hydrateTruncatedPayload,
  isImportantTimelineEvent,
  summarizeEventPreview,
} from "@/lib/readableAgentText";

type DetailView = "readable" | "raw";
type TimelineScope = "important" | "all";

function normalizeForCompare(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** One normalized timeline for run and agent inspection. Payloads are sanitized by the server. */
export function ExecutionTimeline({
  events,
  emptyMessage = "No execution events yet.",
  nodeFilter,
  onClearNodeFilter,
}: {
  events: RunEvent[];
  emptyMessage?: string;
  nodeFilter?: string | null;
  onClearNodeFilter?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<DetailView>("readable");
  const [scope, setScope] = useState<TimelineScope>("important");
  const listRef = useRef<HTMLOListElement>(null);
  const followTail = useRef(true);
  const ordered = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events]);
  const visible = useMemo(() => {
    const scoped = nodeFilter ? ordered.filter((event) => event.nodeId === nodeFilter) : ordered;
    if (scope === "all") return scoped;
    const important = scoped.filter(isImportantTimelineEvent);
    return important.length > 0 ? important : scoped;
  }, [ordered, scope, nodeFilter]);

  const effectiveSelectedId = visible.some((event) => event.id === selectedId)
    ? selectedId
    : visible.at(-1)?.id ?? null;
  const selected = visible.find((event) => event.id === effectiveSelectedId);
  const nodeOutcomeLookup = useMemo(() => buildNodeOutcomeLookup(ordered), [ordered]);
  const normalized = useMemo(
    () => (selected ? normalizePayload(hydrateTruncatedPayload(selected.payload, nodeOutcomeLookup)) : null),
    [selected, nodeOutcomeLookup],
  );
  const isFailureEvent = Boolean(selected && (selected.type.endsWith("failed") || selected.type === "run.cancelled"));
  const explainedError = useMemo(() => {
    if (!selected || !isFailureEvent) return null;
    const rawError = typeof selected.payload.error === "string" ? selected.payload.error : undefined;
    const code = typeof selected.payload.code === "string" ? selected.payload.code : undefined;
    return explainRunError(rawError, code);
  }, [selected, isFailureEvent]);
  const blockerContext = useMemo(() => {
    if (!selected || !isFailureEvent) return null;
    // Only pull preceding agent report when the failure itself doesn't come from an agent event.
    if (selected.type === "agent.failed") return null;
    return extractLatestAgentBlockerContext(ordered, selected.sequence - 1);
  }, [selected, isFailureEvent, ordered]);

  useEffect(() => {
    const list = listRef.current;
    if (list && followTail.current) list.scrollTop = list.scrollHeight;
  }, [visible.length]);
  const onScroll = () => {
    const list = listRef.current;
    if (!list) return;
    followTail.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  };
  const showBlockerContext = useMemo(() => {
    if (!blockerContext) return null;
    const explainedNorm = normalizeForCompare(explainedError?.explanation);
    const distinctBlockers = blockerContext.blockers.filter(
      (item) => normalizeForCompare(item) && normalizeForCompare(item) !== explainedNorm,
    );
    const mdNorm = normalizeForCompare(blockerContext.formattedMarkdown);
    const blockersJoinedNorm = normalizeForCompare(distinctBlockers.join(" "));
    const showMarkdown =
      Boolean(mdNorm) &&
      mdNorm !== explainedNorm &&
      mdNorm !== blockersJoinedNorm &&
      !distinctBlockers.some((b) => normalizeForCompare(b) === mdNorm);
    if (distinctBlockers.length === 0 && !showMarkdown) return null;
    return {
      ...blockerContext,
      blockers: distinctBlockers,
      showMarkdown,
    };
  }, [blockerContext, explainedError]);

  return <div className="min-w-0 space-y-3">
    {!events.length && <p className="text-sm text-zinc-400">{emptyMessage}</p>}
    {events.length > 0 && (
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-400">
            Showing {visible.length} of {ordered.length} events
          </span>
          {nodeFilter && (
            <button
              type="button"
              onClick={() => onClearNodeFilter?.()}
              className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 font-mono text-[11px] text-indigo-300 transition-colors hover:bg-indigo-500/20"
              title="Clear step filter"
            >
              <span className="max-w-44 truncate">{nodeFilter}</span>
              <X className="h-3 w-3 shrink-0" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5" role="group" aria-label="Timeline filter">
          {(["important", "all"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={scope === mode}
              onClick={() => setScope(mode)}
              className="rounded-md px-2.5 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-100 aria-pressed:bg-indigo-600 aria-pressed:text-white"
            >
              {mode === "important" ? "Key steps" : "All events"}
            </button>
          ))}
        </div>
      </div>
    )}
    {events.length > 0 && visible.length === 0 && nodeFilter && (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-center text-xs text-zinc-400">
        No events recorded for <span className="font-mono text-zinc-200">{nodeFilter}</span>.
      </div>
    )}
    <ol ref={listRef} onScroll={onScroll} className="max-h-80 space-y-2 overflow-y-auto overflow-x-hidden pr-1" aria-label="Execution timeline">
      {visible.map((event) => {
        const preview = summarizeEventPreview(event);
        const fullIndex = ordered.findIndex((candidate) => candidate.id === event.id);
        const dur = durationFor(event, ordered, fullIndex);
        return (
          <li key={event.id} className="min-w-0">
            <button
              type="button"
              aria-pressed={event.id === effectiveSelectedId}
              onClick={() => setSelectedId(event.id)}
              className="w-full min-w-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-left text-xs transition-colors hover:border-indigo-500/50 focus-visible:outline-2 focus-visible:outline-indigo-400 aria-pressed:border-indigo-500/70 aria-pressed:bg-indigo-950/25"
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate font-medium ${event.type.endsWith("failed") || event.type === "run.cancelled" ? "text-red-300" : event.type.endsWith("completed") ? "text-emerald-300" : event.type.includes("requested") || event.type === "run.paused" ? "text-amber-300" : "text-zinc-100"}`}>
                  {humanizeEventLabel(event.type)}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-zinc-500">#{event.sequence}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
                <time dateTime={event.timestamp}>{formatDateTime(event.timestamp)}</time>
                <span aria-hidden="true">·</span>
                <span>{eventStatus(event.type)}{dur ? ` · ${dur}` : ""}</span>
              </div>
              {event.nodeId && (
                <span className="mt-1 block truncate font-mono text-[11px] text-zinc-400" title={`${event.nodeId}${event.agentId ? ` · ${event.agentId}` : ""}`}>
                  Step: {event.nodeId}{event.agentId ? ` · Agent: ${event.agentId}` : ""}{event.toolId ? ` · Tool: ${event.toolId}` : ""}
                </span>
              )}
              {preview && <span dir="auto" className="mt-1.5 block truncate text-zinc-200">{preview}</span>}
            </button>
          </li>
        );
      })}
    </ol>
    {selected && <section className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3.5" aria-label="Event detail">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-zinc-100">{humanizeEventLabel(selected.type)}</h3>
          <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{selected.type}</span>
          <span className="font-mono text-[10px] text-zinc-500">#{selected.sequence}</span>
        </div>
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5" role="group" aria-label="Payload view">
          {(["readable", "raw"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={detailView === mode}
              onClick={() => setDetailView(mode)}
              className="rounded-md px-2 py-0.5 text-[11px] font-medium capitalize text-zinc-400 transition-colors hover:text-zinc-100 aria-pressed:bg-zinc-800 aria-pressed:text-zinc-100"
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs text-zinc-300">
        {Object.entries({
          Timestamp: formatDateTime(selected.timestamp), Run: selected.runId, Step: selected.nodeId, Agent: selected.agentId, Tool: selected.toolId,
          Duration: typeof selected.payload.durationMs === "number" && Number.isFinite(selected.payload.durationMs) ? formatDurationMs(selected.payload.durationMs) : undefined,
        }).map(([label, value]) => value !== undefined && (
          <div key={label} className="contents">
            <dt className="text-zinc-500">{label}</dt>
            <dd className={label === "Run" || label === "Step" || label === "Agent" || label === "Tool" ? "font-mono text-[11px] break-all" : "break-words"}>
              {String(value)}
            </dd>
          </div>
        ))}
      </dl>
      {detailView === "readable" && normalized ? (
        <div className="mt-3 space-y-3">
          {explainedError && (
            <div className="space-y-2 rounded-lg border border-red-800/50 bg-red-950/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold text-red-200">{explainedError.title}</p>
                {explainedError.code && (
                  <span className="rounded border border-red-800/70 bg-red-950/60 px-1.5 py-0.5 font-mono text-[10px] text-red-200">
                    {explainedError.code}
                  </span>
                )}
              </div>
              <pre dir="auto" className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-950/60 p-2.5 font-mono text-xs leading-relaxed text-red-100">
                {explainedError.explanation}
              </pre>
              {explainedError.hint && <p dir="auto" className="text-xs text-amber-200/90">{explainedError.hint}</p>}
            </div>
          )}
          {showBlockerContext && (
            <div className="space-y-2 rounded-lg border border-amber-800/50 bg-zinc-950/80 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                Reason reported by {showBlockerContext.nodeId ?? "previous agent"} (#{showBlockerContext.sequence})
              </p>
              {showBlockerContext.blockers.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-100">
                  {showBlockerContext.blockers.map((item, idx) => (
                    <li key={idx} dir="auto" className="break-words">{item}</li>
                  ))}
                </ul>
              )}
              {showBlockerContext.showMarkdown && (
                <ReadableContent text={showBlockerContext.formattedMarkdown} />
              )}
            </div>
          )}
          {normalized.sections
            .filter((section) => !(explainedError && section.label.toLowerCase() === "error"))
            .map((section) => (
              <div key={section.label}>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">{section.label}</p>
                <ReadableContent text={section.text} />
              </div>
            ))}
          {normalized.meta && Object.keys(normalized.meta).length > 0 && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-500">Details</p>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border border-zinc-800/80 bg-zinc-950/80 p-3 text-xs">
                {Object.entries(normalized.meta).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="font-medium text-zinc-400">{humanizeKey(key)}</dt>
                    <dd dir="auto" className="break-words text-zinc-200">{formatMetaCell(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {!explainedError && normalized.sections.length === 0 && !normalized.meta && (
            <p className="text-xs text-zinc-500">No payload fields.</p>
          )}
        </div>
      ) : (
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800/80 bg-zinc-950/80 p-3 font-mono text-xs text-zinc-300">{JSON.stringify(selected.payload, null, 2)}</pre>
      )}
    </section>}
  </div>;
}

function eventStatus(type: string): string {
  if (type.endsWith("failed") || type === "run.cancelled") return "Failed / cancelled";
  if (type.endsWith("completed")) return "Completed";
  if (type.endsWith("started")) return "Running";
  if (type.includes("requested") || type === "run.paused") return "Waiting";
  return "Recorded";
}

function formatDurationMs(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  const totalSeconds = milliseconds / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function durationFor(event: RunEvent, events: RunEvent[], index: number): string | undefined {
  const raw = event.payload.durationMs;
  const milliseconds = typeof raw === "number" && Number.isFinite(raw) ? raw : (() => {
    if (index < 0 || (!event.type.endsWith("completed") && !event.type.endsWith("failed"))) return undefined;
    const start = [...events.slice(0, index)].reverse().find((candidate) => candidate.type === event.type.replace(/completed$|failed$/, "started") && candidate.nodeId === event.nodeId && candidate.agentId === event.agentId);
    if (!start) return undefined;
    const value = Date.parse(event.timestamp) - Date.parse(start.timestamp);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  })();
  return milliseconds === undefined ? undefined : formatDurationMs(milliseconds);
}

const TEXT_KEYS = ["content", "output", "error", "message", "text", "log", "stdout", "stderr", "summary", "thoughts", "outcome", "result", "data", "nodeOutcomes", "handoffs"] as const;
const META_SKIP = new Set(["durationMs", ...TEXT_KEYS]);

type NormalizedPayload = {
  sections: Array<{ label: string; text: string }>;
  meta: Record<string, unknown> | null;
};

/** Pull nested log/output strings AND structured agent objects out of JSON so they render as readable prose. */
function normalizePayload(payload: Record<string, unknown>): NormalizedPayload {
  const sections: Array<{ label: string; text: string }> = [];
  const used = new Set<string>();

  for (const key of TEXT_KEYS) {
    if (!(key in payload)) continue;
    const label = key === "thoughts" ? "Thinking" : humanizeKey(key);
    const extracted = extractReadableSection(payload[key], label);
    if (!extracted) continue;
    sections.push(extracted);
    used.add(key);
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
    const fallback = formatAnyValueForReading(payload);
    if (fallback) sections.push({ label: "Payload", text: fallback });
  }

  return { sections, meta: Object.keys(meta).length ? meta : null };
}

function extractReadableSection(value: unknown, label: string): { label: string; text: string } | null {
  if (typeof value === "string") {
    const text = decodeEscapedNewlines(value).trim();
    return text ? { label, text } : null;
  }
  if (isRecord(value)) {
    const formatted = formatAnyValueForReading(value).trim();
    return formatted ? { label, text: formatted } : null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const formatted = formatAnyValueForReading(value).trim();
    return formatted ? { label, text: formatted } : null;
  }
  return null;
}

function formatMetaCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return decodeEscapedNewlines(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    if (value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
      return value.join(", ");
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
