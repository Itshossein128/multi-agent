# Implementation Plan: Task Board Multi-Property Filtering

**Branch**: `main` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)  
**Status**: Ready for Task Breakdown  

---

## Summary

Enhance the Tasks page at `http://localhost:3060/tasks` with simultaneous multi-property filtering:
1. **Multi-Property Filtering Engine**: Extend `filterTasks` in `apps/web/src/lib/taskBoardView.ts` to support simultaneous conjunction (AND logic) across workspace, project, status, priority, assigned agent, workflow, operational state (paused, blocked), and case-insensitive free-text search.
2. **Filter Controls UI (`TaskFilterBar`)**: Comprehensive, responsive filter bar in `apps/web/src/components/tasks/TaskFilterBar.tsx` providing selectors for Workspace, Project, Status, Priority, Agent, Workflow, and State, along with matching task counts (`Showing X of Y tasks`).
3. **Active Filter Management**: Removable active filter chips for quick single-filter deletion, plus a single-click "Clear all filters" button.
4. **Zero-Match Filter Empty State**: Informative empty-state component displayed when active filters yield zero tasks, featuring a clear-all call-to-action.
5. **URL Query Synchronization**: Bidirectional synchronization of filter state with URL query parameters (`?workspace=...&project=...&status=...`) for bookmarking and link sharing without triggering full page reloads.

---

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js 20+  
**Primary Dependencies**: Next.js 16 (App Router), React 19, `@tanstack/react-query`, Lucide React icons, Tailwind CSS  
**Storage**: N/A (Client-side view evaluation over loaded board dataset backed by existing `/api/tasks`, `/api/workspaces`, `/api/projects`)  
**Testing**: Jest (`tests/taskBoardView.test.ts`)  
**Target Platform**: Modern web browsers (desktop and tablet viewports)  
**Project Type**: Web application UI & client state module  
**Performance Goals**: Filter evaluation completes in <10ms for boards with up to 1,000 tasks; URL parameter synchronization without page reload delay  
**Constraints**:
- Pure client-side filtering logic with 100% unit-testable coverage
- Conjunction (AND) logic across distinct filter dimensions
- Respect unassigned states for workspaces, projects, agents, and workflows
- Clean, non-intrusive URL query parameters (default values stripped)  
**Scale/Scope**: 1 UI page, 1 pure view utility module, 2 new/enhanced UI components, 1 test suite  

---

## Constitution Check

| Gate | Status | Notes |
| :--- | :---: | :--- |
| **Tenant Isolation** | PASS | All workspace and project data loaded on `/tasks` is already scoped by the authenticated user's session and tenant. |
| **Non-Destructive Filtering** | PASS | Filtering operates in-memory; underlying tasks and backend state are unaffected by filter operations. |
| **Test-First & Coverage** | PASS | Pure filter evaluation, edge cases, and URL parameter mapping are tested via Jest in `tests/taskBoardView.test.ts`. |
| **Simplicity (YAGNI)** | PASS | Leverages existing Next.js App Router patterns, Tailwind components, and client-side array filtering without introducing extra state libraries. |

---

## Project Structure

### Documentation (this feature)

```text
specs/006-task-filtering/
├── plan.md              # This plan
├── research.md          # Phase 0: Technical decisions & evaluation logic
├── data-model.md        # Phase 1: Filter criteria model & URL schema
├── quickstart.md        # Phase 1: Automated & manual verification guide
├── contracts/           # Phase 1: Pure function, URL, and component contracts
│   └── filter-contract.md
└── checklists/
    └── requirements.md  # Quality validation checklist
```

### Source Code Architecture

```text
apps/web/src/
├── lib/
│   ├── taskBoardView.ts        # Extended filterTasks, URL serialization/deserialization, active chips
│   └── taskStatus.ts           # Status and priority domain definitions
├── components/tasks/
│   ├── TaskFilterBar.tsx       # Filter controls bar, active chips, and match counter
│   ├── TaskFilterEmptyState.tsx# Zero-match empty state banner
│   └── TaskBoardColumn.tsx     # Kanban column rendering
└── app/(authenticated)/tasks/
    └── page.tsx                # Tasks page: URL query sync, filter state wiring, board rendering

tests/
└── taskBoardView.test.ts       # Comprehensive unit tests for multi-property filtering & URL sync
```

---

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
| :--- | :--- | :--- |
| *None* | No architectural violations or external dependencies added. | N/A |
