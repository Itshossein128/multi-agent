# Interface & API Contract: Task Board Multi-Property Filtering

**Feature**: `006-task-filtering`  
**Date**: 2026-10-22  
**Spec**: [spec.md](../spec.md)  

---

## 1. Pure Filtering Function Contract

### Signature

```typescript
import type { Task, TaskPriority, TaskStatus, ColumnId } from "@/lib/taskStatus";

export interface TaskBoardFilters {
  search: string;
  status: TaskStatus | ColumnId | "all";
  workspaceId: string;
  projectId: string;
  priority: TaskPriority | "all";
  agent: string;
  workflow: string;
  operationalState?: "all" | "paused" | "blocked";
}

export interface FilterTasksOptions {
  tasksById?: Map<string, Task>;
}

export function filterTasks(
  tasks: Task[],
  filters: TaskBoardFilters,
  options?: FilterTasksOptions
): Task[];
```

### Preconditions
- `tasks` is an array of `Task` objects.
- `filters` is an object conforming to `TaskBoardFilters`.

### Invariants & Postconditions
- **Immutability**: `filterTasks` does not mutate the input `tasks` array or any `Task` object.
- **Conjunction**: A task is included in the output if and only if it satisfies all active filter properties.
- **Order Preservation**: The relative ordering of matching tasks in `tasks` is preserved.
- **Completeness**: When all filters are in default state (`search: ""`, all other properties `"all"`), `filterTasks(tasks, DEFAULT_TASK_BOARD_FILTERS)` returns a shallow copy of all tasks.

---

## 2. URL Serialization & Deserialization Contract

### Signatures

```typescript
export function parseFilterSearchParams(
  searchParams: URLSearchParams | ReadonlyURLSearchParams
): TaskBoardFilters;

export function serializeFilterSearchParams(
  filters: TaskBoardFilters
): URLSearchParams;
```

### Mapping Rules

| URL Key | Filter Field | Serialization Rule |
| :--- | :--- | :--- |
| `q` | `search` | If trimmed string is non-empty, set `q`; otherwise omit. |
| `status` | `status` | If !== `"all"`, set `status`; otherwise omit. |
| `workspace` | `workspaceId` | If !== `"all"`, set `workspace`; otherwise omit. |
| `project` | `projectId` | If !== `"all"`, set `project`; otherwise omit. |
| `priority` | `priority` | If !== `"all"`, set `priority`; otherwise omit. |
| `agent` | `agent` | If !== `"all"`, set `agent`; otherwise omit. |
| `workflow` | `workflow` | If !== `"all"`, set `workflow`; otherwise omit. |
| `state` | `operationalState` | If !== `"all"`, set `state`; otherwise omit. |

---

## 3. UI Component Contract: `TaskFilterBar`

```typescript
export interface TaskFilterBarProps {
  filters: TaskBoardFilters;
  onFilterChange: <K extends keyof TaskBoardFilters>(key: K, value: TaskBoardFilters[K]) => void;
  onResetFilters: () => void;
  totalTaskCount: number;
  filteredTaskCount: number;
  workspaces: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
  workflows: Array<{ id: string; name: string }>;
}
```

### Behaviors
1. Renders inputs and dropdown selectors for each filter dimension.
2. Displays total vs. filtered match counter (e.g. `"Showing 5 of 20 tasks"`).
3. If `filteredTaskCount < totalTaskCount` or any filter is non-default, renders active filter chips and a `"Clear filters"` action.

---

## 4. UI Component Contract: `TaskEmptyState`

```typescript
export interface TaskFilterEmptyStateProps {
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}
```

### Behaviors
1. Rendered inside the task board container when `totalTaskCount > 0` and `filteredTaskCount === 0`.
2. Explains clearly: `"No tasks match your selected filters."`
3. Provides a button: `"Reset filters"` that invokes `onResetFilters()`.
