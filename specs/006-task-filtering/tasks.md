# Tasks: Task Board Multi-Property Filtering

**Input**: Design documents from `/specs/006-task-filtering/`  
**Prerequisites**: `plan.md`, `spec.md`, `data-model.md`, `contracts/filter-contract.md`, `quickstart.md`  

---

## Phase 1: Setup & Types

**Purpose**: Define the filter criteria data model, types, and defaults.

- [x] T001 Define `TaskBoardFilters`, `TaskFilterPriority`, `TaskFilterOperationalState`, and `DEFAULT_TASK_BOARD_FILTERS` in `apps/web/src/lib/taskBoardView.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core filtering functions that MUST be complete before UI components and user story wiring can begin.

**⚠️ CRITICAL**: Foundational tasks block user story implementation.

- [x] T002 [P] Extend unit test suite in `tests/taskBoardView.test.ts` with test fixtures covering multi-attribute task filtering across workspace, project, status, agent, workflow, priority, and operational flags
- [x] T003 Implement multi-property simultaneous filter matching in `filterTasks()` in `apps/web/src/lib/taskBoardView.ts` supporting AND conjunction across search, status, workspaceId, projectId, priority, agent, workflow, and operationalState
- [x] T004 Implement `countActiveFilters()` and `getActiveFilterChips()` in `apps/web/src/lib/taskBoardView.ts` to compute active filter count and generate dismissible filter chips

**Checkpoint**: Core filtering logic is implemented and unit-tested; user story implementation can begin.

---

## Phase 3: User Story 1 - Multi-Property Simultaneous Task Filtering (Priority: P1) 🎯 MVP

**Goal**: Users can filter tasks simultaneously by workspace, project, and status (or status column category), including options for unassigned entities.

**Independent Test**: Filter tasks by workspace, project, and status individually and in combination; confirm only tasks matching all active filters are displayed across the board.

### Tests for User Story 1
- [x] T005 [P] [US1] Add unit tests in `tests/taskBoardView.test.ts` for workspace filtering (specific workspace UUID, "unassigned", "all") and project filtering (specific project UUID from `projectIds` array, "unassigned", "all")
- [x] T006 [P] [US1] Add unit tests in `tests/taskBoardView.test.ts` for status filtering (exact status match, column category mapped statuses, "all")

### Implementation for User Story 1
- [x] T007 [US1] Create Workspace and Project dropdown selector controls in `apps/web/src/components/tasks/TaskFilterBar.tsx` with options for All, Unassigned, and dynamically populated entities
- [x] T008 [US1] Create Status dropdown selector control in `apps/web/src/components/tasks/TaskFilterBar.tsx` mapping to canonical columns and statuses
- [x] T009 [US1] Wire workspace, project, and status filter state into `TaskBoardPage` in `apps/web/src/app/(authenticated)/tasks/page.tsx` and pass filtered tasks to `groupTasksByColumn`

**Checkpoint**: At this point, User Story 1 delivers a functional MVP allowing simultaneous filtering by workspace, project, and status.

---

## Phase 4: User Story 2 - Comprehensive Attribute Filtering (Priority: P1)

**Goal**: Users can filter tasks by priority, assigned agent, associated workflow, and operational flags (paused, dependency-blocked) in conjunction with other filters.

**Independent Test**: Filter tasks by priority, agent, workflow, and operational state individually and simultaneously; verify accurate task inclusion and exclusion.

### Tests for User Story 2
- [x] T010 [P] [US2] Add unit tests in `tests/taskBoardView.test.ts` for `operationalState` filtering ("paused" checking `task.paused`, "blocked" checking uncompleted dependencies)

### Implementation for User Story 2
- [x] T011 [US2] Add operational state selector (All, Paused, Blocked) to `apps/web/src/components/tasks/TaskFilterBar.tsx`
- [x] T012 [US2] Refactor and integrate existing Priority, Agent, and Workflow selectors into `apps/web/src/components/tasks/TaskFilterBar.tsx` with consistent dark theme styling and unassigned options
- [x] T013 [US2] Wire operational state, priority, agent, and workflow filter state into `apps/web/src/app/(authenticated)/tasks/page.tsx`

**Checkpoint**: All primary task attributes and operational flags can be filtered simultaneously.

---

## Phase 5: User Story 3 - Filter Controls, Active State Indicators, and One-Click Reset (Priority: P2)

**Goal**: Users see clear visual indicators of which filters are active, total vs. matching task count, removable filter pills, and a single-click "Clear all filters" mechanism.

**Independent Test**: Apply several filters, verify active indicators and count; click "Clear All" or remove single filter pills and verify the board returns to the default view.

### Implementation for User Story 3
- [x] T014 [US3] Implement active filter chips section with removable badges in `apps/web/src/components/tasks/TaskFilterBar.tsx`
- [x] T015 [US3] Implement matching task counter ("Showing X of Y tasks") and prominent "Clear all filters" button in `apps/web/src/components/tasks/TaskFilterBar.tsx`
- [x] T016 [US3] Wire reset and single-filter removal handlers in `apps/web/src/app/(authenticated)/tasks/page.tsx`

**Checkpoint**: Filter bar provides full visual feedback and effortless clearing of filters.

---

## Phase 6: User Story 4 - Empty State for Zero Filter Matches (Priority: P2)

**Goal**: When active filters yield zero matching tasks, display an informative empty-state banner with a one-click button to reset filters.

**Independent Test**: Select conflicting filters yielding 0 results; verify empty-state banner appears with a one-click button to reset filters.

### Implementation for User Story 4
- [x] T017 [P] [US4] Create `TaskFilterEmptyState` component in `apps/web/src/components/tasks/TaskFilterEmptyState.tsx` with FilterX icon, descriptive message, and reset button
- [x] T018 [US4] Render `TaskFilterEmptyState` across the task board container in `apps/web/src/app/(authenticated)/tasks/page.tsx` when total tasks > 0 and filtered tasks === 0

**Checkpoint**: Zero-match filter results are clearly explained with an instant recovery path.

---

## Phase 7: User Story 5 - Persistent & Shareable Filter State (Priority: P3)

**Goal**: Bidirectionally synchronize filter state with URL query parameters so filtered views can be bookmarked, shared, and survive page refreshes.

**Independent Test**: Set filters, copy the URL into a new tab/session, and verify the exact same filter configuration and task subset are loaded automatically.

### Tests for User Story 5
- [x] T019 [P] [US5] Add unit tests in `tests/taskBoardView.test.ts` for `parseFilterSearchParams()` and `serializeFilterSearchParams()`

### Implementation for User Story 5
- [x] T020 [US5] Implement `parseFilterSearchParams()` and `serializeFilterSearchParams()` in `apps/web/src/lib/taskBoardView.ts`
- [x] T021 [US5] Integrate URL search params synchronization with debounce for text search in `apps/web/src/app/(authenticated)/tasks/page.tsx` using `window.history.replaceState` and `popstate` event listening

**Checkpoint**: Filter states are preserved in the URL query string and can be bookmarked or shared.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Cross-cutting improvements, validation, responsive testing, and type safety.

- [x] T022 [P] Verify responsive layout of `TaskFilterBar` on desktop and tablet screen widths without wrapping defects in `apps/web/src/components/tasks/TaskFilterBar.tsx`
- [x] T023 Run `quickstart.md` validation scenarios and complete test suite (`pnpm test tests/taskBoardView.test.ts`)
- [x] T024 Run root and web typecheck (`npx tsc --noEmit` and `pnpm --filter web build`) and verify clean git status

---

## Dependencies & Execution Order

### Phase Dependencies
- **Phase 1 (Setup)**: Can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1. Blocks all user stories.
- **Phase 3 (User Story 1 - P1)**: Depends on Phase 2. Forms MVP.
- **Phase 4 (User Story 2 - P1)**: Depends on Phase 2. Integrates with US1 components.
- **Phase 5 (User Story 3 - P2)**: Depends on Phase 3 and Phase 4.
- **Phase 6 (User Story 4 - P2)**: Depends on Phase 3.
- **Phase 7 (User Story 5 - P3)**: Depends on Phase 1, Phase 2, and Phase 3.
- **Phase 8 (Polish)**: Depends on all user stories being complete.

### Parallel Opportunities
- T002, T005, T006, T010, T017, T019 can be prepared in parallel with their respective phase dependencies.
- Component development for `TaskFilterEmptyState.tsx` (T017) can proceed independently of `TaskFilterBar.tsx` (T007, T011, T014).

---

## Implementation Strategy

### MVP First (User Story 1 Only)
1. Complete Phase 1 (Setup & Types: T001).
2. Complete Phase 2 (Foundational: T002, T003, T004).
3. Complete Phase 3 (User Story 1: T005–T009).
4. **Validate MVP**: Test simultaneous filtering by workspace, project, and status.

### Incremental Delivery
1. Foundation ready (T001–T004).
2. MVP delivered (T005–T009) -> Workspace, Project, Status filtering.
3. Attribute filtering (T010–T013) -> Priority, Agent, Workflow, Operational State.
4. Active chips & Reset (T014–T016) -> Indicators, chips, and clear-all.
5. Empty state (T017–T018) -> Zero-match banner.
6. URL persistence (T019–T021) -> Bookmarkable and shareable views.
7. Verification & Polish (T022–T024).
