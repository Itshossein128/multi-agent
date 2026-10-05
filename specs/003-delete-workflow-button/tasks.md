---
description: "Task list for Delete Workflow Button"
---

# Tasks: Delete Workflow Button

**Input**: Design documents from `/specs/003-delete-workflow-button/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Plan and quickstart request focused owner-delete / post-delete list coverage and ownership regression — include test tasks where listed. UI confirm copy is validated manually or via a small unit/helper assertion when practical.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Studio API: `apps/server/src/api/studio/`
- Studio store: `src/studio/infrastructure/`
- Web UI: `apps/web/src/components/workflow/`, `apps/web/src/services/`, `apps/web/src/store/`
- Tests: `tests/`, optional `apps/web/e2e/`
- Feature docs: `specs/003-delete-workflow-button/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm design artifacts and inventory existing delete touchpoints before UI work

- [x] T001 Confirm feature docs complete under `specs/003-delete-workflow-button/` (plan.md, spec.md, research.md, data-model.md, contracts/delete-workflow.openapi.yaml, quickstart.md) and note feature id `003-delete-workflow-button`
- [x] T002 [P] Inventory existing delete path in `apps/server/src/api/studio/workflowRoutes.ts` (`DELETE /workflows/:id`), `apps/server/src/api/studio/workflowService.ts` (`delete`), `src/studio/infrastructure/postgres-studio-store.ts` / `in-memory-studio-store.ts` (`deleteWorkflow`), and confirm web gap: no `deleteWorkflow` in `apps/web/src/services/workflowService.ts` and no Delete control in `apps/web/src/components/workflow/WorkflowSwitcher.tsx`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Web client delete API that all user stories share — MUST complete before story UI work

**WARNING: CRITICAL**: No user story UI work can begin until this phase is complete

- [x] T003 Add `deleteWorkflow(id: string): Promise<void>` to `apps/web/src/services/workflowService.ts` that `DELETE`s `/workflows/${encodeURIComponent(id)}` via the existing `request` helper (parity with `deleteAgent` / `deleteTool`)
- [x] T004 On successful `deleteWorkflow` in `apps/web/src/services/workflowService.ts`, clear the active workflow storage key when it matches the deleted `id` (`ACTIVE_WORKFLOW_KEY` / `setActiveWorkflowId(null)` path already used by create/save)
- [x] T005 [P] Verify server contract still matches `specs/003-delete-workflow-button/contracts/delete-workflow.openapi.yaml` for owner success `{ ok: true }`, unauthenticated `401`, and non-owner/missing `404` in `apps/server/src/api/studio/workflowRoutes.ts` + `workflowService.ts` — change server only if response shape/UX gaps block the web client

**Checkpoint**: Foundation ready — web can call authorized delete; story UI can proceed

---

## Phase 3: User Story 1 - Delete a workflow from the studio UI (Priority: P1) MVP

**Goal**: Owner sees a Delete control on the open workflow, confirms, workflow is permanently removed, list updates, and the editor navigates to a remaining workflow or a fresh create state

**Independent Test**: Create a disposable owned workflow, use Delete + confirm, verify it is gone from the switcher and cannot be opened; deleting the open/last workflow leaves a usable editor

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T006 [P] [US1] Add failing owner happy-path coverage in `tests/workflowDelete.test.ts` (or extend an existing studio workflow suite): authenticated owner `DELETE /workflows/:id` returns `{ ok: true }`; subsequent `GET /workflows` and `GET /workflows/:id` no longer expose that id
- [x] T007 [P] [US1] Add failing assertion that after owner delete of workflow A while B exists, list contains B and not A (same suite as T006)

### Implementation for User Story 1

- [x] T008 [US1] Add a destructive **Delete** `Button` on `apps/web/src/components/workflow/WorkflowSwitcher.tsx` for the currently selected/open workflow (`definition.id` / `definition.name`), disabled while `busy`
- [x] T009 [US1] On Delete confirm in `WorkflowSwitcher.tsx`, call `workflowService.deleteWorkflow(definition.id)`, set `busy`/clear `error`, and `queryClient.invalidateQueries({ queryKey: ["workflows"] })` so the switcher list refreshes without a full page reload (FR-008)
- [x] T010 [US1] After successful delete in `WorkflowSwitcher.tsx`, navigate with `router.push`: if other workflows remain in the refreshed list, go to the first remaining id (`/org?workflowId=...`); if none remain, call `workflowService.createWorkflow` (default untitled name) and navigate to the new id so the editor is never stuck on a missing definition (FR-007)
- [x] T011 [US1] If `useWorkflowStore` load/reset is required after navigation, coordinate minimal reset in `apps/web/src/store/useWorkflowStore.ts` only as needed so opening the post-delete target does not keep stale deleted definition state (no store change required: `WorkflowEditor` reloads on `workflowId` search param)

**Checkpoint**: US1 independently testable — Delete -> confirm -> gone from list; open/last workflow ends in usable state

---

## Phase 4: User Story 2 - Prevent accidental or unauthorized deletion (Priority: P1)

**Goal**: Cancel leaves the workflow untouched; failures show a clear alert and keep the UI usable; unauthorized deletes cannot remove another user's workflow

**Independent Test**: Cancel confirm -> no network delete / workflow still present; force delete failure -> alert + workflow remains; non-owner DELETE still fails closed (existing ownership behavior)

### Tests for User Story 2

- [x] T012 [P] [US2] Confirm (or extend if gaps) unauthorized/unauthenticated delete cases remain green in `tests/ownershipAuthorization.test.ts` (Bob/Eve/`401` cannot delete Alice's workflow; Alice's workflow remains)
- [x] T013 [P] [US2] Add failing coverage in `tests/workflowDelete.test.ts` for delete failure surfacing contract: after a rejected DELETE, workflow still appears in owner list (permission/not-found simulation)

### Implementation for User Story 2

- [x] T014 [US2] In `apps/web/src/components/workflow/WorkflowSwitcher.tsx`, if user cancels `window.confirm`, return immediately with **no** `deleteWorkflow` call and no navigation (FR-005)
- [x] T015 [US2] On delete failure in `WorkflowSwitcher.tsx`, set user-visible `error` (`role="alert"` path already present), clear `busy`, do not navigate away, and leave the current workflow selectable (FR-009)
- [x] T016 [US2] When editor is dirty for the open workflow, include discard wording in the delete confirm message in `WorkflowSwitcher.tsx` (parity with `apps/web/src/components/agents/AgentDetail.tsx` / tools) so accidental delete of unsaved work is explicit
- [x] T017 [US2] Do not add a forged "delete other user's workflow" UI path; rely on owner-scoped `listWorkflows` + server fail-closed DELETE — document in code comment near the Delete handler in `WorkflowSwitcher.tsx` that authorization is server-enforced per `contracts/delete-workflow.openapi.yaml`

**Checkpoint**: US2 independently testable — cancel is no-op; errors recoverable; ownership still fail-closed

---

## Phase 5: User Story 3 - Understand what will be lost before confirming (Priority: P2)

**Goal**: Confirmation identifies the workflow by name and states that deletion is permanent

**Independent Test**: Activate Delete on a named workflow; confirm dialog text includes that name and permanence language ("cannot be undone" / equivalent)

### Implementation for User Story 3

- [x] T018 [US3] Set confirm copy in `apps/web/src/components/workflow/WorkflowSwitcher.tsx` to include the human-readable workflow `name` (e.g. `Delete workflow "{name}"? This cannot be undone.`) per research and FR-003
- [x] T019 [P] [US3] Add a small pure helper (optional) e.g. `apps/web/src/lib/workflow/deleteConfirmMessage.ts` that builds the confirm string from `name` + optional dirty flag, and unit-test the string includes the name and permanence phrase in `tests/workflowDeleteConfirmMessage.test.ts` (or colocated web test if that is the project norm)

**Checkpoint**: US3 independently testable — confirm names the workflow and states permanence

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end validation and optional browser smoke

- [x] T020 [P] Optionally extend `apps/web/e2e/studio-lifecycle.spec.ts` with create -> Delete -> confirm -> workflow absent from switcher (skip if e2e harness cannot drive `window.confirm` reliably; note in PR)
- [x] T021 Run validation from `specs/003-delete-workflow-button/quickstart.md`: focused Jest suites, `npx tsc --noEmit`, `pnpm --filter web build`, `git diff --check`
- [x] T022 [P] Manual pass of quickstart scenarios A-E (happy path, multi-workflow navigate, last-workflow create, auth, failure surfacing) and fix any gaps in `WorkflowSwitcher.tsx` / `workflowService.ts`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS** all user stories
- **User Story 1 (Phase 3)**: Depends on Foundational — MVP
- **User Story 2 (Phase 4)**: Depends on Foundational; practically builds on US1 Delete button in the same file (`WorkflowSwitcher.tsx`) — implement after or carefully merge with US1
- **User Story 3 (Phase 5)**: Depends on confirm existing from US1/US2 — refine copy/helper
- **Polish (Phase 6)**: Depends on desired stories complete

### User Story Dependencies

- **User Story 1 (P1)**: After Foundational — delivers MVP delete + navigation
- **User Story 2 (P1)**: After Foundational; shares `WorkflowSwitcher.tsx` with US1 (same-file sequencing recommended: US1 then US2)
- **User Story 3 (P2)**: After US1 confirm exists; can parallelize helper/tests with US2 if copy API is stable

### Within Each User Story

- Tests (where listed) first and failing before implementation
- Client method (Phase 2) before UI wiring
- Delete + invalidate before navigation rules
- Confirm cancel/error handling before polish copy extraction

### Parallel Opportunities

- T001 / T002 in Setup
- T005 with T003-T004 review once client shape is known
- T006 / T007 test tasks in parallel
- T012 / T013 test tasks in parallel
- T019 helper/tests parallel with T018 once message contract agreed
- T020 / T022 polish items in parallel after implementation

---

## Parallel Example: User Story 1

```bash
# Tests in parallel (before UI):
Task: "Add owner DELETE happy-path in tests/workflowDelete.test.ts"
Task: "Add post-delete list assertion for remaining workflow B"

# Then sequential UI in WorkflowSwitcher + service (service already from Phase 2):
Task: "Add Delete button in apps/web/src/components/workflow/WorkflowSwitcher.tsx"
Task: "Wire deleteWorkflow + invalidateQueries"
Task: "Navigate to remaining or createWorkflow when last"
```

---

## Parallel Example: User Story 2

```bash
# Auth regression + failure list assertion in parallel:
Task: "Confirm ownershipAuthorization DELETE cases"
Task: "Add rejected DELETE still-listed assertion in tests/workflowDelete.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (`deleteWorkflow` client)
3. Complete Phase 3: User Story 1 (button, confirm, delete, list refresh, navigation)
4. **STOP and VALIDATE** with Independent Test + T006/T007
5. Demo MVP

### Incremental Delivery

1. Setup + Foundational -> Foundation ready
2. US1 -> owner can delete from studio (MVP)
3. US2 -> cancel/errors/auth hardened
4. US3 -> confirm copy clarity (+ optional helper test)
5. Polish -> quickstart + optional e2e

### Parallel Team Strategy

1. Together: Setup + Foundational
2. Dev A: US1 UI + navigation in `WorkflowSwitcher.tsx`
3. Dev B: `tests/workflowDelete.test.ts` + ownership confirmation (merge before claiming US1 done)
4. Same file (`WorkflowSwitcher.tsx`): serialize US2/US3 confirm/error/copy edits after US1 lands

---

## Notes

- [P] tasks = different files, no dependencies on incomplete work
- Server DELETE already exists — do not rebuild persistence
- Prefer `window.confirm` parity with agents/tools (research decision)
- Bulk delete and restore are out of scope
- Suggested MVP: Phases 1-3 (US1) only
- Implementation note (T011): no `useWorkflowStore` change required; editor reload follows `workflowId` navigation
