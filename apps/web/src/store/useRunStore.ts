"use client";

import { create } from "zustand";
import type { ApprovalRequest, Run, RunEvent } from "@multi-agent/types";
import { runService } from "@/services/runService";
import { createRunEventStream } from "@/services/runEventStream";

type StreamStatus = "idle" | "connecting" | "live" | "error" | "closed";
export const RUN_TIMELINE_EVENT_LIMIT = 5_000;
const TERMINAL_EVENT_TYPES = new Set(["run.completed", "run.failed", "run.cancelled"]);

function applyTerminalEvent(run: Run, event: RunEvent): Run {
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

interface RunStoreState {
  runId: string | null; run: Run | null; events: RunEvent[]; approvals: ApprovalRequest[]; selectedEventId: string | null; streamStatus: StreamStatus; error: string | null;
  load: (runId: string) => Promise<void>; attach: (runId: string) => () => void; selectEvent: (id: string | null) => void; clear: () => void;
}

export const useRunStore = create<RunStoreState>((set) => {
  const refreshApprovals = (runId: string) => { void runService.getApprovals(runId).then((approvals) => set({ approvals })).catch(() => undefined); };
  return {
    runId: null, run: null, events: [], approvals: [], selectedEventId: null, streamStatus: "idle", error: null,
    load: async (runId) => {
      set({ runId, run: null, events: [], approvals: [], selectedEventId: null, streamStatus: "idle", error: null });
      try {
        const [run, approvals, history] = await Promise.all([
          runService.getRun(runId),
          runService.getApprovals(runId).catch(() => []),
          runService.getRunEvents(runId).catch(() => []),
        ]);
        set((state) => {
          if (state.runId !== runId) return state;
          const byId = new Map(history.map((event) => [event.id, event]));
          for (const event of state.events) byId.set(event.id, event);
          const events = [...byId.values()].sort((a, b) => a.sequence - b.sequence).slice(-RUN_TIMELINE_EVENT_LIMIT);
          const terminal = [...events].reverse().find((event) => TERMINAL_EVENT_TYPES.has(event.type));
          return { run: terminal ? applyTerminalEvent(run, terminal) : run, approvals, events, error: null };
        });
      } catch (error) { set((state) => state.runId === runId ? { error: error instanceof Error ? error.message : String(error) } : state); }
    },
    attach: (runId) => {
      set((state) => state.runId === runId
        ? { runId, streamStatus: "idle" }
        : { runId, events: [], approvals: [], selectedEventId: null, streamStatus: "idle" });
      const stream = createRunEventStream(runId, {
        onStatus: (streamStatus) => set((state) => state.runId === runId ? { streamStatus } : state),
        onEvent: (event) => {
          set((state) => {
            if (state.runId !== runId) return state;
            const events = state.events.some((item) => item.id === event.id)
              ? state.events
              : [...state.events, event].sort((a, b) => a.sequence - b.sequence).slice(-RUN_TIMELINE_EVENT_LIMIT);
            let run = state.run;
            if (run) {
              if (event.type === "run.started" || event.type === "run.resumed") run = { ...run, status: "running" };
              if (event.type === "run.paused" || event.type === "human_approval.requested") run = { ...run, status: "waiting_for_human", currentNodeId: event.nodeId ?? run.currentNodeId };
              if (TERMINAL_EVENT_TYPES.has(event.type)) run = applyTerminalEvent(run, event);
            }
            return { events, run };
          });
          if (event.type === "human_approval.requested" || event.type === "human_approval.resolved" || event.type === "human_approval.approved" || event.type === "human_approval.rejected") refreshApprovals(runId);
        },
      });
      return stream.close;
    },
    selectEvent: (selectedEventId) => set({ selectedEventId }),
    clear: () => set({ runId: null, run: null, events: [], approvals: [], selectedEventId: null, streamStatus: "idle", error: null }),
  };
});
