"use client";

import { AlertOctagon } from "lucide-react";
import type { Task } from "@/lib/taskStatus";

/** Rose inspection card showing the last execution error, if any. */
export function LastErrorCard({ lastError }: { lastError: Task["lastError"] }) {
  if (!lastError) return null;
  return (
    <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 space-y-1 text-xs text-rose-300">
      <span className="flex items-center gap-1 font-semibold text-rose-200">
        <AlertOctagon className="h-3.5 w-3.5 flex-shrink-0" />
        Last Execution Error
      </span>
      <p className="font-mono text-[11px] whitespace-pre-wrap">{lastError}</p>
    </div>
  );
}
