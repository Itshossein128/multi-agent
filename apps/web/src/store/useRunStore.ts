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
  refreshApprovals: (runId: string) => Promise<void>;
  load: (runId: string) => Promise<void>; attach: (runId: string) => () => void; selectEvent: (id: string | null) => void; clear: () => void;
}

export const useRunStore = create<RunStoreState>((set, get) => {
  let generation = 0;
  let approvalRequest = 0;
  let approvalCommit = 0;
  const refreshApprovals = async (runId: string, attachment: number) => {
    const request = ++approvalRequest;
    const approvals = await runService.getApprovals(runId);
      if (generation !== attachment || get().runId !== runId || request !== approvalRequest) return;
      approvalCommit = request;
      set({ approvals });
  };
  return {
    runId: null, run: null, events: [], approvals: [], selectedEventId: null, streamStatus: "idle", error: null,
    refreshApprovals: (runId) => get().runId === runId ? refreshApprovals(runId, generation) : Promise.resolve(),
    load: async (runId) => {
      const loading = ++generation;
      const loadedApprovalCommit = approvalCommit;
      set({ runId, run: null, events: [], approvals: [], selectedEventId: null, streamStatus: "idle", error: null });
      try {
        const [run, approvals, history] = await Promise.all([
          runService.getRun(runId),
          runService.getApprovals(runId).catch(() => []),
          runService.getRunEvents(runId).catch(() => []),
        ]);
        set((state) => {
          if (state.runId !== runId || generation !== loading) return state;
          const events = mergeTimelineEvents(state.events, history);
          const terminal = findTerminalEvent(events);
          // Live lifecycle events may arrive while the fetched snapshot is loading.
          // Keep fetched terminal state authoritative over older nonterminal history.
          const observed = ["completed", "failed", "cancelled"].includes(run.status) ? run : events.reduce(applyRunEvent, run);
          return { run: terminal ? applyTerminalEvent(observed, terminal) : observed, approvals: approvalCommit === loadedApprovalCommit ? approvals : state.approvals, events, error: null };
        });
      } catch (error) { set((state) => state.runId === runId && generation === loading ? { error: error instanceof Error ? error.message : String(error) } : state); }
    },
    attach: (runId) => {
      if (get().runId !== runId) ++generation;
      const attachment = generation;
      set((state) => state.runId === runId
        ? { runId, streamStatus: "idle" }
        : { runId, events: [], approvals: [], selectedEventId: null, streamStatus: "idle" });
      const stream = createRunEventStream(runId, {
        onStatus: (streamStatus) => set((state) => state.runId === runId && generation === attachment ? { streamStatus } : state),
        onEvent: (event) => {
          if (get().runId !== runId || generation !== attachment) return;
          set((state) => {
            if (state.runId !== runId) return state;
            const events = state.events.some((item) => item.id === event.id)
              ? state.events
              : mergeTimelineEvents(state.events, [event]);
            let run = state.run;
            if (run) run = applyRunEvent(run, event);
            return { events, run };
          });
          if (event.type.startsWith("human_approval.")) void refreshApprovals(runId, attachment).catch(() => undefined);
        },
      });
      return stream.close;
    },
    selectEvent: (selectedEventId) => set({ selectedEventId }),
    clear: () => { ++generation; set({ runId: null, run: null, events: [], approvals: [], selectedEventId: null, streamStatus: "idle", error: null }); },
  };
});
