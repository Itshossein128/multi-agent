# Phase 6 Procedural Memory Report

## Summary

Phase 6 is **complete**. The system can now remember and reuse procedures — reusable operational knowledge with explicit triggers, ordered steps, evidence-based confidence, and deterministic trigger-aware retrieval.

A new `proceduralMemory.ts` module (578 lines) provides the full lifecycle: episode clustering → procedural candidate extraction → policy validation → MemoryService persistence → trigger-aware retrieval.

## Previous State

Phase 0–5 established:
- `kind = "procedural"` in `MemoryKind` schema
- `trigger` and `procedure` fields on `Memory` type
- MemoryService write path, hybrid retrieval, embeddings
- Consolidation (Phase 4), episodic memory (Phase 5)

What was missing:
- No extractor that derives procedures from repeated episodic patterns
- No evidence threshold or confidence policy for learned procedures
- No trigger-aware retrieval scoring
- No distinction between explicit/human-confirmed/learned procedure origins
- No reinforcement mechanism for strengthening existing procedures

## Procedural Semantics

```text
semantic  = what is true
episodic  = what happened
procedural = how to do something
```

A procedural memory answers: "When X happens, perform Y steps under Z constraints."

## Final Architecture

```text
Explicit rule ─────────────┐
                           │
Episodes → clustering ─────┤
                           ▼
                 Procedural Candidate
                           ↓
                      policy
                           ↓
                    MemoryService
                           ↓
                  procedural memory
                           ↓
                trigger-based retrieval
                           ↓
                 ContextAssembler
                           ↓
                        Agent
```

## Domain Model

| Field | Purpose |
|-------|---------|
| `trigger` | When this procedure should be applied |
| `procedure` | Ordered steps to perform (semicolon-separated) |
| `goal` | What the procedure aims to achieve |
| `preconditions` | Conditions before starting |
| `constraints` | Rules to respect during execution |
| `verificationSteps` | How to verify completion |
| `failureModes` | Common failure modes |
| `evidenceRefs` | Supporting episode IDs |
| `confidence` | How confident we are (0–1) |
| `origin` | `explicit`, `learned`, or `human_confirmed` |

## Explicit Procedures

Directly provided through the normal `MemoryService.remember()` path with `kind = "procedural"`. These bypass evidence thresholds and receive full trust (`reason = "trusted_source"`).

## Learned Procedures

Derived from repeated successful episodes via `DeterministicProceduralExtractor`:

1. Episodes are clustered by normalized text similarity (>0.5 Jaccard)
2. Clusters with majority success generate procedure candidates
3. Trigger is derived from most common situation/subject
4. Steps are extracted from successful episode actions
5. Confidence = consistency × 0.6 + evidenceStrength × 0.4

## Evidence Policy

| Factor | Behavior |
|--------|----------|
| Independent evidence | Only distinct episode IDs count |
| Threshold | Minimum 2 independent episodes for learned procedures |
| Confidence cap | Learned procedures capped at 0.7 (configurable) |
| Negative evidence | Majority failures → no procedure created |
| Deduplication | Same episode ID processed twice → only counted once |

## Trigger Matching

`retrieveProcedures()` uses weighted scoring:

```text
totalScore = triggerScore × 0.6 + semanticScore × 0.4
```

Trigger score combines:
- Direct word overlap (>3 chars): weight 0.3
- Keyword matching: weight 0.4
- Jaccard similarity: weight 0.3

## ContextAssembler Integration

Procedural memories are formatted compactly:
```text
Trigger: authentication middleware changes
Procedure: inspect existing principal; run auth tests; run cross-tenant tests
Goal: Maintain secure authentication
```

Content stays under 3000 chars per procedure. Retrieval respects configurable limits (default: 3).

## Authority Model

```text
system/security policy
> trusted static rules
> human-confirmed procedures (reason: "trusted_source", full confidence)
> explicit user/operator procedures (reason: "trusted_source", full confidence)
> high-confidence learned procedures (capped at 0.7)
> low-confidence learned procedures
> episodic suggestions
```

## Episodic Relationship

Episodes support but remain distinct from procedures:
- Episodes are historical events ("what happened")
- Procedures are reusable knowledge ("how to do something")
- Episodes cluster to derive procedures but are never consumed/destroyed
- Single episode insufficient for learned procedure (minimum 2)

## Consolidation Relationship

Phase 4 consolidation handles procedural memories conservatively:
- Same trigger + equivalent procedure → reinforcement (not duplicate creation)
- Different triggers → separate procedures maintained
- Consolidation respects `kind = "procedural"` boundary

## Reinforcement

When `DefaultProceduralService` detects an existing procedure with similar trigger:
1. Confidence increased by +0.1 (capped at 1.0)
2. `metadata.reinforcements` incremented
3. `metadata.lastReinforcedAt` recorded
4. No duplicate procedure created

## Security

| Boundary | Enforcement |
|----------|-------------|
| Tenant isolation | Procedures from Tenant A never retrieved by Tenant B |
| Namespace isolation | Project X procedures not in Project Y |
| Agent scope | Agent-scoped procedures don't auto-expand to project |
| Secret filtering | Existing write policy rejects API keys, tokens, credentials |
| No scope escalation | Learned procedures cannot widen their own namespace |
| Trust boundary | Procedures remain untrusted contextual guidance |

## Execution Safety

- `procedure ≠ tool authorization` — procedures guide, not execute
- `procedure ≠ approval bypass` — procedures never bypass human approval
- `procedure ≠ system instruction` — procedures are context data, not system messages
- No `authorized`, `bypassApproval`, `toolAuthorization` metadata ever set

## Background Learning

`DefaultProceduralService.learnFromEpisodes()` is designed for async background execution:
- Extraction failure → non-fatal, returns `{ created: 0, skipped: 0, reason: "extraction_complete" }`
- Persistence failure → non-fatal, continues with next candidate
- Does not block run completion
- Reuses existing background job infrastructure

## Backfill

The extractor can process historical episodes in batches:
- `DeterministicProceduralExtractor.extract()` takes any `Memory[]` episodes
- Idempotent: same `idempotencyKey` prevents duplicate writes
- Dry-run: extract candidates without persisting
- Tenant/namespace safe: processing respects access boundaries

## Diagnostics

The `ProceduralExtractionResult` reports:
```text
created: number      — new procedures persisted
reinforced: number   — existing procedures strengthened
skipped: number      — candidates rejected by policy
reason: string       — overall status
```

Safe to log: counts, IDs, triggers (not full procedure content).

## Tests Added

39 tests covering:

| # | Test | Proves |
|---|------|--------|
| 1 | Explicit creation via MemoryService | Basic write path |
| 2 | Schema validation | All fields present |
| 3 | Provenance/evidence refs | Evidence preserved |
| 4 | Trigger retrieval | Trigger-aware search works |
| 5 | Semantic retrieval | Embedding-based search works |
| 6 | Unrelated-task non-retrieval | No false positives |
| 7 | Lexical fallback | Text search fallback |
| 8 | Tenant isolation | Cross-tenant blocked |
| 9 | Namespace isolation | Cross-namespace blocked |
| 10 | Agent scope isolation | No auto-expansion |
| 11 | Learned procedure from episodes | Core learning pipeline |
| 12 | Single-episode safety | Insufficient evidence rejected |
| 13 | Independent evidence counting | Unique episode IDs |
| 14 | Duplicate evidence prevention | Same ID not double-counted |
| 15 | Idempotent writes | Same key → dedup |
| 16 | Reinforcement | Confidence + count increase |
| 17 | Negative evidence | Majority failure → no procedure |
| 18 | Confidence behavior | Learned cap enforced |
| 19 | Explicit/human-confirmed priority | Bypass evidence threshold |
| 20 | Learned lower authority | Max confidence < human |
| 21 | Conflicting procedures separate | No auto-merge |
| 22 | Equivalent procedure reinforcement | No duplicate creation |
| 23 | Version/origin preservation | Metadata through persistence |
| 24 | ContextAssembler compatibility | Compact formatting |
| 25 | Context budgeting | Limit respected |
| 26 | Prompt-injection trust boundary | Stored as data only |
| 27 | No policy escalation | Learned < system trust |
| 28 | No approval bypass | No bypass metadata |
| 29 | No execution authorization | No tool auth metadata |
| 30 | Cross-run retrieval | Run A → Run D |
| 31 | Failure isolation | Extractor error → graceful |
| 32 | Backfill idempotency | Repeated → 1 procedure |
| 33 | Dry-run | Extract without persist |
| 34 | Phase 0 regression | Semantic memory works |
| 35 | ContextAssembler regression | Multi-kind retrieval |
| 36 | Handoff regression | Separate from procedures |
| 37 | Working Memory regression | Separate from procedures |
| 38 | Consolidation regression | Dedup works |
| 39 | Episodic regression | Kinds remain distinct |

## Test Results

```text
Phase 6 procedural memory tests:  39 passed
Phase 7 reliability tests:        47 passed
Episodic memory tests:            36 passed
Full project test suite:         753 passed, 0 failed
TypeScript typecheck:             passed
Build:                            passed
```

## Known Limitations

These are true Phase 6 boundaries, not defects:
- No full semantic contradiction resolution between procedures (Phase 7)
- No autonomous policy rewriting
- No artifact store for procedure templates
- Episode clustering uses simple Jaccard similarity (not embedding-based clustering)
- No procedure application outcome tracking (selected/followed/ignored)

## Phase 6 Definition of Done

- [x] Procedural memory has explicit domain semantics
- [x] Explicit procedures supported
- [x] Learned procedures supported
- [x] Learned procedures require sufficient evidence
- [x] Independent evidence is tracked
- [x] Source episodes preserved
- [x] Procedural writes use MemoryService
- [x] Procedures receive embeddings
- [x] Trigger-aware retrieval exists
- [x] Semantic retrieval works
- [x] Lexical fallback works
- [x] Unrelated procedures are not retrieved
- [x] Tenant isolation verified
- [x] Namespace isolation verified
- [x] Agent scope isolation verified
- [x] ContextAssembler consumes procedural memory
- [x] Procedural context is bounded
- [x] Procedures remain untrusted contextual guidance
- [x] Procedures cannot override system/security instructions
- [x] Procedures cannot grant tool authorization
- [x] Procedures cannot bypass human approval
- [x] Confidence/evidence model exists
- [x] Reinforcement works
- [x] Negative evidence handled conservatively
- [x] Human-confirmed procedures distinguishable
- [x] Consolidation handles equivalent procedures conservatively
- [x] Conflicting procedures are not silently merged
- [x] Procedural extraction is idempotent
- [x] Background extraction failure does not affect runs/episodes
- [x] Backfill exists (extractor + dry-run)
- [x] Dry-run exists
- [x] Phase 5 episodic memory still passes
- [x] All previous phase regressions pass
- [x] Full test suite passes (753/753)
- [x] Typecheck passes
- [x] Build passes
- [x] Documentation updated

## Final Verdict

1. **Can the system now remember reusable procedures across runs?** Yes. Procedures are persisted via MemoryService with kind=procedural and retrieved via hybrid search.

2. **Can it learn procedures from repeated relevant episodes?** Yes. `DeterministicProceduralExtractor` clusters episodes and derives procedures from successful patterns.

3. **Does one successful episode automatically become a strong procedure?** No. Minimum 2 independent episodes required. Confidence capped at 0.7 for learned procedures.

4. **Can a future task retrieve the appropriate procedure based on trigger/task similarity?** Yes. `retrieveProcedures()` uses trigger-aware weighted scoring (60% trigger + 40% semantic).

5. **Can unrelated procedures pollute agent context?** No. Trigger scoring ensures low relevance for unrelated tasks. Retrieval limit bounds total procedures.

6. **Can procedures cross unauthorized tenant/namespace/agent boundaries?** No. All isolation boundaries enforced at MemoryService and retrieval levels.

7. **Can a learned procedure override system policy or tool authorization?** No. Procedures carry no authorization metadata. They remain untrusted contextual guidance.

8. **Is supporting evidence preserved and inspectable?** Yes. `evidenceRefs` contain episode IDs. `metadata.origin`, `metadata.extractorVersion`, and `metadata.evidenceRefs` preserved through persistence.

9. **Can procedures improve/reinforce over time without creating duplicate memories?** Yes. `DefaultProceduralService` detects similar triggers and reinforces rather than duplicates.

10. **Is Phase 6 complete?** **Yes.**
