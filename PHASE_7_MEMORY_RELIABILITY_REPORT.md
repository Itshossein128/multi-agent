# Phase 7 Memory Reliability Report

## Summary

Phase 7 makes long-term memory reliable over time by introducing a comprehensive reliability model with confidence calibration, verification, temporal validity, freshness policy, conflict detection, and reliability-aware retrieval. Memories now carry explicit provenance, confidence, verification state, reinforcement history, and conflict semantics.

Phase 7 is **complete**.

## Previous State

The existing `Memory` type had `confidence`, `reinforcementCount`, `accessCount`, `lastAccessedAt`, `status`, `supersedesMemoryId`, `supersededByMemoryId`, and `expiresAt` fields. However:
- No verification status tracking
- No freshness/staleness evaluation
- No conflict detection between memories
- No reliability-aware retrieval scoring
- No temporal validity windows
- No evidence independence tracking
- Confidence was set but not centrally calibrated

## Reliability Model

```
Memory = content + provenance + temporal validity + verification
         + confidence + independent evidence + conflict state + freshness
```

### Fields Used

| Field | Source | Purpose |
|-------|--------|---------|
| `confidence` | Memory.confidence | Base confidence score [0,1] |
| `reinforcementCount` | Memory.reinforcementCount | Independent positive evidence count |
| `accessCount` | Memory.accessCount | Retrieval count (NOT truth signal) |
| `verificationStatus` | metadata | unverified/verified/stale/disputed/invalidated |
| `validFrom` | metadata | When memory becomes valid |
| `validUntil` | metadata | When memory expires |
| `lastVerifiedAt` | metadata | Last verification timestamp |
| `verificationCount` | metadata | Total verification attempts |
| `contradictionCount` | metadata | Negative evidence count |
| `evidenceCount` | metadata | Total evidence sources |
| `evidenceRefs` | metadata | Stable evidence identity references |
| `verificationHistory` | metadata | Audit trail of verifications |

## Temporal Semantics

- **validFrom/validUntil**: Time-bounded facts (e.g., "project uses npm valid until 2026-02-10")
- **asOf**: Not implemented in Phase 7; documented as future enhancement
- **Historical retrieval**: Superseded memories accessible via direct `get()` but excluded from normal `recall()`

## Freshness

Kind-specific freshness thresholds:

| Kind | Fresh | Aging | Stale |
|------|-------|-------|-------|
| Semantic | 30 days | 90 days | >90 days |
| Procedural | 60 days | 180 days | >180 days |
| Episodic | Never stale | Never stale | Never stale |

Episodic memories are historical events and don't become "stale" as current-state facts.

## Verification

- **Source types**: file_check, manual, human, automated
- **Outcomes**: confirmed, rejected, inconclusive
- **Provenance**: sourceType, sourceRef, verifier, timestamp
- **History**: Bounded audit trail (last 20 verifications)
- **Revalidation**: Previously invalidated memories can be re-verified

## Reinforcement

- **Independent evidence**: Each evidence reference tracked by stable ID
- **Duplicate prevention**: Same evidence cannot reinforce twice
- **Positive evidence**: Increments reinforcementCount
- **Negative evidence**: Increments contradictionCount (separate from reinforcement)
- **Access != reinforcement**: Retrieval/access counts are never treated as evidence

## Conflict Detection

Relations detected:

| Relation | Meaning | Action |
|----------|---------|--------|
| `duplicate` | Exact content match | Ignore new |
| `compatible` | High overlap, no conflict | Keep both |
| `temporal_successor` | Explicit supersede | Supersede old |
| `contradiction` | Same subject, different values | Mark disputed |
| `uncertain` | Ambiguous relationship | Keep both, flag |

**Key rule**: Uncertain conflicts are NOT auto-resolved. System keeps both and flags for review.

## Conflict Resolution

The system:
- **Keeps both** when uncertain
- **Marks disputed** when evidence is ambiguous
- **Supersedes** only with explicit `supersedesMemoryId` or clear temporal evidence
- **Invalidates** only via explicit verification rejection

The system does NOT:
- Let LLMs silently choose "true" memory
- Auto-merge conflicting procedures
- Delete historical evidence

## Confidence Calibration

Centralized `DeterministicConfidencePolicy`:
- Base confidence from reliability
- Verification bonus: verified +0.15, disputed -0.2, invalidated -0.5
- Freshness penalty: aging -0.1, stale -0.25, expired -0.5
- Reinforcement boost: min(count * 0.05, 0.2)
- Contradiction penalty: min(count * 0.1, 0.3)
- Always clamped to [0, 1]

## Retrieval Integration

`computeReliabilityFactor()` produces a multiplier [0, 1] applied to relevance scores:
- Invalidated memories → factor = 0 (excluded)
- Verification status affects factor
- Freshness affects factor (non-episodic only)
- Conflicts reduce factor

## ContextAssembler Integration

Reliability metadata is available in memory records but remains **advisory context data**, not system authority. Trust hierarchy from Phase 1 is preserved.

## Memory Kind Differences

| Kind | Freshness | Conflict Semantics |
|------|-----------|-------------------|
| Semantic | Time-limited | Strongest contradiction handling |
| Episodic | Never stale | Episodes don't contradict (different events) |
| Procedural | Time-limited | Procedures can conflict (flagged conservatively) |

## Security

- **Tenant isolation**: All reliability operations scoped to tenant
- **Namespace isolation**: No cross-namespace comparison
- **Kind isolation**: Semantic/episodic/procedural have different conflict rules
- **Tool authorization**: Reliability processing never bypasses execution policy
- **Prompt injection**: Verified status doesn't elevate memory to system authority

## Concurrency

- Version-checked updates prevent lost updates
- Optimistic locking via `expectedVersion`
- Transaction-safe multi-memory operations

## Maintenance

### Scan Tenant
```typescript
const reliabilityService = new DefaultMemoryReliabilityService(store);
const result = await reliabilityService.scanTenant(namespace, access);
// result: { totalScanned, conflictsFound, staleMemories, unverifiedMemories, disputedMemories }
```

### Dry-Run
All scans are read-only by default. No mutations during analysis.

## Diagnostics

Safe metrics (no content logged):
- memories verified/stale/disputed/invalidated
- conflicts detected
- reinforcements recorded
- negative evidence events
- verification failures

## Tests Added (47)

| # | Test | What it proves |
|---|------|---------------|
| 1 | Reliability model validation | All fields extracted correctly |
| 2 | Confidence bounds | Always clamped to [0,1] |
| 3 | Verification provenance | Source type/ref/verifier recorded |
| 4 | lastVerifiedAt behavior | Set on verification |
| 5 | Semantic staleness | Ages over time |
| 6 | Episodic historical stability | Never becomes stale |
| 7 | Procedural staleness | Ages over time |
| 8 | Temporal validity | validFrom/validUntil respected |
| 9 | Temporal successor detection | Explicit supersede detected |
| 10 | True contradiction detection | Same subject different content |
| 11 | Uncertain conflict handling | Not auto-resolved |
| 12 | Disputed status | Tracked correctly |
| 13 | Invalidation | Excluded from normal ranking |
| 14 | Revalidation | Can be re-verified |
| 15 | Semantic conflict | Same subject flagged |
| 16 | Episodic non-conflict | Different outcomes don't conflict |
| 17 | Procedural conflict | Conflicting procedures detected |
| 18 | Independent reinforcement | Increases with evidence |
| 19 | Duplicate evidence prevention | Same evidence rejected |
| 20 | Access != reinforcement | Access doesn't inflate reinforcement |
| 21 | Negative evidence | Tracked separately |
| 22 | Human confirmation | Sets verified status |
| 23 | Authority weighting | Verified ranks higher |
| 24 | Reliability-aware ranking | Factor affects scoring |
| 25 | Stale down-ranking | Lower reliability factor |
| 26 | Disputed down-ranking | Lower reliability factor |
| 27 | Invalidated exclusion | Zero reliability factor |
| 28 | Superseded historical retrieval | Accessible via direct get |
| 29 | ContextAssembler formatting | Metadata available |
| 30 | Tenant isolation | Cross-tenant blocked |
| 31 | Namespace isolation | Cross-namespace blocked |
| 32 | Kind isolation | Different conflict rules |
| 33 | Concurrent updates | Safe under concurrency |
| 34 | Optimistic locking | Version conflicts detected |
| 35 | Backfill idempotency | Setting metadata is idempotent |
| 36 | Dry-run safety | No mutations |
| 37 | Conflict scan boundedness | Completes on large sets |
| 38 | Verification failure degradation | Memory preserved |
| 39 | Prompt-injection isolation | Verified != system authority |
| 40-47 | Phase 0-6 regressions | All previous phases work |

## Test Results

```
✅ 47/47 memory reliability tests pass
✅ 714/714 full test suite passes
✅ TypeScript typecheck passes
✅ Build passes
✅ git diff --check clean
```

## Known Limitations

- No full symbolic reasoning
- No arbitrary autonomous truth resolution
- No graph database
- No artifact store
- No as-of temporal queries (schema could support but not implemented)
- No automatic verification job (requires tool authorization infrastructure)

## Phase 7 Definition of Done

- [x] Explicit reliability model exists
- [x] Confidence semantics documented
- [x] Confidence centrally calibrated
- [x] Temporal validity supported
- [x] Freshness policy exists
- [x] Freshness differs by memory kind
- [x] Verification status exists
- [x] Verification provenance preserved
- [x] Last verification time tracked
- [x] Reinforcement uses independent evidence
- [x] Duplicate evidence cannot reinforce twice
- [x] Access count does not equal reinforcement
- [x] Negative evidence supported
- [x] Conflict detector exists
- [x] Deterministic conflicts handled first
- [x] Semantic conflict judgment is bounded
- [x] Contradictions can become disputed
- [x] Uncertain conflicts are not auto-resolved
- [x] Temporal successors supported
- [x] Clear superseding works
- [x] Invalidation supported
- [x] Historical records preserved
- [x] Retrieval is reliability-aware
- [x] Stale memories down-ranked/marked
- [x] Disputed memories handled explicitly
- [x] Invalidated memories excluded from normal recall
- [x] Episodic memories retain historical semantics
- [x] Procedural reliability integrated
- [x] Consolidation preserves reliability evidence
- [x] ContextAssembler preserves trust boundaries
- [x] Tenant isolation verified
- [x] Namespace isolation verified
- [x] Kind isolation verified
- [x] Concurrent reliability updates safe
- [x] Maintenance/backfill exists
- [x] Dry-run exists
- [x] All previous phase regressions pass
- [x] Full suite passes (714/714)
- [x] Typecheck passes
- [x] Build passes
- [x] Documentation updated

## Final Verdict

1. **Can the system distinguish a memory being old from a memory being wrong?** Yes. Freshness (stale/aging) is separate from verification status (invalidated/disputed).

2. **Can it represent historical facts that were once true but are no longer current?** Yes. Temporal validity (validFrom/validUntil) and superseding support time-bounded facts.

3. **Can it detect genuinely contradictory active memories?** Yes. `DeterministicConflictDetector` detects same-subject different-content contradictions.

4. **Can it avoid auto-resolving ambiguous conflicts?** Yes. Uncertain conflicts are flagged but not resolved. Both memories remain active.

5. **Can memories be explicitly verified or invalidated with provenance?** Yes. `DefaultMemoryVerificationService` records source, verifier, timestamp, and outcome.

6. **Can independent evidence reinforce a memory without double-counting?** Yes. Evidence references tracked by stable ID; duplicates rejected.

7. **Can retrieval prefer fresh verified knowledge over stale disputed knowledge?** Yes. `computeReliabilityFactor()` produces multipliers that affect ranking.

8. **Are episodic and procedural memories treated appropriately differently?** Yes. Episodic never stale; procedural ages; conflict rules differ by kind.

9. **Can reliability processing ever cross tenant/namespace boundaries?** No. All operations scoped to tenant/namespace.

10. **Does reliability metadata remain advisory data rather than system authority?** Yes. Verified status doesn't elevate memory to system instruction level.

11. **Does the system preserve historical evidence instead of silently rewriting memory?** Yes. Superseded/invalidated records preserved; verification history maintained.

12. **Is Phase 7 complete?** Yes.
