# Data Model: Task Board Multi-Property Filtering

**Feature**: `006-task-filtering`  
**Date**: 2026-10-22  
**Spec**: [spec.md](./spec.md)  

---

## 1. Filter Criteria Model (`TaskBoardFilters`)

Represents the complete in-memory filter configuration applied to the task board:

```typescript
export type TaskFilterPriority = TaskPriority | "all";
export type TaskFilterOperationalState = "all" | "paused" | "blocked";

export interface TaskBoardFilters {
  /** Free-text search matching title or description (case-insensitive substring) */
  search: string;
  /**
   * Status filter:
   * - "all": any status
   * - ColumnId ("backlog" | "ready" | "running" | "waiting" | "done" | "failed"): matches mapped statuses
   * - TaskStatus: exact status match
   */
  status: TaskStatus | ColumnId | "all";
  /**
   * Workspace filter:
   * - "all": any workspace
   * - "unassigned": task.workspaceId is undefined or empty
   * - string: exact workspaceId UUID match
   */
  workspaceId: string;
  /**
   * Project filter:
   * - "all": any project
   * - "unassigned": task.projectIds is undefined, empty, or has 0 items
   * - string: project ID exists in task.projectIds
   */
  projectId: string;
  /**
   * Priority filter: "all" or specific urgency level ("high" | "medium" | "low")
   */
  priority: TaskFilterPriority;
  /**
   * Agent filter:
   * - "all": any agent
   * - "unassigned" or "": task has no assigned agent
   * - string: agent name or agent ID match
   */
  agent: string;
  /**
   * Workflow filter:
   * - "all": any workflow
   * - "unassigned": task.workflowId is null or undefined
   * - string: workflowId match
   */
  workflow: string;
  /**
   * Operational flag filter:
   * - "all": no restriction
   * - "paused": task.paused === true
   * - "blocked": task has unfinished dependencies
   */
  operationalState: TaskFilterOperationalState;
}

export const DEFAULT_TASK_BOARD_FILTERS: TaskBoardFilters = {
  search: "",
  status: "all",
  workspaceId: "all",
  projectId: "all",
  priority: "all",
  agent: "all",
  workflow: "all",
  operationalState: "all",
};
```

---

## 2. URL Search Parameters Schema (`TaskFilterUrlParams`)

Defines the serialized representation of filter criteria in the browser URL query string:

| Parameter | Type | Default (omitted) | Example Values | Description |
| :--- | :--- | :--- | :--- | :--- |
| `q` | `string` | `""` | `?q=auth` | Substring search on title & description |
| `status` | `string` | `"all"` | `?status=running`, `?status=waiting` | Specific status or column category |
| `workspace` | `string` | `"all"` | `?workspace=ws-abc`, `?workspace=unassigned` | Workspace ID or unassigned |
| `project` | `string` | `"all"` | `?project=proj-123`, `?project=unassigned` | Project ID or unassigned |
| `priority` | `string` | `"all"` | `?priority=high`, `?priority=low` | Priority level |
| `agent` | `string` | `"all"` | `?agent=agent-developer`, `?agent=unassigned` | Assigned agent ID/name or unassigned |
| `workflow` | `string` | `"all"` | `?workflow=wf-ci`, `?workflow=unassigned` | Workflow ID or unassigned |
| `state` | `string` | `"all"` | `?state=paused`, `?state=blocked` | Operational execution state |

---

## 3. Active Filter Chip Model (`ActiveFilterChip`)

View model representing an applied filter displayed as a dismissible badge:

```typescript
export interface ActiveFilterChip {
  id: string;             // Unique identifier, e.g. "workspace", "project", "priority"
  category: string;       // Human label, e.g. "Workspace", "Project", "Priority"
  label: string;          // Formatted value, e.g. "Production Core", "High", "Paused"
  onRemove: () => void;   // Handler to reset this specific filter to its default value
}
```

---

## 4. Filter Evaluation Pipeline

Pure function contract in `apps/web/src/lib/taskBoardView.ts`:

```typescript
export interface FilterTasksOptions {
  tasksById?: Map<string, Task>;
}

export function filterTasks(
  tasks: Task[],
  filters: TaskBoardFilters,
  options?: FilterTasksOptions
): Task[];

export function countActiveFilters(filters: TaskBoardFilters): number;

export function getActiveFilterChips(
  filters: TaskBoardFilters,
  lookups: {
    workspaceNamesById: Map<string, string>;
    projectNamesById: Map<string, string>;
    workflowsById: Map<string, string>;
    agentsById: Map<string, string>;
  },
  onRemoveFilter: <K extends keyof TaskBoardFilters>(key: K, defaultValue?: TaskBoardFilters[K]) => void
): ActiveFilterChip[];
```
