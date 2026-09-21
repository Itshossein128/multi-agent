/**
 * Pure task-board view logic: filtering, column grouping, and sorting.
 * No React, no fetching — fully unit-testable.
 */

import {
  DEP_GATED_STATUSES,
  TASK_COLUMNS,
  canMoveStatus,
  getColumnForStatus,
  getDependencyBlockers,
  type ColumnId,
  type Task,
  type TaskPriority,
} from "@/lib/taskStatus";

export const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export interface TaskBoardFilters {
  search: string;
  priority: TaskPriority | "all";
  agent: string; // "all", agent id/name, or "" for unassigned
  workflow: string; // "all" or workflow id
}

export function filterTasks(tasks: Task[], filters: TaskBoardFilters): Task[] {
  const q = filters.search.trim().toLowerCase();
  return tasks.filter((task) => {
    if (
      q &&
      !task.title.toLowerCase().includes(q) &&
      !task.description.toLowerCase().includes(q)
    ) {
      return false;
    }
    if (filters.priority !== "all" && task.priority !== filters.priority) return false;
    if (filters.agent !== "all") {
      const matchesAgent =
        task.assignedAgent === filters.agent ||
        (task.assignedAgents && task.assignedAgents.includes(filters.agent));
      if (!matchesAgent) return false;
    }
    if (filters.workflow !== "all" && task.workflowId !== filters.workflow) return false;
    return true;
  });
}

/** Group filtered tasks into UI columns, sorted by priority then newest first. */
export function groupTasksByColumn(tasks: Task[]): Map<ColumnId, Task[]> {
  const grouped = new Map<ColumnId, Task[]>();
  for (const column of TASK_COLUMNS) grouped.set(column.id, []);
  for (const task of tasks) {
    const colId = getColumnForStatus(task.status);
    grouped.get(colId)?.push(task);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => {
      const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (byPriority !== 0) return byPriority;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }
  return grouped;
}

export interface MoveValidation {
  ok: boolean;
  reason?: string;
}

/** Client-side pre-validation of a column move; the server stays authoritative. */
export function validateMove(
  task: Task,
  toStatus: Task["status"],
  tasksById: Map<string, Task>
): MoveValidation {
  if (task.status === toStatus) return { ok: false, reason: "Task is already in that column." };
  if (!canMoveStatus(task.status, toStatus)) {
    return {
      ok: false,
      reason: `Invalid transition: ${task.status.replace("_", " ")} → ${toStatus.replace("_", " ")}`,
    };
  }
  if (DEP_GATED_STATUSES.includes(toStatus)) {
    const blockers = getDependencyBlockers(task, tasksById);
    if (blockers.length > 0) {
      return {
        ok: false,
        reason: `"${task.title}" is blocked by unfinished dependencies: ${blockers
          .map((b) => `"${b.title}"`)
          .join(", ")}`,
      };
    }
  }
  return { ok: true };
}

/** Pre-validation for starting a run from a task. */
export function validateStart(task: Task, tasksById: Map<string, Task>): MoveValidation {
  const blockers = getDependencyBlockers(task, tasksById);
  if (blockers.length > 0) {
    return {
      ok: false,
      reason: `Cannot start: blocked by unfinished dependencies: ${blockers
        .map((b) => `"${b.title}"`)
        .join(", ")}`,
    };
  }
  return { ok: true };
}
