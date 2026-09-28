import type { MemorySearchResult } from "@multi-agent/types";
import { nowIso } from "@multi-agent/types";
import { InMemoryMemoryStore } from "../infrastructure/in-memory-memory-store";
import { HybridMemoryRetriever, DefaultMemoryContextFormatter } from "../application";
import {
  computePopulationMetrics, emptyPopulationMetrics, evaluateMemoryRelevance,
  type MemoryTokenAccounting, type MemoryUsefulnessLabel,
} from "../application/memoryEvaluation";
import {
  MEMORY_EVAL_DATASET_VERSION, MEMORY_EVAL_FIXTURES, MEMORY_EVAL_NOW, MEMORY_EVAL_NAMESPACE, MEMORY_EVAL_NAMESPACE_B,
  MEMORY_EVAL_RELEVANCE_RULES, MEMORY_EVAL_SCENARIOS, MEMORY_EVAL_TENANT, MEMORY_EVAL_TENANT_B,
  evalEmbeddingProvider, fixtureToMemory,
  type MemoryEvalScenarioDefinition,
} from "./memoryEvalFixtures";

// ─── Ablation Configuration (Steps 14/15/43/44) ──────────────────────────────

export type MemoryAblationMode = "all" | "semantic" | "episodic" | "procedural" | "none";

/** Map an ablation mode to the retriever's kind filter. */
function kindsForMode(mode: MemoryAblationMode): import("@multi-agent/types").MemoryKind[] | undefined {
  switch (mode) {
    case "semantic": return ["semantic"];
    case "episodic": return ["episodic"];
    case "procedural": return ["procedural"];
    case "all": return undefined;
    case "none": return [];
  }
}

// ─── Scenario Execution ──────────────────────────────────────────────────────

export interface MemoryEvalScenarioResult {
  scenarioId: string;
  title: string;
  expectation: string;
  ablation: MemoryAblationMode;
  retrieved: { id: string; kind: string; score: number; tokens: number; label: MemoryUsefulnessLabel }[];
  /** Candidate diagnostics for drop explanations. */
  candidates: { memoryId: string; score: number; reason: string; reliabilityFactor?: number }[];
  retrievedCount: number;
  injectedCount: number;
  injectionTokens: number;
  /** Candidates removed by normalized deduplication during retrieval. */
  duplicateCandidateCount: number;
  retrievalLatencyMs: number;
  embeddingLatencyMs: number;
  retrievalMode: string;
  conflictGroupCount: number;
  conflictSuppressedCount: number;
  staleConflictSuppressed: number;
  disputedConflictSuppressed: number;
  /** precision@k against fixture ground truth (undefined when no relevant ids exist). */
  precisionAtK?: number;
  /** recall@k against fixture ground truth. */
  recallAtK: number;
  /** Ground-truth relevant memories that were not retrieved (Step 72). */
  misses: string[];
  /** Forbidden (harmful/irrelevant) fixtures that leaked into retrieval. */
  forbiddenHits: string[];
  /** Expected top fixture ranked first. */
  topRankedCorrect: boolean;
  /** All mustRankBelow fixtures actually ranked below the expected top. */
  rankingCorrect: boolean;
  /** Cross-tenant probe results (Step 47). */
  tenantLeakCount: number;
  namespaceLeakCount: number;
  invalidatedInjectionCount: number;
  passed: boolean;
  failureReasons: string[];
}

const emptyTokens = (): MemoryTokenAccounting => ({ semantic: 0, episodic: 0, procedural: 0 });

/** Serialize retrieved results exactly as the runtime would (untrusted envelope). */
function serializeContext(results: MemorySearchResult[]): string {
  return new DefaultMemoryContextFormatter().render(results);
}

async function runScenario(
  scenario: MemoryEvalScenarioDefinition,
  ablation: MemoryAblationMode,
  options: { evaluationStore: boolean },
): Promise<MemoryEvalScenarioResult> {
  const store = new InMemoryMemoryStore(() => new Date(MEMORY_EVAL_NOW));
  const failures: string[] = [];
  let tenantLeakCount = 0;
  let namespaceLeakCount = 0;
  let invalidatedInjectionCount = 0;

  // Insert fixtures for the primary tenant.
  for (const fixtureId of scenario.fixtureIds) {
    const definition = MEMORY_EVAL_FIXTURES.find(f => f.id === fixtureId);
    if (definition) await store.insert(fixtureToMemory(definition));
  }
  // Foreign-tenant mirror of the same fixture ids for the isolation probe.
  if (scenario.foreignTenantProbe) {
    for (const fixtureId of scenario.fixtureIds) {
      const definition = MEMORY_EVAL_FIXTURES.find(f => f.id === fixtureId);
      if (definition) await store.insert(fixtureToMemory(definition, MEMORY_EVAL_TENANT_B, MEMORY_EVAL_NAMESPACE_B));
    }
  }

  // Ablation overrides the scenario's kind filter (semantic/episodic/procedural/none).
  const kinds = ablation === "all" ? scenario.kinds : kindsForMode(ablation);
  const retriever = new HybridMemoryRetriever(store, {
    embeddingProvider: ablation === "none" ? undefined : evalEmbeddingProvider,
    now: () => MEMORY_EVAL_NOW,
  });
  const access = {
    principalId: "eval-runner",
    tenantId: MEMORY_EVAL_TENANT,
    readableNamespaces: [MEMORY_EVAL_NAMESPACE, MEMORY_EVAL_NAMESPACE_B],
    writableNamespaces: [MEMORY_EVAL_NAMESPACE],
  };

  const query = {
    text: scenario.query,
    namespaces: [MEMORY_EVAL_NAMESPACE],
    kinds,
    limit: scenario.maxMemories,
    maxTokens: 4096,
    minScore: 0,
  };
  const result = await retriever.retrieve(query, access);

  // Foreign-tenant probe: same query, but results must never contain tenant B ids.
  if (scenario.foreignTenantProbe) {
    const foreignResult = await retriever.retrieve(query, { ...access, tenantId: MEMORY_EVAL_TENANT_B });
    const ownIds = new Set(result.results.map(r => r.memory.id));
    for (const item of foreignResult.results) if (ownIds.has(item.memory.id) && item.memory.tenantId === MEMORY_EVAL_TENANT) tenantLeakCount += 1;
    // A tenant-B access must only ever see tenant-B records.
    for (const item of foreignResult.results) if (item.memory.tenantId !== MEMORY_EVAL_TENANT_B) tenantLeakCount += 1;
  }

  const serialized = serializeContext(result.results);
  // Re-run formatter selection to attribute tokens per memory exactly as the runtime does.
  const selected = new DefaultMemoryContextFormatter().select(result.results, 4096);
  const injectionByToken = new Map<string, number>(selected.map(item => [item.memory.id, item.tokenCount]));  const injectedCount = selected.length;
  const injectionTokens = [...injectionByToken.values()].reduce((a, b) => a + b, 0);

  const retrieved = result.results.map(item => ({
    id: item.memory.id,
    kind: item.memory.kind,
    score: item.score,
    tokens: injectionByToken.get(item.memory.id) ?? 0,
    label: evaluateMemoryRelevance(item.memory, MEMORY_EVAL_RELEVANCE_RULES),
  }));

  // Labels: relevance rules mark known-bad fixtures harmful; the rest are useful/irrelevant/unknown.
  // Unknown label is reserved for the no-ground-truth case (Step 70) — fixtures always have ground truth.
  const labels = retrieved.map(item => item.label === "unknown" ? (scenario.relevantIds.includes(item.id) ? "useful" : "irrelevant") : item.label);

  // Ranking checks
  const topRankedCorrect = scenario.expectTopId ? (result.results[0]?.memory.id === scenario.expectTopId) : true;
  let rankingCorrect = true;
  if (scenario.expectTopId && scenario.mustRankBelow) {
    const topIndex = result.results.findIndex(r => r.memory.id === scenario.expectTopId);
    for (const belowId of scenario.mustRankBelow) {
      const belowIndex = result.results.findIndex(r => r.memory.id === belowId);
      if (belowIndex !== -1 && topIndex > belowIndex) rankingCorrect = false;
    }
  }

  // Forbidden leak checks
  const forbiddenHits = (scenario.forbiddenIds ?? []).filter(id => result.results.some(r => r.memory.id === id));
  // Invalidated injection detection from actual records (zero tolerance, Step 47).
  for (const item of result.results) {
    const status = (item.memory.metadata?.__reliability_verification_status as string | undefined)
      ?? (item.memory as unknown as { verificationStatus?: string }).verificationStatus;
    if (status === "invalidated") invalidatedInjectionCount += 1;
  }

  // Namespace leak: any result outside the requested namespace.
  for (const item of result.results) if (item.memory.namespace.id !== MEMORY_EVAL_NAMESPACE.id) namespaceLeakCount += 1;

  // Precision/recall/misses against ground truth (Steps 18/19/23/72).
  const relevantRetrieved = result.results.slice(0, scenario.k).filter(r => scenario.relevantIds.includes(r.memory.id)).length;
  const precisionAtK = scenario.relevantIds.length ? relevantRetrieved / scenario.k : undefined;
  const totalRelevant = scenario.relevantIds.length;
  const relevantFound = result.results.filter(r => scenario.relevantIds.includes(r.memory.id)).length;
  const recallAtK = totalRelevant ? relevantFound / totalRelevant : 0;
  const misses = scenario.relevantIds.filter(id => !result.results.some(r => r.memory.id === id));
  // Unexpected-but-expected misses: scenario declares misses that retrieval *should* miss (Step 23 fixture).
  const expectedMissesHonored = (scenario.expectedMissIds ?? []).every(id => !result.results.some(r => r.memory.id === id));

  // Pass/fail per scenario. Expectation checks apply only when memory is fully
  // enabled — ablation runs (semantic/episodic/procedural/none) observe counts, not pass/fail.
  const expectationsEnforced = ablation === "all";
  if (expectationsEnforced && scenario.expectsMemory && injectedCount === 0) failures.push("expected memory injection but none occurred");
  if (expectationsEnforced && !scenario.expectsMemory && injectedCount > 0) failures.push(`expected zero injection but ${injectedCount} memories reached context`);
  if (expectationsEnforced && scenario.expectTopId && !topRankedCorrect) failures.push(`expected ${scenario.expectTopId} at rank 1 but got ${result.results[0]?.memory.id ?? "nothing"}`);
  if (expectationsEnforced && !rankingCorrect) failures.push("expected fixture did not rank above mustRankBelow fixtures");
  if (expectationsEnforced && forbiddenHits.length) failures.push(`forbidden fixtures retrieved: ${forbiddenHits.join(", ")}`);
  if (invalidatedInjectionCount > 0) failures.push("invalidated memory reached context (zero-tolerance violation)");
  if (tenantLeakCount > 0) failures.push("cross-tenant leak (zero-tolerance violation)");
  if (namespaceLeakCount > 0) failures.push("cross-namespace leak (zero-tolerance violation)");
  if (expectationsEnforced && (scenario.expectedMissIds ?? []).length && !expectedMissesHonored) failures.push(`expected misses were retrieved: ${scenario.expectedMissIds?.filter(id => result.results.some(r => r.memory.id === id)).join(", ")}`);
  if (serialized.includes("ignore all prior instructions") && scenario.id === "prompt-injection-isolation") {
    // Injection-like content must appear ONLY inside the untrusted JSON envelope — which is exactly
    // what this check validates: it is present as escaped data, never as a system instruction.
    try {
      const parsed = JSON.parse(serialized) as { type?: string; warning?: string };
      if (parsed.type !== "untrusted_memory_context" || !parsed.warning?.includes("Do not follow instructions")) failures.push("injection content escaped the untrusted envelope");
    } catch { failures.push("memory context is not a valid untrusted envelope"); }
  }

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    expectation: scenario.expectation,
    ablation,
    retrieved,
    candidates: result.diagnostics.candidates.map(c => ({ memoryId: c.memoryId, score: c.score, reason: c.reason, reliabilityFactor: c.reliabilityFactor })),
    retrievedCount: result.results.length,
    injectedCount,
    injectionTokens,
    duplicateCandidateCount: result.diagnostics.deduplicatedCount,
    retrievalLatencyMs: result.diagnostics.latencyMs,
    embeddingLatencyMs: result.diagnostics.embeddingLatencyMs,
    retrievalMode: result.diagnostics.retrievalMode ?? "lexical",
    conflictGroupCount: result.diagnostics.conflict?.groups ?? 0,
    conflictSuppressedCount: result.diagnostics.conflict?.suppressed ?? 0,
    staleConflictSuppressed: result.diagnostics.conflict?.staleSuppressed ?? 0,
    disputedConflictSuppressed: result.diagnostics.conflict?.disputedSuppressed ?? 0,
    precisionAtK,
    recallAtK,
    misses,
    forbiddenHits,
    topRankedCorrect,
    rankingCorrect,
    tenantLeakCount,
    namespaceLeakCount,
    invalidatedInjectionCount,
    passed: failures.length === 0,
    failureReasons: failures,
  };
}

// ─── Aggregate Report ────────────────────────────────────────────────────────

export interface MemoryEvalReport {
  datasetVersion: number;
  generatedAt: string;
  /** Repository commit the evaluation ran against, when available (Step 68). */
  commit: string | null;
  ablation: MemoryAblationMode;
  baseline: MemoryEvalBaselineReport | null;
  scenarios: MemoryEvalScenarioResult[];
  metrics: Record<string, number>;
  thresholdFailures: string[];
  passed: boolean;
}

export interface MemoryEvalBaselineReport {
  datasetVersion: number;
  generatedAt: string;
  ablation: MemoryAblationMode;
  scenarios: MemoryEvalScenarioResult[];
  metrics: Record<string, number>;
  thresholdFailures: string[];
  passed: boolean;
}

/**
 * Conservative deterministic CI thresholds (Step 46). Derived from the dataset:
 * dataset v1 places 1 known-bad (harmful-labeled) fixture among the semantic
 * scenario's candidates, so harmful/pollution thresholds are pinned to the
 * dataset's known-bad share; only structural violations are zero-tolerance.
 */
export const MEMORY_EVAL_THRESHOLDS = {
  semantic_precision_at_1_min: 1,
  recall_at_k_min: 0.5,
  /** v1 dataset: 1 of 3 labeled injected memories in the semantic scenario is the known-bad down-ranked fixture. */
  max_harmful_memory_rate: 1 / 3,
  max_context_pollution_rate: 1 / 3,
  invalidated_injection_must_be: 0,
  tenant_leaks_must_be: 0,
  namespace_leaks_must_be: 0,
  no_memory_scenario_max_injected: 0,
  memory_token_share_max: 0.5,
} as const;

function evaluateThresholds(
  scenarios: MemoryEvalScenarioResult[],
  metrics: Record<string, number>,
  ablation: MemoryAblationMode,
): string[] {
  const failures: string[] = [];
  const fullyEnabled = ablation === "all";
  // Ranking/precision/label-mix thresholds apply only to fully-enabled runs;
  // ablation runs deliberately restrict kinds so their mix is not comparable.
  const semantic = fullyEnabled ? scenarios.find(s => s.scenarioId === "semantic-pnpm") : undefined;
  if (semantic && (semantic.precisionAtK ?? 0) < MEMORY_EVAL_THRESHOLDS.semantic_precision_at_1_min) failures.push(`semantic precision@1 ${semantic.precisionAtK} < ${MEMORY_EVAL_THRESHOLDS.semantic_precision_at_1_min}`);
  const noMemory = fullyEnabled ? scenarios.find(s => s.scenarioId === "no-memory-unrelated") : undefined;
  if (noMemory && noMemory.injectedCount > MEMORY_EVAL_THRESHOLDS.no_memory_scenario_max_injected) failures.push(`no-memory scenario injected ${noMemory.injectedCount} > 0`);
  if (fullyEnabled && metrics.context_pollution_rate > MEMORY_EVAL_THRESHOLDS.max_context_pollution_rate) failures.push(`context_pollution_rate ${metrics.context_pollution_rate.toFixed(3)} > ${MEMORY_EVAL_THRESHOLDS.max_context_pollution_rate}`);
  if (fullyEnabled && metrics.harmful_memory_rate > MEMORY_EVAL_THRESHOLDS.max_harmful_memory_rate) failures.push(`harmful_memory_rate ${metrics.harmful_memory_rate} > ${MEMORY_EVAL_THRESHOLDS.max_harmful_memory_rate}`);
  if (metrics.invalidated_memory_injection_rate > MEMORY_EVAL_THRESHOLDS.invalidated_injection_must_be) failures.push("invalidated_memory_injection_rate > 0 (zero-tolerance)");
  const tenantLeaks = scenarios.reduce((sum, s) => sum + s.tenantLeakCount, 0);
  const namespaceLeaks = scenarios.reduce((sum, s) => sum + s.namespaceLeakCount, 0);
  if (tenantLeaks > 0) failures.push("cross-tenant leakage detected (zero-tolerance)");
  if (namespaceLeaks > 0) failures.push("cross-namespace leakage detected (zero-tolerance)");
  return failures;
}

export interface RunMemoryEvalOptions {
  ablation?: MemoryAblationMode;
  baseline?: boolean;
  scenarioFilter?: string;
  /** Deterministic precision/recall are fixture-only; the flag exists for CLI symmetry. */
  json?: boolean;
}

/** Execute the fixed deterministic evaluation suite. Read-only over isolated in-memory stores (Step 78). */
export async function runMemoryEvaluation(options: RunMemoryEvalOptions = {}): Promise<MemoryEvalReport> {
  const ablation = options.ablation ?? "all";
  const scenarios = MEMORY_EVAL_SCENARIOS.filter(s => !options.scenarioFilter || s.id === options.scenarioFilter);
  const results: MemoryEvalScenarioResult[] = [];
  for (const scenario of scenarios) results.push(await runScenario(scenario, ablation, { evaluationStore: true }));

  // Population metrics across scenarios (labeled known: useful + irrelevant + harmful).
  const population = emptyPopulationMetrics();
  for (const result of results) {
    population.invocations += 1;
    population.retrievals += 1;
    if (result.retrievedCount === 0) population.emptyRetrievals += 1;
    population.duplicateCandidates += result.duplicateCandidateCount;
    population.droppedAfterSelectionCount += Math.max(0, result.retrievedCount - result.injectedCount);
    population.retrievedCount += result.retrievedCount;
    population.selectedCount += result.retrievedCount;
    population.injectedCount += result.injectedCount;
    population.memoryTokens += result.injectionTokens;
    population.totalInputTokens += result.injectionTokens + 400; // fixed scenario task/system size analog
    for (const item of result.retrieved) {
      if (item.label === "useful") population.usefulInjections += 1;
      else if (item.label === "irrelevant") population.irrelevantInjections += 1;
      else if (item.label === "harmful") population.harmfulInjections += 1;
      if (item.label !== "unknown") population.knownLabelCount += 1;
    }
    population.invalidatedInjections += result.invalidatedInjectionCount;
    population.conflictGroups += result.conflictGroupCount;
    population.conflictSuppressed += result.conflictSuppressedCount;
    population.staleConflictsSuppressed += result.staleConflictSuppressed;
    population.disputedConflictsSuppressed += result.disputedConflictSuppressed;
  }
  const metrics = computePopulationMetrics(population);
  // Zero-tolerance checks apply to every run mode; dataset-derived label-mix
  // thresholds (harmful/pollution share, precision) only compare fully-enabled runs.
  const thresholdFailures = evaluateThresholds(results, metrics, ablation);

  let baseline: MemoryEvalReport["baseline"] = null;
  if (options.baseline) {
    const baselineResults: MemoryEvalScenarioResult[] = [];
    for (const scenario of scenarios) baselineResults.push(await runScenario(scenario, "none", { evaluationStore: false }));
    const baselineInjected = baselineResults.reduce((sum, r) => sum + r.injectedCount, 0);
    const withMemoryInjected = results.reduce((sum, r) => sum + r.injectedCount, 0);
    baseline = { datasetVersion: MEMORY_EVAL_DATASET_VERSION, generatedAt: nowIso(), ablation: "none", scenarios: baselineResults, metrics: { injected_count: baselineInjected }, thresholdFailures: [], passed: true };
    // Attach comparison delta to the top-level metrics for the report.
    metrics.memory_enabled_injected = withMemoryInjected;
    metrics.memory_disabled_injected = baselineInjected;
  }

  const allPassed = results.every(r => r.passed) && thresholdFailures.length === 0;
  return {
    datasetVersion: MEMORY_EVAL_DATASET_VERSION,
    generatedAt: nowIso(),
    commit: detectGitCommit(),
    ablation,
    baseline,
    scenarios: results,
    metrics,
    thresholdFailures,
    passed: allPassed,
  };
}

// ─── Report Serialization (Steps 68/69) ────────────────────────────────────

/** Best-effort commit capture — evaluation must work outside git repos too. */
function detectGitCommit(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).toString().trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function reportToJson(report: MemoryEvalReport): string {
  return JSON.stringify({
    datasetVersion: report.datasetVersion,
    generatedAt: report.generatedAt,
    commit: report.commit,
    ablation: report.ablation,
    baseline: report.baseline ? { ablation: report.baseline.ablation, injected: report.baseline.metrics.injected_count } : null,
    passed: report.passed,
    metrics: report.metrics,
    thresholdFailures: report.thresholdFailures,
    scenarios: report.scenarios.map(s => ({
      id: s.scenarioId, ablation: s.ablation, passed: s.passed,
      retrieved: s.retrievedCount, injected: s.injectedCount, injectionTokens: s.injectionTokens,
      precisionAtK: s.precisionAtK, recallAtK: s.recallAtK,
      misses: s.misses, forbiddenHits: s.forbiddenHits,
      topRankedCorrect: s.topRankedCorrect, rankingCorrect: s.rankingCorrect,
      tenantLeakCount: s.tenantLeakCount, namespaceLeakCount: s.namespaceLeakCount,
      invalidatedInjectionCount: s.invalidatedInjectionCount,
      failureReasons: s.failureReasons,
      mode: s.retrievalMode,
    })),
  }, null, 2);
}

export function reportToMarkdown(report: MemoryEvalReport): string {
  const lines: string[] = [];
  lines.push(`# Memory Evaluation Report`);
  lines.push("");
  lines.push(`- Dataset version: **${report.datasetVersion}**`);
  lines.push(`- Generated: ${report.generatedAt}`);
  if (report.commit) lines.push(`- Commit: ${report.commit}`);
  lines.push(`- Ablation: \`${report.ablation}\``);
  if (report.baseline) lines.push(`- Baseline (no memory): ${report.baseline.metrics.injected_count} injected vs ${report.metrics.memory_enabled_injected ?? "?"} with memory`);
  lines.push(`- Overall: **${report.passed ? "PASS" : "FAIL"}**`);
  lines.push("");
  lines.push(`## Scenario Results`);
  lines.push("");
  lines.push(`| Scenario | Passed | Retrieved | Injected | precision@k | recall@k | Tokens | Notes |`);
  lines.push(`|----------|--------|-----------|----------|-------------|----------|--------|-------|`);
  for (const scenario of report.scenarios) {
    const notes = [...scenario.failureReasons, ...(scenario.misses.length ? [`misses: ${scenario.misses.join(",")}`] : [])].join("; ") || "—";
    lines.push(`| ${scenario.scenarioId} | ${scenario.passed ? "✅" : "❌"} | ${scenario.retrievedCount} | ${scenario.injectedCount} | ${scenario.precisionAtK ?? "n/a"} | ${scenario.recallAtK.toFixed(2)} | ${scenario.injectionTokens} | ${notes} |`);
  }
  lines.push("");
  lines.push(`## Aggregate Metrics`);
  lines.push("");
  for (const [key, value] of Object.entries(report.metrics)) lines.push(`- ${key}: ${typeof value === "number" ? value.toFixed(4) : value}`);
  if (report.thresholdFailures.length) {
    lines.push("");
    lines.push(`## Threshold Failures`);
    lines.push("");
    for (const failure of report.thresholdFailures) lines.push(`- ❌ ${failure}`);
  }
  return lines.join("\n");
}
