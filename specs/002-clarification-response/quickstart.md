# Quickstart: Clarification Response Validation

**Feature**: `002-clarification-response`  
**Date**: 2026-09-30  
**Contracts**: [clarification-response.openapi.yaml](./contracts/clarification-response.openapi.yaml)  
**Data model**: [data-model.md](./data-model.md)

This guide validates the feature after implementation. It is not an implementation walkthrough.

## Prerequisites

- Repo root install: `pnpm install`
- Types build when needed: `pnpm run build:types`
- Do **not** mutate live production records (e.g. `task-munq01y0-5gglrn` / `run-munq68dw-paj0sl`); use fixtures only

## Focused automated checks

```bash
# Task board + lifecycle / legacy clarification sync
pnpm test --runInBand -- tests/taskBoardPhase2.test.ts

# needs_human pause/resume without duplicate provider call + approval regression
pnpm test --runInBand -- tests/workflowRuntimeContracts.test.ts

# Clarification read/submit/auth/idempotency/legacy follow-up (expected new suite)
pnpm test --runInBand -- tests/clarificationResponse.test.ts
```

If the clarification suite is named differently in `tasks.md`, run that path instead; keep coverage of the scenarios below.

## Typecheck and builds

```bash
npx tsc --noEmit
pnpm --filter server exec tsc --noEmit
pnpm --filter server build
pnpm --filter web build
git diff --check
```

## Manual / contract scenarios (expected outcomes)

### A. Structured clarification (resumable)

1. Drive or seed a run that pauses with `needs_human` + `questions`.
2. `GET /runs/{runId}/clarification` (authorized) → `status=pending`, `canSubmit=true`, `continuation=resume`, `extraction=structured`.
3. Linked task is **not** Done (`waiting_for_human` / Review-Blocked).
4. `POST` valid answers → package updates; run resumes; provider call count for the paused step does not increase.
5. Refresh GET → same answers/status visible.
6. Cross-tenant GET/POST → denied without leaking questions.

### B. Validation and idempotency

1. POST empty / wrong count / overlong → 400; still `canSubmit=true`.
2. POST identical valid body twice → second response idempotent (`idempotentReplay=true`); single continuation.
3. POST different answers after accept → 409.

### C. Legacy free-text

1. Seed completed run output matching deterministic patterns (e.g. “Clarification required before implementation…”, “intake remains in clarification…”).
2. Task sync → blocked / not Done; `completedAt` null.
3. GET clarification → questions if extractable (`legacy_deterministic`) else `extraction=unavailable` and no fabricated prompts.
4. POST answers → **one** follow-up run with lineage; task running until structured success; no follow-up before POST.

### D. Approvals regression

1. Ordinary approval wait (no clarification questions) → `ApprovalPanel` Approve/Reject still works via existing resolve endpoint.
2. Clarification wait → task UI answer form; Approve/Reject path not required for Q&A.

### E. Failure visibility

1. Force resume/follow-up failure after answers → task remains not Done; error visible on task/run; GET still returns stored answers when accepted.

### F. Success still Done

1. Ordinary structured `success` → task `completed` with `completedAt` set.

## Pass criteria

- All focused tests green
- Typecheck/builds/`git diff --check` clean
- Manual scenarios A–F match [spec.md](./spec.md) success criteria SC-001–SC-008
- Lifecycle invariant holds: **run.completed without structured success never marks task Done**
