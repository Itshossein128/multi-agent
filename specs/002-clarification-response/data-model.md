# Data Model: Clarification Response

**Feature**: `002-clarification-response`  
**Date**: 2026-09-30  
**Related**: [spec.md](./spec.md), [research.md](./research.md), [contracts/clarification-response.openapi.yaml](./contracts/clarification-response.openapi.yaml)

## Entities

### ClarificationQuestion

| Field | Type | Rules |
|-------|------|--------|
| `id` | string | Required; stable within request; max 64 chars; non-empty after trim |
| `prompt` | string | Required; max 2000 chars; non-empty after trim |
| `required` | boolean | Default `true` |
| `missingField` | string? | Optional field name this question fills; max 128 |

### NeedsHumanInfo (extended)

| Field | Type | Rules |
|-------|------|--------|
| `reason` | string | Required (backward compatible); max 500 (existing envelope bound) |
| `purpose` | `"approval" \| "clarification"`? | Default: `"clarification"` if `questions` present, else `"approval"` |
| `questions` | ClarificationQuestion[]? | When purpose is clarification: 1–20 items; unique ids |
| `missingFields` | string[]? | Optional; max 32 entries × 128 chars |

Legacy envelopes with only `{ reason }` remain valid.

### ClarificationAnswer

| Field | Type | Rules |
|-------|------|--------|
| `questionId` | string | Must match a question id on the active request |
| `value` | string | Trimmed non-empty if question.required; max 4000 chars |
| `answeredAt` | string (ISO)? | Server-set on accept |
| `actorId` | string? | Server-set from principal; never client-trusted alone |

### ClarificationAnswerSet

| Field | Type | Rules |
|-------|------|--------|
| `answers` | ClarificationAnswer[] | Count must cover every `required` question; no unknown questionIds; no duplicates |
| `submittedAt` | string (ISO) | Server-set |
| `actorId` | string | From authorized principal |
| `fingerprint` | string | Server hash of canonical answers for idempotency |
| `runId` | string | Owning run |
| `taskId` | string? | When submitted via task surface |
| `approvalId` | string? | Linked pending/resolved approval |

**Secret policy**: Reject or redact values matching credential/token patterns where existing redaction helpers apply; never store raw provider API keys.

### ClarificationPackage (read model)

Aggregated GET payload (not necessarily a new table row):

| Field | Type | Meaning |
|-------|------|--------|
| `status` | `pending \| answered \| unavailable \| resumed \| follow_up_started` | Operator-facing state |
| `runId` | string | Linked run |
| `taskId` | string? | Linked task when known |
| `nodeId` | string? | Paused node |
| `approvalId` | string? | Pending approval when waiting |
| `reason` | string? | From needsHuman |
| `questions` | ClarificationQuestion[] | Structured or extracted |
| `missingFields` | string[]? | |
| `answers` | ClarificationAnswer[]? | Last accepted set |
| `canSubmit` | boolean | True only when answering is allowed now |
| `continuation` | `resume \| follow_up \| none` | How submit will continue work |
| `parentRunId` | string? | Legacy lineage when follow-up used |
| `extraction` | `structured \| legacy_deterministic \| unavailable` | Provenance of questions |
| `updatedAt` | string (ISO)? | |

### Human Pause Context (existing, extended)

`PausedContext.pendingHuman` continues to hold `{ nodeId, envelope }`. On clarification pause, `envelope.needsHuman` includes questions. On resume after answers, compiler injects answer set into success value and clears `pendingHuman`.

### ApprovalRequest (existing, extended usage)

| Existing field | Clarification usage |
|----------------|---------------------|
| `context` | `{ kind: "agent_needs_human", purpose?: "clarification", envelope }` |
| `response` | Optional short summary string |
| `metadata` | `clarificationAnswers`, `answerFingerprint`, `taskId` |
| `status` | `requested` → `approved` on successful clarification submit |

Ordinary approvals omit clarification questions / purpose clarification.

### LegacyFollowUpLink

| Field | Type | Rules |
|-------|------|--------|
| `parentRunId` | string | Prior completed clarification run |
| `followUpRunId` | string | New run started only after explicit submit |
| `taskId` | string | Task rebound to follow-up |
| `answers` | ClarificationAnswerSet | Copied into follow-up input/context |
| `createdAt` | string (ISO) | |

Stored on follow-up run metadata and/or task metadata for lineage readback.

### Task–Run Sync Mapping (behavioral entity)

| Run / result condition | Task status | `completedAt` |
|------------------------|-------------|---------------|
| `run.result.status === success` (and not legacy-blocked text alone as override when status success without adverse) | `completed` | set |
| `needs_human` | `waiting_for_human` | null |
| `blocked` / `policy_rejected` / `validation_failed` / `unknown` | `blocked` | null |
| `failed` | `failed` | per existing rules |
| `run.status === waiting_for_human` | `waiting_for_human` | null |
| completed run + `LEGACY_BLOCKED_OUTPUT` on output | `blocked` | null |
| Premature `completed` task + adverse/clarification result on sync | corrected to blocked / waiting_for_human | null |

**Invariant**: `run.status === "completed"` alone does **not** imply task Done.

## State transitions

### ClarificationPackage.status

```text
unavailable  → (structured pause or reliable legacy extract) → pending
pending      → (valid submit + resume) → resumed
pending      → (valid submit + legacy follow-up) → follow_up_started
pending      → (answered stored, continuation deferred) → answered
answered / resumed / follow_up_started → (new needs_human) → pending
```

### Run (clarification path)

```text
running → waiting_for_human (needs_human interrupt)
waiting_for_human → running (clarification submit / approve resolve)
running → completed | failed | waiting_for_human | …
```

Legacy completed clarification runs stay `completed`; follow-up is a **new** run.

### Task (clarification path)

```text
running → waiting_for_human | blocked
waiting_for_human | blocked → running (after successful submit continuation)
running → completed  ONLY IF linked run structured success
```

## Validation summary

- Empty / whitespace answers for required questions → 400
- Unknown / duplicate `questionId` → 400
- Answer count missing required questions → 400
- Overlong prompt/answer → 400
- Malformed body → 400
- Cross-tenant → 403/404 per existing resource pattern (no content leak)
- Duplicate identical submit → 200 idempotent
- Conflicting submit after different answers → 409
- Submit when `canSubmit=false` → 409
- Resume/follow-up failure → task not Done; error visible on task/run

## Persistence notes

- **Preferred v1**: no new SQL table; use `studio_approvals` + run/task metadata JSON.
- **Migration**: add only if implementation cannot guarantee restart readback; any migration must be backward compatible with rows lacking clarification fields.
- **In-memory store**: same shapes for tests.
