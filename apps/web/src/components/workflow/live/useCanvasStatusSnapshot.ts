"use client";

import { useMemo, useSyncExternalStore } from "react";
import type { ApprovalRequest, Run, RunEvent } from "@multi-agent/types";
import { useRunStore } from "@/store/useRunStore";
import { isStatusChangingEvent } from "@/lib/runCanvasProjection";

export const CANVAS_STATUS_COMMIT_MS = 32;

interface CanvasStatusSnapshot {
  runId: string | null;
  events: readonly RunEvent[];
  run: Run | null;
  approvals: readonly ApprovalRequest[];
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((item, index) => item === b[index]));
}

function selectSnapshot(): CanvasStatusSnapshot {
  const state = useRunStore.getState();
  return {
    runId: state.runId,
    events: state.events.filter(event => isStatusChangingEvent(event.type)),
    run: state.run,
    approvals: state.approvals,
  };
}

function createStatusSource(live: boolean) {
  let snapshot: CanvasStatusSnapshot = live ? selectSnapshot() : { runId: null, events: [], run: null, approvals: [] };
  return {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      if (!live) return () => {};
      // Cover changes between render and subscription (also Strict Mode replays).
      snapshot = selectSnapshot();
      let pending = snapshot;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        timer = undefined;
        snapshot = pending;
        notify();
      };
      const unsubscribe = useRunStore.subscribe(() => {
        const next = selectSnapshot();
        if (next.runId === pending.runId && next.run === pending.run && sameItems(next.events, pending.events) && sameItems(next.approvals, pending.approvals)) return;
        pending = next;
        // A different run must never briefly show the previous run's evidence.
        if (next.runId !== snapshot.runId) {
          if (timer !== undefined) clearTimeout(timer);
          flush();
        } else if (timer === undefined) {
          // Fixed window, not trailing debounce: sustained bursts cannot starve UI.
          timer = setTimeout(flush, CANVAS_STATUS_COMMIT_MS);
        }
      });
      return () => {
        unsubscribe();
        if (timer !== undefined) clearTimeout(timer);
      };
    },
  };
}

/** Only graph chrome is coalesced. The node inspector observes its own live slice. */
export function useCanvasStatusSnapshot(live: boolean): CanvasStatusSnapshot {
  const source = useMemo(() => createStatusSource(live), [live]);
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}
