# Feature Specification: Clarification Response End-to-End

**Feature Branch**: `002-clarification-response`

**Created**: 2026-09-30

**Status**: Draft

**Input**: User description: "در codebase چند-agent فعلی، قابلیت کامل پاسخ‌دادن به سؤال‌های clarification را end-to-end پیاده‌سازی کن — structured needs_human/clarification, UI form, resume without duplicate provider calls, legacy follow-up, lifecycle sync so run.completed alone never marks task Done."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Answer clarification and continue the same work (Priority: P1)

When an agent run cannot proceed because required information is missing, the linked task stays in Review / Blocked (or Waiting for human) instead of Done. The operator opens the task, sees a clear “Clarification required” section with numbered questions, fills in answers, submits them, and the work continues from the paused point with the answers applied—without starting a duplicate execution of the same agent step and without losing prior context.

**Why this priority**: This is the primary broken flow today: clarification appears as free text, the run looks finished, the task sits in Review / Blocked with no way to reply, and operators cannot unblock work.

**Independent Test**: Drive a run that produces a structured clarification request; confirm the task is not Done; submit valid answers from the task detail UI; confirm the run resumes (or a controlled follow-up starts for legacy cases), answers persist after refresh, and the task only becomes Done after a true success outcome.

**Acceptance Scenarios**:

1. **Given** a run pauses because the agent needs clarification, **When** the operator opens the linked task, **Then** they see a Clarification required section with numbered questions, reason/missing-field context when available, and no Done status on the task.
2. **Given** visible clarification questions, **When** the operator submits non-empty structured answers for each required question, **Then** the answers are stored, the execution continues with those answers in context, and the previous agent step is not re-invoked solely because answers were submitted.
3. **Given** a successful submit, **When** the operator refreshes the task or run view, **Then** they still see the submitted answers, current clarification or run status, and any updated timeline/link for the continued execution.
4. **Given** the continued execution finishes with a structured success result, **When** task status is synchronized, **Then** the task becomes Done only then—not merely because a run reached a completed lifecycle state.

---

### User Story 2 - View clarification state safely across tenants (Priority: P1)

Authorized operators can read the current clarification package for a task or run (questions, prior answers, status, linked run/task identity, whether answering is still allowed). Principals from another organization cannot read or submit answers.

**Why this priority**: Clarification data is operationally sensitive and must follow existing ownership/tenant authorization.

**Independent Test**: As an allowed principal, fetch clarification for a known task/run; as a different-tenant principal, attempt the same read and a submit; verify allow/deny outcomes.

**Acceptance Scenarios**:

1. **Given** an authorized principal for the task’s organization, **When** they request clarification details for that task or its linked run, **Then** they receive questions, recorded answers, status, run identity, and whether continuation is available.
2. **Given** a principal from another organization, **When** they attempt to read or submit clarification for that task/run, **Then** access is denied without leaking clarification content.
3. **Given** clarification was previously submitted, **When** the authorized principal reads it again after restart or refresh, **Then** the same persisted answers and status are returned.

---

### User Story 3 - Keep ordinary approvals and clarification responses distinct (Priority: P1)

Existing human-approval flows (Approve / Reject) continue to work unchanged. Clarification answering uses a clearly separate request/response contract and user action path, even if both ultimately resume waiting work through the same pause/resume machinery.

**Why this priority**: Operators already rely on approval panels; a parallel incompatible system would break trust and cause regressions.

**Independent Test**: Run a standard needs-human approval scenario and a clarification scenario; confirm Approve/Reject still work for approvals and that clarification uses the answer-submit path without breaking the approval UI.

**Acceptance Scenarios**:

1. **Given** a run waiting for a standard approval decision, **When** the operator Approves or Rejects, **Then** existing approval behavior continues without requiring the clarification form.
2. **Given** a run waiting for clarification answers, **When** the operator opens the task, **Then** they see the clarification answer form rather than being forced through Approve/Reject as the only action.
3. **Given** both capability types exist in the product, **When** contracts and user actions are reviewed, **Then** clarification response and approval decision remain distinguishable to the operator and to integrations.

---

### User Story 4 - Unblock legacy tasks that only have free-text clarification (Priority: P2)

Older tasks whose runs already completed with free-text clarification-style output (for example phrases like “Clarification required before implementation…” or “The intake remains in clarification…”) remain in Review / Blocked, never Done. Operators can still answer when questions can be extracted reliably; answers trigger a controlled follow-up execution that preserves lineage to the prior run and carries answers explicitly into the new run’s input/context. No second execution starts without an explicit operator submit.

**Why this priority**: Real historical cases (illustrated by sample task/run pairs in the product) are stuck without a reply path; migration must not leave them permanently unanswerable.

**Independent Test**: Seed a completed run whose output matches known legacy clarification patterns; confirm task is not Done; submit answers; confirm a follow-up run is created only after submit, lineage is preserved, task stays Running until true success, and unreliable extraction shows a “structured answers unavailable” message instead of fabricated questions.

**Acceptance Scenarios**:

1. **Given** a legacy completed run whose output matches deterministic clarification/blocked patterns, **When** task status is synchronized, **Then** the task stays in Review / Blocked (or Waiting for human) and is not marked Done; completion timestamps are not set for those statuses.
2. **Given** such a legacy task where questions can be extracted deterministically, **When** the operator submits answers, **Then** a controlled follow-up run is created with explicit answers in context and a clear link to the prior run—never automatically before the operator acts.
3. **Given** legacy free text that cannot be trusted for question extraction, **When** the operator opens the task, **Then** they see that structured answers are unavailable rather than invented questions.
4. **Given** a follow-up run fails to start or resume, **When** the operator reviews the task, **Then** the task is not Done and the failure remains visible.

---

### User Story 5 - Correct task board mapping for all structured outcomes (Priority: P2)

Whenever a linked run updates, the task board reflects structured result status: success → Done; needs_human / clarification → Waiting for human (shown under Review / Blocked grouping as today); blocked, validation_failed, policy_rejected, and unknown → Review / Blocked; failed → Failed. Tasks that were prematurely marked Done despite an adverse or clarification outcome are corrected back to the appropriate non-Done status. Plain “Done” wording or a completed run lifecycle alone never closes a task.

**Why this priority**: Prevents false Done states that hide work needing human input.

**Independent Test**: For each structured outcome and for legacy clarification text, sync task status and assert board column and completion-timestamp rules; confirm ordinary success still reaches Done.

**Acceptance Scenarios**:

1. **Given** a linked run with structured success, **When** the task is synchronized, **Then** the task is Done.
2. **Given** a linked run with needs_human or clarification, **When** the task is synchronized, **Then** the task is Waiting for human / Review / Blocked and not Done.
3. **Given** a linked run with blocked, validation_failed, policy_rejected, or unknown, **When** the task is synchronized, **Then** the task is Review / Blocked and not Done.
4. **Given** a task already marked Done while its result is adverse or clarification, **When** synchronization runs, **Then** the task returns to the appropriate non-Done status without a completion timestamp for blocked/waiting states.

---

### Edge Cases

- Empty answers, wrong answer count, oversized answers, or malformed payloads are rejected with a clear error; the run/task stays answerable.
- Duplicate submit of the same valid answers is idempotent: no double resume, no duplicate follow-up run, same persisted state returned.
- Submit while another resume is already in progress does not create conflicting duplicate executions.
- Resume failure leaves the task not Done and surfaces a visible error.
- Secrets, credentials, and tokens must not be stored in clarification answers or audit payloads.
- Concurrent refresh during submit shows consistent eventual state (answers and status match server truth).
- Standard approval waiting runs must not be misclassified as clarification-only or lose Approve/Reject.
- Existing lifecycle guard that prevents premature Done (already shipped) must not regress.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When an agent cannot continue without more information, the system MUST emit a structured human-needed / clarification outcome (not free text alone as the decision source) that includes a question list and, when known, reason and missing/required fields.
- **FR-002**: On that outcome, the run MUST remain waiting for human input; the system MUST NOT produce a successful completed result for that step solely because clarification was requested.
- **FR-003**: The linked task MUST appear as Waiting for human and/or under Review / Blocked, and MUST NOT become Done based only on run completed lifecycle or display text that says Done.
- **FR-004**: Only a structured success outcome MAY move a task to Done / completed.
- **FR-005**: Structured blocked, validation_failed, policy_rejected, unknown, and clarification / needs_human outcomes MUST keep the task in Review / Blocked or Waiting for human as appropriate; failed outcomes MUST map to Failed.
- **FR-006**: Clarification MUST reuse the existing human-pause / approval infrastructure rather than introducing a parallel incompatible pause system; clarification answer actions MUST remain contractually distinguishable from Approve / Reject.
- **FR-007**: Authorized operators MUST be able to retrieve clarification details for a task or its linked run, including questions, prior answers, status, linked identities, and whether answering/continuation is available.
- **FR-008**: Authorized operators MUST be able to submit structured answers for a pending clarification; unauthorized principals (including other organizations) MUST be denied.
- **FR-009**: Answer validation MUST reject empty answers, malformed payloads, wrong answer counts, and excessively long answers.
- **FR-010**: Answer submission MUST be idempotent for duplicate identical submits.
- **FR-011**: After a valid submit on a resumable waiting run, the system MUST resume with answers in context and MUST NOT re-execute the prior provider/agent call for that same paused step when safe resume is available.
- **FR-012**: For legacy runs that already completed with only free-text clarification, the system MUST still allow answering when extraction is reliable; if the same run cannot be resumed, the system MUST create a controlled follow-up run only after explicit operator submit, preserve lineage to the prior run, place answers explicitly in the new run’s input/context, keep the task Running until true success, and never auto-create the follow-up without user action.
- **FR-013**: Legacy free-text detection MUST use precise, deterministic, testable patterns (including known phrases such as “Clarification required before implementation…” and “The intake remains in clarification…”); unreliable extraction MUST show that structured answers are unavailable instead of inventing questions.
- **FR-014**: Task–run synchronization MUST inspect structured result status first; legacy text MAY only adjust status via the deterministic patterns above; tasks prematurely marked completed MUST be corrected back when the outcome is adverse or clarification; completion timestamps MUST NOT be set for blocked or waiting-for-human statuses.
- **FR-015**: The task detail experience MUST show a Clarification required section for applicable Review / Blocked or waiting-for-human tasks, with numbered questions, per-question inputs, prior answers when present, clear submit/error/success feedback, and a disabled submit control while a request is in flight.
- **FR-016**: After successful submit, the UI MUST update (live or via refresh) to the new task/run status; if more clarification is needed, the form MUST reappear with new questions; if the work succeeds, Done appears only then.
- **FR-017**: Existing approval UI (Approve / Reject) MUST continue to work for ordinary approvals without requiring clarification forms.
- **FR-018**: Clarification answers, actor, time, task identity, and run identity MUST be persisted for readback after refresh or restart; credentials, tokens, and secrets MUST NOT be stored in clarification or related audit records.
- **FR-019**: If schema or storage changes are required for persistence, they MUST preserve backward compatibility for existing runs and tasks.
- **FR-020**: The previously shipped lifecycle guard that prevents Done without true success MUST be preserved; this feature MUST NOT regress that behavior.
- **FR-021**: Verification for this feature MUST cover the focused task-board and workflow-runtime behaviors, approval/resume paths, and the listed acceptance scenarios including a deterministic fixture equivalent to the known sample task/run clarification case—without mutating real production task or run records.

### Key Entities

- **Clarification Request**: A structured pause package tied to a run (and optionally task/node), containing ordered questions, optional reason and missing/required fields, status, and metadata such as timestamps and actor references.
- **Clarification Answer Set**: Structured operator responses keyed to the request’s questions; includes submit metadata (actor, time) and supports idempotent re-submission.
- **Human Pause Context**: Shared waiting-for-human context reused for both ordinary approvals and clarification; clarification extends this context rather than replacing it.
- **Task–Run Sync Mapping**: Rules that translate structured run outcomes (and narrow legacy text patterns) into task board statuses and completion-timestamp behavior.
- **Legacy Follow-up Link**: Explicit lineage between a prior completed clarification run and a user-triggered follow-up run that carries answers forward.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of structured clarification cases under test, the linked task is not Done while clarification is pending, and questions are retrievable by an authorized operator.
- **SC-002**: Operators can complete the path “see questions → submit answers → continued execution visible” in one task-detail session without creating an accidental duplicate run of the same paused step.
- **SC-003**: 100% of unauthorized cross-organization read/submit attempts under test are denied.
- **SC-004**: Duplicate identical answer submits under test produce a single logical continuation (idempotent) with no extra follow-up runs.
- **SC-005**: 100% of seeded legacy clarification-pattern outputs under test remain out of Done until a later structured success; follow-up runs occur only after explicit submit.
- **SC-006**: Ordinary success outcomes still reach Done; ordinary Approve/Reject approvals pass existing regression checks without failure introduced by this feature.
- **SC-007**: When resume/continuation fails under test, the task remains not Done and the failure is visible to the operator.
- **SC-008**: After refresh or process restart under test, previously submitted clarification answers and status match what was stored before the interruption.

## Assumptions

- Target operators are signed-in members of the same organization that owns the task/run; existing tenant/owner authorization is reused.
- The existing waiting-for-human / approval pause model is the preferred extension point; a second incompatible clarification subsystem is out of scope.
- Structured clarification is the source of truth going forward; free-text clarification is supported only for backward compatibility and migration of stuck legacy work.
- Safe resume without re-calling the provider for the paused step is required whenever the current runtime already supports that for human pauses; follow-up runs are reserved for legacy completed runs that cannot resume in place.
- UI language may be English or bilingual labels consistent with the current studio; “Clarification required” (or an equivalent clear label) is acceptable.
- Answer length limits follow the product’s existing payload/body caps unless a tighter clarification-specific limit is needed for safety.
- Idempotency for duplicate submits may key off run identity plus answer payload (or an equivalent stable request identity); exact storage mechanism is a planning concern.
- Real production sample identifiers mentioned in the request are reference cases only; tests use deterministic fixtures and MUST NOT mutate those live records.
- Out of scope: redesigning the entire task board, replacing the approval product, multi-party clarification workflows, and changes unrelated to clarification answer end-to-end.
- The lifecycle synchronization fix already delivered (commit noted by the requester) remains in force and is treated as a non-negotiable baseline for this feature.
