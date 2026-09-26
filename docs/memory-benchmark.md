# Production Memory Benchmark

Phase 5 adds an offline, deterministic benchmark around the production memory components. It is evidence gathering, not a new memory implementation or optimizer.

## Run it

```bash
pnpm memory:benchmark
pnpm memory:benchmark -- --json
pnpm memory:benchmark -- --scenario=semantic-recall
pnpm memory:benchmark -- --mode=full
```

Every run writes `MEMORY_BENCHMARK_REPORT.json` for branch/commit comparison and `MEMORY_BENCHMARK_REPORT.md` for review. Both generated files are ignored by Git. Reports record commit SHA, UTC timestamp, benchmark version, deterministic embedding identity, modes, and whether live evaluation was requested.

## Architecture and modes

The scenario contract declares setup memories and prior runs, a fixed target task, expected relevant and forbidden memory IDs, behavior invariants, enabled modes, and context budget. Each scenario gets a clean `InMemoryMemoryStore` and uses the production `HybridMemoryRetriever` and `DefaultMemoryContextFormatter`.

The same task and fixtures run in `no-memory`, `semantic-only`, `semantic-episodic`, and `full` modes where applicable. A deterministic executor follows only the actionable field of selected memory (semantic content, episodic action, or procedural steps), then checks required and forbidden output markers. Required memories must be selected, forbidden memories must be absent, and novel tasks must produce an empty context. The benchmark never asks an agent to grade itself.

Lifecycle evaluations reuse the production episodic policy/extractor/service, procedural extractor/policy/service, consolidation judge/engine, reliability-aware retrieval, and token formatter. Production defaults are unchanged.

## Scenario catalog

| Scenario | Ground truth |
|---|---|
| `semantic-recall` | current pnpm fact is selected |
| `episodic-recall` | duplicate-column recovery episode is reused |
| `procedural-recall` | verified release sequence is selected |
| `novel-task` | unrelated astronomy task gets no injected memory |
| `stale-conflict` | pnpm wins and stale npm is suppressed |
| `supersession` | replacement is selected and superseded record is absent |
| `episodic-diversity` | three distinct migration incidents remain available |
| `procedural-conflict` | stronger same-trigger procedure wins |
| `procedural-distinct-triggers` | deploy and rollback procedures both survive |
| `vocabulary-mismatch` | PostgreSQL is recalled from a paraphrased datastore query |
| `unknown-domain-conflict` | bearer-token fact suppresses obsolete session-cookie fact |
| `context-budget` | highest-value procedure survives a 330-token memory budget |

Vocabulary mismatch, unknown-domain conflict, and episodic diversity are diagnostic baselines. Their failures remain visible but do not make deterministic security/regression gates fail.

## Metrics

Per scenario and mode the JSON report includes task pass/fail, invariant satisfaction, repeated mistakes, solution reuse, candidate/selected IDs and counts, precision, recall, noise, hit rate, correct-empty versus failed retrieval, false-positive candidate/injection rates, token accounting, useful-token ratio, retrieval/preparation latency, embedding calls, fallback use, conflict suppression, and security counters.

The aggregate report includes local p50, p95, and max latency. These are deterministic local infrastructure measurements, not production SLAs. Provider price is `null` when pricing is unavailable; monetary cost is never fabricated.

Learning evaluation measures meaningful episode creation, trivial rejection, duplicate avoidance, later retrieval, minimum evidence, duplicate evidence, majority failure, procedure precision, missed learning, and reinforcement. Consolidation has fixed ground-truth cases for exact duplicates, related distinct memories, temporal replacement, and paraphrased duplicates. The default growth simulation runs 100 synthetic executions without API calls and records memory counts, superseded count, consolidation/procedural operations, candidate/selection volume, tokens, and precision over time.

## Regression gates

The initial gates are intentionally conservative:

- cross-tenant leakage is zero;
- cross-namespace leakage is zero;
- invalidated injection is zero;
- superseded injection is zero;
- canonical semantic recall is 100%;
- novel-task forbidden injection is zero;
- meaningful/trivial/duplicate episodic behavior remains correct;
- procedural minimum/duplicate/majority-failure evidence remains correct;
- consolidation false merges are zero in fixed ground truth.

Performance values are recorded but not gated.

## Optional live evaluation

Live evaluation is separate from deterministic regression coverage and makes real provider calls only when both the CLI flag and environment opt-in are present:

```bash
MEMORY_LIVE_EVAL=1 \
MEMORY_LIVE_EVAL_PROVIDER=openai \
MEMORY_LIVE_EVAL_MODEL=gpt-4o-mini \
OPENAI_API_KEY=... \
pnpm memory:benchmark -- --live
```

Provider values follow the existing API backend (`openai`, `anthropic`, `google`, or `gemini`). Missing credentials produce a reported skip. Live results are stored separately and never affect deterministic regression gates.
