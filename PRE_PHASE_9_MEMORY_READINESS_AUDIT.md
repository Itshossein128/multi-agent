# Pre-Phase 9 Memory Readiness Audit

## Executive Summary

The memory system's **runtime paths (Phases 0–3, 7, 8) are genuinely wired and working**, verified by re-running the full suite (760 tests), by running the PostgreSQL/pgvector-gated suites against a real disposable Postgres 16 + pgvector container (67 additional tests, 0 failures), and by a live runtime probe driving the real `AgentRuntime` → `RuntimeMemory` → `DefaultMemoryService` → `HybridMemoryRetriever` → `ContextAssembler` stack through five scenarios with per-candidate traces.

Two material caveats temper readiness:

1. **Phases 4/5/6 engines (consolidation, episodic extraction, procedural learning) are not reachable from the running server.** They are fully implemented and extensively tested (`memoryConsolidation.test.ts` 33, `episodicMemory.test.ts` 36, `proceduralMemory.test.ts` 39 tests), but `apps/server/src/memory/composition.ts` constructs only service/extractor/writePolicy/formatter/jobs — nothing in `apps/server`, `src/cli`, or `scripts/` imports `RealMemoryConsolidator`, `DefaultEpisodeService`, or the procedural extractor. They are dormant outside tests. Phase 5/6 *retrieval* of seeded episodic/procedural memories works (verified live); the *automatic creation* pipelines never fire in production.
2. **Phase 8 evaluation is wired into the runtime contract but not into the server composition** — `MemoryDependencies.evaluation` exists and works (probe evidence), but `createMemoryComposition()` never sets it, so production runs record no evaluation telemetry until it is attached.

Verdict: **READY WITH MINOR ISSUES** — see Final Verdict for the rationale.

## Final Verdict

```text
READY WITH MINOR ISSUES
```

Rationale: no critical security or runtime path is broken — all six security gates measured zero, the semantic/vector/hybrid path works end-to-end against real Postgres+pgvector, retrieval correctly prefers verified current memory and excludes invalidated memory, and the evaluation runner is operational. The issues found are dormant-but-tested pipelines (4/5/6 creation), unwired evaluation telemetry, and stale/disputed memories still being injected when budget allows — all documented below with evidence, none blocking further development.

## Validation Results

| Check | Result |
|---|---|
| Full test suite (jest) | **56 suites: 54 passed, 2 effectively-skipped (DB-gated); 795 tests: 760 passed, 0 failed, 35 skipped** |
| 35 skips — cause | All gated on `MEMORY_TEST_DATABASE_URL` (no local Postgres configured in CI/env) |
| Skips re-run against real Postgres 16 + pgvector (disposable container) | **67/67 passed** across `memorySemanticVector` (11), `memoryStorage` (24), `memoryEndToEnd` (2), `ownershipAuthorization` (13), `dashboardSourceOfTruth` (14), `auth` (3 gated) |
| Transient issue during PG run | 3 `ownershipAuthorization` tests failed on first pass with 5s `beforeAll` hook timeouts while the fresh container was still warming; **passed 13/13 on immediate re-run against the warm DB** — test-infra robustness gap, not a product defect |
| Typecheck (`tsc --noEmit`) | **0 errors** |
| Build (`tsc`) | **exit 0** |
| Lint | **not configured** (no eslint config or script in repo) |
| `git diff --check` | **clean** |

Memory-specific suite counts (from the full run):

| Suite | Passed/Total |
|---|---|
| workingMemory | 53/53 |
| memoryReliability | 47/47 |
| proceduralMemory | 39/39 |
| episodicMemory | 36/36 |
| contextAssembler | 32/32 |
| memoryConsolidation | 33/33 |
| handoff | 30/30 |
| memoryApi | 24/24 |
| memoryRuntime | 23/23 |
| memoryEvaluation (Phase 8) | 22/22 |
| memoryEvalScenarios (Phase 8) | 20/20 |
| memoryService | 16/16 |
| memoryStorage | 24/24 (12 skipped without DB; **all 24 passed with DB**) |
| memorySemanticVector | 11/11 (skipped without DB; **11/11 with DB**) |
| memoryEndToEnd | 2/2 (1 skipped without DB; **2/2 with DB**) |
| workingMemoryRuntime, graphRunner, humanApproval, approvalManager, phase9Persistence, phase45Hardening, phase4Phase5Completion, phase5Runtime, memoryEmbedding, memoryRetrieval, storageUtils, workflowGuardrails | all passing (5–14 each) |

## Phase-by-Phase Verification

### Phase 0 — Semantic Memory: **Verified**
- Real path exercised with actual PostgreSQL + pgvector: `memorySemanticVector.test.ts` 11/11 passed against a real pgvector 16 container — semantic retrieval without lexical overlap, tenant isolation, namespace isolation, embedding-version compatibility, superseded/expired exclusion, idempotent writes, **restart persistence**, graceful lexical degradation when the embedding provider fails, lexical fallback, cross-run retrieval.
- Server composition (`apps/server/src/memory/composition.ts`) builds `PostgresMemoryStore` from `MEMORY_DATABASE_URL` with `MEMORY_VECTOR_ENABLED` flag; refuses volatile store in production; embeds via `embeddingProviderFromEnvironment()`.
- Embedding backfill tooling exists (`pnpm memory:backfill-embeddings`).
- Live probe: seeded "project package manager is pnpm" through the real service; a later invocation's context contained it, retrieved in `hybrid` mode with 4 candidates.

### Phase 1 — ContextAssembler: **Verified**
- `tests/contextAssembler.test.ts` 32/32. Part 3 below confirms single authority.

### Phase 2 — Structured Handoff: **Verified**
- `tests/handoff.test.ts` 30/30 including: handoffs included as context items, deterministic multi-handoff ordering, handoffs outrank raw previous output, raw fallback only when no handoffs exist, untrusted framing (adversarial content serialized as data), failed-agent handoffs, parallel-branch handoffs do not overwrite, budget-aware large handoffs.
- Workflow wiring verified in code: `workflowCompiler.ts:255` builds a structured handoff from every agent node's output (`buildHandoff`) and passes it through graph state to downstream nodes' `AgentRuntime.execute` input.

### Phase 3 — Working Memory: **Verified**
- `tests/workingMemory.test.ts` 53/53 (validation, scope escalation denied by server policy, run isolation, parallel merge, budget, diagnostics counts-only) + `tests/workingMemoryRuntime.test.ts` 11/11 in the compiled graph: checkpoint survival across runtime destruction, parallel-branch merge, fan-in isolation of predecessor-private entries, failed-agent writes never persisted, malformed updates rejected without breaking nodes.
- Runtime wiring verified: `workflowCompiler.ts` strips the untrusted `workingMemoryUpdates` channel at the executor boundary, validates via `applyWorkingMemoryUpdates` with server-owned scope policy, and merges into graph state.

### Phase 4 — Memory Consolidation: **Partially Verified** (engine works; not wired into production)
- `tests/memoryConsolidation.test.ts` 33/33: exact duplicates ignored, paraphrase merge via judge, related-but-distinct kept, temporal replacement → supersede, provenance preserved, tenant/namespace/kind boundaries, concurrency, restart safety, judge/embedding failure graceful.
- **Gap**: no production caller (see Dormant Implementations).

### Phase 5 — Episodic Memory: **Partially Verified** (retrieval works; creation pipeline not wired)
- `tests/episodicMemory.test.ts` 36/36: meaningful success/failure policies, trivial runs produce nothing, extraction failure doesn't alter run outcome, cross-run retrieval, tenant/namespace isolation, episodes stay episodes (never semantic facts/procedures), similar failures kept separate, idempotency, Working Memory informs without being copied.
- Live probe: a seeded failure episode was retrieved (finalScore 0.652, top) and injected (367 tokens, episodic kind) for a similar later task.
- **Gap**: `DeterministicEpisodicPolicy`/`DefaultEpisodeService` have no production caller — runs in the live server do not automatically create episodes.

### Phase 6 — Procedural Memory: **Partially Verified** (retrieval works; learning pipeline not wired)
- `tests/proceduralMemory.test.ts` 39/39: explicit creation, retrieval by trigger/semantic/lexical, single-episode does not create procedures, distinct-episode evidence counting, dedup, reinforcement, majority-failure rejection, cap for learned procedures, tenant/namespace isolation, injection attempts remain untrusted data, no approval-bypass metadata, cross-run reuse (Run A → Run D).
- Live probe: seeded release procedure ranked top (finalScore 0.604) and was injected (320 tokens) for a matching trigger task; unrelated weather memory dropped `low_score`.
- **Gap**: the procedural learning extractor has no production caller.

### Phase 7 — Reliability: **Verified**
- `tests/memoryReliability.test.ts` 47/47: staleness windows, successor detection, contradiction detection (not auto-resolved), invalidated exclusion from normal retrieval, revalidation, independent-evidence reinforcement (access count ≠ reinforcement), tenant/namespace isolation, integration with all phases, reliability factor in ranking.
- Phase 8 gap fix confirmed live: retriever diagnostics show `reliabilityFactor` multiplied into final scores; invalidated candidate got `reliabilityScore: 0`, `finalScore: 0`, `dropReason: "invalidated"`.
- Live probe caveat: verified memory outranked stale/disputed (0.685 / 0.814 / 0.840 reliability-scaled scores) — but see Context Quality: stale/disputed were still *injected*.

### Phase 8 — Evaluation: **Verified** (as built; telemetry not attached in server composition)
- `tests/memoryEvaluation.test.ts` 22/22 + `tests/memoryEvalScenarios.test.ts` 20/20.
- `pnpm memory:eval` runs all modes; `MEMORY_EVALUATION_REPORT.json/.md` written; thresholds enforced (zero-tolerance security metrics fail the run).
- Live probe: with the recorder attached via `MemoryDependencies.evaluation`, the real runtime produced retrieval traces, per-candidate selection diagnostics with drop reasons, injection records with per-kind tokens, and invocation evaluations with the full per-source token distribution — exactly as designed, observationally (executor output identical).
- **Gap**: `createMemoryComposition()` does not set `evaluation`, so production telemetry is only collected when a deployment attaches it.

## Real Runtime Data Flow

```text
workflowCompiler node (apps/server/src/compiler/workflowCompiler.ts)
  │  runAgentThroughRuntime ──────────────────────────────────────────────┐
  ▼                                                                      │
AgentRuntime.execute (src/agents/runtime/agentRuntime.ts)                │
  ├─► RuntimeMemory.read (src/agents/runtime/runtimeMemory.ts)           │
  │     ├─ memoryAccess authorization (tenant + namespaces)              │
  │     ├─ MemoryService.recall → HybridMemoryRetriever                  │
  │     │     ├─ vector (pgvector cosine) ─┐                             │
  │     │     └─ lexical ──────────────────┴→ hybrid score × reliability │
  │     ├─ MemoryContextFormatter (budget-bounded serialization)         │
  │     └─ [optional Phase 8 recorder: trace + selection diagnostics]    │
  ├─► DefaultContextAssembler.assemble (single context authority)        │
  │     system → task → handoff → working_memory → long_term_memory →    │
  │     history … budget pruning with dropped-item diagnostics           │
  ├─► executor.execute({ ..., assembledContext })   ◄────────────────────┘
  │     Api/Cli executor only serializes AssembledContext
  ├─ executor events; workingMemoryUpdates channel stripped once
  ├─ buildHandoff(rawOutput) → structured handoff for downstream nodes
  ├─ memory write (policy → extractor → service, background jobs)
  └─ [optional Phase 8 recorder: injection + invocation evaluation]
```

Storage: `PostgresMemoryStore` (pgvector) or `InMemoryMemoryStore`, chosen in `apps/server/src/memory/composition.ts`; durable storage never silently falls back to in-memory.

## Memory Evaluation Results

`pnpm memory:eval` (dataset v1, deterministic, fake embeddings — no external APIs), measured metrics:

| Metric | all | none | semantic | episodic | procedural |
|---|---|---|---|---|---|
| Overall | PASS | PASS | PASS | PASS | PASS |
| retrieval_hit_rate | 0.7143 | 0.0000 | 0.4286 | 0.1429 | 0.1429 |
| empty_retrieval_rate | 0.2857 | 1.0000 | 0.5714 | 0.8571 | 0.8571 |
| fallback_rate | 0 | 0 | 0 | 0 | 0 |
| stale_memory_rate | 0 | 0 | 0 | 0 | 0 |
| disputed_memory_rate | 0 | 0 | 0 | 0 | 0 |
| invalidated_memory_injection_rate | 0 | 0 | 0 | 0 | 0 |
| context_pollution_rate | 0.1111 | 0 | 0 | 0 | 0.5000* |
| harmful_memory_rate | 0.3333* | 0 | 0.5000* | 0 | 0 |
| memory_token_share | 0.4109 | 0 | 0.3009 | 0.1094 | 0.1261 |

\* *dataset-derived: v1 intentionally places known-bad fixtures (stale/disputed/injection-attempt) that must rank below verified memory, not vanish; thresholds (1/3) are pinned to that share and are CI regression guards. `memory=none` injects 0 across all 7 scenarios.*

Precision@1 = 1.0 on all positive scenarios; recall@k = 1.00 except the designed vocabulary-mismatch miss scenario (`retrieval-miss-vocabulary`, misses=`["fix-sem-db"]`) which itself validates miss detection.

## Memory Enabled vs Disabled

Measured via `--baseline` (identical scenario set, retrieval off): **9 memories injected with memory enabled vs 0 disabled** — every injected item is attributable to memory, and the no-memory scenario injects nothing in either mode. Scenario-level outcome signals (steps/retries/tool calls) are not produced by the deterministic evaluation stack, which uses a fixed executor analog; the comparison therefore supports statements about memory surface area and injection behavior only. No causal performance claims are made.

## Semantic Memory Findings

- Vector retrieval genuinely executes through pgvector (verified against real Postgres; ordering respects model/version/dimension/namespace).
- Hybrid ranking works: live probe semantic scenario top score 0.684 vs 0.098–0.155 for unrelated candidates.
- Cross-run retrieval and restart persistence verified (`memoryEndToEnd` with real Postgres: write in run 1, retrieve in run 2 after service reconstruction, no duplicates).
- Known gap: vocabulary-mismatch miss (relevant memory with zero lexical/semantic overlap is not found) — detected and counted, not fixed.

## Episodic Memory Findings

- Retrieval/injection works (probe: top-ranked 0.652, 367 tokens injected for a similar failure task).
- Episodes remain episodes — never promoted to semantic facts; similar failures stay separate.
- **Creation pipeline dormant in production** — no wiring from run completion to `DefaultEpisodeService`.

## Procedural Memory Findings

- Trigger/specificity retrieval works (probe: specific procedure 0.604, injected 320 tokens; unrelated procedure dropped).
- Safety properties verified: no authority escalation, no approval-bypass metadata, injection attempts remain untrusted data.
- **Learning pipeline dormant in production** — nothing calls the procedural extractor outside tests.

## Working Memory Findings

- Agent-private scope, workflow scope, run isolation, tenant isolation, checkpoint/restart, parallel-write merge all verified in the compiled graph (11 runtime tests) and unit suites (53 tests).
- Model output is treated as untrusted: channel stripped once at the executor boundary, validated against server-owned scope policy, rejection diagnostics never echo content.
- Working memory does not enter long-term memory automatically (dedicated test).

## Handoff Findings

- Structured handoff is the primary contract; every agent node produces one (`buildHandoff` in the compiler); fan-out/fan-in, parallel branches, multi-predecessor aggregation, and failed-agent handoffs verified.
- Raw fallback exists only when no handoffs exist and is observable via dedicated tests.
- Approval pause/resume verified (`humanApproval` 5/5, `approvalManager` 12/12, `graphRunner` interrupt handling); restart persistence verified (`phase9Persistence` restores waiting runs and step budgets).
- Note: no test named for the "extraction failed → raw output as summary" warning path was found (fallback-from-parse-failure is implemented at `handoff.ts:206` but appears untested) — low-severity observability gap.

## Consolidation Findings

- Behavior fully verified in suite (duplicate/paraphrase/keep-both/supersede, provenance preserved, retrieval returns canonical actives).
- **Not wired into the running server or any scheduled job** — consolidation only happens if a deployment explicitly constructs `RealMemoryConsolidator` (nothing does).

## Reliability Findings

- Invalidation exclusion, staleness, contradiction detection, successor-vs-contradiction distinction, independent-evidence reinforcement all verified.
- Live evidence: invalidated memory → reliability 0, excluded with `dropReason: "invalidated"`; verified memory outranked stale/disputed.
- Residual risk: stale/disputed memories remain *retrievable and injectable* (by design — down-ranked, marked with verification status) — see Context Quality.

## ContextAssembler Findings

- Single authority confirmed: sole production `executor.execute()` call site (`agentRuntime.ts:137`) always passes `assembledContext`; Api/Cli executors serialize it and their legacy `context.memoryContext` fallback paths are unreachable from the runtime (exercised only by direct executor unit tests).
- Token distribution per source is complete (system/task/history/long_term_memory/handoff/working_memory/runtime_state/previous_output/metadata) and is exposed to Phase 8 evaluation per invocation (probe captured full distributions).
- Budget behavior: dropped items and tokens are tracked; working memory has an independent sub-budget; required content survives tight budgets.

## Security Gates

| Gate | Result |
| --- | --- |
| Cross-tenant leakage | **0** (tenant-isolation scenario + `memorySemanticVector` tenant tests + reliability suite tenant tests, all passing; eval threshold zero-tolerance) |
| Namespace leakage | **0** (namespace isolation tests passing; eval threshold zero-tolerance) |
| Agent-private WM leakage | **0** (`workingMemoryRuntime` fan-in test: reviewer never sees predecessor-private entries; assembler never serializes another agent's private entries) |
| Handoff cross-run leakage | **0** (handoffs are per-node graph state within a run; no cross-run handoff path exists; branch-safety tests pass) |
| Invalidated-memory injection | **0** (retriever excludes invalidated via reliability factor — live probe evidence + eval zero-tolerance threshold) |
| Memory authority escalation | **0** (prompt-injection scenario: memory serialized as escaped untrusted data, never system authority; procedural tests assert no approval-bypass/authority metadata; `memoryRuntime` authority tests pass) |

## Context Quality

- **Memory misses**: 1 designed vocabulary-mismatch miss in dataset v1 (`fix-sem-db` — PostgreSQL fact vs package-manager query). Layer attribution: candidate retrieval (zero lexical/semantic overlap → below relevance floor). Detection works; documented, not fixed.
- **Context pollution**: 0.111 in full mode (1 of 9 injected is an irrelevant-but-admitted fixture, ranked last). Probe D (unrelated task) injected **0** memories — the system does not force memory into unrelated contexts.
- **Stale/disputed injections**: eval dataset reports 0 (its bad fixtures are down-ranked below selection floor in those scenarios). However, the **live probe Scenario E is a real pollution case**: verified (finalScore 0.685), stale (0.563) and disputed (0.545) memories were all *selected and injected* (572 semantic tokens total) — the verified one ranked first, but stale/disputed still reach the model within budget. This is the most actionable quality finding: current behavior is "down-rank and annotate," not "exclude when a verified current duplicate-subject memory exists."
- **Duplicate injections**: `duplicate_candidate_rate` = 0.

## Cost / Performance

From the live probe (real runtime path, deterministic embeddings):

- Memory tokens per invocation: A=301, B=367, C=522 (2 memories), D=0, E=572 (3 memories) — all within the configured 3000-token retrieval budget; assembler dropped 0 tokens in every scenario.
- Memory share of context: long_term_memory tokens vs total assembled tokens — A: 86/116 (74% of a small invocation), E: 154/177; on realistic large contexts (history + system) the share drops proportionally; eval `memory_token_share` = 0.4109 with a 0.5 CI guard.
- Retrieval latency: 1–5 ms (fake embeddings); embedding latency 0–1 ms. Real-provider latency is not measured in this audit (no paid APIs used, per audit rules).
- Assembler latency: not separately timed in the probe (sub-millisecond scale in eval runs); the eval suite tracks it per scenario.

## Fallback Analysis

- `fallback_rate` = 0 in all eval modes; probe retrievals all `hybrid` mode.
- Lexical fallback verified functional (`memorySemanticVector`: provider failure degrades to lexical; vector disabled at store level → lexical works).
- Raw handoff fallback: only when no handoffs exist (tested); production path always produces handoffs, so expected raw-fallback rate in workflows is ~0.
- Extraction fallbacks (episodic/procedural) cannot be exercised in production because the pipelines are unwired — see Dormant Implementations.

## Dormant / Incomplete Implementations

1. **`RealMemoryConsolidator` + `MemoryConsolidationEngine` + judge/backfill (Phase 4)** — implemented and tested, exported via barrel, but no import in `apps/server/**`, `src/cli/**`, or `scripts/**`. No scheduled or on-write consolidation occurs in the live server.
2. **Episodic creation pipeline (Phase 5)** — `DeterministicEpisodicPolicy`, `DeterministicEpisodeExtractor`, `DefaultEpisodeService` have no production callers. Runs in the live server never create episodes automatically.
3. **Procedural learning pipeline (Phase 6)** — `DeterministicProceduralPolicy`, `DeterministicProceduralExtractor` have no production callers. Procedures can only be created explicitly via the MemoryService API.
4. **Phase 8 evaluation telemetry** — the runtime contract is complete and observational, but `createMemoryComposition()` never attaches `evaluation`, so production invocations record no traces/metrics by default.
5. **`handoff.ts:206-215` raw-output-on-extraction-failure path** — implemented; no dedicated test found for the parse-failure warning path (adjacent fallbacks are tested).

None of these are fake/dead code — all are reachable from tests and correct — but features 1–3 are not operationally complete in the deployed system.

## Issues Found

### Critical
- None.

### High
- **H1 — Phases 4/5/6 creation pipelines are dormant in production.** The server stores, retrieves, ranks, and evaluates all memory kinds, but never consolidates, never auto-extracts episodes, and never learns procedures. Evidence: composition file contents + absence of imports (see Dormant Implementations). Impact: long-term memory quality degrades over time unattended; Phase 4/5/6 claims are test-only until wired.

### Medium
- **M1 — Stale/disputed memories are injected when they clear the score floor** (probe Scenario E: 3 package-manager memories injected together). Down-ranked and annotated, but a verified current memory does not suppress same-subject stale/disputed variants at injection time. Impact: recurring context pollution and potential model confusion on exactly the reliability cases Phase 7 was built for.
- **M2 — Phase 8 evaluation telemetry not attached in server composition** — production observability is opt-in-by-code only. Impact: no memory quality data from real runs until wired.
- **M3 — CI never runs the PostgreSQL/pgvector suites** (no `MEMORY_TEST_DATABASE_URL` in CI env), so the most important persistence/vector/isolation regressions would not be caught by CI as configured. Also: 3 PG suites exhibited 5s hook timeouts on cold DB start (passed on warm re-run) — hook timeouts are too tight for real infrastructure.

### Low
- **L1 — Vocabulary-mismatch retrieval miss** (designed, detected, counted): relevant memory with zero query overlap is unretrievable. Known IR limitation.
- **L2 — Handoff extraction-failure fallback path untested** (`handoff.ts:206`).
- **L3 — Eval `harmful_memory_rate` can look alarming (0.333)** without reading the threshold rationale; it is a dataset-derived ranking guard, not a defect indicator. Documentation already covers this; consider renaming or surfacing the note in the report output.

## Human Review Candidates

Constructed audit runs (deterministic, isolated stores; IDs from the live probe):

| # | Run ID | Workflow / node | Why inspect | Diagnostic IDs |
|---|---|---|---|---|
| 1 | `audit-A-semantic-42` | audit-workflow / audit-node | Good semantic retrieval: 4 candidates → 1 selected → 1 injected (301 tokens); 3 dropped `low_score` | semantic `3985f24b…`; dropped `f290743a…`, `0e52084a…`, `ed97d0ec…` |
| 2 | `audit-B-episodic-43` | audit-workflow / audit-node | Good episodic retrieval: failure episode top-ranked (0.652) and injected for a similar later failure | episode `ed97d0ec…` |
| 3 | `audit-C-procedural-44` | audit-workflow / audit-node | Procedural + episodic co-injection; check whether the episode (202 tokens) adds value or dilutes the procedure (320 tokens) | proc `0e52084a…`, epi `ed97d0ec…` |
| 4 | `audit-D-unrelated-45` | audit-workflow / audit-node | No-memory-needed task: 0 injected despite 4 candidates — verify agreement that nothing was relevant | all 4 dropped `low_score` |
| 5 | `audit-E-reliability-46` | audit-workflow / audit-node | **Context pollution candidate**: verified + stale + disputed all injected; confirm whether stale/disputed content could mislead | verified `3985f24b…`, stale `65420524…`, disputed `481fdd00…`, invalidated (excluded) `1b85915e…` |
| 6 | `retrieval-miss-vocabulary` (eval dataset v1) | memory:eval scenario | Memory-miss candidate: PostgreSQL fact exists, package-manager query misses it entirely | fixture `fix-sem-db` |
| 7 | `semantic-pnpm` (eval dataset v1) | memory:eval scenario | Ranking robustness: stale/disputed/contradicted/invalidated variants all below verified | fixtures `fix-bad-*` |
| 8 | `prompt-injection-isolation` (eval dataset v1) | memory:eval scenario | Injection content stays inside untrusted envelope; confirm framing in serialized context | fixture `fix-injection` |

## Recommended Next Action

```text
Fix current memory defects
```

Specifically, before building further on memory: wire consolidation/episodic/procedural creation pipelines into the server composition and lifecycle (H1), suppress same-subject stale/disputed variants when a verified current memory exists at injection time (M1), and attach evaluation telemetry in `createMemoryComposition()` (M2). Retrieval/evaluation tuning and the next system bottleneck should follow once creation pipelines are actually operating.

## Readiness Checklist

- [x] semantic vector path verified
- [x] lexical fallback verified
- [x] ContextAssembler single authority verified
- [x] structured handoff primary path verified
- [x] Working Memory runtime path verified
- [ ] consolidation verified *(verified in tests; not wired into production runtime)*
- [x] episodic cross-run recall verified *(retrieval; auto-creation not wired)*
- [x] procedural cross-run reuse verified *(retrieval; auto-learning not wired)*
- [x] reliability ranking verified
- [x] evaluation runner operational
- [x] memory-disabled baseline operational
- [x] memory-type ablation operational
- [x] context pollution measurable
- [x] memory misses measurable
- [x] security leakage = zero
- [x] invalidated-memory injection = zero
- [x] prompt-injection authority escalation = zero
- [x] full suite passes
- [x] typecheck passes
- [x] build passes
- [x] real multi-agent scenarios exercised
- [x] human-review candidates produced

## Final Questions

1. **Are Phases 0–8 genuinely wired into the real runtime?** Phases 0–3, 7, 8-observability: yes, verified end-to-end (including against real Postgres+pgvector). Phase 8 telemetry is wired in the runtime but not attached in server composition. Phases 4/5/6: retrieval paths yes; creation pipelines no — test-only.
2. **Are any phases only partially operational despite being marked complete?** Yes — 4 (consolidation), 5 (episode creation), 6 (procedure learning) are fully implemented and tested but have no production caller; their retrieval halves work.
3. **Does semantic memory measurably retrieve useful facts?** Yes — verified current fact ranked first (0.684 vs ≤0.155 others) in live probe; pgvector path proven against real Postgres.
4. **Does episodic memory retrieve useful prior experiences?** Yes — prior failure episode top-ranked (0.652) and injected for a similar task; cross-run recall proven in suites.
5. **Does procedural memory retrieve applicable reusable procedures?** Yes — repository-specific procedure top-ranked (0.604) for a matching trigger; generic/unrelated procedures dropped.
6. **Does the system avoid injecting memory when no relevant memory exists?** Yes — unrelated task produced 0 injected memories despite 4 candidates; eval `no-memory-unrelated` injects 0 with a zero-injection threshold.
7. **Are stale/conflicting memories handled correctly?** Mostly — invalidated are excluded; stale/disputed/contradicted are down-ranked and annotated, and verified memory outranks them — but stale/disputed variants still reach context when budget allows (M1).
8. **Is memory context cost reasonable based on measured data?** Yes — 0–572 memory tokens per audited invocation, 0 assembler drops, eval token share 0.41 under the 0.5 guard; no bloat detected at current scale.
9. **Are there any security/isolation failures?** No — all six mandatory gates measured zero with passing test evidence.
10. **Are fallback paths being used unexpectedly often?** No — fallback_rate 0 everywhere; all audited retrievals ran hybrid; raw handoff fallback is structurally rare (handoffs always built in workflows).
11. **What is the single largest remaining memory weakness?** The dormant Phase 4/5/6 creation pipelines: the system can remember what it is explicitly told, but cannot yet maintain (consolidate) or grow (episodes/procedures) its long-term memory on its own in the running product.
12. **Is the system ready to move beyond memory development?** With the listed fixes — yes, after H1/M1/M2 are addressed; the retrieval, reliability, isolation, and measurement foundations are solid and regression-guarded.

## Phase 0 Update: Production Episodic Memory Wiring (Completed)

- **Status**: Production-wired and verified.
- **Trigger Point**: Centralized run completion / failure handler in `GraphRunner` and `RunExecutor`. When a run reaches a terminal state (`completed` or `failed`), `DefaultEpisodeService.processRun(...)` is invoked automatically.
- **Idempotency**: Enforced via deterministic `idempotencyKey` (`episode:${runId}:${EPISODIC_EXTRACTOR_VERSION}`). Duplicate completion events, replays, or retries do not create duplicate episodic memories.
- **Security & Scope**: Namespace and tenant isolation are enforced using server-authoritative `MemoryAccessContext`.
- **Failure Semantics**: Episodic memory extraction and persistence errors are safely caught and logged as bounded diagnostics. Memory failures never cause an otherwise successful workflow run to fail.
- **Remaining Gaps**: Consolidation scheduling (Phase 4) and automatic procedural learning (Phase 6) remain dormant in production and are scheduled for future wiring phases.
