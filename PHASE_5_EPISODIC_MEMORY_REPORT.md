# Phase 5 Episodic Memory Report

## Summary

Phase 5 introduces real episodic memory extraction, storage, retrieval, and runtime use. The system now learns from meaningful past workflow executions by extracting structured episodes from run completion/failure events, persisting them through the existing `MemoryService` pipeline, and making them retrievable for future agents via `ContextAssembler`.

Phase 5 is **complete**.

## Previous State

The `MemoryKind = "episodic"` type already existed in the schema, and the `Memory` type had `situation`, `action`, `result`, `lesson`, `success` fields. However, no extraction pipeline existed — episodes were only created when agents explicitly included `kind: "episodic"` in `memoryCandidates` output, which was rare and unreliable. There was no automatic episode creation from run lifecycle events, no significance policy, and no structured extraction.

## Episode Semantics

An episode is a compact, reusable description of a meaningful past experience. It answers: "What happened before in a similar situation?"

**Worth remembering:**
- Unexpected failure with clear cause
- Meaningful recovery after retry
- Important architectural decision
- Non-obvious debugging discovery
- Successful strategy worth reusing
- Failed strategy worth avoiding
- Constraint discovered during implementation
- Important human correction

**NOT worth remembering:**
- Simple successful task with nothing learned
- Trivial CRUD execution
- Routine tool calls
- Empty runs

## Final Architecture

```
Workflow Run
    ↓
finalization / failure
    ↓
significance policy (DeterministicEpisodicPolicy)
    ↓
episode extraction (DeterministicEpisodeExtractor)
    ↓
schema validation + secret filtering
    ↓
MemoryService.remember() with kind=episodic
    ↓
idempotency (episode:<runId>:<version>)
    ↓
embeddings via Phase 0 path
    ↓
Hybrid retrieval
    ↓
ContextAssembler (untrusted context)
    ↓
future Agent
```

## Episode Domain Model

Episodes are stored as `Memory` records with `kind: "episodic"` and structured fields:

| Field | Purpose |
|-------|---------|
| `situation` | The task/context that prompted the experience |
| `action` | What approach was taken (from handoffs/decisions) |
| `result` | What happened (success or failure description) |
| `lesson` | What was learned (from high-importance findings/constraints) |
| `success` | Whether the run succeeded |
| `failureReason` | Error details if failed |

**Provenance** preserved via:
- `source.runId`, `source.nodeId`, `source.agentId`, `source.workflowId`
- `metadata.extractorVersion`
- `metadata.evidenceRefs` (run:, node:, agent: refs)
- `metadata.importantDecisions`, `metadata.relevantConstraints`

## Significance Policy

`DeterministicEpisodicPolicy` uses these signals (in order):

| Signal | Decision |
|--------|----------|
| Failed run with error | CREATE (importance 0.7) |
| Human rejection | CREATE (importance 0.8) |
| Retry recovery (retryCount > 0) | CREATE (importance 0.6) |
| Handoffs with warnings | CREATE (importance 0.6) |
| Handoffs with decisions | CREATE (importance 0.5) |
| High-importance findings (≥0.7) | CREATE (importance 0.6) |
| Discovered constraints | CREATE (importance 0.5) |
| Trivial cancellation | SKIP |
| Simple success | SKIP |

## Extraction Input

High-signal sources used:
- **Task/original input** → situation
- **Handoff summaries** → action
- **Handoff decisions** → importantDecisions
- **Working Memory findings** → lesson
- **Working Memory constraints** → relevantConstraints
- **Failure/error** → result, failureReason
- **Run metadata** → evidenceRefs

NOT used: raw event logs, full transcripts, unbounded model output.

## Persistence

Episodes flow through the standard `MemoryService.remember()` pipeline:
- Write policy checks (secret filtering, trivial content, size limits)
- Idempotency via `episode:<runId>:<extractorVersion>` key
- Embeddings via existing Phase 0 embedding provider
- Namespace/tenant authorization

## Retrieval

Episodes are retrieved through `HybridMemoryRetriever` just like semantic memories:
- **Semantic**: Cosine similarity on embeddings → "Have we had a similar failure before?"
- **Lexical**: Substring matching → keyword overlap
- **Combined ranking**: Same scoring as semantic memories

## ContextAssembler Integration

Episodes arrive as part of `long_term_memory` context source. The `DefaultContextAssembler` includes them in the `LONG_TERM_MEMORY` priority tier. Episodes remain distinguishable by `kind: episodic` in metadata, allowing future priority adjustments.

Episodes are treated as **untrusted historical data**, not instructions.

## Working Memory Relationship

Working Memory informs episode extraction without being copied:
- **Findings** → lesson (high-importance only)
- **Decisions** → action summary
- **Constraints** → relevantConstraints
- **Todos/notes/questions** → NOT included

Working Memory is never automatically persisted wholesale as episodes.

## Handoff Relationship

Handoffs inform extraction:
- **Summary** → action
- **Decisions** → importantDecisions
- **Warnings** → triggered by significance policy

Handoffs are never automatically persisted wholesale as episodes.

## Semantic Memory Relationship

```
episode = what happened (historical experience)
semantic = what is believed true (current fact)
```

Episodes are NOT promoted to semantic facts. An episode "In Run 12, Postgres was unavailable" does NOT create semantic memory "Postgres is unavailable."

## Consolidation Relationship

Phase 4 consolidation keeps similar episodes separate by default. Two different runs with similar failure episodes remain distinct events because they have different content (different error messages, different run metadata). Only exact content duplicates are deduplicated.

## Security

- **Tenant isolation**: Episodes stored with tenant-scoped access context
- **Namespace isolation**: Episodes scoped to project/workflow namespace
- **Secret filtering**: Write policy rejects content containing API keys, tokens, credentials
- **Trust boundary**: Episodes are untrusted context data, never elevated to instruction authority

## Failure Handling

| Failure | Behavior |
|---------|----------|
| Extraction throws | Returns `{ created: false, reason: "extraction_failed" }` |
| Write policy rejects | Returns `{ created: false, reason: "policy_rejected" }` |
| Persistence fails | Returns `{ created: false, reason: "persistence_failed" }` |
| Policy skips run | Returns `{ created: false, reason: "trivial_success" }` |

Episode extraction failure NEVER alters the original run outcome.

## Diagnostics

Safe observability via `EpisodeExtractionResult`:
- `created: boolean` — whether episode was persisted
- `memoryId?: string` — ID of created memory (if any)
- `reason: string` — policy/extraction/persistence outcome

No episode content logged by default.

## Tests Added (36)

| # | Test | What it proves |
|---|------|---------------|
| 1 | Meaningful successful run produces episode | Handoff decisions trigger creation |
| 2 | Meaningful failure produces episode | Error triggers creation with high importance |
| 3 | Trivial success produces no episode | Policy prevents memory spam |
| 4 | Episode schema validation | Structured fields are populated correctly |
| 5 | Episode provenance | Run/node/agent IDs preserved |
| 6 | Significance policy handles all signals | All signal types tested |
| 7 | Extraction failure does not alter run outcome | Failure is non-destructive |
| 8 | Idempotent extraction | Same run → 1 episode |
| 9 | Episode persistence | Correct fields stored |
| 10 | Semantic embedding generation | Embeddings created |
| 11 | Episodic semantic retrieval | Similar queries find episodes |
| 12 | Lexical fallback | Keyword search works |
| 13 | Cross-run retrieval | Past episodes inform future runs |
| 14 | ContextAssembler integration | Episodes in context |
| 15 | Bounded episodic context | Limit respects budget |
| 16 | Tenant isolation | Cross-tenant not visible |
| 17 | Namespace isolation | Cross-namespace not visible |
| 18 | Prompt-injection trust boundary | Episodes remain untrusted |
| 19 | Secret filtering | Secrets rejected |
| 20 | Restart-safe extraction | Idempotent across instances |
| 21 | Retry/recovery semantics | Recovery captured |
| 22 | Cancellation policy | Trivial skips, unsafe remembers |
| 23 | Human approval handling | Rejections create episodes |
| 24 | Working Memory integration | Findings → lesson |
| 25 | Handoff integration | Summaries → action |
| 26 | No WM automatic persistence | WM not wholesale copied |
| 27 | No semantic fact promotion | Episodes ≠ facts |
| 28 | No procedural promotion | Episodes ≠ procedures |
| 29 | Consolidation keeps separate events | Similar episodes distinct |
| 30 | Backfill idempotency | Multiple runs → 1 episode |
| 31 | Dry-run no mutations | Policy check without persistence |
| 32 | Phase 0 retrieval regression | Semantic retrieval works |
| 33 | Phase 1 ContextAssembler regression | Context assembly works |
| 34 | Phase 2 handoff regression | Handoffs alongside episodes |
| 35 | Phase 3 Working Memory regression | WM informs without copying |
| 36 | Phase 4 consolidation regression | Consolidation works |

## Test Results

```
✅ 36/36 episodic memory tests pass
✅ 667/667 full test suite passes
✅ TypeScript typecheck passes
✅ Build passes
✅ git diff --check clean
```

## Known Limitations

- No procedural memory extraction (Phase 6)
- No full contradiction detection (Phase 7)
- No artifact store
- No autonomous self-reflection loops
- Extraction is deterministic (no LLM-based summarization in Phase 5)

These are explicitly deferred to later phases.

## Phase 5 Definition of Done

- [x] Explicit `EpisodicMemoryExtractor` exists
- [x] Significance policy exists
- [x] Trivial runs are skipped
- [x] Meaningful successes can become episodes
- [x] Meaningful failures can become episodes
- [x] Episode provenance is preserved
- [x] Extraction is schema validated
- [x] Extraction failure does not alter run outcome
- [x] Episodic writes use MemoryService
- [x] Episodes are idempotent per run
- [x] Episodes receive embeddings
- [x] Semantic episodic retrieval works
- [x] Lexical fallback works
- [x] Cross-run episodic recall works
- [x] ContextAssembler consumes episodes
- [x] Episode context is bounded
- [x] Episodes remain untrusted context
- [x] Tenant isolation verified
- [x] Namespace isolation verified
- [x] Secrets are excluded
- [x] Working Memory is not automatically persisted wholesale
- [x] Handoffs are not automatically persisted wholesale
- [x] Episodic memory does not automatically become semantic memory
- [x] Episodic memory does not automatically become procedural memory
- [x] Separate similar runs are not incorrectly consolidated
- [x] Background extraction/restart behavior is defined
- [x] Full test suite passes (667/667)
- [x] Typecheck passes
- [x] Build passes
- [x] Documentation updated

## Final Verdict

1. **Can the system now remember meaningful experiences from previous runs?** Yes. `DeterministicEpisodicPolicy` identifies significant runs, `DeterministicEpisodeExtractor` creates structured episodes, and `DefaultEpisodeService` persists them via `MemoryService`.

2. **Does it avoid storing every run as memory?** Yes. The significance policy skips trivial successes, empty runs, and routine completions.

3. **Can successful and failed experiences both be represented?** Yes. Both success and failure episodes are created with appropriate importance levels.

4. **Can a future agent retrieve a semantically similar past experience?** Yes. Episodes receive embeddings and are retrievable via `HybridMemoryRetriever` with semantic and lexical search.

5. **Can an episode cross tenant or unauthorized namespace boundaries?** No. Episodes are scoped to the tenant and namespace of the originating run.

6. **Can episode extraction failure change the original run result?** No. Extraction failure returns `{ created: false }` without affecting the run.

7. **Are episodes clearly distinct from semantic facts, handoffs and Working Memory?** Yes. Episodes have `kind: "episodic"` and are never promoted to semantic/procedural memory.

8. **Are repeated processing/restarts idempotent?** Yes. The `episode:<runId>:<version>` idempotency key prevents duplicates.

9. **Does Phase 4 consolidation preserve separate historical events correctly?** Yes. Different runs with similar episodes remain distinct because their content (error messages, run metadata) differs.

10. **Is Phase 5 complete?** Yes.
