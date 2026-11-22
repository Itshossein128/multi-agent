"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDot,
  Clock3,
  Copy,
  ExternalLink,
  GitBranch,
  Loader2,
  RotateCcw,
  Workflow,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { RunEvent, RunStatus, WorkflowDefinition } from "@multi-agent/types";
import { useOrgPath } from "@/components/organization/OrgProvider";
import { useRunStore } from "@/store/useRunStore";
import { PageContainer } from "@/components/layout/PageContainer";
import { runService } from "@/services/runService";
import { Button } from "@/components/ui/button";
import { ExecutionTimeline } from "@/components/runs/ExecutionTimeline";
import { RunThinkingSection } from "@/components/runs/RunThinkingSection";
import { LiveApprovalBanner } from "@/components/workflow/live/LiveApprovalBanner";
import { ReadableContent } from "@/components/runs/ReadableContent";
import { formatDateTime } from "@/lib/formatDateTime";
import {
  buildNodeOutcomeLookup,
  explainRunError,
  extractLatestAgentBlockerContext,
  formatAnyValueForReading,
  hydrateTruncatedPayload,
} from "@/lib/readableAgentText";

const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "running", "waiting_for_human"];

const NODE_LIFECYCLE_EVENTS = new Set<string>([
  "node.started",
  "node.completed",
  "node.failed",
  "agent.started",
  "agent.completed",
  "agent.failed",
  "approval.requested",
  "fanout.started",
  "fanout.completed",
]);

type NodeFilterMode = "all" | "executed" | "failed";

function normalizeForCompare(value?: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function humanizeNodeId(nodeId: string, config?: Record<string, unknown>): string {
  const configLabel = typeof config?.label === "string" ? config.label.trim() : "";
  if (configLabel) return configLabel;
  return nodeId
    .replace(/^node[-_]/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\bstage(\d+)\b/gi, "Stage $1")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

function formatRunDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return "—";
  const startMs = Date.parse(startedAt);
  const endMs = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return "—";
  const totalSeconds = Math.floor((endMs - startMs) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function extractRunInputSummary(input: unknown): string | null {
  if (typeof input === "string" && input.trim()) return input.trim();
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of ["input", "prompt", "message", "task", "query"]) {
      if (typeof record[key] === "string" && record[key].trim()) {
        return record[key].trim();
      }
    }
    const serialized = JSON.stringify(record);
    if (serialized && serialized !== "{}") return serialized;
  }
  return null;
}

export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const orgUrl = useOrgPath();
  const { runId } = use(params);
  const router = useRouter();
  const run = useRunStore((state) => state.run);
  const events = useRunStore((state) => state.events);
  const approvals = useRunStore((state) => state.approvals);
  const status = useRunStore((state) => state.streamStatus);
  const [definition, setDefinition] = useState<WorkflowDefinition | undefined>();
  const [retrying, setRetrying] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<"id" | "error" | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const load = useRunStore((state) => state.load);
  const attach = useRunStore((state) => state.attach);

  useEffect(() => {
    void load(runId);
    const close = attach(runId);
    void runService.getRunDefinition(runId)
      .then((snapshot) => setDefinition(snapshot.workflow))
      .catch(() => {
        const stored = sessionStorage.getItem(`run-definition:${runId}`);
        if (stored) setDefinition(JSON.parse(stored) as WorkflowDefinition);
      });
    return close;
  }, [runId, load, attach]);

  const nodeStatus = useMemo(() => {
    const map = new Map<string, RunEvent["type"]>();
    const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
    for (const event of ordered) {
      if (event.nodeId && NODE_LIFECYCLE_EVENTS.has(event.type)) {
        map.set(event.nodeId, event.type);
      }
    }
    return map;
  }, [events]);

  const traversedEdges = useMemo(
    () =>
      new Set(
        events
          .filter((event) => event.type === "edge.traversed" && typeof event.payload.edgeId === "string")
          .map((event) => String(event.payload.edgeId)),
      ),
    [events],
  );

  const nodeStats = useMemo(() => {
    const nodes = definition?.nodes ?? [];
    let completed = 0;
    let failed = 0;
    let running = 0;
    for (const node of nodes) {
      const t = nodeStatus.get(node.id);
      if (!t) continue;
      if (t.endsWith("failed") || t === "run.failed" || t === "run.cancelled") failed++;
      else if (t.endsWith("completed")) completed++;
      else if (t.endsWith("started") || t.includes("requested")) running++;
    }
    return {
      total: nodes.length,
      completed,
      failed,
      running,
      executed: completed + failed + running,
    };
  }, [definition, nodeStatus]);

  const runActive = !!run && ACTIVE_RUN_STATUSES.includes(run.status);
  const currentStatus = run?.status ?? status;
  const runInputSummary = useMemo(() => extractRunInputSummary(run?.input), [run?.input]);

  const copyText = (value: string, field: "id" | "error") => {
    void navigator.clipboard?.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 1800);
  };

  return (
    <PageContainer className="flex flex-1 flex-col gap-4 space-y-0">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="breadcrumb text-xs text-zinc-400">
        <ol className="flex flex-wrap items-center">
          <li>
            <Link href={orgUrl("/runs")} className="text-indigo-400 transition-colors hover:text-indigo-300 hover:underline">
              Runs
            </Link>
          </li>
          <li aria-current="page" className="font-mono text-zinc-300">
            {runId}
          </li>
        </ol>
      </nav>

      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 pb-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back to runs"
          title="Back to runs"
          onClick={() => router.push(orgUrl("/runs"))}
          className="shrink-0"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-base font-semibold text-zinc-100">
              {definition?.name ?? `Run ${runId}`}
            </h1>
            <p
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
                currentStatus === "completed"
                  ? "border-emerald-500/30 bg-emerald-950/30 text-emerald-400"
                  : currentStatus === "failed"
                    ? "border-red-500/30 bg-red-950/30 text-red-400"
                    : currentStatus === "running"
                      ? "border-blue-500/30 bg-blue-950/30 text-blue-400"
                      : currentStatus === "waiting_for_human"
                        ? "border-amber-500/30 bg-amber-950/30 text-amber-400"
                        : "border-zinc-700 bg-zinc-900 text-zinc-400"
              }`}
            >
              {currentStatus}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
            <button
              type="button"
              onClick={() => copyText(runId, "id")}
              className="inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/70 px-2 py-0.5 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
              title="Copy run ID"
            >
              <span>{runId}</span>
              {copiedField === "id" ? (
                <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" />
              ) : (
                <Copy className="h-3 w-3 text-zinc-500" aria-hidden="true" />
              )}
            </button>
            {run?.startedAt && (
              <span>Started {formatDateTime(run.startedAt)}</span>
            )}
            {run?.startedAt && (
              <span className="font-mono text-zinc-300">
                Duration: {formatRunDuration(run.startedAt, run.completedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {run?.workflowId && (
            <a
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-indigo-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800"
              href={orgUrl(`/org?${new URLSearchParams({ workflowId: run.workflowId, runId })}`)}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Open on canvas
            </a>
          )}
          {(run?.status === "failed" || run?.status === "cancelled") && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={retrying}
                title="Resume from the last saved checkpoint using current workflow & agent settings"
                onClick={async () => {
                  setRetrying(true);
                  setControlError(null);
                  try {
                    const retried = await runService.retryRun(runId, "resume");
                    router.push(orgUrl(`/runs/${encodeURIComponent(retried.runId)}`));
                  } catch (error) {
                    setControlError(error instanceof Error ? error.message : "Unable to retry run.");
                    setRetrying(false);
                  }
                }}
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {retrying ? "Retrying…" : "Retry run"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={retrying}
                title="Restart the workflow from the very beginning"
                onClick={async () => {
                  setRetrying(true);
                  setControlError(null);
                  try {
                    const retried = await runService.retryRun(runId, "restart");
                    router.push(orgUrl(`/runs/${encodeURIComponent(retried.runId)}`));
                  } catch (error) {
                    setControlError(error instanceof Error ? error.message : "Unable to restart run.");
                    setRetrying(false);
                  }
                }}
              >
                Restart from start
              </Button>
            </>
          )}
          {runActive && (
            <Button variant="destructive" size="sm" onClick={() => void runService.cancelRun(runId)}>
              <Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              Cancel
            </Button>
          )}
        </div>
      </header>

      {/* Run Summary Strip */}
      {run && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Progress</p>
            <p className="mt-1 text-sm font-semibold text-zinc-100">
              {nodeStats.total > 0 ? (
                <>
                  {nodeStats.completed} / {nodeStats.total} steps
                  {nodeStats.failed > 0 && <span className="ml-1.5 text-red-400">· {nodeStats.failed} failed</span>}
                </>
              ) : (
                `${events.length} events`
              )}
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              {run.status === "failed" ? "Stopped at step" : "Current step"}
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-zinc-100" title={run.currentNodeId ?? undefined}>
              {run.currentNodeId ? humanizeNodeId(run.currentNodeId) : "—"}
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Duration</p>
            <p className="mt-1 font-mono text-sm font-semibold text-zinc-100">
              {formatRunDuration(run.startedAt, run.completedAt)}
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">Run input</p>
            <p className="mt-1 truncate text-xs text-zinc-300" title={runInputSummary ?? undefined}>
              {runInputSummary ?? "No input prompt"}
            </p>
          </div>
        </div>
      )}

      {controlError && (
        <p role="alert" className="rounded-lg border border-red-800/50 bg-red-950/20 px-4 py-2.5 text-sm text-red-300">
          {controlError}
        </p>
      )}

      {/* Deduplicated Run Error Banner */}
      {run?.error && (() => {
        const explained = explainRunError(run.error, run.result?.error?.code);
        const blockerCtx = extractLatestAgentBlockerContext(events);
        const explainedNorm = normalizeForCompare(explained.explanation);
        const distinctBlockers = blockerCtx
          ? blockerCtx.blockers.filter((item) => normalizeForCompare(item) && normalizeForCompare(item) !== explainedNorm)
          : [];
        const mdNorm = normalizeForCompare(blockerCtx?.formattedMarkdown);
        const showBlockerMarkdown =
          Boolean(blockerCtx && mdNorm) &&
          mdNorm !== explainedNorm &&
          !distinctBlockers.some((b) => normalizeForCompare(b) === mdNorm);
        const hasDistinctBlockerDetails = distinctBlockers.length > 0 || showBlockerMarkdown;

        return (
          <section
            className="space-y-3 rounded-xl border border-red-800/60 bg-red-950/20 p-4"
            aria-label="Run error"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-red-300">
                  {run.status === "cancelled" ? "Run Cancelled" : explained.title}
                </h2>
                {explained.code && (
                  <span className="rounded border border-red-800/70 bg-red-950/60 px-1.5 py-0.5 font-mono text-[10px] text-red-200">
                    {explained.code}
                  </span>
                )}
                {blockerCtx?.nodeId && (
                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(blockerCtx.nodeId ?? null)}
                    className="rounded border border-amber-500/30 bg-amber-950/30 px-2 py-0.5 font-mono text-[10px] text-amber-300 transition-colors hover:border-amber-400/50"
                    title="Filter timeline to this step"
                  >
                    {blockerCtx.nodeId} · #{blockerCtx.sequence}
                  </button>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                onClick={() => copyText(explained.explanation, "error")}
              >
                {copiedField === "error" ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy error
                  </>
                )}
              </Button>
            </div>

            <pre
              dir="auto"
              className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-red-900/40 bg-zinc-950/65 p-3 font-mono text-xs leading-relaxed text-red-100"
            >
              {explained.explanation}
            </pre>

            {explained.hint && (
              <p dir="auto" className="text-xs text-amber-200/90">
                {explained.hint}
              </p>
            )}

            {blockerCtx && hasDistinctBlockerDetails && (
              <div className="space-y-2 rounded-lg border border-amber-800/50 bg-zinc-950/70 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
                  Details from {blockerCtx.nodeId ?? "latest agent"} (#{blockerCtx.sequence})
                </p>
                {distinctBlockers.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-100">
                    {distinctBlockers.map((item, idx) => (
                      <li key={idx} dir="auto" className="break-words">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {showBlockerMarkdown && <ReadableContent text={blockerCtx.formattedMarkdown} />}
              </div>
            )}
          </section>
        );
      })()}

      {approvals.some((approval) => approval.status === "requested") && (
        <LiveApprovalBanner
          runId={runId}
          variant="inline"
          onAttachRun={(nextId) => router.push(orgUrl(`/runs/${encodeURIComponent(nextId)}`))}
        />
      )}

      {run?.output !== undefined && run.output !== null && (
        <section className="rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-4" aria-label="Final run output">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
            Final Run Result / Agent Output
          </h2>
          <ReadableContent
            text={formatAnyValueForReading(hydrateTruncatedPayload(run.output, buildNodeOutcomeLookup(events)))}
          />
        </section>
      )}

      <RunThinkingSection events={events} run={run} definition={definition} />

      {/* Balanced 2-column execution & timeline layout */}
      <div className="grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <RuntimeGraph
            definition={definition}
            nodeStatus={nodeStatus}
            traversedEdges={traversedEdges}
            runActive={runActive}
            selectedNodeId={selectedNodeId}
            onSelectNode={(nodeId) => setSelectedNodeId((prev) => (prev === nodeId ? null : nodeId))}
          />
        </section>
        <section className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Event timeline
          </h2>
          <ExecutionTimeline
            events={events}
            emptyMessage="Waiting for execution events…"
            nodeFilter={selectedNodeId}
            onClearNodeFilter={() => setSelectedNodeId(null)}
          />
        </section>
      </div>
    </PageContainer>
  );
}

function RuntimeGraph({
  definition,
  nodeStatus,
  traversedEdges,
  runActive,
  selectedNodeId,
  onSelectNode,
}: {
  definition?: WorkflowDefinition;
  nodeStatus: Map<string, RunEvent["type"]>;
  traversedEdges: Set<string>;
  runActive: boolean;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const [filterMode, setFilterMode] = useState<NodeFilterMode>("all");
  const [edgeScope, setEdgeScope] = useState<"traversed" | "all">("traversed");

  const nodes = definition?.nodes ?? [];
  const edges = definition?.edges ?? [];

  const counts = useMemo(() => {
    let executed = 0;
    let failed = 0;
    for (const node of nodes) {
      const t = nodeStatus.get(node.id);
      if (t) {
        executed++;
        if (t.endsWith("failed") || t === "run.failed" || t === "run.cancelled") failed++;
      }
    }
    return { all: nodes.length, executed, failed };
  }, [nodes, nodeStatus]);

  const filteredNodes = useMemo(() => {
    if (filterMode === "all") return nodes;
    if (filterMode === "executed") return nodes.filter((node) => nodeStatus.has(node.id));
    return nodes.filter((node) => {
      const t = nodeStatus.get(node.id);
      return Boolean(t && (t.endsWith("failed") || t === "run.failed" || t === "run.cancelled"));
    });
  }, [nodes, nodeStatus, filterMode]);

  const visibleEdges = useMemo(() => {
    if (edgeScope === "all" || traversedEdges.size === 0) return edges;
    return edges.filter((edge) => traversedEdges.has(edge.id));
  }, [edges, edgeScope, traversedEdges]);

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Workflow execution
          </h2>
          {nodes.length > 0 && (
            <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
              {counts.executed}/{counts.all}
            </span>
          )}
        </div>

        {nodes.length > 0 && (
          <div
            className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950/60 p-0.5"
            role="group"
            aria-label="Filter workflow steps"
          >
            {(
              [
                { id: "all", label: `All (${counts.all})` },
                { id: "executed", label: `Executed (${counts.executed})` },
                ...(counts.failed > 0 ? [{ id: "failed" as const, label: `Failed (${counts.failed})` }] : []),
              ] as Array<{ id: NodeFilterMode; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={filterMode === tab.id}
                onClick={() => setFilterMode(tab.id)}
                className="rounded-md px-2 py-0.5 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-100 aria-pressed:bg-indigo-600 aria-pressed:text-white"
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!definition ? (
        <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-6 text-xs text-zinc-500">
          Graph state is represented by the live event stream.
        </div>
      ) : (
        <>
          <div className="grid max-h-[34rem] gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
            {filteredNodes.map((node) => {
              const statusType = nodeStatus.get(node.id);
              const isSelected = selectedNodeId === node.id;
              const isFailed = Boolean(
                statusType &&
                  (statusType.endsWith("failed") || statusType === "run.failed" || statusType === "run.cancelled"),
              );
              const isCompleted = Boolean(statusType && statusType.endsWith("completed"));
              const isActive = Boolean(statusType && (statusType.endsWith("started") || statusType.includes("requested")));
              const label = humanizeNodeId(node.id, node.config as Record<string, unknown> | undefined);

              return (
                <button
                  key={node.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelectNode(node.id)}
                  title={`Click to filter timeline by ${node.id}`}
                  className={`group flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-indigo-400 ${
                    isSelected
                      ? "border-indigo-500 bg-indigo-950/30"
                      : isFailed
                        ? "border-red-500/40 bg-red-950/15 hover:border-red-400/60"
                        : isCompleted
                          ? "border-emerald-500/25 bg-emerald-950/10 hover:border-emerald-500/45"
                          : isActive
                            ? "border-indigo-500/40 bg-indigo-950/15 hover:border-indigo-400/60"
                            : "border-zinc-800/80 bg-zinc-950/50 opacity-75 hover:border-zinc-700 hover:opacity-100"
                  }`}
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <EventIcon type={statusType} runActive={runActive} />
                      <span className="truncate text-xs font-semibold text-zinc-100">{label}</span>
                    </div>
                    <span className="shrink-0 rounded border border-zinc-800 bg-zinc-900/90 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      {node.type}
                    </span>
                  </div>
                  <p className="truncate font-mono text-[10px] text-zinc-500">{node.id}</p>
                </button>
              );
            })}
          </div>

          {edges.length > 0 && (
            <details open={edges.length <= 8} className="group rounded-lg border border-zinc-800/80 bg-zinc-950/40">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-medium text-zinc-300 transition-colors hover:text-zinc-100">
                <span className="inline-flex items-center gap-2">
                  <ChevronRight
                    className="h-3.5 w-3.5 text-zinc-500 transition-transform group-open:rotate-90"
                    aria-hidden="true"
                  />
                  <GitBranch className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                  <span>Edges</span>
                </span>
                <span className="font-mono text-[11px] text-zinc-400">
                  {traversedEdges.size} traversed · {edges.length} total
                </span>
              </summary>
              <div className="space-y-2 border-t border-zinc-800/80 p-3">
                {traversedEdges.size > 0 && traversedEdges.size < edges.length && (
                  <div className="flex items-center justify-end">
                    <div
                      className="inline-flex rounded-md border border-zinc-800 bg-zinc-900/60 p-0.5"
                      role="group"
                      aria-label="Edge filter"
                    >
                      {(["traversed", "all"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          aria-pressed={edgeScope === mode}
                          onClick={() => setEdgeScope(mode)}
                          className="rounded px-2 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors hover:text-zinc-100 aria-pressed:bg-zinc-800 aria-pressed:text-zinc-100"
                        >
                          {mode === "traversed" ? `Traversed (${traversedEdges.size})` : `All (${edges.length})`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {visibleEdges.map((edge) => {
                    const traversed = traversedEdges.has(edge.id);
                    return (
                      <div
                        key={edge.id}
                        className={`flex min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 font-mono text-[11px] ${
                          traversed
                            ? "border-indigo-500/40 bg-indigo-950/25 text-indigo-200"
                            : "border-zinc-800/80 bg-zinc-950/60 text-zinc-500"
                        }`}
                      >
                        <span className="truncate" title={`${edge.source} → ${edge.target}`}>
                          {edge.source} → {edge.target}
                        </span>
                        {edge.branchKey && (
                          <span className="shrink-0 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-300">
                            {edge.branchKey}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function EventIcon({ type, runActive }: { type?: string; runActive: boolean }) {
  if (type?.endsWith("failed") || type === "run.failed" || type === "run.cancelled") {
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />;
  }
  if (type?.includes("approval.requested") || type === "run.paused") {
    return <Clock3 className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />;
  }
  if (type?.endsWith("completed") || type === "run.completed") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />;
  }
  if (type?.endsWith("started") || type === "run.started") {
    // Only spin while the run is actually in progress; a stale "started" after
    // failure/cancel/timeout should not look like live work.
    if (runActive) return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" aria-hidden="true" />;
    return <CircleDot className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden="true" />;
  }
  return <Circle className="h-3.5 w-3.5 shrink-0 text-zinc-600" aria-hidden="true" />;
}
