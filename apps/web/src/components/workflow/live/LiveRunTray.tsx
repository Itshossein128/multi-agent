"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { WorkflowDefinition } from "@multi-agent/types";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useOrgPath } from "@/components/organization/OrgProvider";
import { useRunStore } from "@/store/useRunStore";
import { runService } from "@/services/runService";
import { buildLiveRunTrayModel } from "@/lib/liveRunTray";
import { explainRunError, extractLatestAgentBlockerContext, formatAnyValueForReading, summarizeEventPreview } from "@/lib/readableAgentText";
import { ReadableContent } from "@/components/runs/ReadableContent";
import type { LiveTrayEventFilter } from "./liveCanvas.types";

export interface LiveRunTrayProps {
  runId: string;
  definition?: WorkflowDefinition | null;
  onRetarget: (runId: string) => Promise<void> | void;
}

const controlClass = "rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-50";

// Reset pending controls and timer state when retry changes the observation target.
export function LiveRunTray(props: LiveRunTrayProps) {
  return <RunTray key={props.runId} {...props} />;
}

function RunTray({ runId, definition, onRetarget }: LiveRunTrayProps) {
  const orgUrl = useOrgPath();
  const run = useRunStore(state => state.run?.id === runId ? state.run : null);
  const events = useRunStore(state => state.events);
  const streamStatus = useRunStore(state => state.streamStatus);
  const streamError = useRunStore(state => state.error);
  const [collapsed, setCollapsed] = useState(false);
  const [eventFilter, setEventFilter] = useState<LiveTrayEventFilter>("all");
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<"cancel" | "retry" | "restart" | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionPending = useRef(false);
  const retriedRunId = useRef<string | null>(null);
  const mounted = useRef(true);
  const feedId = useId();
  const active = !!run && ["queued", "running", "waiting_for_human"].includes(run.status);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const model = useMemo(() => buildLiveRunTrayModel({ runId, run, events, definition, streamStatus, now, collapsed, eventFilter }), [runId, run, events, definition, streamStatus, now, collapsed, eventFilter]);
  async function control(action: "cancel" | "retry" | "restart") {
    const currentRun = useRunStore.getState().run;
    if (actionPending.current || currentRun?.id !== runId) return;
    if (action === "cancel" && (!["queued", "running", "waiting_for_human"].includes(currentRun.status) || cancelRequested)) return;
    if ((action === "retry" || action === "restart") && currentRun.status !== "failed" && currentRun.status !== "cancelled") return;
    actionPending.current = true;
    setPending(action); setError(null);
    try {
      if (action === "cancel") {
        await runService.cancelRun(runId);
        if (mounted.current) setCancelRequested(true);
      } else {
        // If attachment fails after creation, reattach the same new run on retry.
        retriedRunId.current ??= (
          action === "restart" ? await runService.retryRun(runId, "restart") : await runService.retryRun(runId)
        ).runId;
        if (mounted.current) await onRetarget(retriedRunId.current);
      }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      actionPending.current = false;
      if (mounted.current) setPending(null);
    }
  }
  const seconds = Math.floor(model.elapsedMs / 1000);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <section aria-label="Live run controls" className="flex-shrink-0 border-t border-zinc-700 bg-zinc-950 text-zinc-200">
    <header className="flex flex-wrap items-center gap-3 px-3 py-2">
      <button type="button" aria-label={collapsed ? "Expand run timeline" : "Collapse run timeline"} aria-expanded={!collapsed} aria-controls={feedId} className={controlClass} onClick={() => setCollapsed(value => !value)}>
        {collapsed ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronDown aria-hidden="true" className="h-4 w-4" />}
      </button>
      <span className="max-w-48 truncate text-xs text-zinc-400" title={runId}>Run {runId}</span>
      <span role="status" className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-semibold">{run ? model.status : "Loading run…"}</span>
      {typeof run?.metadata?.resumedFromCheckpointId === "string" && (
        <span
          className="rounded border border-emerald-700/60 bg-emerald-950/40 px-2 py-0.5 text-[11px] font-medium text-emerald-300"
          title={`Resumed from checkpoint ${run.metadata.resumedFromCheckpointId}`}
        >
          Resumed from checkpoint
        </span>
      )}
      <span className="text-xs text-zinc-300">Elapsed {elapsed}</span>
      <span className="text-xs text-zinc-300">Step {model.stepCurrent} / {model.stepMax}</span>
      <span className={model.streamStatus === "error" ? "text-xs text-amber-300" : "text-xs text-zinc-400"}>Stream: {model.streamStatus}</span>
      <span className="text-[11px] text-indigo-300">Tip: Click any node on canvas to inspect its logs & output</span>
      <div className="ml-auto flex items-center gap-2">
        <Link
          href={orgUrl(`/runs/${encodeURIComponent(runId)}`)}
          className="inline-flex items-center gap-1 rounded border border-indigo-500/60 bg-indigo-950/50 px-2.5 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-900/60"
        >
          <span>Full Run Logs & Result</span>
          <ExternalLink aria-hidden="true" className="h-3 w-3" />
        </Link>
        {model.canCancel && <button type="button" className={controlClass} disabled={pending !== null || cancelRequested} onClick={() => void control("cancel")}>{pending === "cancel" ? "Cancelling…" : cancelRequested ? "Cancel requested" : "Cancel"}</button>}
        {model.canRetry && (
          <>
            <button
              type="button"
              className={controlClass}
              disabled={pending !== null}
              title="Resume from the last saved checkpoint with current workflow & agent settings"
              onClick={() => void control("retry")}
            >
              {pending === "retry" ? "Retrying…" : "Retry"}
            </button>
            <button
              type="button"
              className={controlClass}
              disabled={pending !== null}
              title="Restart the workflow from the beginning"
              onClick={() => void control("restart")}
            >
              {pending === "restart" ? "Restarting…" : "Restart"}
            </button>
          </>
        )}
      </div>
    </header>
    {(error || streamError) && <p role="alert" className="px-3 pb-2 text-xs text-red-300">{error ?? streamError}</p>}
    {model.streamStatus === "error" && <p role="status" className="px-3 pb-2 text-xs text-amber-300">Connection interrupted. Showing the last recorded state while the event stream reconnects.</p>}
    {!collapsed && <div id={feedId} className="border-t border-zinc-800 px-3 py-2">
      {run?.error && (() => {
        const explained = explainRunError(run.error, run.result?.error?.code);
        const blocker = extractLatestAgentBlockerContext(events);
        return (
          <div className="mb-2 rounded-lg border border-red-800/60 bg-red-950/20 p-2.5 text-xs">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-red-200">{explained.title}</span>
              {explained.code && (
                <span className="rounded bg-red-950/70 px-1.5 py-0.5 font-mono text-[10px] text-red-300">{explained.code}</span>
              )}
            </div>
            <p dir="auto" className="text-red-100">{explained.explanation}</p>
            {blocker && blocker.blockers.length > 0 && (
              <p dir="auto" className="mt-1 text-amber-200">
                <strong className="font-semibold">Blocker ({blocker.nodeId ?? "agent"}):</strong> {blocker.blockers[0]}
              </p>
            )}
          </div>
        );
      })()}
      {run?.output !== undefined && run.output !== null && (
        <div className="mb-2 rounded-lg border border-emerald-800/60 bg-emerald-950/20 p-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">Final Run Result</span>
            <Link href={orgUrl(`/runs/${encodeURIComponent(runId)}`)} className="text-[11px] text-indigo-300 hover:underline">
              Open detailed timeline →
            </Link>
          </div>
          <div className="max-h-32 overflow-y-auto text-xs">
            <ReadableContent text={formatAnyValueForReading(run.output)} />
          </div>
        </div>
      )}
      <div className="mb-2 flex gap-2" role="group" aria-label="Timeline event filter">
        {(["all", "node", "error", "tool"] as const).map(filter => <button key={filter} type="button" className={controlClass} aria-pressed={eventFilter === filter} onClick={() => setEventFilter(filter)}>{filter[0].toUpperCase() + filter.slice(1)}</button>)}
      </div>
      <ol aria-label="Run events" className="max-h-36 space-y-1 overflow-y-auto text-xs">
        {model.events.slice(-100).map(event => {
          const preview = summarizeEventPreview(event);
          return (
            <li key={event.id} className="flex flex-wrap gap-x-3 rounded bg-zinc-900/50 px-2 py-1">
              <span className="font-medium text-zinc-200">{event.type}</span>
              <span className="truncate text-zinc-400">{event.nodeId ?? event.toolId ?? ""}</span>
              {typeof event.payload.error === "string"
                ? <span dir="auto" className="text-red-300">{explainRunError(event.payload.error, typeof event.payload.code === "string" ? event.payload.code : undefined).explanation}</span>
                : preview && <span dir="auto" className="truncate text-zinc-300">{preview}</span>}
            </li>
          );
        })}
      </ol>
      {model.events.length === 0 && <p className="text-xs text-zinc-400">No matching events recorded.</p>}
      {model.events.length > 100 && <p className="mt-1 text-xs text-zinc-400">Showing the latest 100 matching events.</p>}
    </div>}
  </section>;
}
