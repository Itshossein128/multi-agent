# Implementation Plan: Clarification Response End-to-End

**Branch**: `002-clarification-response` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-clarification-response/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Enable operators to **see, answer, and continue** agent clarification requests end-to-end without false Done states. Extend the existing `needs_human` / `ApprovalManager` pause-resume path with a structured clarification contract (question list, answers, metadata), dedicated read/submit APIs distinct from Approve/Reject, task-detail UI, answer persistence/idempotency, and a controlled legacy follow-up run for completed free-text clarification cases. Preserve the shipped task lifecycle guard: **only structured `success` may mark a task completed**; `run.completed` alone never implies Done.

## Technical Context

**Language/Version**: TypeScript 5.7 (Node execution server + Next.js web)

**Primary Dependencies**: Hono (runs + studio APIs), LangGraph interrupt/resume (`ApprovalManager`, `workflowCompiler` `pendingHuman`), `@multi-agent/types` (`NodeResultEnvelope`, `NeedsHumanInfo`, `ApprovalRequest`), Next.js / React / TanStack Query (web)

**Storage**: Existing `studio_approvals` + `studio_runs.paused_context` JSONB (and in-memory mirrors); extend approval `context`/`response`/`metadata` (and optionally run/task metadata) for structured clarification + answers — prefer no new table unless persistence gaps force a small migration

**Testing**: Jest root suites (`taskBoardPhase2`, `workflowRuntimeContracts`, new clarification-focused tests); `tsc` root + `apps/server`; `pnpm --filter server build`; `pnpm --filter web build`; `git diff --check`

**Target Platform**: Self-hosted Studio web + execution server (Windows/Linux Node)

**Project Type**: Monorepo web application (Next.js UI + Hono execution API + shared types)

**Performance Goals**: Clarification read/submit within interactive UI expectations; resume path must not re-invoke the paused-step provider call when `pendingHuman` safe-resume is available

**Constraints**: Tenant/owner authorization on all clarification endpoints; reuse approval pause machinery (no parallel pause system); backward-compatible `NeedsHumanInfo` (`reason` remains valid alone); do not regress lifecycle sync from commit `bdd4798`; do not mutate live production sample task/run IDs

**Scale/Scope**: Contract extension + 2 clarification HTTP surfaces (run primary, task convenience), task-detail clarification form, legacy extract + follow-up start, focused regression tests (~14 scenarios from spec)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the Spec Kit placeholder. Applying **de facto Studio / runtime gates**:

| Gate | Status | Notes |
|------|--------|-------|
| Tenant-scoped access for Studio/run mutate | PASS | Clarification GET/POST use existing principal + resource ownership checks |
| Prefer evolving existing contracts over parallel systems | PASS | Extend `needs_human` + `ApprovalManager`; no second pause subsystem |
| Fail-closed structured outcomes (no free-text as sole decision source) | PASS | Structured clarification is source of truth; legacy text only for migration detection/extraction |
| Preserve shipped lifecycle guard (Done only on structured success) | PASS | Explicit non-regression on `syncTaskWithRun` / `taskStatusForCompletedRun` |
| Safe resume: no duplicate provider call on paused agent step | PASS | Keep `pendingHuman` skip-provider path; inject answers into resume context |
| Testable services/contracts before UI-only work | PASS | Plan includes types, API, runtime, then UI + verification suite |
| YAGNI: minimal storage change | PASS | Prefer approval/run JSON fields; migration only if readback cannot be guaranteed |

**Gate result**: PASS (no unjustified violations). Complexity Tracking left empty.

### Post–Phase 1 re-check

Design keeps: extended `NeedsHumanInfo`, clarification endpoints separate from approve/reject, resume via `ApprovalManager`, legacy follow-up only after explicit submit, sync mapping unchanged in spirit — still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/002-clarification-response/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   └── clarification-response.openapi.yaml
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/types/src/
├── nodeContract.ts          # Extend NeedsHumanInfo + envelope parse/validate
├── approval.ts              # Optional structured clarification fields on decision/response
└── index.ts                 # Re-exports

apps/server/src/
├── compiler/workflowCompiler.ts   # Emit richer needs_human; resume injects answers
├── runtime/approvalManager.ts     # Clarification-aware resolve / idempotent answer apply
├── runtime/graphRunner.ts         # Preserve interrupt → approval handoff
├── api/runs.ts / api/runs/runApiService.ts
│                                  # GET/POST /runs/:runId/clarification (+ auth)
├── api/studio/taskRoutes.ts / taskService.ts
│                                  # Task-scoped clarification read/submit; sync mapping;
│                                  # legacy extract + follow-up run; keep lifecycle guard
└── (optional) clarification*.ts   # Pure helpers: validate answers, legacy extract, redact secrets

apps/web/src/
├── components/tasks/TaskDetailPanel.tsx
├── components/tasks/detail/       # ClarificationRequired section / form
├── components/runs/ApprovalPanel.tsx   # Leave Approve/Reject for true approvals
├── services/runService.ts         # clarification get/submit clients
└── hooks/useTasksQuery.ts         # Invalidate/refetch after submit

tests/
├── taskBoardPhase2.test.ts        # Sync/legacy/Done guard regressions
├── workflowRuntimeContracts.test.ts  # needs_human resume without extra provider call
└── clarificationResponse.test.ts  # New: read/submit/auth/idempotency/legacy follow-up fixture
```

**Structure Decision**: Extend the existing monorepo Studio + runtime surfaces listed above. No new app package. Prefer colocated pure helpers over a parallel clarification service hierarchy.

## Complexity Tracking

> No constitution violations requiring justification.
