"use client";

import { useState } from "react";
import type { Run } from "@multi-agent/types";
import { Button } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/runs/ExecutionTimeline";
import { useAgentRunEvents } from "@/hooks/useAgentDetail";
import { runDuration } from "@/lib/agentConfiguration";
import { Section } from "./AgentFields";

export function AgentExecutionHistory({ agentId, runs, navigate }: { agentId: string; runs: Run[]; navigate: (url: string) => void }) {
  const [selection, setSelection] = useState<string | null>(null);
  const runId = runs.find((run) => run.id === selection)?.id ?? runs[0]?.id ?? null;
  const events = useAgentRunEvents(agentId, runId);
  const run = runs.find((run) => run.id === runId);
  // These values come from recorded executor events, never from today's agent configuration.
  const started = events.data?.find((event) => event.type === "agent.started");
  const nodes = [...new Set(events.data?.map((event) => event.nodeId).filter(Boolean))];
  const errors = events.data?.filter((event) => event.type.endsWith("failed")) ?? [];
  const traceUrl = typeof run?.metadata.traceUrl === "string" && /^https?:\/\//i.test(run.metadata.traceUrl) ? run.metadata.traceUrl : null;
  return <Section title="Executions">
    <p className="text-sm text-zinc-400">Real runs involving this agent. History is persisted by the execution server when Studio Postgres is configured.</p>
    {!runs.length && <p className="text-sm text-zinc-400">No recorded executions for this agent.</p>}
    {!!runs.length && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Runs involving this agent</caption>
      <thead className="text-zinc-400"><tr>{["Run", "Workflow", "Run status", "Started", "Run duration"].map((label) => <th key={label} className="p-2 font-medium">{label}</th>)}</tr></thead>
      <tbody>{runs.map((item) => <tr key={item.id} className={item.id === runId ? "bg-indigo-950/40" : "border-t border-zinc-800"}>
        <td className="p-2"><button className="text-indigo-300 underline underline-offset-4" aria-pressed={item.id === runId} onClick={() => setSelection(item.id)}>{item.id}</button></td>
        <td className="p-2">{item.workflowId}</td><td className="p-2">{item.status}</td><td className="whitespace-nowrap p-2">{item.startedAt}</td><td className="p-2">{runDuration(item.startedAt, item.completedAt)}</td>
      </tr>)}</tbody>
    </table></div>}
    {run && <div className="space-y-4 border-t border-zinc-800 pt-4">
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" onClick={() => navigate(`/runs/${encodeURIComponent(run.id)}`)}>Open run</Button><Button variant="outline" size="sm" onClick={() => void events.refetch()}>Refresh events</Button>
        {traceUrl && <a className="text-sm text-indigo-300 underline" href={traceUrl} target="_blank" rel="noreferrer">View Trace</a>}
      </div>
      {events.isPending && <p role="status">Loading events…</p>}
      {events.isError && <p role="alert" className="text-sm text-red-300">Could not load events: {events.error.message}</p>}
      {events.data && <>
        <dl className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
          <div><dt className="text-zinc-400">Recorded provider</dt><dd>{typeof started?.payload.provider === "string" ? started.payload.provider : "Not recorded"}</dd></div>
          <div><dt className="text-zinc-400">Recorded model</dt><dd>{typeof started?.payload.model === "string" ? started.payload.model : "Not recorded"}</dd></div>
          <div><dt className="text-zinc-400">Nodes</dt><dd className="break-all">{nodes.join(", ") || "Not recorded"}</dd></div>
          <div><dt className="text-zinc-400">Recorded tool calls</dt><dd>{events.data.filter((event) => event.type === "tool.started").length}</dd></div>
        </dl>
        <p className="text-xs text-zinc-400">A complete backend/configuration version snapshot is not persisted. Current configuration is not used to fill missing history.</p>
        {run.error && <p className="break-words text-sm text-red-300">Run error: {run.error}</p>}
        {!errors.length && <p className="text-sm text-zinc-400">No failed agent events in this run.</p>}
        <ExecutionTimeline key={run.id} events={events.data} emptyMessage="No events attributed to this agent in this run." />
      </>}
    </div>}
  </Section>;
}
