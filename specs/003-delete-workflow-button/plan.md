# Implementation Plan: Delete Workflow Button

**Branch**: `003-delete-workflow-button` | **Date**: 2026-10-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-delete-workflow-button/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Expose a **Delete** control in the studio workflow chrome so owners can permanently remove a workflow with confirm/cancel, clear error handling, and safe post-delete navigation. Reuse the existing authorized `DELETE /workflows/:id` studio route and ownership model; add the missing web client method, switcher/chrome button, query invalidation, and focused UI/API regression coverage. No new persistence schema and no bulk/restore scope.

## Technical Context

**Language/Version**: TypeScript 5.7 (Node execution server + Next.js web)

**Primary Dependencies**: Hono studio workflow routes (`WorkflowService.delete`), Next.js / React client components, TanStack Query (`["workflows"]` invalidation), `@multi-agent/types` `WorkflowDefinition`, existing `Button` UI primitives

**Storage**: Existing `studio_workflows` (Postgres) / in-memory studio store — **no schema change**; hard delete via current `StudioStore.deleteWorkflow`

**Testing**: Jest ownership/studio suites (extend or add workflow-delete UI/client coverage); optional Playwright studio lifecycle touch; `tsc` root + apps; `pnpm --filter web build`; `git diff --check`

**Target Platform**: Self-hosted Studio web + execution server (Windows/Linux Node)

**Project Type**: Monorepo web application (Next.js UI + Hono execution API + shared types)

**Performance Goals**: Interactive delete (confirm → list update) within normal UI responsiveness; no background jobs

**Constraints**: Owner/tenant fail-closed auth (non-owners already get not-found style denial); permanent delete only; match existing destructive UX (`window.confirm` naming the resource); do not leave a broken editor when deleting the open/last workflow; YAGNI — no typed-name challenge, soft-delete, or cascade UI

**Scale/Scope**: One primary UI surface (`WorkflowSwitcher` / open-workflow chrome), one client API method, thin wiring to existing DELETE; ~6–10 acceptance scenarios from the spec

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the Spec Kit placeholder. Applying **de facto Studio gates**:

| Gate | Status | Notes |
|------|--------|-------|
| Tenant/owner-scoped mutate | PASS | Reuse `WorkflowService.delete` + store principal filtering; unauthorized stays non-disclosing failure |
| Prefer existing contracts over parallel systems | PASS | Document/consume existing `DELETE /workflows/:id`; no second delete subsystem |
| Fail-closed authorization | PASS | UI only lists owner-visible workflows; server remains authoritative |
| Safe destructive UX | PASS | Confirm with workflow name + permanent wording; cancel is no-op |
| YAGNI / minimal surface | PASS | UI + client method + tests; no schema, bulk, restore, or new dialog library |
| Testable before broad UI polish | PASS | Contract/ownership already tested; plan adds client + post-delete navigation coverage |

**Gate result**: PASS (no unjustified violations). Complexity Tracking left empty.

### Post–Phase 1 re-check

Design keeps: existing DELETE contract, `window.confirm` parity with agents/tools, switcher placement, navigate-to-remaining or create-empty after delete, query invalidation — still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/003-delete-workflow-button/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   └── delete-workflow.openapi.yaml
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
apps/server/src/api/studio/
├── workflowRoutes.ts        # Existing DELETE /workflows/:id (document; change only if error UX gaps)
└── workflowService.ts       # Existing delete(id, principal)

src/studio/infrastructure/
├── postgres-studio-store.ts # Existing deleteWorkflow
└── in-memory-studio-store.ts

apps/web/src/
├── services/workflowService.ts              # Add deleteWorkflow(id); clear active id when needed
├── components/workflow/WorkflowSwitcher.tsx # Delete button + confirm + busy/error + navigation
└── store/useWorkflowStore.ts                # Optional thin helper if load/reset after delete needs store coordination

tests/
├── ownershipAuthorization.test.ts           # Already covers unauthorized DELETE → 404
└── (new or extended) workflowDelete*.test.ts / web-focused test
    # Owner delete success, cancel path (UI), post-delete list absence, open-workflow navigation

apps/web/e2e/
└── studio-lifecycle.spec.ts                 # Optional: create → delete → absent from switcher
```

**Structure Decision**: Stay inside the existing Studio web + execution API layout. Primary implementation is web client + `WorkflowSwitcher`; server path is already sufficient unless verification finds a response/UX gap.

## Complexity Tracking

> No constitution violations requiring justification.
