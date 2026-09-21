"use client";

import Link from "next/link";
import { Activity, ExternalLink } from "lucide-react";
import { Task } from "@/lib/taskStatus";

/** Cyan inspection card linking to the backend run powering this task. */
export function LinkedRunCard({ runId }: { runId: Task["runId"] }) {
  if (!runId) return null;
  return (
    <div className="rounded-lg border border-cyan-800/40 bg-cyan-950/20 p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
          <Activity className="h-3.5 w-3.5" />
          Linked Runtime Run
        </span>
        <Link
          href={`/runs/${runId}`}
          className="flex items-center gap-1 text-xs text-cyan-400 hover:underline"
        >
          View Details
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
      <p className="font-mono text-xs text-cyan-200 truncate">{runId}</p>
    </div>
  );
}
