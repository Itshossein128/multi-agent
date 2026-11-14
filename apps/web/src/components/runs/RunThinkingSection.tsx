"use client";

import type { Run, RunEvent } from "@multi-agent/types";
import { buildNodeExecutionView } from "@/lib/runCanvasProjection";
import { ThinkingTranscript } from "@/components/workflow/live/ThinkingTranscript";

/** One thinking transcript per agent step, using the same projection as the canvas inspector. */
export function RunThinkingSection({ events, run }: { events: RunEvent[]; run: Run | null }) {
  const nodeIds: string[] = [];
  for (const event of events) {
    const nodeId = event.nodeId;
    if (!nodeId || nodeIds.includes(nodeId)) continue;
    if (event.type === "agent.started" || event.payload.channel === "thinking") nodeIds.push(nodeId);
  }
  if (nodeIds.length === 0) return null;
  return <section className="mx-4 mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-4" aria-label="Agent thinking">
    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Thinking</h2>
    <div className="space-y-4">
      {nodeIds.map((nodeId) => {
        const view = buildNodeExecutionView(nodeId, { events, run });
        return <div key={nodeId}>
          <p className="mb-1 break-all text-xs text-zinc-500">{nodeId}</p>
          <ThinkingTranscript attempts={view.thinkingAttempts} />
        </div>;
      })}
    </div>
  </section>;
}
