/**
 * Task board domain model, column config, and workflow state machine.
 * Shared between the server store (taskBoard.ts) and client components.
 */

import {
  canTransitionStatus,
  isCompletedStatus,
  isStatusDependencyGated,
  toCanonicalStatus,
  type Phase2TaskStatus,
  type LegacyTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from "@multi-agent/types";

export type {
  Phase2TaskStatus,
  LegacyTaskStatus,
  TaskPriority,
  TaskStatus,
};

export {
  canTransitionStatus,
  isCompletedStatus,
  isStatusDependencyGated,
  toCanonicalStatus,
};

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedAgent: string | null;
  assignedAgents?: string[];
  workflowId?: string | null;
  dependencies: string[];
  output: string | null;
  lastError?: string | null;
  runId?: string | null;
  parentTaskId?: string | null;
  retryCount: number;
  paused: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface BoardAgent {
  id: string;
  name: string;
  role: string;
  model: string;
  status: "running" | "idle" | "error";
}

export interface BoardWorkflow {
  id: string;
  name: string;
}

export interface TaskBoardData {
  tasks: Task[];
  agents: BoardAgent[];
  workflows?: BoardWorkflow[];
  lastUpdated: string;
}

export const TASK_STATUSES: TaskStatus[] = [
  "backlog",
  "ready",
  "queued",
  "running",
  "blocked",
  "waiting_for_human",
  "completed",
  "failed",
  "cancelled",
  "todo",
  "planning",
  "in_progress",
  "waiting_tool",
  "review",
  "done",
];

export const TASK_PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

export type ColumnId = "backlog" | "ready" | "running" | "waiting" | "done" | "failed";

export interface TaskColumnConfig {
  id: ColumnId;
  status: TaskStatus;
  label: string;
  targetStatus: TaskStatus;
  mappedStatuses: TaskStatus[];
  accent: string;
  dot: string;
  dragOverRing: string;
}

export const TASK_COLUMNS: TaskColumnConfig[] = [
  {
    id: "backlog",
    status: "backlog",
    label: "Backlog",
    targetStatus: "backlog",
    mappedStatuses: ["backlog", "todo"],
    accent: "text-zinc-300",
    dot: "bg-zinc-400",
    dragOverRing: "ring-1 ring-zinc-500/60",
  },
  {
    id: "ready",
    status: "ready",
    label: "Ready",
    targetStatus: "ready",
    mappedStatuses: ["ready", "planning", "queued"],
    accent: "text-violet-300",
    dot: "bg-violet-400",
    dragOverRing: "ring-1 ring-violet-500/60",
  },
  {
    id: "running",
    status: "running",
    label: "Running",
    targetStatus: "running",
    mappedStatuses: ["running", "in_progress"],
    accent: "text-blue-300",
    dot: "bg-blue-400",
    dragOverRing: "ring-1 ring-blue-500/60",
  },
  {
    id: "waiting",
    status: "waiting_for_human",
    label: "Review / Blocked",
    targetStatus: "blocked",
    mappedStatuses: ["blocked", "waiting_tool", "waiting_for_human", "review"],
    accent: "text-amber-300",
    dot: "bg-amber-400",
    dragOverRing: "ring-1 ring-amber-500/60",
  },
  {
    id: "done",
    status: "completed",
    label: "Done",
    targetStatus: "completed",
    mappedStatuses: ["completed", "done"],
    accent: "text-emerald-300",
    dot: "bg-emerald-400",
    dragOverRing: "ring-1 ring-emerald-500/60",
  },
  {
    id: "failed",
    status: "failed",
    label: "Failed / Cancelled",
    targetStatus: "cancelled",
    mappedStatuses: ["failed", "cancelled"],
    accent: "text-rose-300",
    dot: "bg-rose-400",
    dragOverRing: "ring-1 ring-rose-500/60",
  },
];

export function getColumnForStatus(status: TaskStatus): ColumnId {
  const canonical = toCanonicalStatus(status);
  switch (canonical) {
    case "backlog":
      return "backlog";
    case "ready":
    case "queued":
      return "ready";
    case "running":
      return "running";
    case "blocked":
    case "waiting_for_human":
      return "waiting";
    case "completed":
      return "done";
    case "failed":
    case "cancelled":
      return "failed";
  }
}

/** Allowed workflow transitions for UI transition hints. */
export const STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ["ready", "running", "cancelled"],
  ready: ["backlog", "running", "cancelled"],
  queued: ["running", "ready", "cancelled"],
  running: ["blocked", "waiting_for_human", "completed", "failed", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  waiting_for_human: ["running", "completed", "failed", "cancelled"],
  completed: ["ready", "backlog"],
  failed: ["ready", "running", "backlog"],
  cancelled: ["ready", "backlog"],
  // Legacy aliases
  todo: ["planning", "in_progress", "waiting_tool", "failed"],
  planning: ["todo", "in_progress", "waiting_tool", "failed"],
  in_progress: ["planning", "waiting_tool", "review", "done", "failed"],
  waiting_tool: ["planning", "in_progress", "failed"],
  review: ["done", "in_progress", "failed"],
  done: ["todo", "review"],
};

export const DEP_GATED_STATUSES: TaskStatus[] = [
  "queued",
  "running",
  "waiting_for_human",
  "completed",
  "in_progress",
  "review",
  "done",
];

export function canMoveStatus(from: TaskStatus, to: TaskStatus): boolean {
  return canTransitionStatus(from, to);
}

export function getDependencyBlockers(
  task: Pick<Task, "dependencies">,
  tasksById: Map<string, Task>,
): Task[] {
  return (task.dependencies ?? [])
    .map((id) => tasksById.get(id))
    .filter((dep): dep is Task => dep !== undefined && !isCompletedStatus(dep.status));
}

export function hasDependencyCycle(
  tasks: Task[],
  taskId: string,
  nextDependencies: string[],
): boolean {
  if (nextDependencies.includes(taskId)) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const stack = [...nextDependencies];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = byId.get(current);
    if (node && Array.isArray(node.dependencies)) {
      stack.push(...node.dependencies);
    }
  }
  return false;
}

// Presentation helpers moved to focused modules; re-exported for import stability.
export { statusBadgeConfig, priorityBadgeClasses } from "@/lib/taskBadge";
export { formatRelativeTime } from "@/lib/formatRelativeTime";
