# Research: Delete Workflow Button

**Feature**: `003-delete-workflow-button`  
**Date**: 2026-10-04

## Research questions resolved

### 1. Does the server already support workflow deletion?

**Decision**: Yes. Reuse `DELETE /workflows/:id` → `WorkflowService.delete` → `StudioStore.deleteWorkflow` with principal scoping. Success body is `{ ok: true }`. Unauthorized/cross-tenant/non-owner attempts already fail closed (typically `404` “Workflow not found” / ownership mapping) without disclosing existence; unauthenticated → `401`.

**Rationale**: Spec assumptions state the gap is the studio UI. Ownership isolation is already covered in `tests/ownershipAuthorization.test.ts`.

**Alternatives considered**:
- New soft-delete endpoint — rejected (YAGNI; spec assumes permanent delete).
- Client-only removal from local state — rejected (would diverge from server truth).

### 2. Where should the Delete control live?

**Decision**: Primary placement on `WorkflowSwitcher` (open-workflow chrome): a destructive **Delete** button acting on the **currently selected** workflow (the one shown in the switcher / editor). That satisfies FR-010 “list/switcher and/or open-workflow chrome” without inventing a separate workflow library page.

**Rationale**: There is no dedicated multi-column workflow list page today; the switcher select is the workflow list surface. Agents/tools already delete from their detail chrome with the same pattern.

**Alternatives considered**:
- Per-option delete inside the `<select>` — poor accessibility/UX; rejected.
- Separate workflows admin page — out of scope / YAGNI for this feature.

### 3. Confirmation UX pattern?

**Decision**: Use `window.confirm` with the workflow **name** and permanent-delete wording, matching `AgentDetail` / `ToolDetail` / `NodePalette` (e.g. `Delete workflow “{name}”? This cannot be undone.`). Cancel returns immediately with no network call.

**Rationale**: Spec v1 explicitly allows simple confirm/cancel; the product already uses this for destructive actions. Avoids adding a dialog dependency for one button.

**Alternatives considered**:
- Typed-name challenge — deferred (spec out of scope for v1).
- Radix/shadcn AlertDialog — nicer a11y long-term, but inconsistent with current delete paths; deferred unless a shared dialog migration happens elsewhere.

### 4. Missing web client method?

**Decision**: Add `workflowService.deleteWorkflow(id: string): Promise<void>` calling `DELETE /workflows/:id` (same `request` helper as agents/tools). On success, clear `ACTIVE_WORKFLOW_KEY` when it matches the deleted id, then let the UI navigate and invalidate queries.

**Rationale**: `deleteAgent` / `deleteTool` already exist; workflow delete was the missing peer despite server support.

**Alternatives considered**: Inline `fetch` in the component — rejected (breaks service boundary used everywhere else).

### 5. Post-delete navigation when the open (or last) workflow is removed?

**Decision**:
1. Invalidate TanStack Query keys prefixed with `["workflows"]` (and any editor load that depends on them).
2. If other workflows remain in the refreshed list, `router.push(/org?workflowId=…)` to a remaining id (stable choice: first remaining by list order).
3. If none remain, call existing `createWorkflow` (default untitled name) and navigate to the new id so the editor is never left on a missing definition.
4. Surface failures via the switcher’s existing `error` / `role="alert"` path; do not navigate away on failure.

**Rationale**: `loadWorkflow` / editor assume a loadable definition; FR-007 requires a usable state. Auto-create-on-empty matches “empty/create state” and reuses the create path already on the switcher.

**Alternatives considered**:
- Navigate to `/org` with no id and hope default load — fragile if active id still points at deleted workflow.
- Leave a blank canvas without persisting — inconsistent with server-backed studio model.

### 6. Dirty / unsaved editor state?

**Decision**: Before delete confirm (or immediately before confirm), if the store reports dirty for the open workflow being deleted, either include discard wording in the confirm message (agent/tool pattern) or run the existing `canLeave()` discard confirm first. Prefer a **single** confirm that states permanent delete and that unsaved edits will be discarded when `dirty`.

**Rationale**: Avoid double-confirm friction while preventing surprise loss of unrelated navigate guards.

**Alternatives considered**: Block delete while dirty until save — rejected (user may be deleting precisely because they want to abandon the draft).

### 7. Related runs / tasks referencing the workflow?

**Decision**: v1 does **not** add cascade cleanup or preflight blocks beyond what the server already does. Historical runs/tasks may retain a `workflowId` that no longer resolves to a definition; existing run/task UIs already tolerate missing labels where applicable. If delete later becomes blocked by dependents, surface the server error string in the switcher alert (FR-009).

**Rationale**: Spec assumptions defer cascade UI; current `deleteWorkflow` is a direct row delete.

**Alternatives considered**: Block delete when runs exist — product change beyond stated scope; not evidenced in current service.

### 8. Authorization visibility in the UI?

**Decision**: Do not add a special “not owner” button state. The switcher only lists workflows returned by `GET /workflows` for the principal (owner-scoped). Server remains authoritative if IDs are forged.

**Rationale**: Matches list isolation already proven in ownership tests.

## Summary of unknowns

All Technical Context items resolved; no remaining `NEEDS CLARIFICATION` for planning. Implementation may choose exact remaining-workflow selection order (first in list vs. previous neighbor) without changing contracts.
