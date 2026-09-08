/**
 * Task board domain model, column config, and workflow state machine.
 * Shared between the server store (taskBoard.ts) and client components.
 */

export type TaskStatus =
  | "todo"
  | "planning"
  | "in_progress"
  | "waiting_tool"
  | "review"
  | "done"
  | "failed";

export type TaskPriority = "high" | "medium" | "low";

/**
 * Task model:
 * { id, title, description, priority, status, assignedAgent,
 *   dependencies[], output, retryCount, createdAt }
 *
 * `paused` and `updatedAt` are auxiliary fields supporting the
 * pause/resume feature and conflict-free optimistic UI updates.
 */
export interface Task {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedAgent: string | null;
  dependencies: string[];
  output: string | null;
  retryCount: number;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BoardAgent {
  id: string;
  name: string;
  role: string;
  model: string;
  status: "running" | "idle" | "error";
}

export interface TaskBoardData {
  tasks: Task[];
  agents: BoardAgent[];
  lastUpdated: string;
}

export const TASK_STATUSES: TaskStatus[] = [
  "todo",
  "planning",
  "in_progress",
  "waiting_tool",
  "review",
  "done",
  "failed",
];

export const TASK_PRIORITIES: TaskPriority[] = ["high", "medium", "low"];

export interface TaskColumnConfig {
  status: TaskStatus;
  label: string;
  /** Header text + icon color */
  accent: string;
  /** Card count dot color */
  dot: string;
  /** Column highlight while dragging over */
  dragOverRing: string;
}

export const TASK_COLUMNS: TaskColumnConfig[] = [
  {
    status: "todo",
    label: "Todo",
    accent: "text-zinc-300",
    dot: "bg-zinc-400",
    dragOverRing: "ring-1 ring-zinc-500/60",
  },
  {
    status: "planning",
    label: "Planning",
    accent: "text-violet-300",
    dot: "bg-violet-400",
    dragOverRing: "ring-1 ring-violet-500/60",
  },
  {
    status: "in_progress",
    label: "In Progress",
    accent: "text-blue-300",
    dot: "bg-blue-400",
    dragOverRing: "ring-1 ring-blue-500/60",
  },
  {
    status: "waiting_tool",
    label: "Waiting Tool",
    accent: "text-amber-300",
    dot: "bg-amber-400",
    dragOverRing: "ring-1 ring-amber-500/60",
  },
  {
    status: "review",
    label: "Review",
    accent: "text-cyan-300",
    dot: "bg-cyan-400",
    dragOverRing: "ring-1 ring-cyan-500/60",
  },
  {
    status: "done",
    label: "Done",
    accent: "text-emerald-300",
    dot: "bg-emerald-400",
    dragOverRing: "ring-1 ring-emerald-500/60",
  },
  {
    status: "failed",
    label: "Failed",
    accent: "text-rose-300",
    dot: "bg-rose-400",
    dragOverRing: "ring-1 ring-rose-500/60",
  },
];

/** Allowed workflow transitions between board columns. */
export const STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ["planning", "in_progress", "waiting_tool", "failed"],
  planning: ["todo", "in_progress", "waiting_tool", "failed"],
  in_progress: ["planning", "waiting_tool", "review", "done", "failed"],
  waiting_tool: ["planning", "in_progress", "failed"],
  review: ["done", "in_progress", "failed"],
  done: ["todo", "review"],
  failed: ["todo", "in_progress"],
};

/** Statuses that require every dependency to be `done` first. */
export const DEP_GATED_STATUSES: TaskStatus[] = ["in_progress", "review", "done"];

export function canMoveStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}

export function getDependencyBlockers(
  task: Pick<Task, "dependencies">,
  tasksById: Map<string, Task>
): Task[] {
  return task.dependencies
    .map((id) => tasksById.get(id))
    .filter((dep): dep is Task => dep !== undefined && dep.status !== "done");
}

/**
 * Returns true if setting `nextDependencies` on task `taskId`
 * would introduce a circular dependency chain.
 */
export function hasDependencyCycle(
  tasks: Task[],
  taskId: string,
  nextDependencies: string[]
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
    if (node) stack.push(...node.dependencies);
  }
  return false;
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
