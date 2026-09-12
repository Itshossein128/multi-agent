import type { TimeFilter } from "@/lib/runtimeTracker";

/** Keep StatCards and list sections on the same Today/Week/Month window. */
export function matchesTimeFilter(
  period: TimeFilter | undefined,
  timeFilter: TimeFilter
): boolean {
  if (!period) return timeFilter === "month";
  if (timeFilter === "today") return period === "today";
  if (timeFilter === "week") return period === "today" || period === "week";
  return true;
}
