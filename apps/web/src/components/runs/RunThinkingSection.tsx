"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Brain, CheckCircle2, Clock3, Loader2, Terminal } from "lucide-react";
import type { Run, RunEvent, WorkflowDefinition } from "@multi-agent/types";
import { buildNodeExecutionView } from "@/lib/runCanvasProjection";
import { ThinkingTranscript } from "@/components/workflow/live/ThinkingTranscript";
import { ReadableContent } from "@/components/runs/ReadableContent";

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "waiting_for_human"]);
const TERMINAL_NODE_EVENTS = new Set(["node.completed", "node.failed", "agent.failed"]);

function humanizeNodeId(nodeId: string, definition?: WorkflowDefinition): string {
  const match = definition?.nodes.find((node) => node.id === nodeId);
  const configLabel = match && typeof (match.config as { label?: unknown }).label === "string"
    ? String((match.config as { label?: unknown }).label).trim()
    : "";
  if (configLabel) return configLabel;
  return nodeId
    .replace(/^node[-_]/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\bstage(\d+)\b/gi, "Stage $1")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

function extractModelFromArgs(args: unknown): string | undefined {
  if (!Array.isArray(args)) return undefined;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if ((token === "--model" || token === "-m") && typeof args[i + 1] === "string") {
      return args[i + 1] as string;
    }
    if (typeof token === "string" && token.startsWith("--model=")) {
      return token.slice("--model=".length);
    }
  }
  return undefined;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

interface ActiveStepInfo {
  nodeId: string;
  startedAt?: string;
  provider?: string;
  model?: string;
  sessionTurn?: number;
  attempt: number;
}

function findActiveStep(events: RunEvent[], run: Run | null): ActiveStepInfo | null {
  if (!run || !ACTIVE_RUN_STATUSES.has(run.status)) return null;

  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const latestNodeEvent = new Map<string, RunEvent>();
  const latestStartByNode = new Map<string, RunEvent>();
  const latestAgentStartByNode = new Map<string, RunEvent>();
  const activeOrder: string[] = [];

  for (const event of sorted) {
    const nodeId = event.nodeId;
    if (!nodeId) continue;
    latestNodeEvent.set(nodeId, event);
    if (event.type === "node.started" || event.type === "agent.started") {
      latestStartByNode.set(nodeId, event);
      const existingIdx = activeOrder.indexOf(nodeId);
      if (existingIdx >= 0) activeOrder.splice(existingIdx, 1);
      activeOrder.push(nodeId);
    }
    if (event.type === "agent.started") {
      latestAgentStartByNode.set(nodeId, event);
    }
  }

  let activeNodeId: string | undefined;
  for (let i = activeOrder.length - 1; i >= 0; i--) {
    const candidate = activeOrder[i];
    const last = latestNodeEvent.get(candidate);
    if (last && !TERMINAL_NODE_EVENTS.has(last.type)) {
      activeNodeId = candidate;
      break;
    }
  }
  if (!activeNodeId && run.currentNodeId) {
    const last = latestNodeEvent.get(run.currentNodeId);
    if (!last || !TERMINAL_NODE_EVENTS.has(last.type)) {
      activeNodeId = run.currentNodeId;
    }
  }
  if (!activeNodeId) return null;

  const startEvent = latestStartByNode.get(activeNodeId);
  const agentStart = latestAgentStartByNode.get(activeNodeId);
  const payload = agentStart?.payload ?? {};
  const provider = typeof payload.provider === "string" ? payload.provider : undefined;
  const model = (typeof payload.model === "string" ? payload.model : undefined) ?? extractModelFromArgs(payload.args);
  const sessionTurn = typeof payload.sessionTurn === "number" ? payload.sessionTurn : undefined;
  const attempt = typeof startEvent?.payload?.attempt === "number" ? startEvent.payload.attempt : 1;

  return {
    nodeId: activeNodeId,
    startedAt: agentStart?.timestamp ?? startEvent?.timestamp ?? run.startedAt,
    provider,
    model,
    sessionTurn,
    attempt,
  };
}

/**
 * Shows live progress for the currently executing step while a run is active,
 * and displays agent thinking transcripts ONLY for steps that actually shared thinking.
 */
export function RunThinkingSection({
  events,
  run,
  definition,
}: {
  events: RunEvent[];
  run: Run | null;
  definition?: WorkflowDefinition;
}) {
  const activeStep = useMemo(() => findActiveStep(events, run), [events, run]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!activeStep) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeStep]);

  const sharedThinkingNodes = useMemo(() => {
    const seen = new Set<string>();
    const results: Array<{ nodeId: string; view: ReturnType<typeof buildNodeExecutionView> }> = [];
    for (const event of events) {
      const nodeId = event.nodeId;
      if (!nodeId || seen.has(nodeId)) continue;
      if (event.type !== "agent.started" && event.payload.channel !== "thinking" && typeof event.payload.thoughts !== "string") continue;
      seen.add(nodeId);
      const view = buildNodeExecutionView(nodeId, { events, run });
      if (view.thinkingAttempts.some((attempt) => attempt.availability === "shared")) {
        results.push({ nodeId, view });
      }
    }
    return results;
  }, [events, run]);

  const activeView = useMemo(
    () => (activeStep ? buildNodeExecutionView(activeStep.nodeId, { events, run }) : null),
    [activeStep, events, run],
  );

  const completedStepsCount = useMemo(() => {
    const completed = new Set<string>();
    for (const event of events) {
      if (event.type === "node.completed" && event.nodeId) completed.add(event.nodeId);
    }
    return completed.size;
  }, [events]);

  const otherSharedNodes = activeStep
    ? sharedThinkingNodes.filter((entry) => entry.nodeId !== activeStep.nodeId)
    : sharedThinkingNodes;

  if (!activeStep && otherSharedNodes.length === 0) return null;

  const activeHasSharedThinking = activeView?.thinkingAttempts.some((a) => a.availability === "shared") ?? false;
  const elapsedMs = activeStep?.startedAt ? Math.max(0, nowMs - new Date(activeStep.startedAt).getTime()) : undefined;
  const latestTool = activeView && activeView.toolCalls.length > 0
    ? activeView.toolCalls[activeView.toolCalls.length - 1]
    : undefined;

  return (
    <div className="space-y-3">
      {activeStep && (
        <section
          className="rounded-xl border border-indigo-500/30 bg-indigo-950/15 p-4"
          aria-label="Current step status"
        >
          <div className="flex flex-wrap items-center gap-2">
            {run?.status === "waiting_for_human" ? (
              <Clock3 className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-400" />
            )}
            <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
              {run?.status === "waiting_for_human" ? "Waiting for input" : "Current step"}
            </span>
            <span className="text-sm font-semibold text-zinc-100">
              {humanizeNodeId(activeStep.nodeId, definition)}
            </span>
            <span className="rounded border border-zinc-800 bg-zinc-950/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              {activeStep.nodeId}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
              {activeStep.provider && (
                <span className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900/70 px-2 py-0.5 text-zinc-300">
                  <Terminal className="h-3 w-3 text-zinc-400" />
                  {activeStep.provider}{activeStep.model ? ` · ${activeStep.model}` : ""}
                </span>
              )}
              <span className="rounded border border-zinc-800 bg-zinc-900/70 px-2 py-0.5">
                Attempt {activeStep.attempt}
                {activeStep.sessionTurn ? ` · Turn ${activeStep.sessionTurn}` : ""}
              </span>
              {elapsedMs !== undefined && Number.isFinite(elapsedMs) && (
                <span className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-950/40 px-2 py-0.5 font-mono text-indigo-200">
                  <Activity className="h-3 w-3" />
                  {formatElapsed(elapsedMs)}
                </span>
              )}
              {completedStepsCount > 0 && (
                <span className="inline-flex items-center gap-1 text-emerald-300/90">
                  <CheckCircle2 className="h-3 w-3" />
                  {completedStepsCount} completed
                </span>
              )}
            </div>
          </div>

          {activeHasSharedThinking && activeView ? (
            <div className="mt-3 border-t border-indigo-500/20 pt-3">
              <ThinkingTranscript attempts={activeView.thinkingAttempts} />
            </div>
          ) : activeView?.streamText ? (
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3">
              <ReadableContent text={activeView.streamText} />
            </div>
          ) : latestTool ? (
            <p className="mt-2 text-xs text-zinc-300">
              Latest tool activity: <span className="font-mono text-indigo-200">{latestTool.toolId ?? latestTool.id}</span> ({latestTool.status})
            </p>
          ) : (
            <p className="mt-2 text-xs text-zinc-400">
              {run?.status === "waiting_for_human"
                ? "This step is paused until your response is submitted above."
                : activeStep.provider
                  ? `Running via ${activeStep.provider}${activeStep.model ? ` (${activeStep.model})` : ""}. Live reasoning is not streamed by this backend—output will appear automatically when the step finishes.`
                  : "Step is executing. Live updates will appear automatically as events arrive."}
            </p>
          )}
        </section>
      )}

      {otherSharedNodes.length > 0 && (
        <section
          className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4"
          aria-label="Agent thinking"
        >
          <div className="mb-3 flex items-center gap-2">
            <Brain className="h-3.5 w-3.5 text-zinc-400" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Agent reasoning ({otherSharedNodes.length})
            </h2>
          </div>
          <div className="space-y-3">
            {otherSharedNodes.map(({ nodeId, view }, index) => (
              <details
                key={nodeId}
                open={index === otherSharedNodes.length - 1}
                className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3"
              >
                <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-200">
                  <span>{humanizeNodeId(nodeId, definition)}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{nodeId}</span>
                </summary>
                <div className="mt-2 border-t border-zinc-800/60 pt-2">
                  <ThinkingTranscript attempts={view.thinkingAttempts} />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
