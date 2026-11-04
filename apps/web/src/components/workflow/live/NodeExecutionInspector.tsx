"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { WorkflowNode } from "@multi-agent/types";
import { X } from "lucide-react";
import { useRunStore } from "@/store/useRunStore";
import { buildNodeExecutionView, projectRunCanvas, selectNodeEvents } from "@/lib/runCanvasProjection";
import { ReadableContent } from "@/components/runs/ReadableContent";

function Evidence({ value }: { value: unknown }) {
  if (value === undefined) return <p className="text-xs text-zinc-400">Not available in recorded events.</p>;
  return <ReadableContent text={typeof value === "string" ? value : JSON.stringify(value, null, 2)} />;
}

export function NodeExecutionInspector({ nodeId, node, onClose }: { nodeId: string; node?: WorkflowNode; onClose: () => void }) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const allEvents = useRunStore(useShallow(state => state.events));
  const events = useMemo(() => selectNodeEvents(allEvents, nodeId), [allEvents, nodeId]);
  const stepIndex = useRunStore(state => {
    let index = 0;
    for (const event of state.events) {
      if (event.type !== "node.started") continue;
      index++;
      if (event.nodeId === nodeId) return typeof event.payload.step === "number" ? event.payload.step : index;
    }
    return undefined;
  });
  const run = useRunStore(state => state.run);
  const approvals = useRunStore(useShallow(state => state.approvals.filter(approval => approval.nodeId === nodeId)));
  const view = useMemo(() => buildNodeExecutionView(nodeId, { events, run, approvals }, node), [nodeId, events, run, approvals, node]);
  const topologyHints = useMemo(() => projectRunCanvas({ events: allEvents, run, approvals }).topologyHints, [allEvents, run, approvals]);
  const iteration = topologyHints?.iterationByNodeId?.[nodeId];
  const subgraphFrame = topologyHints?.subgraphFrames?.find((frame) => frame.parentNodeId === nodeId);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  return <aside aria-label="Node execution inspector" aria-labelledby={titleId} className="absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-zinc-700 bg-zinc-950 shadow-2xl">
    <header className="flex items-center justify-between gap-3 border-b border-zinc-800 p-4">
      <div className="min-w-0"><h2 id={titleId} className="text-sm font-semibold text-zinc-100">Node execution inspector</h2><p className="truncate text-xs text-zinc-400" title={nodeId}>{nodeId} · {view.liveStatus}</p></div>
      <button ref={closeRef} type="button" aria-label="Close inspector" onClick={onClose} className="rounded p-2 text-zinc-300 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-indigo-400"><X aria-hidden="true" className="h-4 w-4" /></button>
    </header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      <section><h3 className="mb-2 text-sm font-semibold text-zinc-200">Input</h3><Evidence value={view.input} /></section>
      <section><h3 className="mb-2 text-sm font-semibold text-zinc-200">Timing</h3><dl className="grid grid-cols-2 gap-2 text-xs text-zinc-300">
        <dt>Step</dt><dd>{stepIndex ?? view.stepIndex ?? "Unavailable"}</dd><dt>Starts / retries</dt><dd>{view.attemptCount}</dd>
        <dt>Started</dt><dd>{view.startedAt ?? "Unavailable"}</dd><dt>Completed</dt><dd>{view.completedAt ?? "Unavailable"}</dd><dt>Duration</dt><dd>{view.durationMs === undefined ? "Unavailable" : `${view.durationMs} ms`}</dd>
        {iteration && (<><dt>Loop iteration</dt><dd>{iteration.current}/{iteration.max}{iteration.phase ? ` (${iteration.phase})` : ""}</dd></>)}
        {subgraphFrame && (<><dt>Subgraph</dt><dd>{subgraphFrame.workflowId || "nested"} · depth {subgraphFrame.depth} · {subgraphFrame.status}</dd></>)}
        {topologyHints?.swarmTerminationReason && (<><dt>Swarm</dt><dd>{topologyHints.swarmTerminationReason}</dd></>)}
      </dl></section>
      <section><h3 className="mb-2 text-sm font-semibold text-zinc-200">Stream</h3><Evidence value={view.streamText || undefined} />
        {view.thoughtsText && <details className="mt-2"><summary className="cursor-pointer text-xs text-zinc-300">Published thoughts</summary><Evidence value={view.thoughtsText} /></details>}
      </section>
      <section><h3 className="mb-2 text-sm font-semibold text-zinc-200">Tools</h3>
        {view.toolCalls.length === 0 && <p className="text-xs text-zinc-400">No recorded tool calls.</p>}
        {view.toolCalls.map(call => <details key={call.id} className="mb-2 rounded border border-zinc-800 p-2"><summary className="cursor-pointer text-xs text-zinc-300">{call.toolId ?? call.id} · {call.status}</summary><p className="my-2 text-xs text-zinc-400">Arguments</p><Evidence value={call.arguments} /><p className="my-2 text-xs text-zinc-400">Result</p><Evidence value={call.result} />{call.error && <Evidence value={call.error} />}</details>)}
      </section>
      <section><h3 className="mb-2 text-sm font-semibold text-zinc-200">Result</h3><Evidence value={view.result} /></section>
      <section><h3 className="mb-2 text-sm font-semibold text-zinc-200">Error</h3><Evidence value={view.error} />{view.contractViolation !== undefined && <Evidence value={view.contractViolation} />}</section>
    </div>
  </aside>;
}
