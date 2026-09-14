"use client";

import { create } from "zustand";
import type { ApprovalRequest, Run, RunEvent } from "@multi-agent/types";
import { runService } from "@/services/runService";
import { createRunEventStream } from "@/services/runEventStream";

type StreamStatus = "idle" | "connecting" | "live" | "error" | "closed";
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
        const [run, approvals] = await Promise.all([runService.getRun(runId), runService.getApprovals(runId).catch(() => [])]);
        set((state) => state.runId === runId ? { run, approvals, error: null } : state);
      } catch (error) { set((state) => state.runId === runId ? { error: error instanceof Error ? error.message : String(error) } : state); }
    },
    attach: (runId) => {
      set({ runId, events: [], approvals: [], selectedEventId: null, streamStatus: "idle" });
      const stream = createRunEventStream(runId, {
        onStatus: (streamStatus) => set((state) => state.runId === runId ? { streamStatus } : state),
        onEvent: (event) => {
          set((state) => {
            if (state.runId !== runId) return state;
            const events = state.events.some((item) => item.id === event.id)
              ? state.events
              : [...state.events, event].sort((a, b) => a.sequence - b.sequence);
            let run = state.run;
            if (run) {
              if (event.type === "run.started" || event.type === "run.resumed") run = { ...run, status: "running" };
              if (event.type === "run.paused" || event.type === "human_approval.requested") run = { ...run, status: "waiting_for_human", currentNodeId: event.nodeId ?? run.currentNodeId };
              if (event.type === "run.completed") run = { ...run, status: "completed", completedAt: event.timestamp, output: event.payload.output as Record<string, unknown> | undefined };
              if (event.type === "run.failed") {
                const cancelled = event.payload.cancelled === true;
                run = { ...run, status: cancelled ? "cancelled" : "failed", completedAt: event.timestamp, error: typeof event.payload.error === "string" ? event.payload.error : run.error };
              }
              if (event.type === "run.cancelled") run = { ...run, status: "cancelled", completedAt: event.timestamp };
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
