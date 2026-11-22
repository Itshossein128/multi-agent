"use client";

import { useOrgPath, useOrg } from "@/components/organization/OrgProvider";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Activity, RotateCcw } from "lucide-react";
import type { RunStatus } from "@multi-agent/types";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { runService } from "@/services/runService";
import { formatDateTime } from "@/lib/formatDateTime";

const STATUSES: Array<RunStatus | ""> = ["", "queued", "running", "waiting_for_human", "completed", "failed", "cancelled"];

function runStatusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/30 bg-emerald-950/30 text-emerald-400";
    case "failed":
      return "border-red-500/30 bg-red-950/30 text-red-400";
    case "running":
      return "border-blue-500/30 bg-blue-950/30 text-blue-400";
    case "waiting_for_human":
      return "border-amber-500/30 bg-amber-950/30 text-amber-400";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }
}

function initialStatus(value: string | null): RunStatus | "" {
  return STATUSES.includes(value as RunStatus) ? (value as RunStatus) : "";
}

function RunsHistoryContent() {
  const orgUrl = useOrgPath();
  const { org } = useOrg();
  const searchParams = useSearchParams();
  const [workflowId, setWorkflowId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [status, setStatus] = useState<RunStatus | "">(() => initialStatus(searchParams.get("status")));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const hasActiveFilters = Boolean(workflowId.trim() || taskId.trim() || status || from || to);

  const resetFilters = () => {
    setWorkflowId("");
    setTaskId("");
    setStatus("");
    setFrom("");
    setTo("");
  };

  const filters = useMemo(() => ({
    workflowId: workflowId.trim() || undefined,
    taskId: taskId.trim() || undefined,
    status: status || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  }), [workflowId, taskId, status, from, to]);

  const runs = useQuery({
    queryKey: ["org", org.id, "runs", filters],
    queryFn: () => runService.listRuns(filters),
    refetchInterval: 5000,
  });

  return (
    <PageContainer>
      {/* Header managed by layout */}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-5">
          <label className="space-y-1 text-xs font-medium text-zinc-400">
            <span>Workflow id</span>
            <input
              placeholder="e.g. wf-..."
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-zinc-400">
            <span>Task id</span>
            <input
              placeholder="e.g. task-..."
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-zinc-400">
            <span>Status</span>
            <select
              className="studio-select h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={status}
              onChange={(e) => setStatus(e.target.value as RunStatus | "")}
            >
              {STATUSES.map((item) => <option key={item || "all"} value={item}>{item || "All"}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-zinc-400">
            <span>From</span>
            <input
              type="datetime-local"
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-zinc-400">
            <span>To</span>
            <input
              type="datetime-local"
              className="h-9 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
        {hasActiveFilters && (
          <div className="flex justify-end border-t border-zinc-800/80 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-7 gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Clear filters
            </Button>
          </div>
        )}
      </section>

      <section>
        {runs.isLoading && <p className="text-sm text-zinc-500">Loading runs…</p>}
        {runs.error && <p role="alert" className="text-sm text-red-300">{(runs.error as Error).message}</p>}
        {!runs.isLoading && !runs.data?.length && (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 px-6 py-10 text-center">
            <Activity className="mx-auto mb-2 h-6 w-6 text-zinc-500" aria-hidden="true" />
            <p className="text-sm text-zinc-400">No runs match these filters.</p>
          </div>
        )}
        <ul className="space-y-2">
          {runs.data?.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition-colors hover:border-zinc-700">
              <div className="min-w-0 flex-1">
                <Link href={orgUrl(`/runs/${encodeURIComponent(run.id)}`)} className="text-sm font-medium text-indigo-300 hover:underline">{run.id}</Link>
                <p className="text-[11px] text-zinc-500">{run.workflowId}{run.taskId ? ` · task ${run.taskId}` : ""} · {formatDateTime(run.startedAt)}</p>
              </div>
              <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${runStatusBadgeClass(run.status)}`}>{run.status}</span>
              <Link href={orgUrl(`/runs/${encodeURIComponent(run.id)}`)} className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800">Open</Link>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}

export default function RunsHistoryPage() {
  return (
    <Suspense fallback={<PageContainer className="text-sm text-zinc-500">Loading runs…</PageContainer>}>
      <RunsHistoryContent />
    </Suspense>
  );
}
