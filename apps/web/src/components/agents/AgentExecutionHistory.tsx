"use client";

import { useId, useState } from "react";
import { ArrowUpRight, History, RefreshCw } from "lucide-react";
import type { Run } from "@multi-agent/types";
import { Button } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/runs/ExecutionTimeline";
import { useAgentRunEvents } from "@/hooks/useAgentDetail";
import { runDuration } from "@/lib/agentConfiguration";
import { formatDateTime } from "@/lib/formatDateTime";
import { Section } from "./AgentFields";

function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 [html[data-appearance='light']_&]:text-emerald-700";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-300 [html[data-appearance='light']_&]:text-red-700";
    case "running":
    case "queued":
      return "border-indigo-500/30 bg-indigo-500/10 text-indigo-300";
    case "waiting_for_human":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300 [html[data-appearance='light']_&]:text-amber-700";
    default:
      return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }
}

export function AgentExecutionHistory({
  agentId,
  runs,
  navigate,
}: {
  agentId: string;
  runs: Run[];
  navigate: (url: string) => void;
}) {
  const captionId = useId();
  const [selection, setSelection] = useState<string | null>(null);
  const runId = runs.find((run) => run.id === selection)?.id ?? runs[0]?.id ?? null;
  const events = useAgentRunEvents(agentId, runId);
  const run = runs.find((run) => run.id === runId);

  // These values come from recorded executor events, never from today's agent configuration.
  const started = events.data?.find((event) => event.type === "agent.started");
  const nodes = [...new Set(events.data?.map((event) => event.nodeId).filter(Boolean))];
  const errors = events.data?.filter((event) => event.type.endsWith("failed")) ?? [];
  const traceUrl =
    typeof run?.metadata.traceUrl === "string" && /^https?:\/\//i.test(run.metadata.traceUrl)
      ? run.metadata.traceUrl
      : null;

  return (
    <Section
      title="Executions"
      description="Real runs involving this agent. Select any run row to inspect recorded execution events and node telemetry."
    >
      {!runs.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center">
          <History className="mb-2 h-5 w-5 text-zinc-500" aria-hidden="true" />
          <p className="text-sm text-zinc-300">No recorded executions for this agent.</p>
          <p className="mt-1 text-xs text-zinc-500">
            Run a test or trigger a workflow using this agent to inspect execution logs here.
          </p>
        </div>
      ) : (
        <div
          tabIndex={0}
          role="region"
          aria-labelledby={captionId}
          className="agent-table-wrapper rounded-lg border border-zinc-800/80"
        >
          <table className="w-full text-left text-sm">
            <caption id={captionId} className="sr-only">
              Runs involving this agent
            </caption>
            <thead className="bg-zinc-900/95 text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                {["Run", "Workflow", "Run status", "Started", "Run duration"].map((label) => (
                  <th key={label} scope="col" className="border-b border-zinc-800 px-3 py-2.5 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {runs.map((item) => {
                const selected = item.id === runId;
                return (
                  <tr
                    key={item.id}
                    className={
                      selected
                        ? "bg-indigo-500/10"
                        : "transition-colors hover:bg-zinc-900/50"
                    }
                  >
                    <td data-label="Run" className="px-3 py-2">
                      <button
                        type="button"
                        className="inline-flex min-h-7 items-center rounded font-mono text-xs text-indigo-300 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-pressed={selected}
                        onClick={() => setSelection(item.id)}
                      >
                        {item.id}
                      </button>
                    </td>
                    <td data-label="Workflow" className="px-3 py-2 font-mono text-xs text-zinc-300">
                      {item.workflowId}
                    </td>
                    <td data-label="Run status" className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusBadgeClass(item.status)}`}
                      >
                        {item.status.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td data-label="Started" className="whitespace-nowrap px-3 py-2 text-xs text-zinc-300">
                      {formatDateTime(item.startedAt)}
                    </td>
                    <td data-label="Run duration" className="px-3 py-2 font-mono text-xs text-zinc-300">
                      {runDuration(item.startedAt, item.completedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {run ? (
        <div className="space-y-4 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-zinc-400">Inspecting:</span>
              <span className="font-mono text-xs font-semibold text-zinc-100">{run.id}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate(`/runs/${encodeURIComponent(run.id)}`)}
                className="gap-1.5 text-xs"
              >
                <span>Open run</span>
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void events.refetch()}
                className="gap-1.5 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Refresh events</span>
              </Button>
              {traceUrl ? (
                <a
                  className="inline-flex min-h-8 items-center gap-1 rounded px-2 text-xs font-medium text-indigo-300 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  href={traceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View Trace
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>

          {events.isPending ? (
            <p role="status" className="text-xs text-zinc-400">
              Loading events…
            </p>
          ) : null}
          {events.isError ? (
            <p
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
            >
              Could not load events: {events.error.message}
            </p>
          ) : null}

          {events.data ? (
            <>
              <dl className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-zinc-500">Recorded provider</dt>
                  <dd className="mt-0.5 font-mono text-zinc-200">
                    {typeof started?.payload.provider === "string"
                      ? started.payload.provider
                      : "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Recorded model</dt>
                  <dd className="mt-0.5 font-mono text-zinc-200">
                    {typeof started?.payload.model === "string"
                      ? started.payload.model
                      : "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Nodes</dt>
                  <dd className="mt-0.5 break-all font-mono text-zinc-200">
                    {nodes.join(", ") || "Not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Recorded tool calls</dt>
                  <dd className="mt-0.5 font-mono text-zinc-200">
                    {events.data.filter((event) => event.type === "tool.started").length}
                  </dd>
                </div>
              </dl>

              <p className="text-xs text-zinc-500">
                A complete backend/configuration version snapshot is not persisted. Current configuration is not used to fill missing history.
              </p>

              {run.error ? (
                <p
                  role="alert"
                  className="break-words rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
                >
                  Run error: {run.error}
                </p>
              ) : null}

              {!errors.length ? (
                <p className="text-xs text-zinc-400">No failed agent events in this run.</p>
              ) : null}

              <ExecutionTimeline
                key={run.id}
                events={events.data}
                emptyMessage="No events attributed to this agent in this run."
              />
            </>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}
