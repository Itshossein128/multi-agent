"use client";

import { create } from "zustand";
import type { ApprovalRequest, Run, RunEvent } from "@multi-agent/types";
import { runService } from "@/services/runService";
import { createRunEventStream } from "@/services/runEventStream";
import {
  applyRunEvent,
  applyTerminalEvent,
  findTerminalEvent,
  mergeTimelineEvents,
} from "@/lib/runTimeline";

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
        const [run, approvals, history] = await Promise.all([
          runService.getRun(runId),
          runService.getApprovals(runId).catch(() => []),
          runService.getRunEvents(runId).catch(() => []),
        ]);
        set((state) => {
          if (state.runId !== runId) return state;
          const events = mergeTimelineEvents(state.events, history);
          const terminal = findTerminalEvent(events);
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
              : mergeTimelineEvents(state.events, [event]);
            let run = state.run;
            if (run) run = applyRunEvent(run, event);
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
