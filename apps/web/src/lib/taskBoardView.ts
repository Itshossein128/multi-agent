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
  type TaskStatus,
} from "@/lib/taskStatus";

export const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

export type TaskFilterPriority = TaskPriority | "all";
export type TaskFilterOperationalState = "all" | "paused" | "blocked";

export interface TaskBoardFilters {
  search: string;
  priority: TaskFilterPriority;
  agent: string; // "all", agent id/name, or "" / "unassigned" for unassigned
  workflow: string; // "all", workflow id, or "" / "unassigned" for unassigned
  status?: TaskStatus | ColumnId | "all";
  workspaceId?: string; // "all", "unassigned", or workspaceId UUID
  projectId?: string; // "all", "unassigned", or projectId UUID
  operationalState?: TaskFilterOperationalState;
}

export const DEFAULT_TASK_BOARD_FILTERS: Required<TaskBoardFilters> = {
  search: "",
  status: "all",
  workspaceId: "all",
  projectId: "all",
  priority: "all",
  agent: "all",
  workflow: "all",
  operationalState: "all",
};

export interface FilterTasksOptions {
  tasksById?: Map<string, Task>;
}

export function filterTasks(
  tasks: Task[],
  filters: TaskBoardFilters,
  options?: FilterTasksOptions,
): Task[] {
  const q = filters.search.trim().toLowerCase();
  const byId = options?.tasksById ?? new Map(tasks.map((t) => [t.id, t]));

  return tasks.filter((task) => {
    // 1. Text search across title and description
    if (
      q &&
      !task.title.toLowerCase().includes(q) &&
      !task.description.toLowerCase().includes(q)
    ) {
      return false;
    }

    // 2. Status filter
    if (filters.status && filters.status !== "all") {
      const col = TASK_COLUMNS.find((c) => c.id === filters.status);
      if (col) {
        const matchesCol =
          col.mappedStatuses.includes(task.status) ||
          task.status === filters.status ||
          getColumnForStatus(task.status) === filters.status;
        if (!matchesCol) return false;
      } else if (task.status !== filters.status) {
        return false;
      }
    }

    // 3. Workspace filter
    if (filters.workspaceId && filters.workspaceId !== "all") {
      if (filters.workspaceId === "unassigned") {
        if (task.workspaceId) return false;
      } else if (task.workspaceId !== filters.workspaceId) {
        return false;
      }
    }

    // 4. Project filter
    if (filters.projectId && filters.projectId !== "all") {
      const taskProjectIds: string[] = [];
      if (task.projectId) taskProjectIds.push(task.projectId);
      const rawProjectIds = (task as unknown as { projectIds?: string[] }).projectIds;
      if (Array.isArray(rawProjectIds)) {
        taskProjectIds.push(...rawProjectIds);
      }

      if (filters.projectId === "unassigned") {
        if (taskProjectIds.length > 0) return false;
      } else if (!taskProjectIds.includes(filters.projectId)) {
        return false;
      }
    }

    // 5. Priority filter
    if (filters.priority && filters.priority !== "all" && task.priority !== filters.priority) {
      return false;
    }

    // 6. Agent filter
    if (filters.agent && filters.agent !== "all") {
      const isUnassigned = filters.agent === "" || filters.agent === "unassigned";
      if (isUnassigned) {
        const hasAgent = Boolean(
          task.assignedAgent || (task.assignedAgents && task.assignedAgents.length > 0),
        );
        if (hasAgent) return false;
      } else {
        const matchesAgent =
          task.assignedAgent === filters.agent ||
          (task.assignedAgents && task.assignedAgents.includes(filters.agent));
        if (!matchesAgent) return false;
      }
    }

    // 7. Workflow filter
    if (filters.workflow && filters.workflow !== "all") {
      const isUnassigned = filters.workflow === "" || filters.workflow === "unassigned";
      if (isUnassigned) {
        if (task.workflowId) return false;
      } else if (task.workflowId !== filters.workflow) {
        return false;
      }
    }

    // 8. Operational state filter
    if (filters.operationalState && filters.operationalState !== "all") {
      if (filters.operationalState === "paused") {
        if (!task.paused) return false;
      } else if (filters.operationalState === "blocked") {
        const blockers = getDependencyBlockers(task, byId);
        if (blockers.length === 0) return false;
      }
    }

    return true;
  });
}

export function countActiveFilters(filters: TaskBoardFilters): number {
  let count = 0;
  if (filters.search && filters.search.trim()) count++;
  if (filters.status && filters.status !== "all") count++;
  if (filters.workspaceId && filters.workspaceId !== "all") count++;
  if (filters.projectId && filters.projectId !== "all") count++;
  if (filters.priority && filters.priority !== "all") count++;
  if (filters.agent && filters.agent !== "all") count++;
  if (filters.workflow && filters.workflow !== "all") count++;
  if (filters.operationalState && filters.operationalState !== "all") count++;
  return count;
}

export interface ActiveFilterChip {
  id: string;
  category: string;
  label: string;
  key: keyof TaskBoardFilters;
}

export function getActiveFilterChips(
  filters: TaskBoardFilters,
  lookups: {
    workspaceNamesById: Map<string, string>;
    projectNamesById: Map<string, string>;
    workflowsById: Map<string, string>;
    agentsById?: Map<string, string>;
  },
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  if (filters.search && filters.search.trim()) {
    chips.push({
      id: "search",
      key: "search",
      category: "Search",
      label: `"${filters.search.trim()}"`,
    });
  }

  if (filters.status && filters.status !== "all") {
    const col = TASK_COLUMNS.find((c) => c.id === filters.status);
    const label = col ? col.label : filters.status.replace(/_/g, " ");
    chips.push({
      id: "status",
      key: "status",
      category: "Status",
      label,
    });
  }

  if (filters.workspaceId && filters.workspaceId !== "all") {
    const label =
      filters.workspaceId === "unassigned"
        ? "Unassigned"
        : lookups.workspaceNamesById.get(filters.workspaceId) ?? filters.workspaceId;
    chips.push({
      id: "workspace",
      key: "workspaceId",
      category: "Workspace",
      label,
    });
  }

  if (filters.projectId && filters.projectId !== "all") {
    const label =
      filters.projectId === "unassigned"
        ? "Unassigned"
        : lookups.projectNamesById.get(filters.projectId) ?? filters.projectId;
    chips.push({
      id: "project",
      key: "projectId",
      category: "Project",
      label,
    });
  }

  if (filters.priority && filters.priority !== "all") {
    chips.push({
      id: "priority",
      key: "priority",
      category: "Priority",
      label: filters.priority.charAt(0).toUpperCase() + filters.priority.slice(1),
    });
  }

  if (filters.agent && filters.agent !== "all") {
    const label =
      filters.agent === "" || filters.agent === "unassigned"
        ? "Unassigned"
        : lookups.agentsById?.get(filters.agent) ?? filters.agent;
    chips.push({
      id: "agent",
      key: "agent",
      category: "Agent",
      label,
    });
  }

  if (filters.workflow && filters.workflow !== "all") {
    const label =
      filters.workflow === "" || filters.workflow === "unassigned"
        ? "Unassigned"
        : lookups.workflowsById.get(filters.workflow) ?? filters.workflow;
    chips.push({
      id: "workflow",
      key: "workflow",
      category: "Workflow",
      label,
    });
  }

  if (filters.operationalState && filters.operationalState !== "all") {
    chips.push({
      id: "operationalState",
      key: "operationalState",
      category: "State",
      label: filters.operationalState === "paused" ? "Paused" : "Blocked",
    });
  }

  return chips;
}

export function parseFilterSearchParams(searchParams: {
  get: (key: string) => string | null;
}): TaskBoardFilters {
  const search = searchParams.get("q") ?? "";
  const status = (searchParams.get("status") as TaskStatus | ColumnId) ?? "all";
  const workspaceId = searchParams.get("workspace") ?? "all";
  const projectId = searchParams.get("project") ?? "all";
  const priority = (searchParams.get("priority") as TaskFilterPriority) ?? "all";
  const agent = searchParams.get("agent") ?? "all";
  const workflow = searchParams.get("workflow") ?? "all";
  const operationalState =
    (searchParams.get("state") as TaskFilterOperationalState) ?? "all";

  return {
    search,
    status: status || "all",
    workspaceId: workspaceId || "all",
    projectId: projectId || "all",
    priority: priority || "all",
    agent: agent !== null ? agent : "all",
    workflow: workflow !== null ? workflow : "all",
    operationalState: operationalState || "all",
  };
}

export function serializeFilterSearchParams(filters: TaskBoardFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search && filters.search.trim()) {
    params.set("q", filters.search.trim());
  }
  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.workspaceId && filters.workspaceId !== "all") {
    params.set("workspace", filters.workspaceId);
  }
  if (filters.projectId && filters.projectId !== "all") {
    params.set("project", filters.projectId);
  }
  if (filters.priority && filters.priority !== "all") {
    params.set("priority", filters.priority);
  }
  if (filters.agent && filters.agent !== "all") {
    params.set("agent", filters.agent);
  }
  if (filters.workflow && filters.workflow !== "all") {
    params.set("workflow", filters.workflow);
  }
  if (filters.operationalState && filters.operationalState !== "all") {
    params.set("state", filters.operationalState);
  }
  return params;
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
