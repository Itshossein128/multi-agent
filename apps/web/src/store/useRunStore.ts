"use client";

import { create } from "zustand";
import type { Run, RunEvent } from "@multi-agent/types";
import { runService } from "@/services/runService";
import { createRunEventStream } from "@/services/runEventStream";

type StreamStatus = "idle" | "connecting" | "live" | "error" | "closed";
interface RunStoreState {
  run: Run | null; events: RunEvent[]; selectedEventId: string | null; streamStatus: StreamStatus; error: string | null;
  load: (runId: string) => Promise<void>; attach: (runId: string) => () => void; selectEvent: (id: string | null) => void; clear: () => void;
}

export const useRunStore = create<RunStoreState>((set) => ({
  run: null, events: [], selectedEventId: null, streamStatus: "idle", error: null,
  load: async (runId) => { try { set({ run: await runService.getRun(runId), error: null }); } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); } },
  attach: (runId) => {
    const stream = createRunEventStream(runId, { onStatus: (streamStatus) => set({ streamStatus }), onEvent: (event) => set((state) => ({ events: state.events.some((item) => item.id === event.id) ? state.events : [...state.events, event] })) });
    return stream.close;
  },
  selectEvent: (selectedEventId) => set({ selectedEventId }),
  clear: () => set({ run: null, events: [], selectedEventId: null, streamStatus: "idle", error: null }),
}));
