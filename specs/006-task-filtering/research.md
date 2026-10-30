# Research & Technical Decisions: Task Board Multi-Property Filtering

**Feature**: `006-task-filtering`  
**Date**: 2026-10-22  
**Spec**: [spec.md](./spec.md)  

---

## 1. Multi-Property Conjunction & Filter Evaluation

### Context & Problem
Users need to filter tasks simultaneously by status, project, workspace, priority, assigned agent, workflow, and operational state (paused, dependency-blocked), in addition to free-text search across titles and descriptions.

### Decision
- **Evaluation Paradigm**: Pure client-side filter pipeline (`filterTasks(tasks, filters, options)`) operating on the loaded in-memory task array in `apps/web/src/lib/taskBoardView.ts`.
- **Combination Logic**: Conjunction (AND) across all active filter dimensions. A task matches if and only if it satisfies all active criteria.
  - **Search**: Case-insensitive substring match against `title` or `description`.
  - **Status**: Matches exact task `status` OR matches column category (e.g. selecting `backlog` matches both `backlog` and `todo`; selecting `running` matches `running` and `in_progress`).
  - **Workspace**: 
    - `"all"`: no workspace restriction.
    - `"unassigned"`: `!task.workspaceId`.
    - Specific ID: `task.workspaceId === filters.workspaceId`.
  - **Project**:
    - `"all"`: no project restriction.
    - `"unassigned"`: `!task.projectIds || task.projectIds.length === 0`.
    - Specific ID: `task.projectIds?.includes(filters.projectId)`.
  - **Priority**: `"all"` or exact match with `task.priority` (`high`, `medium`, `low`).
  - **Agent**:
    - `"all"`: no agent restriction.
    - `""` / `"unassigned"`: `!task.assignedAgent && (!task.assignedAgents || task.assignedAgents.length === 0)`.
    - Specific agent name/ID: `task.assignedAgent === agent || task.assignedAgents?.includes(agent)`.
  - **Workflow**:
    - `"all"`: no workflow restriction.
    - `"unassigned"`: `!task.workflowId`.
    - Specific workflow ID: `task.workflowId === filters.workflow`.
  - **Operational State**:
    - `"all"`: no restriction.
    - `"paused"`: `task.paused === true`.
    - `"blocked"`: task has unfinished dependencies evaluated using `tasksById`.

### Rationale
- Pure client-side filtering offers instantaneous response times (<10ms) without triggering network round-trips or loading spinners during keystrokes or dropdown clicks.
- Conjunction (AND) matches standard operational expectations (e.g., "show me high-priority tasks in Workspace X for Project Y").
- Handling "unassigned" explicitly prevents orphaned tasks from becoming invisible.

### Alternatives Considered
- **Server-side query filtering**: Sending filter parameters as query params to `/api/tasks?workspaceId=...`. Rejected because `/api/tasks` is polled every 3 seconds and feeds the full Kanban board. Client-side filtering ensures instant UI updates, works offline/during drag-and-drop, and avoids unnecessary database query variations.

---

## 2. URL Query Parameter Synchronization & Deep Linking

### Context & Problem
Operators need to bookmark filtered views, share URLs with colleagues (e.g., `http://localhost:3060/tasks?workspace=ws-123&priority=high`), and refresh the browser without losing filter criteria.

### Decision
- **URL Param Schema**:
  - `q`: search text (omitted if empty)
  - `status`: status or column id (omitted if `"all"`)
  - `workspace`: workspace ID or `"unassigned"` (omitted if `"all"`)
  - `project`: project ID or `"unassigned"` (omitted if `"all"`)
  - `priority`: `high` | `medium` | `low` (omitted if `"all"`)
  - `agent`: agent identifier or `"unassigned"` (omitted if `"all"`)
  - `workflow`: workflow ID or `"unassigned"` (omitted if `"all"`)
  - `state`: `paused` | `blocked` (omitted if `"all"`)
- **Synchronization Mechanism**:
  - Read query parameters on initial page mount using `useSearchParams()`.
  - When filters update, synchronize to URL using `window.history.replaceState` (or `router.replace` with `scroll: false`) with debounce on text search to prevent polluting browser history with single characters.
  - Browser Back/Forward navigation handles `popstate` to restore filter state.

### Rationale
- Minimal URL query footprint: Default values (`"all"`, empty strings) are stripped to keep URLs clean and human-readable.
- `replaceState` updates the URL in the address bar without triggering Next.js App Router full page re-renders or resetting local focus.

### Alternatives Considered
- **LocalStorage only**: Does not allow link sharing or bookmarking.
- **`router.push` on every keypress**: Clutters browser history and causes noticeable lag in Next.js App Router.

---

## 3. Filter Bar UX, Active Indicators, and Clear Controls

### Context & Problem
With 7 filter dimensions plus search, the interface must remain clean, intuitive, and discoverable without overwhelming the Kanban board layout.

### Decision
- **Two-Tier Layout**:
  - **Top Row**: Primary search input, Workspace selector, Project selector, Status selector, Priority selector, More Filters dropdown (or secondary selectors for Agent, Workflow, State), and a match counter (e.g., `"Showing 8 of 42 tasks"`).
  - **Active Filter Chips Row**: Displays active non-default filters as removable pills (e.g., `Workspace: Core Engine [x]`, `Priority: High [x]`) and a prominent `"Clear all"` button.
- **Zero-Match Empty State**:
  - When `tasks.length > 0` but `filteredTasks.length === 0`, render a dedicated board banner/card:
    - Clear icon (`FilterX`)
    - Message: *"No tasks match the active filters"*
    - Button: *"Clear all filters"*

### Rationale
- Operators immediately see what filters are narrowing their view.
- Active chips allow removing an individual constraint without resetting the entire configuration.
- The empty state prevents confusing "no matching tasks" with "no tasks exist in the workspace".

### Alternatives Considered
- **Modal-only filter dialog**: Hides filter state behind an extra click and slows down rapid scanning.
- **Single monolithic dropdown**: Harder to see multi-attribute combinations at a glance.

---

## 4. Drag-and-Drop Compatibility with Active Filters

### Context & Problem
When a user moves a task card between columns while filters are active:
- If filtering by status (e.g. `status=running`) and the user moves a card from `running` to `completed`, what should happen?

### Decision
- The status transition executes normally against the backend store (`moveTask`).
- If the card no longer satisfies the active status filter, it naturally leaves the visible filtered list (with standard optimistic UI behavior).
- If the card still satisfies all active filters (e.g. filtering was by workspace or priority), it moves into the destination column seamlessly.

### Rationale
- Predictable and standard Kanban behavior; avoids blocking legitimate workflow movements while honoring the selected filter criteria.
