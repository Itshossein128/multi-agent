# Feature Specification: Delete Workflow Button

**Feature Branch**: `003-delete-workflow-button`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "add a button to make it possible to delete a workflow."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Delete a workflow from the studio UI (Priority: P1)

A signed-in user who owns a workflow opens the studio, finds a clearly labeled Delete control for that workflow, confirms they intend to remove it, and the workflow is permanently removed from their list so it no longer appears or can be opened.

**Why this priority**: Without a delete control in the product UI, users cannot clean up obsolete or mistaken workflows even when removal is already supported behind the scenes. This is the core value of the feature.

**Independent Test**: Create a disposable workflow as an authenticated owner, use the Delete button and confirmation, then verify the workflow is gone from the list and cannot be opened again.

**Acceptance Scenarios**:

1. **Given** the user owns at least one workflow and is viewing the studio workflow list or switcher, **When** they look for deletion, **Then** they see a Delete control associated with that workflow.
2. **Given** the user activates Delete on a workflow they own, **When** the confirmation step appears, **Then** they can cancel and the workflow remains unchanged.
3. **Given** the user activates Delete on a workflow they own, **When** they confirm deletion, **Then** the workflow is removed permanently, disappears from the list/switcher, and navigating to it shows that it is no longer available.
4. **Given** deletion succeeds while the deleted workflow was the one currently open, **When** the UI finishes the delete, **Then** the user is taken to a sensible remaining workflow or an empty/create state rather than a broken editor.

---

### User Story 2 - Prevent accidental or unauthorized deletion (Priority: P1)

Destructive deletion is gated by an explicit confirmation. Users who are not allowed to delete a workflow never see a working Delete path that removes someone else’s workflow.

**Why this priority**: Workflows may represent substantial design work; accidental or unauthorized removal would be high-impact and hard to recover from.

**Independent Test**: Attempt deletion with cancel, with confirm, and (where another user’s workflow is visible or addressable) verify unauthorized deletion is refused without removing the workflow.

**Acceptance Scenarios**:

1. **Given** a user starts delete on a workflow, **When** they dismiss or cancel the confirmation, **Then** no deletion occurs and the workflow still appears and opens normally.
2. **Given** a user is not permitted to delete a given workflow, **When** they attempt deletion (via UI if shown, or equivalent access), **Then** the workflow is not deleted and the user receives a clear failure indication.
3. **Given** a delete attempt fails (permission, not found, or temporary error), **When** the failure is shown, **Then** the UI remains usable and the workflow list reflects the true remaining state after refresh or error recovery.

---

### User Story 3 - Understand what will be lost before confirming (Priority: P2)

Before confirming, the user understands that deletion is permanent and which workflow will be removed (by name or other recognizable label).

**Why this priority**: Confirmation without identity context still risks deleting the wrong workflow when several exist.

**Independent Test**: Open delete confirmation for a named workflow and verify the prompt identifies that workflow and states that removal is permanent.

**Acceptance Scenarios**:

1. **Given** the user activates Delete on a workflow named “Onboarding Intake”, **When** the confirmation appears, **Then** the prompt identifies “Onboarding Intake” (or equivalent clear label) as the target.
2. **Given** the confirmation is shown, **When** the user reads it, **Then** it is clear that confirming permanently removes the workflow from their workspace.

---

### Edge Cases

- What happens when the user deletes the only remaining workflow?
- What happens when the user deletes the workflow that is currently open in the editor?
- What happens if the workflow was already deleted by another session before confirmation completes?
- What happens if the user lacks permission or is signed out when they confirm?
- What happens if related runs, tasks, or history still reference the workflow—does deletion proceed, and what does the user see afterward?
- How does the UI behave if the network fails mid-delete (no double-delete side effects; list eventually consistent with server)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The studio MUST expose a Delete control for each workflow the current user is allowed to delete.
- **FR-002**: Activating Delete MUST require an explicit confirmation before any removal occurs.
- **FR-003**: The confirmation MUST identify the target workflow by a human-readable label (name) and MUST state that deletion is permanent.
- **FR-004**: On confirmed delete by an authorized owner, the system MUST permanently remove that workflow so it no longer appears in lists/switchers and cannot be opened as an existing workflow.
- **FR-005**: Canceling or dismissing confirmation MUST leave the workflow and its definition unchanged.
- **FR-006**: Users MUST NOT be able to delete workflows they do not own (or are otherwise unauthorized to delete); unauthorized attempts MUST fail without removing the workflow.
- **FR-007**: After a successful delete of the currently open workflow, the UI MUST navigate to another available workflow or a clear empty/create state.
- **FR-008**: After a successful delete, workflow lists and switchers MUST update so the deleted workflow no longer appears without requiring a full page reload.
- **FR-009**: When deletion fails, the system MUST show a clear, user-visible error and MUST keep the workflow available if it was not actually removed.
- **FR-010**: Delete MUST only be offered for workflows in contexts where the user can identify the specific workflow being acted on (list/switcher and/or open-workflow chrome).

### Key Entities

- **Workflow**: A named studio workflow definition owned by a user within a tenant; the entity removed by this feature.
- **Delete Confirmation**: The pre-delete step that names the workflow and requires explicit user approval before permanent removal.
- **Workflow Owner / Principal**: The authenticated actor whose ownership (or equivalent permission) determines whether Delete is allowed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An authorized user can permanently remove an owned workflow from the studio UI in under 30 seconds (locate Delete → confirm → gone from list).
- **SC-002**: 100% of successful delete attempts remove the workflow from subsequent list views for that user; canceled attempts leave the workflow intact 100% of the time.
- **SC-003**: At least 95% of first-time users in usability checks correctly understand that confirmation permanently deletes the named workflow (no surprise data loss after cancel).
- **SC-004**: Unauthorized delete attempts never result in the target workflow being removed (0 successful unauthorized deletes in verification).
- **SC-005**: After deleting the open workflow, users reach a usable studio state (another workflow or empty/create) with no stuck/broken editor in 100% of successful cases tested.

## Assumptions

- Backend removal capability for owned workflows already exists; this feature’s primary gap is exposing a safe Delete button and confirmation in the studio UI and wiring it to that capability.
- Deletion is permanent (not soft-delete/archive) unless a later feature introduces recovery.
- Only the workflow owner (same permission model already used for workflow update/delete) may delete; other org members cannot delete someone else’s workflow.
- Related historical runs or tasks may remain as historical records or become inaccessible from the deleted definition; this feature does not add a full cascade-cleanup UI. If the product already blocks delete when dependents exist, the UI MUST surface that block clearly; otherwise permanent workflow removal proceeds as today.
- Placement: Delete is available from the workflow switcher/list and from the open workflow’s chrome so users can delete without hunting through unrelated screens.
- Confirmation is a simple confirm/cancel step (no typed-name challenge) for v1, because workflows are owner-scoped and recoverable via recreation if needed.
- Bulk delete of multiple workflows is out of scope.
- Restoring a deleted workflow is out of scope.
