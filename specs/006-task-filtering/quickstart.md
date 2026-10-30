# Quickstart & Validation Guide: Task Board Multi-Property Filtering

**Feature**: `006-task-filtering`  
**Date**: 2026-10-22  
**Spec**: [spec.md](./spec.md)  
**Contracts**: [filter-contract.md](./contracts/filter-contract.md)  
**Data Model**: [data-model.md](./data-model.md)  

---

## 1. Prerequisites

1. Node.js 20+ and `pnpm` installed.
2. Dependencies installed:
   ```bash
   pnpm install
   ```
3. Web application and server running:
   ```bash
   pnpm --filter server dev &
   pnpm --filter web dev &
   ```
   Tasks page is accessible at `http://localhost:3060/tasks`.

---

## 2. Automated Unit & Integration Testing

Run the test suite verifying pure filtering logic and URL serialization:

```bash
pnpm test tests/taskBoardView.test.ts
```

### Expected Outcomes
- All existing tests pass (11+ tests).
- New unit test suites for:
  - Filtering by workspace (specific UUID and "unassigned").
  - Filtering by project (specific UUID and "unassigned").
  - Filtering by status (exact status and column category).
  - Simultaneous conjunction (e.g. Workspace + Project + Status + Priority).
  - Operational state filtering (paused tasks, blocked tasks).
  - URL serialization and deserialization (`parseFilterSearchParams`, `serializeFilterSearchParams`).

---

## 3. End-to-End Manual Verification Scenarios

### Scenario A: Simultaneous Multi-Property Filtering
1. Open `http://localhost:3060/tasks` in a web browser.
2. Select a specific **Workspace** from the dropdown. Verify only tasks linked to that workspace remain visible on the board.
3. While the workspace filter is active, select a specific **Project**. Verify only tasks that belong to *both* the selected workspace and project remain visible.
4. Select **Priority: High**. Verify only high-priority tasks in that project and workspace remain visible.
5. Inspect the counter: it should indicate `Showing X of Y tasks`.

### Scenario B: Active Filter Chips & Reset
1. With filters applied from Scenario A, verify removable chips appear below the filter bar (e.g., `Workspace: Core Engine [x]`, `Project: Alpha [x]`, `Priority: High [x]`).
2. Click the `[x]` on the `Priority` chip.
   - Verify only the Priority filter is removed.
   - Verify medium/low tasks in that workspace and project reappear.
3. Click the `"Clear all filters"` button.
   - Verify all filters return to "All".
   - Verify the complete board of tasks is restored.

### Scenario C: Zero-Match Empty State
1. Select a combination of filters that yields no matching tasks (e.g., Workspace X + Project Y + Priority Low).
2. Verify the board displays the empty state card:
   - Message: *"No tasks match the active filters"*
   - Action: *"Clear all filters"*
3. Click *"Clear all filters"* in the empty state card.
   - Verify all tasks reappear immediately.

### Scenario D: URL Sharing and Deep Linking
1. Apply filters: select a workspace, a project, and enter a search query.
2. Observe the browser address bar: URL updates with query parameters (e.g. `/tasks?workspace=...&project=...&q=...`).
3. Copy the URL, open it in an Incognito / private window or a new browser tab.
4. Verify the page opens with the exact same filter controls selected and displays the identical subset of tasks.
5. Click the browser Back button. Verify the filter controls update to the previous filter state.
