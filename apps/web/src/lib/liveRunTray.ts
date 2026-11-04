import type { Run, RunEvent, WorkflowDefinition } from "@multi-agent/types";
import type { LiveRunTrayModel, LiveStreamStatus, LiveTrayEventFilter } from "../components/workflow/live/liveCanvas.types";
import { filterTrayEvents } from "./runCanvasProjection";

interface LiveRunTrayInput {
  runId: string;
  run?: Run | null;
  events: readonly RunEvent[];
  definition?: WorkflowDefinition | null;
  streamStatus: LiveStreamStatus | "idle";
  now: number;
  collapsed?: boolean;
  eventFilter?: LiveTrayEventFilter;
}

export function buildLiveRunTrayModel(input: LiveRunTrayInput): LiveRunTrayModel {
  const run = input.run?.id === input.runId ? input.run : null;
  const events = input.events.filter(event => event.runId === input.runId);
  const active = !!run && ["queued", "running", "waiting_for_human"].includes(run.status);
  const started = run ? Date.parse(run.startedAt) : NaN;
  const terminal = [...events].reverse().find(event => ["run.completed", "run.failed", "run.cancelled"].includes(event.type));
  const ended = run?.completedAt ? Date.parse(run.completedAt) : !active && terminal ? Date.parse(terminal.timestamp) : active ? input.now : started;
  const elapsedMs = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
  const startedEvents = events.filter(event => event.type === "node.started");
  const observedSteps = startedEvents.map(event => event.payload.step).filter((step): step is number => typeof step === "number" && Number.isFinite(step) && step >= 0);
  const configuredMax = input.definition?.archetypeConfig?.maxExecutionSteps;
  const eventFilter = input.eventFilter ?? "all";
  return {
    runId: input.runId,
    status: run?.status ?? "queued",
    streamStatus: input.streamStatus === "idle" ? "connecting" : input.streamStatus,
    elapsedMs,
    stepCurrent: observedSteps.length ? Math.max(...observedSteps) : startedEvents.length,
    stepMax: typeof configuredMax === "number" && Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 1000,
    collapsed: input.collapsed ?? false,
    eventFilter,
    canCancel: active,
    canRetry: run?.status === "failed",
    events: filterTrayEvents(events, eventFilter),
  };
}
