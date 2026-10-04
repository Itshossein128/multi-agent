---
description: "Task list for Clarification Response End-to-End"
---

# Tasks: Clarification Response End-to-End

**Input**: Design documents from `/specs/002-clarification-response/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Explicitly requested in spec FR-021 and verification scenarios â€” include failing-first / regression test tasks per story where listed.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Shared types: `packages/types/src/`
- Runtime / compiler: `apps/server/src/runtime/`, `apps/server/src/compiler/`
- Run API: `apps/server/src/api/runs.ts`, `apps/server/src/api/runs/`
- Studio tasks: `apps/server/src/api/studio/`
- Web UI: `apps/web/src/components/tasks/`, `apps/web/src/services/`, `apps/web/src/hooks/`
- Tests: `tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm design artifacts and inventory extension points before contract/runtime work

- [x] T001 Confirm feature docs complete under `specs/002-clarification-response/` (plan.md, spec.md, research.md, data-model.md, contracts/clarification-response.openapi.yaml, quickstart.md) and note feature branch id `002-clarification-response`
- [x] T002 [P] Inventory pause/resume and sync touchpoints in `apps/server/src/runtime/approvalManager.ts`, `apps/server/src/compiler/workflowCompiler.ts`, `apps/server/src/api/studio/taskService.ts` (`syncTaskWithRun`, `LEGACY_BLOCKED_OUTPUT`), `apps/server/src/api/runs.ts`, `apps/web/src/components/runs/ApprovalPanel.tsx`, and `apps/web/src/components/tasks/TaskDetailPanel.tsx` â€” document that lifecycle guard from commit `bdd4798` must not regress

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared clarification contract, validation helpers, and package shape that ALL user stories depend on

**âš ï¸ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Extend `NeedsHumanInfo` in `packages/types/src/nodeContract.ts` with optional `purpose?: "approval" | "clarification"`, `questions?: ClarificationQuestion[]` (each `id` max 64 non-empty, `prompt` max 2000 non-empty, `required` default true, `missingField` max 128), and `missingFields?: string[]` (max 32 Ã— 128); keep `reason: string` required for backward compatibility
- [x] T004 [P] Add `ClarificationQuestion`, answer-input types, and export them from `packages/types/src/index.ts` (and any dedicated helper module under `packages/types/src/` if preferred)
- [x] T005 Update envelope parse/validate in `packages/types/src/nodeContract.ts` so legacy `{ reason }` still passes; reject malformed questions (empty id/prompt, >20 questions, duplicate ids) with stable diagnostics; default `purpose` to `"clarification"` when `questions` present else `"approval"`
- [x] T006 [P] Extend `ApprovalDecisionRequest` / approval metadata usage in `packages/types/src/approval.ts` to allow structured clarification answers on resolve (without breaking `{ decision, response?: string }` Approve/Reject clients)
- [x] T007 Create pure helpers in `apps/server/src/api/clarification.ts` (or `apps/server/src/runtime/clarification.ts`): build `ClarificationPackage` read model; validate submit answers (required coverage, no unknown/duplicate `questionId`, value trim non-empty for required, value max 4000); compute answer fingerprint for idempotency; redact secrets/tokens from stored answers using patterns consistent with `apps/server/src/runtime/store/helpers.ts`
- [x] T008 Rebuild types package so dependents compile: `pnpm run build:types` (or `pnpm --filter @multi-agent/types build`)

**Checkpoint**: Foundation ready â€” clarification types + validators available; user story implementation can begin

---

## Phase 3: User Story 1 - Answer clarification and continue the same work (Priority: P1) ðŸŽ¯ MVP

**Goal**: Structured `needs_human` clarification pauses the run as `waiting_for_human`, keeps the task out of Done, exposes questions, accepts answers, resumes without replaying the paused-step provider call, and only marks Done on later structured success

**Independent Test**: Seed/drive a run that emits `needs_human` with questions; assert task not Done; GET package; POST answers; assert resume + answers persisted; assert provider call count for paused step unchanged; assert Done only after structured success

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T009 [P] [US1] Add failing tests in `tests/clarificationResponse.test.ts` for: structured needs_human â†’ run `waiting_for_human`; task not Done; questions persist; valid submit resumes; empty/malformed submit rejected; resume failure leaves task not Done; provider not re-called on resume (assert call count)
- [x] T010 [P] [US1] Extend `tests/workflowRuntimeContracts.test.ts` to cover clarification-purpose `needs_human` resume injecting answers without an extra provider call (preserve existing approval resume case)

### Implementation for User Story 1

- [x] T011 [US1] When agent envelope `status === "needs_human"` with questions, emit interrupt context `{ kind: "agent_needs_human", purpose: "clarification", envelope }` and set `pendingHuman` in `apps/server/src/compiler/workflowCompiler.ts` without emitting structured success for that step
- [x] T012 [US1] On clarification resume in `apps/server/src/compiler/workflowCompiler.ts`, skip provider replay via existing `pendingHuman` path and set node success `value` to bounded `{ clarificationAnswers, priorValue? }` then clear `pendingHuman`
- [x] T013 [US1] Teach `apps/server/src/runtime/approvalManager.ts` to persist clarification questions on approval `context`, accept structured answers into approval `metadata` (`clarificationAnswers`, `answerFingerprint`, optional `taskId`), resolve as approved for continuation, and return idempotent success when fingerprint matches a prior accept
- [x] T014 [US1] Implement `getClarification` / `submitClarification` in `apps/server/src/api/runs/runApiService.ts` (or colocated service) producing `ClarificationPackage` with `status`, `runId`, `questions`, `answers`, `canSubmit`, `continuation` (`resume`|`follow_up`|`none`), `extraction`
- [x] T015 [US1] Register `GET /runs/:runId/clarification` and `POST /runs/:runId/clarification` in `apps/server/src/api/runs.ts` per `specs/002-clarification-response/contracts/clarification-response.openapi.yaml` (400 validation, 409 conflict, optional `Idempotency-Key`)
- [x] T016 [US1] Add web client methods for clarification get/submit in `apps/web/src/services/runService.ts` (and BFF proxy under `apps/web/src/app/api/` if runs are proxied that way)
- [x] T017 [US1] Add `ClarificationRequired` form section in `apps/web/src/components/tasks/detail/ClarificationPanel.tsx` (numbered questions, per-question textarea, prior answers, submit disabled while in flight, clear error/success) and mount it from `apps/web/src/components/tasks/TaskDetailPanel.tsx` for waiting/blocked clarification tasks
- [x] T018 [US1] After successful submit, invalidate/refetch task and run queries via `apps/web/src/hooks/useTasksQuery.ts` (and run query hooks) so status/timeline update without duplicate submits

**Checkpoint**: US1 independently testable â€” structured Q&A â†’ resume path works; task not Done until success

---

## Phase 4: User Story 2 - View clarification state safely across tenants (Priority: P1)

**Goal**: Authorized principals can read clarification for task/run; other tenants are denied; answers survive refresh/restart

**Independent Test**: Same-tenant GET succeeds with package; cross-tenant GET/POST denied without leaking questions; after restart/refresh, answers and status match persisted state

### Tests for User Story 2

- [x] T019 [P] [US2] Add failing tests in `tests/clarificationResponse.test.ts` for authorized GET success, cross-tenant GET/POST denial, and readback of submitted answers after store reload/restart simulation

### Implementation for User Story 2

- [x] T020 [US2] Enforce existing run ownership/tenant authorization on clarification GET/POST in `apps/server/src/api/runs/runApiService.ts` (or shared auth helper used by runs) so foreign tenants receive 403/404 without package contents
- [x] T021 [US2] Implement task-scoped `GET/POST /studio/tasks/:taskId/clarification` in `apps/server/src/api/studio/taskRoutes.ts` + `apps/server/src/api/studio/taskService.ts` that resolve linked `runId`, authorize via existing task `requireResource`/principal checks, and delegate to the run clarification service
- [x] T022 [P] [US2] Add web BFF/client for task clarification under `apps/web/src/app/api/` and wire `ClarificationPanel` to prefer task-scoped endpoints when opened from task detail
- [x] T023 [US2] Persist answers + actor + timestamps such that Postgres and in-memory run stores in `apps/server/src/runtime/store/postgresRunStore.ts` and `apps/server/src/runtime/store/inMemoryRunStore.ts` return the same package after reload (extend approval metadata only; add migration under `infrastructure/studio/migrations/` only if JSON fields prove insufficient)

**Checkpoint**: US2 independently testable â€” auth isolation + durable readback

---

## Phase 5: User Story 3 - Keep ordinary approvals and clarification responses distinct (Priority: P1)

**Goal**: Approve/Reject remains for true approvals; clarification uses the answer contract/UI; contracts stay distinguishable even if resume shares `ApprovalManager`

**Independent Test**: Ordinary approval wait still resolves via Approve/Reject; clarification wait presents answer form and does not require Approve/Reject; existing approval regression tests pass

### Tests for User Story 3

- [x] T024 [P] [US3] Add/extend regression in `tests/workflowRuntimeContracts.test.ts` (and/or `tests/clarificationResponse.test.ts`) proving Approve/Reject path unchanged for non-clarification approvals and that clarification submit does not go through `POST /runs/:runId/approvals/:approvalId/resolve` as the client contract

### Implementation for User Story 3

- [x] T025 [US3] Ensure `apps/web/src/components/runs/ApprovalPanel.tsx` continues to call existing resolve API for approvals where `purpose !== "clarification"` / no questions; do not replace Approve/Reject with the clarification form on that panel
- [x] T026 [US3] In run/task UI routing logic (`TaskDetailPanel.tsx` / run page), show clarification form when package `extraction`/`questions` indicate clarification, and show ApprovalPanel actions for standard approvals â€” never force Q&A through Approve/Reject alone
- [x] T027 [US3] Keep server `POST /runs/:runId/approvals/:approvalId/resolve` behavior in `apps/server/src/api/runs/runApiService.ts` backward compatible (`decision` must be `approved`|`rejected`); clarification-specific validation stays on `/clarification` endpoints

**Checkpoint**: US3 independently testable â€” dual UX/contracts without regression

---

## Phase 6: User Story 4 - Unblock legacy tasks that only have free-text clarification (Priority: P2)

**Goal**: Legacy completed clarification-text runs stay not Done; reliable extract â†’ answer form; submit creates one follow-up run with lineage and answers in context; never auto-start follow-up; unreliable extract shows unavailable message

**Independent Test**: Seed completed run with known legacy phrases; task blocked; GET extract or unavailable; POST creates follow-up only then; lineage preserved; task running until success; resume/start failure â†’ not Done

### Tests for User Story 4

- [x] T028 [P] [US4] Add failing tests in `tests/clarificationResponse.test.ts` (and extend `tests/taskBoardPhase2.test.ts`) for legacy outputs matching â€œClarification required before implementationâ€¦â€ and â€œThe intake remains in clarificationâ€¦â€ staying out of Done; follow-up only after submit; deterministic fixture equivalent to sample `task-munq01y0-5gglrn` / `run-munq68dw-paj0sl` **without mutating live records**

### Implementation for User Story 4

- [x] T029 [US4] Implement deterministic legacy question extraction helper in `apps/server/src/api/clarification.ts` (or dedicated module): only known patterns; if unreliable return `extraction: "unavailable"` with empty questions (no fabricated prompts)
- [x] T030 [US4] On clarification GET for completed legacy runs, populate `ClarificationPackage` with `continuation: "follow_up"` when extractable and `canSubmit` true only after operator can answer â€” in `apps/server/src/api/runs/runApiService.ts` / task service
- [x] T031 [US4] On submit for non-resumable completed clarification runs, create exactly one follow-up run with `metadata.parentRunId` / `clarificationOfRunId`, embed answers in input/context, rebind task `runId`, set task `running`, and never create follow-up on GET â€” in `apps/server/src/api/studio/taskService.ts` (and run service as needed)
- [x] T032 [US4] Surface legacy unavailable vs extractable states in `apps/web/src/components/tasks/detail/ClarificationPanel.tsx` (â€œstructured answers unavailableâ€ when `extraction === "unavailable"`) and show follow-up run link after submit

**Checkpoint**: US4 independently testable â€” legacy unblock path with lineage

---

## Phase 7: User Story 5 - Correct task board mapping for all structured outcomes (Priority: P2)

**Goal**: `syncTaskWithRun` maps structured outcomes correctly; premature Done corrected; `completedAt` null for blocked/waiting_for_human; success still completes; run.completed alone never Done

**Independent Test**: For each result status + legacy patterns, assert task status and `completedAt`; premature completed + adverse â†’ corrected; ordinary success â†’ completed

### Tests for User Story 5

- [x] T033 [P] [US5] Extend `tests/taskBoardPhase2.test.ts` covering mapping: `success`â†’completed; `needs_human`â†’waiting_for_human; `blocked`/`policy_rejected`/`validation_failed`/`unknown`â†’blocked; `failed`â†’failed; legacy clarification textâ†’blocked; premature completed corrected; `completedAt` null for blocked/waiting_for_human

### Implementation for User Story 5

- [x] T034 [US5] Verify and harden `taskStatusForCompletedRun` + `syncTaskWithRun` in `apps/server/src/api/studio/taskService.ts` to match data-model mapping; keep `LEGACY_BLOCKED_OUTPUT`; ensure blocked/waiting_for_human clear `completedAt`; do not treat `run.status === "completed"` alone as Done
- [x] T035 [US5] Confirm board grouping in `apps/web/src/lib/taskStatus.ts` still places `blocked` / `waiting_for_human` under Review / Blocked and does not show Done for those statuses after sync

**Checkpoint**: US5 independently testable â€” lifecycle mapping complete without regressing `bdd4798`

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Full verification suite and docs alignment across stories

- [x] T036 [P] Ensure secret/credential values are not persisted in clarification answers or audit event payloads (extend redaction in `apps/server/src/runtime/store/helpers.ts` and clarification helpers)
- [x] T037 [P] Update operator-facing notes if needed in `docs/architecture.md` and/or `docs/development.md` describing clarification vs approval endpoints (keep concise; no unrelated docs)
- [x] T038 Run focused verification from `specs/002-clarification-response/quickstart.md`: `pnpm test --runInBand -- tests/taskBoardPhase2.test.ts`, `tests/workflowRuntimeContracts.test.ts`, `tests/clarificationResponse.test.ts`
- [x] T039 Run `npx tsc --noEmit`, server typecheck/build (`pnpm --filter server exec tsc --noEmit`, `pnpm --filter server build`), `pnpm --filter web build`, and `git diff --check`
- [x] T040 Produce final implementation report listing changed files, final clarification contract, endpoints, resume vs legacy follow-up differences, exact test results, remaining gaps, and explicit confirmation that `run.completed` without structured success does not mark task Done

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies â€” start immediately
- **Foundational (Phase 2)**: Depends on Setup â€” **BLOCKS** all user stories
- **US1 (Phase 3)**: Depends on Foundational â€” MVP
- **US2 (Phase 4)**: Depends on Foundational; practically after US1 run clarification service exists (extends auth + task routes + persistence)
- **US3 (Phase 5)**: Depends on Foundational; can proceed once US1 UI/API distinction exists; must not break approvals
- **US4 (Phase 6)**: Depends on Foundational + clarification submit service from US1; adds legacy branch
- **US5 (Phase 7)**: Depends on Foundational; mostly harden/verify sync (can parallel with US4 after foundation)
- **Polish (Phase 8)**: After desired stories complete

### User Story Dependencies

- **US1 (P1)**: After Phase 2 â€” no dependency on other stories â€” **MVP**
- **US2 (P1)**: After Phase 2; integrates with US1 endpoints but independently testable for auth/readback
- **US3 (P1)**: After Phase 2; UI/contract separation; regression-safe with US1
- **US4 (P2)**: After US1 submit/resume service exists (follow-up branch)
- **US5 (P2)**: After Phase 2; can run parallel to US4; must not regress lifecycle guard

### Within Each User Story

- Tests (where listed) written and failing before implementation
- Types/helpers before services
- Services before HTTP routes
- Routes before web clients/UI
- Story checkpoint before next priority when staffing is sequential

### Parallel Opportunities

- T001â€“T002 after docs ready
- T003â€“T004, T006â€“T007 marked [P] within foundation where files differ
- T009â€“T010 test stubs in parallel
- T019 / T024 / T028 / T033 test tasks across stories once foundation types exist
- US4 and US5 can proceed in parallel after US1 core submit exists
- T036â€“T037 polish docs/redaction in parallel before full verification

---

## Parallel Example: User Story 1

```bash
# Tests first (parallel):
Task: "Add failing tests in tests/clarificationResponse.test.ts â€¦"
Task: "Extend tests/workflowRuntimeContracts.test.ts â€¦"

# Then implementation sequence:
Task: "Emit clarification interrupt in workflowCompiler.ts"
Task: "Resume inject answers in workflowCompiler.ts"
Task: "ApprovalManager persist/idempotent answers"
Task: "runApiService get/submit clarification"
Task: "Register GET/POST /runs/:runId/clarification"
# UI can proceed once API shape stable:
Task: "ClarificationPanel + TaskDetailPanel"
Task: "runService client + query invalidation"
```

---

## Parallel Example: User Stories 4 & 5

```bash
# After US1 submit service exists:
Task: "US4 legacy extract + follow-up in taskService/clarification helpers"
Task: "US5 harden syncTaskWithRun mapping + taskBoardPhase2 tests"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL)
3. Complete Phase 3: US1 (tests â†’ emit/resume â†’ API â†’ UI)
4. **STOP and VALIDATE** using US1 independent test + quickstart scenario A
5. Demo structured clarification answer â†’ resume

### Incremental Delivery

1. Setup + Foundational â†’ types/helpers ready
2. US1 â†’ MVP resumable clarification
3. US2 â†’ tenant-safe task/run read + durable readback
4. US3 â†’ approval regression / distinct UX
5. US4 â†’ legacy follow-up
6. US5 â†’ mapping hardening
7. Polish â†’ full quickstart verification + report

### Parallel Team Strategy

1. Team completes Setup + Foundational together
2. After foundation:
   - Dev A: US1 runtime/API
   - Dev B: US1 UI (against contract stubs) then US3
   - Dev C: US2 auth/persistence + US5 sync tests
3. US4 after US1 submit lands

---

## Notes

- [P] = different files, no incomplete-task dependencies
- Do not mutate live production task/run sample IDs; use fixtures only
- Preserve lifecycle guard: only structured `success` â†’ task Done
- Reuse `ApprovalManager`; do not invent a parallel pause system
- Prefer approval/run JSON metadata over a new table unless readback fails
- Commit after each task or logical group when the user requests commits

---

## Phase 9: Convergence

- [x] T041 CRITICAL Restrict ClarificationPanel (and package extraction defaults) so non-clarification `blocked` / ordinary approval `waiting_for_human` tasks do not show “Clarification required” / “structured answers unavailable”; only show for questions, prior answers, or legacy-pattern unavailable per FR-015 / edge misclassification / US3 (partial)
- [x] T042 Add focused test(s) in `tests/clarificationResponse.test.ts` that force resume/continuation failure, assert `ok: false` + `errorVisible`, task remains not Done, and failure is visible per SC-007 / FR-021 / US1 edge (missing)
- [x] T043 Add test in `tests/taskBoardPhase2.test.ts` seeding a prematurely `completed` task with `completedAt` set while linked run outcome is adverse/clarification, then assert sync corrects to non-Done and clears `completedAt` per US5/AC4 / FR-014 / FR-021 (missing)
