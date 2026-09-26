"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import type { RunStatus } from "@multi-agent/types";
import { runService } from "@/services/runService";
import { formatDateTime } from "@/lib/formatDateTime";

const STATUSES: Array<RunStatus | ""> = ["", "queued", "running", "waiting_for_human", "completed", "failed", "cancelled"];

function initialStatus(value: string | null): RunStatus | "" {
  return STATUSES.includes(value as RunStatus) ? (value as RunStatus) : "";
}

function RunsHistoryContent() {
  const searchParams = useSearchParams();
  const [workflowId, setWorkflowId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [status, setStatus] = useState<RunStatus | "">(() => initialStatus(searchParams.get("status")));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters = useMemo(() => ({
    workflowId: workflowId.trim() || undefined,
    taskId: taskId.trim() || undefined,
    status: status || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  }), [workflowId, taskId, status, from, to]);

  const runs = useQuery({
    queryKey: ["runs", filters],
    queryFn: () => runService.listRuns(filters),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    staleTime: 2000,
  });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header managed by layout */}

      <section className="grid gap-3 border-b border-zinc-800 p-4 md:grid-cols-5">
        <label className="text-xs text-zinc-400">Workflow id
          <input className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} />
        </label>
        <label className="text-xs text-zinc-400">Task id
          <input className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm" value={taskId} onChange={(e) => setTaskId(e.target.value)} />
        </label>
        <label className="text-xs text-zinc-400">Status
          <select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm" value={status} onChange={(e) => setStatus(e.target.value as RunStatus | "")}>
            {STATUSES.map((item) => <option key={item || "all"} value={item}>{item || "All"}</option>)}
          </select>
        </label>
        <label className="text-xs text-zinc-400">From
          <input type="datetime-local" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-zinc-400">To
          <input type="datetime-local" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </section>

      <section className="p-4">
        {runs.isLoading && <p className="text-sm text-zinc-500">Loading runs…</p>}
        {runs.error && <p role="alert" className="text-sm text-red-300">{(runs.error as Error).message}</p>}
        {!runs.isLoading && !runs.data?.length && <p className="text-sm text-zinc-500">No runs match these filters.</p>}
        <ul className="space-y-2">
          {runs.data?.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <Link href={`/runs/${encodeURIComponent(run.id)}`} className="text-sm font-medium text-indigo-300 underline">{run.id}</Link>
                <p className="text-[11px] text-zinc-500">{run.workflowId}{run.taskId ? ` · task ${run.taskId}` : ""} · {formatDateTime(run.startedAt)}</p>
              </div>
              <span className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-300">{run.status}</span>
              <Link href={`/runs/${encodeURIComponent(run.id)}`} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800">Open</Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function RunsHistoryPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950 p-4 text-sm text-zinc-500">Loading runs…</div>}>
      <RunsHistoryContent />
    </Suspense>
  );
}
