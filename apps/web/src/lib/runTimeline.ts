/**
 * Pure run-timeline reduction: merging events, deriving run status from
 * timeline events, and bounding the visible timeline. Extracted from
 * useRunStore so the state machine is independently testable.
 */

import type { Run, RunEvent } from "@multi-agent/types";

export const RUN_TIMELINE_EVENT_LIMIT = 5_000;

export const TERMINAL_EVENT_TYPES = new Set(["run.completed", "run.failed", "run.cancelled"]);

/**
 * Merge a batch of events with existing ones, dedup by id, sort by sequence,
 * bound size. On id collision the existing (live) event wins, preserving the
 * store's original semantics of freshest in-memory state over fetched history.
 */
export function mergeTimelineEvents(existing: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const byId = new Map(incoming.map((event) => [event.id, event]));
  for (const event of existing) byId.set(event.id, event);
  return [...byId.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .slice(-RUN_TIMELINE_EVENT_LIMIT);
}

/** Apply a single timeline event to the run snapshot (status/output/error derivation). */
export function applyRunEvent(run: Run, event: RunEvent): Run {
  if (event.type === "run.started" || event.type === "run.resumed") {
    return { ...run, status: "running" };
  }
  if (event.type === "run.paused" || event.type === "human_approval.requested") {
    return { ...run, status: "waiting_for_human", currentNodeId: event.nodeId ?? run.currentNodeId };
  }
  return applyTerminalEvent(run, event);
}

/** Derive final run state from a terminal timeline event. */
export function applyTerminalEvent(run: Run, event: RunEvent): Run {
  if (event.type === "run.completed") {
    return { ...run, status: "completed", completedAt: event.timestamp, output: event.payload.output as Record<string, unknown> | undefined };
  }
  if (event.type === "run.cancelled" || (event.type === "run.failed" && event.payload.cancelled === true)) {
    return { ...run, status: "cancelled", completedAt: event.timestamp };
  }
  if (event.type === "run.failed") {
    return { ...run, status: "failed", completedAt: event.timestamp, error: typeof event.payload.error === "string" ? event.payload.error : run.error };
  }
  return run;
}

/** Most recent terminal event in a timeline, if any. */
export function findTerminalEvent(events: RunEvent[]): RunEvent | undefined {
  return [...events].reverse().find((event) => TERMINAL_EVENT_TYPES.has(event.type));
}
