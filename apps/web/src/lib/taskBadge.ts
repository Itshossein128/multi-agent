/**
 * Presentation-only mapping from task domain state to badge styling.
 * No domain logic lives here — status transitions and board grouping
 * remain in `lib/taskStatus.ts`.
 */

import { toCanonicalStatus, type TaskPriority, type TaskStatus } from "@/lib/taskStatus";

export function statusBadgeConfig(status: TaskStatus): { label: string; className: string } {
  const canonical = toCanonicalStatus(status);
  switch (canonical) {
    case "backlog":
      return { label: "Backlog", className: "bg-zinc-800 text-zinc-300 border border-zinc-700" };
    case "ready":
      return { label: "Ready", className: "bg-violet-950/70 text-violet-300 border border-violet-800" };
    case "queued":
      return { label: "Queued", className: "bg-indigo-950/70 text-indigo-300 border border-indigo-800 animate-pulse" };
    case "running":
      return { label: "Running", className: "bg-blue-950/70 text-blue-300 border border-blue-800" };
    case "blocked":
      return { label: "Blocked", className: "bg-amber-950/70 text-amber-300 border border-amber-800" };
    case "waiting_for_human":
      return { label: "Waiting Review", className: "bg-yellow-950/70 text-yellow-300 border border-yellow-800" };
    case "completed":
      return { label: "Completed", className: "bg-emerald-950/70 text-emerald-300 border border-emerald-800" };
    case "failed":
      return { label: "Failed", className: "bg-rose-950/70 text-rose-300 border border-rose-800" };
    case "cancelled":
      return { label: "Cancelled", className: "bg-zinc-800/80 text-zinc-400 border border-zinc-700" };
  }
}

export function priorityBadgeClasses(priority: TaskPriority): string {
  switch (priority) {
    case "high":
      return "bg-red-950/70 text-red-300 border border-red-800/80";
    case "medium":
      return "bg-amber-950/70 text-amber-300 border border-amber-800/80";
    case "low":
      return "bg-zinc-800/80 text-zinc-400 border border-zinc-700";
  }
}
