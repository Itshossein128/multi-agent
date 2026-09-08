"use client";

import { use, useEffect, useState } from "react";
import { ArrowLeft, Ban, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { RunEvent, WorkflowDefinition } from "@multi-agent/types";
import { useRunStore } from "@/store/useRunStore";
import { runService } from "@/services/runService";
import { Button } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/runs/ExecutionTimeline";

export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const router = useRouter();
  const run = useRunStore((state) => state.run);
  const events = useRunStore((state) => state.events);
  const status = useRunStore((state) => state.streamStatus);
  const [definition, setDefinition] = useState<WorkflowDefinition | undefined>();
  const load = useRunStore((state) => state.load);
  const attach = useRunStore((state) => state.attach);
  useEffect(() => { void load(runId); const stored = sessionStorage.getItem(`run-definition:${runId}`); if (stored) setDefinition(JSON.parse(stored) as WorkflowDefinition); const close = attach(runId); return close; }, [runId, load, attach]);
  const nodeStatus = new Map<string, RunEvent["type"]>();
  for (const event of events) if (event.nodeId) nodeStatus.set(event.nodeId, event.type);

  return <main className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
    <header className="flex h-14 items-center gap-3 border-b border-zinc-800 px-4">
      <Button variant="ghost" size="icon" onClick={() => router.push("/")}><ArrowLeft className="h-4 w-4" /></Button>
      <div><h1 className="text-sm font-semibold">Run {runId}</h1><p className="text-[10px] uppercase tracking-widest text-zinc-500">{run?.status ?? status}</p></div>
      {run && ["queued", "running", "waiting_for_human"].includes(run.status) && <Button variant="destructive" size="sm" className="ml-auto" onClick={() => void runService.cancelRun(runId)}><Ban className="mr-1.5 h-3.5 w-3.5" />Cancel</Button>}
    </header>
    <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[1.3fr_0.7fr]">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Workflow execution</h2><RuntimeGraph definition={definition} nodeStatus={nodeStatus} /></section>
      <section className="min-h-0 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4"><h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Event timeline</h2><ExecutionTimeline events={events} emptyMessage="Waiting for execution events…" /></section>
    </div>
  </main>;
}

function RuntimeGraph({ definition, nodeStatus }: { definition?: WorkflowDefinition; nodeStatus: Map<string, RunEvent["type"]> }) {
  if (!definition) return <div className="flex h-full min-h-80 items-center justify-center text-xs text-zinc-600">Graph state is represented by the live event stream.</div>;
  return <div className="grid gap-2 sm:grid-cols-2">{definition.nodes.map((node) => <div key={node.id} className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3"><div className="flex items-center gap-2"><EventIcon type={nodeStatus.get(node.id)} /><span className="text-xs font-semibold">{node.type}</span></div><p className="mt-1 truncate text-[10px] text-zinc-600">{node.id}</p></div>)}</div>;
}

function EventIcon({ type }: { type?: string }) {
  if (type?.endsWith("failed") || type === "run.failed") return <XCircle className="h-3.5 w-3.5 text-red-400" />;
  if (type?.endsWith("completed") || type === "run.completed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
  if (type?.endsWith("started") || type === "run.started") return <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />;
  return <Circle className="h-3.5 w-3.5 text-zinc-600" />;
}
