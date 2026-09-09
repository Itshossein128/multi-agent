"use client";

import { create } from "zustand";
import type { ApprovalRequest, Run, RunEvent } from "@multi-agent/types";
import { runService } from "@/services/runService";
import { createRunEventStream } from "@/services/runEventStream";

type StreamStatus = "idle" | "connecting" | "live" | "error" | "closed";
interface RunStoreState {
  run: Run | null; events: RunEvent[]; approvals: ApprovalRequest[]; selectedEventId: string | null; streamStatus: StreamStatus; error: string | null;
  load: (runId: string) => Promise<void>; attach: (runId: string) => () => void; selectEvent: (id: string | null) => void; clear: () => void;
}

export const useRunStore = create<RunStoreState>((set) => {
  const refreshApprovals = (runId: string) => { void runService.getApprovals(runId).then((approvals) => set({ approvals })).catch(() => undefined); };
  return {
    run: null, events: [], approvals: [], selectedEventId: null, streamStatus: "idle", error: null,
    load: async (runId) => {
      try {
        const [run, approvals] = await Promise.all([runService.getRun(runId), runService.getApprovals(runId).catch(() => [])]);
        set({ run, approvals, error: null });
      } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    },
    attach: (runId) => {
      const stream = createRunEventStream(runId, {
        onStatus: (streamStatus) => set({ streamStatus }),
        onEvent: (event) => {
          set((state) => ({ events: state.events.some((item) => item.id === event.id) ? state.events : [...state.events, event] }));
          if (event.type === "human_approval.requested") { set((state) => ({ run: state.run ? { ...state.run, status: "waiting_for_human" } : state.run })); refreshApprovals(runId); }
          if (event.type === "human_approval.resolved") { set((state) => ({ run: state.run ? { ...state.run, status: "running" } : state.run })); refreshApprovals(runId); }
        },
      });
      return stream.close;
    },
    selectEvent: (selectedEventId) => set({ selectedEventId }),
    clear: () => set({ run: null, events: [], approvals: [], selectedEventId: null, streamStatus: "idle", error: null }),
  };
});
