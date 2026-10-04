# Quickstart: Delete Workflow Button Validation

**Feature**: `003-delete-workflow-button`  
**Date**: 2026-10-04  
**Contracts**: [delete-workflow.openapi.yaml](./contracts/delete-workflow.openapi.yaml)  
**Data model**: [data-model.md](./data-model.md)

This guide validates the feature after implementation. It is not an implementation walkthrough.

## Prerequisites

- Repo root install: `pnpm install`
- Types build when needed: `pnpm run build:types`
- Authenticated studio session in the web app (local org user who can create workflows)
- Execution server reachable the same way as normal studio authoring

## Focused automated checks

```bash
# Ownership / unauthorized delete already fail closed
pnpm test --runInBand -- tests/ownershipAuthorization.test.ts

# Add or extend suite covering owner DELETE success + list absence
# (exact filename from tasks.md — e.g. tests/workflowDelete.test.ts)
pnpm test --runInBand -- tests/workflowDelete.test.ts
```

If the new suite is named differently in `tasks.md`, run that path instead; keep coverage of the scenarios below.

Optional browser smoke (when wired):

```bash
pnpm --filter web exec playwright test e2e/studio-lifecycle.spec.ts
```

## Typecheck and builds

```bash
npx tsc --noEmit
pnpm --filter server exec tsc --noEmit
pnpm --filter web build
git diff --check
```

## Manual / contract scenarios (expected outcomes)

### A. Happy path delete (open workflow)

1. Sign in; create a disposable workflow (e.g. “Delete Me”) and open it in the studio.
2. In the workflow switcher/chrome, activate **Delete**.
3. Confirmation names “Delete Me” and indicates permanence → **Cancel** → workflow still open and listed.
4. Activate **Delete** again → **Confirm** → workflow disappears from the switcher; editor shows another workflow or a fresh create state (not a broken missing-id editor).
5. `GET /workflows` (or switcher list) no longer includes the deleted id; opening the old id is unavailable.

### B. Delete when multiple workflows exist

1. Ensure at least two owned workflows exist; open workflow A.
2. Delete A with confirm.
3. Land on remaining workflow B (or another remaining id); A absent from the select list without full page reload.

### C. Delete last workflow

1. Delete until one owned workflow remains; delete that last one with confirm.
2. UI reaches a usable create/empty outcome (fresh untitled workflow or equivalent), not a stuck error canvas.

### D. Authorization

1. As user Bob, attempt `DELETE /workflows/{aliceWorkflowId}` → failure (`404` per existing contract); Alice’s workflow still listed for Alice.
2. Unauthenticated `DELETE` → `401`.

### E. Failure surfacing

1. Force a failed delete (offline / stopped API) after confirm.
2. User-visible error appears; workflow remains selectable; retry possible after recovery.

## Acceptance mapping

| Spec criterion | How to verify |
|----------------|---------------|
| SC-001 | Manual A completes in under 30s |
| SC-002 | A cancel vs confirm; list reflects outcome |
| SC-003 | Confirm copy names workflow + permanence |
| SC-004 | Scenario D |
| SC-005 | Scenarios A–C post-delete editor state |
