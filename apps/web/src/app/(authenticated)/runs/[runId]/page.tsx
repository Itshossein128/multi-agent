"use client";

import { use, useEffect, useState } from "react";
import { ArrowLeft, Ban, CheckCircle2, Circle, CircleDot, Clock3, Loader2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { RunEvent, RunStatus, WorkflowDefinition } from "@multi-agent/types";
import { useRunStore } from "@/store/useRunStore";
import { runService } from "@/services/runService";
import { Button } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/runs/ExecutionTimeline";
import { ApprovalPanel } from "@/components/runs/ApprovalPanel";

const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "running", "waiting_for_human"];

export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const router = useRouter();
  const run = useRunStore((state) => state.run);
  const events = useRunStore((state) => state.events);
  const approvals = useRunStore((state) => state.approvals);
  const status = useRunStore((state) => state.streamStatus);
  const [definition, setDefinition] = useState<WorkflowDefinition | undefined>();
  const [retrying, setRetrying] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const load = useRunStore((state) => state.load);
  const attach = useRunStore((state) => state.attach);
  useEffect(() => {
    const close = attach(runId);
    void load(runId);
    void runService.getRunDefinition(runId)
      .then((snapshot) => setDefinition(snapshot.workflow))
      .catch(() => {
        const stored = sessionStorage.getItem(`run-definition:${runId}`);
        if (stored) setDefinition(JSON.parse(stored) as WorkflowDefinition);
      });
    return close;
  }, [runId, load, attach]);
  const nodeStatus = new Map<string, RunEvent["type"]>();
  for (const event of events) if (event.nodeId) nodeStatus.set(event.nodeId, event.type);
  const traversedEdges = new Set(events.filter((event) => event.type === "edge.traversed" && typeof event.payload.edgeId === "string").map((event) => String(event.payload.edgeId)));
  const runActive = !!run && ACTIVE_RUN_STATUSES.includes(run.status);

  return <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
    <header className="flex h-14 items-center gap-3 border-b border-zinc-800 px-4">
      <Button variant="ghost" size="icon" onClick={() => router.push("/runs")}><ArrowLeft className="h-4 w-4" /></Button>
      <div><h1 className="text-sm font-semibold">Run {runId}</h1><p className="text-[10px] uppercase tracking-widest text-zinc-500">{run?.status ?? status}</p></div>
      <div className="ml-auto flex items-center gap-2">
        {(run?.status === "failed" || run?.status === "cancelled") && <Button variant="outline" size="sm" disabled={retrying} onClick={async () => {
          setRetrying(true); setControlError(null);
          try { const retried = await runService.retryRun(runId); router.push(`/runs/${encodeURIComponent(retried.runId)}`); }
          catch (error) { setControlError(error instanceof Error ? error.message : "Unable to retry run."); setRetrying(false); }
        }}>{retrying ? "Retrying…" : "Retry run"}</Button>}
        {runActive && <Button variant="destructive" size="sm" onClick={() => void runService.cancelRun(runId)}><Ban className="mr-1.5 h-3.5 w-3.5" />Cancel</Button>}
      </div>
    </header>
    {controlError && <p role="alert" className="px-4 pt-3 text-sm text-red-300">{controlError}</p>}
    {approvals.some((approval) => approval.status === "requested") && <div className="p-4 pb-0"><ApprovalPanel runId={runId} approvals={approvals} /></div>}
    <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1.3fr_0.7fr]">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Workflow execution</h2><RuntimeGraph definition={definition} nodeStatus={nodeStatus} traversedEdges={traversedEdges} runActive={runActive} /></section>
      <section className="min-h-0 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Event timeline</h2><ExecutionTimeline events={events} emptyMessage="Waiting for execution events…" /></section>
    </div>
  </main>;
}

function RuntimeGraph({ definition, nodeStatus, traversedEdges, runActive }: { definition?: WorkflowDefinition; nodeStatus: Map<string, RunEvent["type"]>; traversedEdges: Set<string>; runActive: boolean }) {
  if (!definition) return <div className="flex h-full min-h-80 items-center justify-center text-xs text-zinc-600">Graph state is represented by the live event stream.</div>;
  return <div className="space-y-4"><div className="grid gap-2 sm:grid-cols-2">{definition.nodes.map((node) => <div key={node.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3"><div className="flex items-center gap-2"><EventIcon type={nodeStatus.get(node.id)} runActive={runActive} /><span className="text-xs font-semibold">{node.type}</span></div><p className="mt-1 truncate text-[10px] text-zinc-600">{node.id}</p></div>)}</div>{definition.edges.length > 0 && <div className="space-y-1 border-t border-zinc-800 pt-3"><p className="text-[10px] uppercase tracking-wider text-zinc-500">Edges</p>{definition.edges.map((edge) => <div key={edge.id} className={traversedEdges.has(edge.id) ? "rounded border border-indigo-500/60 bg-indigo-950/30 px-2 py-1 text-[11px] text-indigo-200" : "rounded border border-zinc-800 px-2 py-1 text-[11px] text-zinc-500"}>{edge.source} → {edge.target}{edge.branchKey ? ` · ${edge.branchKey}` : ""}</div>)}</div>}</div>;
}

function EventIcon({ type, runActive }: { type?: string; runActive: boolean }) {
  if (type?.endsWith("failed") || type === "run.failed" || type === "run.cancelled") return <XCircle className="h-3.5 w-3.5 text-red-400" />;
  if (type?.includes("approval.requested") || type === "run.paused") return <Clock3 className="h-3.5 w-3.5 text-amber-300" />;
  if (type?.endsWith("completed") || type === "run.completed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (type?.endsWith("started") || type === "run.started") {
    // Only spin while the run is actually in progress; a stale "started" after
    // failure/cancel/timeout should not look like live work.
    if (runActive) return <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />;
    return <CircleDot className="h-3.5 w-3.5 text-amber-400" />;
  }
  return <Circle className="h-3.5 w-3.5 text-zinc-600" />;
}
