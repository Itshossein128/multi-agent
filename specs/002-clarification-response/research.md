# Research: Clarification Response End-to-End

**Feature**: `002-clarification-response`  
**Date**: 2026-09-30

## Research questions resolved

### 1. Where should structured clarification live?

**Decision**: Extend `NeedsHumanInfo` on `NodeResultEnvelope` (keep `status: "needs_human"`) with optional clarification fields; interrupt `context.kind` remains `"agent_needs_human"` with optional `purpose: "clarification"` (or inferred when `questions` present).

**Rationale**: Runtime already pauses on `needs_human`, persists envelope on the run, maps task → `waiting_for_human`, and resumes via `ApprovalManager` without replaying the provider call (`pendingHuman` in `workflowCompiler`). Adding a new outcome status or parallel pause system would fork lifecycle sync and UI.

**Alternatives considered**:
- New `clarification` outcome status — rejected (duplicates needs_human mapping; more sync/UI churn).
- Free-text-only detection forever — rejected (spec requires structured source of truth).
- Separate ClarificationManager — rejected (YAGNI; violates reuse principle).

### 2. How do answers resume without re-calling the provider?

**Decision**: Clarification submit resolves the pending approval with an **approved** decision carrying structured answers. Resume keeps the existing `pendingHuman` path: re-enter node, re-`interrupt` consumption only, **skip provider**. Node success `value` becomes `{ clarificationAnswers, priorValue? }` (bounded), then the graph continues. Downstream nodes may call agents with answers in state; that is not a replay of the pause-generating call.

**Rationale**: Matches proven `workflowRuntimeContracts` behavior (`providerCalls === 1` across pause/resume). Clarification differs from proposal-approval mainly in payload (answers vs empty approve), not in pause mechanics.

**Alternatives considered**:
- Always start a new run on answer — rejected for waiting runs (loses checkpoint/context; duplicates work).
- Re-invoke same agent node with answers on resume — rejected when `pendingHuman` exists (violates FR-011); reserved only if pause context/checkpointer missing (then fail visibly, do not mark Done).

### 3. How to keep Approve/Reject distinct from clarification answers?

**Decision**:
- **Approvals**: existing `GET /runs/:runId/approvals` + `POST /runs/:runId/approvals/:approvalId/resolve` with `{ decision, response? }`; `ApprovalPanel` unchanged for non-clarification waits.
- **Clarification**: new `GET/POST /runs/:runId/clarification` (and task convenience routes) with question/answer schemas. Server may internally call into `ApprovalManager.resolveApproval` after validation, but clients and UI treat the contracts as separate.

**Rationale**: Spec FR-006/FR-017; operators must not be forced through Approve/Reject for Q&A.

**Alternatives considered**: Overloading resolve with a `mode` flag only — workable internally but insufficient as the sole public contract (UI/API ambiguity).

### 4. Persistence and idempotency without a new table (v1)?

**Decision**: Persist clarification package in approval `context` (questions, reason, missingFields, purpose) and structured answers in approval `response` as JSON string **or** `metadata.clarificationAnswers` (prefer metadata object + short human `response` summary). Also mirror latest package on `run.result.needsHuman` / run metadata for GET when approval row is enough. Idempotency: if pending approval already resolved with identical answer fingerprint → return current clarification state `200`; if resolved with different answers → `409`; if still `requested` → apply once.

**Rationale**: `studio_approvals` already durable; avoids migration unless fingerprint/readback proves insufficient. Secrets redacted via existing approval redaction helpers extended for answer blobs.

**Alternatives considered**: New `studio_clarifications` table — deferred unless Phase 2 implementation hits durability gaps; document as optional follow-up.

### 5. Legacy completed runs with free-text clarification?

**Decision**: Keep `LEGACY_BLOCKED_OUTPUT` in `taskStatusForCompletedRun` (already prevents Done). Add deterministic question extraction (numbered/`?` lines under known preamble patterns). On submit when run is `completed` (not resumable): create **one** follow-up run only after explicit submit, with `metadata.parentRunId` / `clarificationOfRunId` lineage and answers in input/context; rebind task `runId`; task → `running` until structured success. Never auto-start follow-up on GET or page view.

**Rationale**: Checkpointer/paused context absent for completed runs; FR-012. Sample IDs `task-munq01y0-5gglrn` / `run-munq68dw-paj0sl` become **fixtures**, not live mutations.

**Alternatives considered**: Rewrite historical run to `waiting_for_human` — rejected (lies about history; breaks audit).

### 6. Envelope parse backward compatibility?

**Decision**: `reason: string` remains required on `NeedsHumanInfo`. Optional: `questions?: ClarificationQuestion[]`, `missingFields?: string[]`, `purpose?: "approval" | "clarification"`. Parser accepts legacy `{ reason }` only; rejects malformed questions (empty id/prompt, excess length/count) with envelope diagnostics. Free text never alone drives *new* pauses.

**Rationale**: Existing envelopes and tests keep working; validation stays fail-closed for new fields.

### 7. Task vs run API surface?

**Decision**: **Run is source of truth** for clarification state (tied to approval/pause). Task routes proxy: resolve linked `runId`, authorize task tenant, then same service. UI primarily uses task detail → clarification APIs with run id from linked run.

**Rationale**: Approvals already run-scoped; tasks already refuse `POST /tasks/:id/resume` while `waiting_for_human`.

### 8. UI placement?

**Decision**: New “Clarification required” block in task detail (`TaskDetailPanel` / `detail/*`). Show when task is `waiting_for_human` or Review/Blocked grouping **and** clarification package is available (structured or reliably extracted). Keep `ApprovalPanel` on run page for true approvals (`purpose !== "clarification"` / no questions).

**Rationale**: Operators live on the task board; run page approvals must not regress.

## Summary of unknowns

All Technical Context items resolved; no remaining `NEEDS CLARIFICATION` for planning. Implementation may still choose metadata-vs-response JSON encoding detail during tasks without changing contracts’ external shapes.
