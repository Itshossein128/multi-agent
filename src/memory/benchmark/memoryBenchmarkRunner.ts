import { execSync } from "node:child_process";
import type { Memory, MemoryKind, MemoryRetrievalDiagnostics, MemorySearchResult } from "@multi-agent/types";
import { DefaultEpisodeService } from "../application/episodicMemory";
import { DefaultMemoryContextFormatter } from "../application/memoryContextFormatter";
import { DeterministicMemoryConsolidationJudge } from "../application/memoryConsolidationJudge";
import { RealMemoryConsolidator } from "../application/realMemoryConsolidator";
import { DefaultMemoryService } from "../application/memoryService";
import { DefaultProceduralService } from "../application/proceduralMemory";
import { HybridMemoryRetriever } from "../application/hybridMemoryRetriever";
import { InMemoryMemoryStore } from "../infrastructure/in-memory-memory-store";
import type { ConsolidationDecisionType, MemoryAccessContext, MemoryCandidate } from "../contracts";
import {
  MEMORY_EVAL_NAMESPACE,
  MEMORY_EVAL_TENANT,
  evalEmbeddingMetadata,
  evalEmbeddingProvider,
  fixtureToMemory,
} from "../evaluation/memoryEvalFixtures";
import {
  MEMORY_BENCHMARK_NOW,
  MEMORY_BENCHMARK_SCENARIOS,
  MEMORY_BENCHMARK_VERSION,
  kindsForBenchmarkMode,
  type MemoryBenchmarkMode,
  type MemoryBenchmarkScenario,
} from "./memoryBenchmarkFixtures";

export interface MemoryBenchmarkScenarioResult {
  scenario: string;
  category: string;
  mode: MemoryBenchmarkMode;
  diagnosticOnly: boolean;
  taskOutcome: {
    passed: boolean;
    invariantSatisfaction: number;
    knownMistakeRepeated: boolean;
    knownSolutionReused: boolean;
    observedOutput: string;
  };
  expectedMemories: string[];
  forbiddenMemories: string[];
  candidateMemories: string[];
  selectedMemories: string[];
  relevantSelected: number;
  irrelevantSelected: number;
  expectedRetrieved: number;
  forbiddenRetrieved: number;
  candidateCount: number;
  selectedCount: number;
  precision: number | null;
  recall: number;
  noiseRate: number;
  memoryHit: boolean;
  correctEmptyRetrieval: boolean;
  failedRetrieval: boolean;
  falsePositiveCandidateRate: number;
  falsePositiveInjectionRate: number;
  memoryTokens: number;
  usefulMemoryTokens: number;
  totalContextTokens: number;
  memoryContextRatio: number;
  usefulMemoryTokenRatio: number;
  retrievalLatencyMs: number;
  memoryPreparationLatencyMs: number;
  embeddingCalls: number;
  fallbackUsed: boolean;
  conflictGroups: number;
  conflictSuppressed: number;
  staleConflictSuppressed: number;
  disputedConflictSuppressed: number;
  supersededInjection: number;
  invalidatedInjection: number;
  crossTenantLeakage: number;
  crossNamespaceLeakage: number;
  securityViolations: number;
  assertions: Array<{ assertion: string; passed: boolean }>;
}

export interface LearningQualityReport {
  episodic: {
    meaningfulCreated: number;
    trivialRejected: number;
    duplicateAvoided: number;
    relevantLaterRetrieved: number;
    expectedRelevantLater: number;
  };
  procedural: {
    minimumEvidenceRejected: boolean;
    duplicateEvidenceRejected: boolean;
    majorityFailureRejected: boolean;
    learnedProcedures: number;
    correctLearnedProcedures: number;
    procedurePrecision: number;
    missedLearningOpportunities: number;
    reinforcements: number;
  };
}

export interface ConsolidationQualityReport {
  cases: Array<{ id: string; expected: ConsolidationDecisionType; actual: ConsolidationDecisionType; correct: boolean }>;
  trueDuplicateCorrect: number;
  relatedDistinctCorrect: number;
  replacementCorrect: number;
  falseMerges: number;
  missedDuplicates: number;
  accuracy: number;
}

export interface GrowthSnapshot {
  run: number;
  semanticCount: number;
  episodicCount: number;
  proceduralCount: number;
  supersededCount: number;
  averageCandidateCount: number;
  averageSelectedCount: number;
  averageMemoryTokens: number;
  retrievalPrecision: number;
}

export interface MemoryGrowthReport {
  runs: number;
  meaningfulRuns: number;
  trivialRuns: number;
  consolidationOperations: number;
  proceduralLearningOperations: number;
  snapshots: GrowthSnapshot[];
  final: GrowthSnapshot;
}

export interface LatencySummary { p50: number; p95: number; max: number }

export interface LiveEvaluationReport {
  status: "not-requested" | "skipped" | "completed" | "failed";
  provider?: string;
  model?: string;
  reason?: string;
  memoryOffCorrect?: boolean;
  memoryOnCorrect?: boolean;
  memoryOffOutput?: string;
  memoryOnOutput?: string;
}

export interface MemoryBenchmarkReport {
  benchmarkVersion: number;
  generatedAt: string;
  commit: string | null;
  configuration: {
    deterministic: true;
    modes: MemoryBenchmarkMode[];
    scenarioCount: number;
    embeddingProvider: string;
    embeddingModel: string;
    liveRequested: boolean;
  };
  passed: boolean;
  regressionGateFailures: string[];
  scenarios: MemoryBenchmarkScenarioResult[];
  comparison: Array<{
    scenario: string;
    memoryOffSuccess: boolean;
    fullMemorySuccess: boolean;
    successDelta: number;
    repeatedMistakeDelta: number;
    memoryTokenDelta: number;
    preparationLatencyDeltaMs: number;
  }>;
  aggregate: {
    fullMemorySuccessRate: number;
    noMemorySuccessRate: number;
    fullMemoryPrecision: number;
    fullMemoryRecall: number;
    fullMemoryNoiseRate: number;
    memoryHitRate: number;
    correctEmptyRetrievalRate: number;
    falsePositiveCandidateRate: number;
    falsePositiveInjectionRate: number;
    memoryTokens: number;
    totalContextTokens: number;
    memoryContextRatio: number;
    embeddingCalls: number;
    fallbackUsage: number;
    securityViolations: number;
    supersededInjection: number;
    invalidatedInjection: number;
  };
  latency: { retrieval: LatencySummary; memoryPreparation: LatencySummary; conflictProcessing: null };
  learning: LearningQualityReport;
  consolidation: ConsolidationQualityReport;
  growth: MemoryGrowthReport;
  operations: { consolidation: number; proceduralLearning: number };
  providerCost: null;
  live: LiveEvaluationReport;
  weaknesses: Array<{ rank: number; impact: "high" | "medium" | "low"; issue: string; evidence: string }>;
}

export interface RunMemoryBenchmarkOptions {
  scenarioFilter?: string;
  modeFilter?: MemoryBenchmarkMode;
  live?: boolean;
  growthRuns?: number;
}

const access: MemoryAccessContext = {
  principalId: "memory-benchmark",
  tenantId: MEMORY_EVAL_TENANT,
  readableNamespaces: [MEMORY_EVAL_NAMESPACE],
  writableNamespaces: [MEMORY_EVAL_NAMESPACE],
};

const emptyDiagnostics = (): MemoryRetrievalDiagnostics => ({
  latencyMs: 0, embeddingLatencyMs: 0, candidateCount: 0, selectedCount: 0,
  deduplicatedCount: 0, warnings: [], securityViolations: 0,
  filteredCounts: { unauthorized: 0, expired: 0, superseded: 0, invalidated: 0 },
  conflict: { groups: 0, candidates: 0, suppressed: 0, staleSuppressed: 0, disputedSuppressed: 0, unresolved: 0 },
  candidates: [], retrievalMode: "lexical",
});

function intersectKinds(scenarioKinds: MemoryKind[] | undefined, mode: MemoryBenchmarkMode): MemoryKind[] | undefined {
  const modeKinds = kindsForBenchmarkMode(mode);
  if (modeKinds === undefined) return scenarioKinds;
  if (scenarioKinds === undefined) return modeKinds;
  return scenarioKinds.filter(kind => modeKinds.includes(kind));
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(quantile * ordered.length) - 1)];
}

function latencySummary(values: number[]): LatencySummary {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.length ? Math.max(...values) : 0 };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value: number): number { return Number(value.toFixed(6)); }

/** A deterministic executor: it follows only the actionable field of selected memory. */
function executeDeterministicBenchmarkAgent(results: MemorySearchResult[]): string {
  return results.map(({ memory }) => {
    if (memory.kind === "procedural") return memory.procedure ?? memory.content;
    if (memory.kind === "episodic") return memory.action ?? memory.lesson ?? memory.content;
    return memory.content;
  }).join("\n");
}

function outputContainsMarker(output: string, marker: string): boolean {
  const escaped = marker.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(output);
}

function materializeScenarioMemory(scenario: MemoryBenchmarkScenario, index: number): Memory {
  const fixture = scenario.setup.memories[index];
  const memory = fixtureToMemory(fixture);
  memory.createdAt = new Date(MEMORY_BENCHMARK_NOW - (fixture.ageDays ?? 1) * 86400000).toISOString();
  memory.updatedAt = memory.createdAt;
  if (scenario.id === "supersession" && memory.id === "bench-super-old") {
    memory.status = "superseded";
    memory.supersededByMemoryId = "bench-super-new";
  }
  if (scenario.id === "supersession" && memory.id === "bench-super-new") memory.supersedesMemoryId = "bench-super-old";
  return memory;
}

async function runScenario(scenario: MemoryBenchmarkScenario, mode: MemoryBenchmarkMode): Promise<MemoryBenchmarkScenarioResult> {
  const store = new InMemoryMemoryStore(() => new Date(MEMORY_BENCHMARK_NOW));
  for (let index = 0; index < scenario.setup.memories.length; index += 1) await store.insert(materializeScenarioMemory(scenario, index));

  let embeddingCalls = 0;
  const embeddingProvider = {
    metadata: evalEmbeddingMetadata,
    embed: async (text: string) => { embeddingCalls += 1; return evalEmbeddingProvider.embed(text); },
  };
  const formatter = new DefaultMemoryContextFormatter();
  let results: MemorySearchResult[] = [];
  let diagnostics = emptyDiagnostics();
  const preparationStarted = performance.now();
  if (mode !== "no-memory") {
    const retriever = new HybridMemoryRetriever(store, { embeddingProvider, formatter, now: () => MEMORY_BENCHMARK_NOW });
    const retrieval = await retriever.retrieve({
      text: scenario.targetTask,
      namespaces: [MEMORY_EVAL_NAMESPACE],
      kinds: intersectKinds(scenario.kinds, mode),
      limit: scenario.maxMemories,
      maxTokens: scenario.memoryTokenBudget,
      minScore: 0,
    }, access);
    results = formatter.select(retrieval.results, scenario.memoryTokenBudget);
    diagnostics = retrieval.diagnostics;
  }
  // Rendering is included because RuntimeMemory performs both selection and serialization.
  formatter.render(results);
  const memoryPreparationLatencyMs = performance.now() - preparationStarted;

  const selectedIds = results.map(result => result.memory.id);
  const candidateIds = diagnostics.candidates.map(candidate => candidate.memoryId);
  const relevantSet = new Set(scenario.expectedRelevantMemories);
  const forbiddenSet = new Set(scenario.forbiddenMemories);
  const relevantSelected = selectedIds.filter(id => relevantSet.has(id)).length;
  const irrelevantSelected = selectedIds.length - relevantSelected;
  const expectedRetrieved = relevantSelected;
  const forbiddenRetrieved = selectedIds.filter(id => forbiddenSet.has(id)).length;
  const expectsEmpty = scenario.expectedRelevantMemories.length === 0;
  const observedOutput = executeDeterministicBenchmarkAgent(results);
  const normalizedOutput = observedOutput.toLowerCase();
  const knownSolutionReused = expectsEmpty ? selectedIds.length === 0 : expectedRetrieved === scenario.expectedRelevantMemories.length;
  const markerAssertions = [
    ...scenario.requiredOutputMarkers.map(marker => ({ assertion: `output contains: ${marker}`, passed: outputContainsMarker(normalizedOutput, marker) })),
    ...scenario.forbiddenOutputMarkers.map(marker => ({ assertion: `output excludes: ${marker}`, passed: !outputContainsMarker(normalizedOutput, marker) })),
  ];
  const selectionAssertions = [
    ...scenario.expectedRelevantMemories.map(id => ({ assertion: `selected expected memory: ${id}`, passed: selectedIds.includes(id) })),
    ...scenario.forbiddenMemories.map(id => ({ assertion: `excluded forbidden memory: ${id}`, passed: !selectedIds.includes(id) })),
    ...(expectsEmpty ? [{ assertion: "empty memory output", passed: observedOutput.length === 0 }] : []),
  ];
  const assertions = [...selectionAssertions, ...markerAssertions];
  const taskPassed = assertions.every(assertion => assertion.passed);
  const knownMistakeRepeated = forbiddenRetrieved > 0 || scenario.forbiddenOutputMarkers.some(marker => outputContainsMarker(normalizedOutput, marker)) || (!expectsEmpty && !knownSolutionReused);
  const memoryTokens = results.reduce((sum, result) => sum + result.tokenCount, 0);
  const usefulMemoryTokens = results.filter(result => relevantSet.has(result.memory.id)).reduce((sum, result) => sum + result.tokenCount, 0);
  const totalContextTokens = scenario.baseContextTokens + memoryTokens;
  const falsePositiveCandidates = candidateIds.filter(id => !relevantSet.has(id)).length;
  const conflict = diagnostics.conflict;
  const invalidatedInjection = results.filter(result => result.memory.metadata?.__reliability_verification_status === "invalidated").length;
  const supersededInjection = results.filter(result => result.memory.status === "superseded").length;
  const crossTenantLeakage = results.filter(result => result.memory.tenantId !== access.tenantId).length;
  const crossNamespaceLeakage = results.filter(result => result.memory.namespace.scope !== MEMORY_EVAL_NAMESPACE.scope || result.memory.namespace.id !== MEMORY_EVAL_NAMESPACE.id).length;
  const securityViolations = (diagnostics.securityViolations ?? 0) + crossTenantLeakage + crossNamespaceLeakage;

  return {
    scenario: scenario.id, category: scenario.category, mode, diagnosticOnly: scenario.diagnosticOnly ?? false,
    taskOutcome: {
      passed: taskPassed,
      invariantSatisfaction: assertions.length ? assertions.filter(item => item.passed).length / assertions.length : Number(taskPassed),
      knownMistakeRepeated, knownSolutionReused, observedOutput,
    },
    expectedMemories: [...scenario.expectedRelevantMemories], forbiddenMemories: [...scenario.forbiddenMemories],
    candidateMemories: candidateIds, selectedMemories: selectedIds,
    relevantSelected, irrelevantSelected, expectedRetrieved, forbiddenRetrieved,
    candidateCount: diagnostics.candidateCount, selectedCount: selectedIds.length,
    precision: selectedIds.length ? round(relevantSelected / selectedIds.length) : null,
    recall: scenario.expectedRelevantMemories.length ? round(expectedRetrieved / scenario.expectedRelevantMemories.length) : 1,
    noiseRate: selectedIds.length ? round(irrelevantSelected / selectedIds.length) : 0,
    memoryHit: scenario.expectedRelevantMemories.length > 0 && expectedRetrieved > 0,
    correctEmptyRetrieval: expectsEmpty && selectedIds.length === 0,
    failedRetrieval: !expectsEmpty && selectedIds.length === 0,
    falsePositiveCandidateRate: diagnostics.candidateCount ? round(falsePositiveCandidates / diagnostics.candidateCount) : 0,
    falsePositiveInjectionRate: selectedIds.length ? round(irrelevantSelected / selectedIds.length) : 0,
    memoryTokens, usefulMemoryTokens, totalContextTokens,
    memoryContextRatio: totalContextTokens ? round(memoryTokens / totalContextTokens) : 0,
    usefulMemoryTokenRatio: memoryTokens ? round(usefulMemoryTokens / memoryTokens) : 1,
    retrievalLatencyMs: diagnostics.latencyMs,
    memoryPreparationLatencyMs: round(memoryPreparationLatencyMs), embeddingCalls,
    fallbackUsed: diagnostics.retrievalMode === "fallback",
    conflictGroups: conflict?.groups ?? 0, conflictSuppressed: conflict?.suppressed ?? 0,
    staleConflictSuppressed: conflict?.staleSuppressed ?? 0, disputedConflictSuppressed: conflict?.disputedSuppressed ?? 0,
    supersededInjection, invalidatedInjection, crossTenantLeakage, crossNamespaceLeakage, securityViolations,
    assertions,
  };
}

function memoryRecord(id: string, kind: MemoryKind, content: string, fields: Partial<Memory> = {}): Memory {
  const fixture = fixtureToMemory({ id, kind, content, subject: fields.subject ?? id, importance: fields.importance ?? 0.7 });
  return { ...fixture, ...fields, id, kind, content };
}

async function evaluateConsolidation(): Promise<ConsolidationQualityReport> {
  const judge = new DeterministicMemoryConsolidationJudge();
  const cases: Array<{ id: string; incoming: MemoryCandidate; existing: Memory[]; expected: ConsolidationDecisionType }> = [
    {
      id: "exact-duplicate", expected: "ignore_new",
      incoming: { namespace: MEMORY_EVAL_NAMESPACE, kind: "semantic", content: "Use pnpm for package installation.", source: { type: "user" }, subject: "package-manager" },
      existing: [memoryRecord("consolidate-exact", "semantic", "Use pnpm for package installation.", { subject: "package-manager" })],
    },
    {
      id: "related-distinct-episodes", expected: "keep_both",
      incoming: { namespace: MEMORY_EVAL_NAMESPACE, kind: "episodic", content: "Migration failed because a database lock timed out.", source: { type: "agent" }, situation: "migration incident" },
      existing: [memoryRecord("consolidate-episode", "episodic", "Migration failed because a duplicate column already existed.", { situation: "migration incident" })],
    },
    {
      id: "temporal-replacement", expected: "supersede",
      incoming: { namespace: MEMORY_EVAL_NAMESPACE, kind: "semantic", content: "The repository package manager migrated from npm and now uses pnpm.", source: { type: "user" }, subject: "repository package manager" },
      existing: [memoryRecord("consolidate-old", "semantic", "The repository package manager uses npm.", { subject: "repository package manager" })],
    },
    {
      id: "near-duplicate-paraphrase", expected: "merge",
      incoming: { namespace: MEMORY_EVAL_NAMESPACE, kind: "semantic", content: "PostgreSQL is the relational persistence database for the backend.", source: { type: "user" }, subject: "backend database" },
      existing: [memoryRecord("consolidate-paraphrase", "semantic", "The backend relational persistence database is PostgreSQL.", { subject: "backend database" })],
    },
  ];
  const results = [];
  for (const item of cases) {
    const decision = await judge.decide(item.incoming, item.existing);
    results.push({ id: item.id, expected: item.expected, actual: decision.type, correct: decision.type === item.expected });
  }
  const falseMerges = results.filter(item => item.actual === "merge" && item.expected === "keep_both").length;
  const missedDuplicates = results.filter(item => ["ignore_new", "merge"].includes(item.expected) && !["ignore_new", "merge"].includes(item.actual)).length;
  return {
    cases: results,
    trueDuplicateCorrect: Number(results.find(item => item.id === "exact-duplicate")?.correct ?? false),
    relatedDistinctCorrect: Number(results.find(item => item.id === "related-distinct-episodes")?.correct ?? false),
    replacementCorrect: Number(results.find(item => item.id === "temporal-replacement")?.correct ?? false),
    falseMerges, missedDuplicates,
    accuracy: round(results.filter(item => item.correct).length / results.length),
  };
}

async function newLearningServices() {
  const store = new InMemoryMemoryStore(() => new Date(MEMORY_BENCHMARK_NOW));
  const service = new DefaultMemoryService(store, { now: () => MEMORY_BENCHMARK_NOW });
  return { store, service, episode: new DefaultEpisodeService(service), procedural: new DefaultProceduralService(service) };
}

function episodeInput(runId: string, overrides: Record<string, unknown> = {}) {
  return {
    runId, workflowId: "benchmark-workflow", nodeId: "benchmark-node", agentId: "benchmark-agent",
    task: "Repair the database migration after a duplicate column failure",
    output: "Schema inspected and guarded migration succeeded",
    succeeded: true, retryCount: 1,
    handoffs: { result: { summary: "inspect schema; add idempotent guard; rerun migration" } },
    namespace: MEMORY_EVAL_NAMESPACE,
    ...overrides,
  };
}

async function evaluateLearning(): Promise<LearningQualityReport> {
  const episodicServices = await newLearningServices();
  const meaningful = await episodicServices.episode.processRun(episodeInput("episode-meaningful"), access);
  const duplicate = await episodicServices.episode.processRun(episodeInput("episode-meaningful"), access);
  const trivial = await episodicServices.episode.processRun(episodeInput("episode-trivial", { task: "Say hello", output: "Hello", retryCount: 0 }), access);
  const later = await episodicServices.service.recall({ text: "duplicate column migration", namespaces: [MEMORY_EVAL_NAMESPACE], kinds: ["episodic"], limit: 3 }, access);

  const insufficient = await newLearningServices();
  const oneEpisode = memoryRecord("proc-one", "episodic", "Situation: deploy service\nAction: build; test; deploy\nResult: success", { situation: "deploy service", action: "build; test; deploy", success: true, source: { type: "agent", runId: "one" } });
  const minimumResult = await insufficient.procedural.learnFromEpisodes({ episodes: [oneEpisode], namespace: MEMORY_EVAL_NAMESPACE, agentId: "benchmark-agent", access });
  const duplicateResult = await insufficient.procedural.learnFromEpisodes({ episodes: [oneEpisode, { ...oneEpisode, id: "proc-one-copy" }], namespace: MEMORY_EVAL_NAMESPACE, agentId: "benchmark-agent", access });

  const majorityFailureServices = await newLearningServices();
  const majorityEpisodes = [
    memoryRecord("proc-majority-success", "episodic", "deploy service success", { situation: "deploy service", action: "build; test; deploy", success: true, source: { type: "agent", runId: "majority-1" } }),
    memoryRecord("proc-majority-fail-1", "episodic", "deploy service failed one", { situation: "deploy service", action: "deploy", success: false, source: { type: "agent", runId: "majority-2" } }),
    memoryRecord("proc-majority-fail-2", "episodic", "deploy service failed two", { situation: "deploy service", action: "deploy", success: false, source: { type: "agent", runId: "majority-3" } }),
  ];
  const majorityResult = await majorityFailureServices.procedural.learnFromEpisodes({ episodes: majorityEpisodes, namespace: MEMORY_EVAL_NAMESPACE, agentId: "benchmark-agent", access });

  const learnServices = await newLearningServices();
  const goodEpisodes = [1, 2, 3].map(index => memoryRecord(`proc-good-${index}`, "episodic", `deploy service successful run ${index}`, {
    situation: "deploy service", action: "build; test; deploy; health check", success: true, source: { type: "agent", runId: `good-${index}` },
  }));
  const learned = await learnServices.procedural.learnFromEpisodes({ episodes: goodEpisodes.slice(0, 2), namespace: MEMORY_EVAL_NAMESPACE, agentId: "benchmark-agent", access });
  const reinforced = await learnServices.procedural.learnFromEpisodes({ episodes: goodEpisodes, namespace: MEMORY_EVAL_NAMESPACE, agentId: "benchmark-agent", access });
  const learnedMemories = await learnServices.service.list({ namespaces: [MEMORY_EVAL_NAMESPACE], kinds: ["procedural"], limit: 20 }, access);
  const correctLearned = learnedMemories.filter(memory => memory.trigger === "deploy service" && memory.procedure?.includes("health check")).length;

  return {
    episodic: {
      meaningfulCreated: Number(meaningful.created), trivialRejected: Number(!trivial.created),
      duplicateAvoided: Number(!duplicate.created), relevantLaterRetrieved: later.results.some(item => item.memory.id === meaningful.memoryId) ? 1 : 0,
      expectedRelevantLater: 1,
    },
    procedural: {
      minimumEvidenceRejected: minimumResult.created === 0,
      duplicateEvidenceRejected: duplicateResult.created === 0,
      majorityFailureRejected: majorityResult.created === 0,
      learnedProcedures: learnedMemories.length,
      correctLearnedProcedures: correctLearned,
      procedurePrecision: learnedMemories.length ? round(correctLearned / learnedMemories.length) : 1,
      missedLearningOpportunities: learned.created === 0 ? 1 : 0,
      reinforcements: reinforced.reinforced,
    },
  };
}

async function evaluateGrowth(runCount: number): Promise<MemoryGrowthReport> {
  const { store, service, episode, procedural } = await newLearningServices();
  await service.remember({ namespace: MEMORY_EVAL_NAMESPACE, kind: "semantic", content: "The package manager is pnpm.", subject: "package-manager", source: { type: "user" } }, access);
  await service.remember({ namespace: MEMORY_EVAL_NAMESPACE, kind: "semantic", content: "The database is PostgreSQL.", subject: "database", source: { type: "user" } }, access);
  let meaningfulRuns = 0;
  let trivialRuns = 0;
  let proceduralLearningOperations = 0;
  const retrievalSamples: Array<{ candidates: number; selected: number; tokens: number; precision: number }> = [];
  const snapshots: GrowthSnapshot[] = [];

  const capture = async (run: number) => {
    const all = await Promise.all((["active", "superseded"] as const).map(status => store.search({ tenantId: access.tenantId, namespaces: [MEMORY_EVAL_NAMESPACE], status, includeExpired: true, limit: 500 })));
    const memories = all.flat();
    const recentSamples = retrievalSamples.slice(-Math.max(1, Math.min(10, retrievalSamples.length)));
    snapshots.push({
      run,
      semanticCount: memories.filter(memory => memory.kind === "semantic" && memory.status === "active").length,
      episodicCount: memories.filter(memory => memory.kind === "episodic" && memory.status === "active").length,
      proceduralCount: memories.filter(memory => memory.kind === "procedural" && memory.status === "active").length,
      supersededCount: memories.filter(memory => memory.status === "superseded").length,
      averageCandidateCount: round(average(recentSamples.map(sample => sample.candidates))),
      averageSelectedCount: round(average(recentSamples.map(sample => sample.selected))),
      averageMemoryTokens: round(average(recentSamples.map(sample => sample.tokens))),
      retrievalPrecision: round(average(recentSamples.map(sample => sample.precision))),
    });
  };

  for (let index = 1; index <= runCount; index += 1) {
    if (index % 5 === 0) {
      meaningfulRuns += 1;
      await episode.processRun(episodeInput(`growth-${index}`, {
        task: "deploy service after a failed health check",
        output: `deployment recovered successfully in synthetic run ${index}`,
        handoffs: { result: { summary: "build; test; deploy; verify health check" } },
      }), access);
    } else {
      trivialRuns += 1;
      await episode.processRun(episodeInput(`growth-${index}`, { task: `routine status check ${index}`, output: "ok", retryCount: 0 }), access);
    }
    if (index % 20 === 0) {
      await procedural.learnFromAuthorizedEpisodes({ access, namespace: MEMORY_EVAL_NAMESPACE, agentId: "benchmark-agent" });
      proceduralLearningOperations += 1;
    }
    if (index % 10 === 0 || index === runCount) {
      const recalled = await service.recall({ text: "deploy service failed health check", namespaces: [MEMORY_EVAL_NAMESPACE], limit: 8, maxTokens: 2048 }, access);
      const relevant = recalled.results.filter(item => item.memory.kind === "episodic" || item.memory.kind === "procedural").length;
      retrievalSamples.push({
        candidates: recalled.diagnostics.candidateCount,
        selected: recalled.results.length,
        tokens: recalled.results.reduce((sum, item) => sum + item.tokenCount, 0),
        precision: recalled.results.length ? relevant / recalled.results.length : 0,
      });
      await capture(index);
    }
  }
  const consolidator = new RealMemoryConsolidator({ store, now: () => MEMORY_BENCHMARK_NOW });
  const consolidation = await consolidator.consolidate(access, MEMORY_EVAL_NAMESPACE);
  await capture(runCount);
  return {
    runs: runCount, meaningfulRuns, trivialRuns,
    consolidationOperations: consolidation.diagnostics.candidatesEvaluated,
    proceduralLearningOperations,
    snapshots,
    final: snapshots[snapshots.length - 1],
  };
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(item => typeof item === "string" ? item : JSON.stringify(item)).join(" ");
  return JSON.stringify(content ?? "");
}

async function runLiveEvaluation(requested: boolean): Promise<LiveEvaluationReport> {
  if (!requested) return { status: "not-requested" };
  if (process.env.MEMORY_LIVE_EVAL !== "1") return { status: "skipped", reason: "Set MEMORY_LIVE_EVAL=1 to authorize live provider calls." };
  const provider = process.env.MEMORY_LIVE_EVAL_PROVIDER ?? process.env.LLM_PROVIDER ?? "openai";
  const model = process.env.MEMORY_LIVE_EVAL_MODEL ?? process.env.LLM_MODEL;
  const keyAvailable = provider === "openai" ? !!process.env.OPENAI_API_KEY
    : provider === "anthropic" ? !!process.env.ANTHROPIC_API_KEY
      : ["google", "gemini"].includes(provider) ? !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) : false;
  if (!keyAvailable) return { status: "skipped", provider, model, reason: `No credential found for ${provider}.` };
  try {
    const { llmFactory } = await import("../../agents/core/llmFactory");
    const chat = llmFactory.getModel(provider, { model, settings: { temperature: 0, maxTokens: 32 } });
    const task = "Answer with only the package manager name: Which package manager should this repository use?";
    const off = await chat.invoke([{ role: "user", content: task }]);
    const on = await chat.invoke([
      { role: "user", content: JSON.stringify({ type: "untrusted_memory_context", memories: [{ kind: "semantic", content: "The repository package manager is pnpm." }] }) },
      { role: "user", content: task },
    ]);
    const offText = contentToString(off.content).slice(0, 500);
    const onText = contentToString(on.content).slice(0, 500);
    return {
      status: "completed", provider, model,
      memoryOffCorrect: /\bpnpm\b/i.test(offText) && !/\bnpm\b/i.test(offText.replace(/pnpm/ig, "")),
      memoryOnCorrect: /\bpnpm\b/i.test(onText) && !/\bnpm\b/i.test(onText.replace(/pnpm/ig, "")),
      memoryOffOutput: offText, memoryOnOutput: onText,
    };
  } catch (error) {
    return { status: "failed", provider, model, reason: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) };
  }
}

function gitCommit(): string | null {
  try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).toString().trim() || null; }
  catch { return null; }
}

function buildWeaknesses(scenarios: MemoryBenchmarkScenarioResult[], consolidation: ConsolidationQualityReport, growth: MemoryGrowthReport): MemoryBenchmarkReport["weaknesses"] {
  const weaknesses: Array<{ impact: "high" | "medium" | "low"; issue: string; evidence: string }> = [];
  const full = scenarios.filter(result => result.mode === "full");
  const vocabulary = full.find(result => result.scenario === "vocabulary-mismatch");
  if (vocabulary && !vocabulary.taskOutcome.passed) weaknesses.push({ impact: "high", issue: "Vocabulary mismatch causes a false negative", evidence: `Recall=${vocabulary.recall}; expected PostgreSQL memory was not selected.` });
  const unknownConflict = full.find(result => result.scenario === "unknown-domain-conflict");
  if (unknownConflict && !unknownConflict.taskOutcome.passed) weaknesses.push({ impact: "high", issue: "Semantic conflict modeling is domain-specific", evidence: `${unknownConflict.forbiddenRetrieved} obsolete authentication memory reached context; suppressed=${unknownConflict.conflictSuppressed}.` });
  const diversity = full.find(result => result.scenario === "episodic-diversity");
  if (diversity && !diversity.taskOutcome.passed) weaknesses.push({ impact: "high", issue: "Conflict suppression collapses distinct episodic evidence", evidence: `Only ${diversity.expectedRetrieved}/${diversity.expectedMemories.length} distinct migration episodes survived selection; suppressed=${diversity.conflictSuppressed}.` });
  const noisy = full.filter(result => result.noiseRate > 0);
  if (noisy.length) weaknesses.push({ impact: "medium", issue: "Some retrievals inject non-ground-truth memories", evidence: `${noisy.length} full-memory scenarios had non-zero injection noise.` });
  if (consolidation.falseMerges) weaknesses.push({ impact: "high", issue: "Consolidation produced a false merge", evidence: `${consolidation.falseMerges} false merge(s) in deterministic ground truth.` });
  if (consolidation.missedDuplicates) weaknesses.push({ impact: "medium", issue: "Consolidation misses paraphrased duplicates", evidence: `${consolidation.missedDuplicates} missed duplicate(s) in deterministic ground truth.` });
  if (!consolidation.replacementCorrect) weaknesses.push({ impact: "medium", issue: "Implicit temporal replacement was not recognized by consolidation", evidence: "The package-manager migration fixture was kept separate instead of superseding the old value." });
  const first = growth.snapshots[0];
  if (first && growth.final.averageCandidateCount > first.averageCandidateCount * 1.5) weaknesses.push({ impact: "medium", issue: "Candidate volume grows with accumulated memory", evidence: `Average candidates grew from ${first.averageCandidateCount} to ${growth.final.averageCandidateCount}.` });
  if (growth.final.supersededCount > 0) weaknesses.push({ impact: "medium", issue: "Consolidation aggressively collapses repeated episode history", evidence: `${growth.final.supersededCount} of ${growth.meaningfulRuns} meaningful synthetic episodes became superseded after consolidation.` });
  const totalSelected = full.reduce((sum, result) => sum + result.selectedCount, 0);
  const totalRelevant = full.reduce((sum, result) => sum + result.relevantSelected, 0);
  const totalCandidates = full.reduce((sum, result) => sum + result.candidateCount, 0);
  const nonRelevantCandidates = full.reduce((sum, result) => sum + Math.round(result.falsePositiveCandidateRate * result.candidateCount), 0);
  if (totalCandidates && nonRelevantCandidates / totalCandidates > 0.25) weaknesses.push({ impact: "medium", issue: "Candidate-stage false positives are substantial", evidence: `${nonRelevantCandidates}/${totalCandidates} candidates were outside scenario ground truth, though budget/ranking filtered most before injection.` });
  const tokenRatio = full.reduce((sum, result) => sum + result.memoryTokens, 0) / Math.max(1, full.reduce((sum, result) => sum + result.totalContextTokens, 0));
  if (tokenRatio > 0.4) weaknesses.push({ impact: "medium", issue: "Memory consumes a large share of the synthetic context", evidence: `Memory/context token ratio was ${round(tokenRatio)} (${totalRelevant}/${totalSelected} selected memories were relevant).` });
  if (!weaknesses.length) weaknesses.push({ impact: "low", issue: "No deterministic quality weakness triggered", evidence: "Current fixed fixtures all met their ground-truth expectations; broader production traces are still required." });
  return weaknesses.map((weakness, index) => ({ rank: index + 1, ...weakness }));
}

export async function runMemoryBenchmark(options: RunMemoryBenchmarkOptions = {}): Promise<MemoryBenchmarkReport> {
  const scenarioDefinitions = MEMORY_BENCHMARK_SCENARIOS.filter(scenario => !options.scenarioFilter || scenario.id === options.scenarioFilter);
  if (!scenarioDefinitions.length) throw new Error(`Unknown memory benchmark scenario: ${options.scenarioFilter}`);
  const scenarioResults: MemoryBenchmarkScenarioResult[] = [];
  for (const scenario of scenarioDefinitions) {
    for (const mode of scenario.modes) {
      if (!options.modeFilter || mode === options.modeFilter) scenarioResults.push(await runScenario(scenario, mode));
    }
  }
  const consolidation = await evaluateConsolidation();
  const learning = await evaluateLearning();
  const growth = await evaluateGrowth(options.growthRuns ?? 100);
  const live = await runLiveEvaluation(options.live ?? false);
  const full = scenarioResults.filter(result => result.mode === "full");
  const noMemory = scenarioResults.filter(result => result.mode === "no-memory");
  const comparable = scenarioDefinitions.filter(scenario =>
    scenario.modes.includes("no-memory") && scenario.modes.includes("full")
    && noMemory.some(result => result.scenario === scenario.id)
    && full.some(result => result.scenario === scenario.id));
  const comparison = comparable.map(scenario => {
    const off = noMemory.find(result => result.scenario === scenario.id)!;
    const on = full.find(result => result.scenario === scenario.id)!;
    return {
      scenario: scenario.id,
      memoryOffSuccess: off.taskOutcome.passed,
      fullMemorySuccess: on.taskOutcome.passed,
      successDelta: Number(on.taskOutcome.passed) - Number(off.taskOutcome.passed),
      repeatedMistakeDelta: Number(on.taskOutcome.knownMistakeRepeated) - Number(off.taskOutcome.knownMistakeRepeated),
      memoryTokenDelta: on.memoryTokens - off.memoryTokens,
      preparationLatencyDeltaMs: round(on.memoryPreparationLatencyMs - off.memoryPreparationLatencyMs),
    };
  });
  const allSelected = full.reduce((sum, result) => sum + result.selectedCount, 0);
  const allRelevant = full.reduce((sum, result) => sum + result.relevantSelected, 0);
  const allExpected = full.reduce((sum, result) => sum + result.expectedMemories.length, 0);
  const allMemoryTokens = full.reduce((sum, result) => sum + result.memoryTokens, 0);
  const allContextTokens = full.reduce((sum, result) => sum + result.totalContextTokens, 0);
  const fullWithExpected = full.filter(result => result.expectedMemories.length > 0);
  const emptyExpected = full.filter(result => result.expectedMemories.length === 0);
  const totalCandidates = full.reduce((sum, result) => sum + result.candidateCount, 0);
  const falsePositiveCandidates = full.reduce((sum, result) => sum + Math.round(result.falsePositiveCandidateRate * result.candidateCount), 0);
  const regressionGateFailures: string[] = [];
  for (const result of full) {
    if (!result.diagnosticOnly && !result.taskOutcome.passed) regressionGateFailures.push(`${result.scenario}: required deterministic invariant failed`);
    if (result.crossTenantLeakage) regressionGateFailures.push(`${result.scenario}: cross-tenant leakage`);
    if (result.crossNamespaceLeakage) regressionGateFailures.push(`${result.scenario}: cross-namespace leakage`);
    if (result.invalidatedInjection) regressionGateFailures.push(`${result.scenario}: invalidated memory injected`);
    if (result.supersededInjection) regressionGateFailures.push(`${result.scenario}: superseded memory injected`);
  }
  const canonical = full.find(result => result.scenario === "semantic-recall");
  if (canonical && canonical.recall !== 1) regressionGateFailures.push("expected canonical semantic recall must equal 100%");
  const novel = full.find(result => result.scenario === "novel-task");
  if (novel && novel.forbiddenRetrieved !== 0) regressionGateFailures.push("novel task forbidden injection must equal zero");
  if (!learning.episodic.meaningfulCreated || !learning.episodic.trivialRejected || !learning.episodic.duplicateAvoided) regressionGateFailures.push("episodic learning quality gate failed");
  if (!learning.procedural.minimumEvidenceRejected || !learning.procedural.duplicateEvidenceRejected || !learning.procedural.majorityFailureRejected) regressionGateFailures.push("procedural evidence gate failed");
  if (consolidation.falseMerges) regressionGateFailures.push("consolidation false merge gate failed");

  const weaknesses = buildWeaknesses(scenarioResults, consolidation, growth);
  return {
    benchmarkVersion: MEMORY_BENCHMARK_VERSION,
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    configuration: {
      deterministic: true,
      modes: [...new Set(scenarioResults.map(result => result.mode))],
      scenarioCount: scenarioDefinitions.length,
      embeddingProvider: evalEmbeddingMetadata.provider,
      embeddingModel: evalEmbeddingMetadata.model,
      liveRequested: options.live ?? false,
    },
    passed: regressionGateFailures.length === 0,
    regressionGateFailures,
    scenarios: scenarioResults,
    comparison,
    aggregate: {
      fullMemorySuccessRate: full.length ? round(full.filter(result => result.taskOutcome.passed).length / full.length) : 0,
      noMemorySuccessRate: noMemory.length ? round(noMemory.filter(result => result.taskOutcome.passed).length / noMemory.length) : 0,
      fullMemoryPrecision: allSelected ? round(allRelevant / allSelected) : 1,
      fullMemoryRecall: allExpected ? round(allRelevant / allExpected) : 1,
      fullMemoryNoiseRate: allSelected ? round((allSelected - allRelevant) / allSelected) : 0,
      memoryHitRate: fullWithExpected.length ? round(fullWithExpected.filter(result => result.memoryHit).length / fullWithExpected.length) : 1,
      correctEmptyRetrievalRate: emptyExpected.length ? round(emptyExpected.filter(result => result.correctEmptyRetrieval).length / emptyExpected.length) : 1,
      falsePositiveCandidateRate: totalCandidates ? round(falsePositiveCandidates / totalCandidates) : 0,
      falsePositiveInjectionRate: allSelected ? round((allSelected - allRelevant) / allSelected) : 0,
      memoryTokens: allMemoryTokens,
      totalContextTokens: allContextTokens,
      memoryContextRatio: allContextTokens ? round(allMemoryTokens / allContextTokens) : 0,
      embeddingCalls: full.reduce((sum, result) => sum + result.embeddingCalls, 0),
      fallbackUsage: full.filter(result => result.fallbackUsed).length,
      securityViolations: full.reduce((sum, result) => sum + result.securityViolations, 0),
      supersededInjection: full.reduce((sum, result) => sum + result.supersededInjection, 0),
      invalidatedInjection: full.reduce((sum, result) => sum + result.invalidatedInjection, 0),
    },
    latency: {
      retrieval: latencySummary(full.map(result => result.retrievalLatencyMs)),
      memoryPreparation: latencySummary(full.map(result => result.memoryPreparationLatencyMs)),
      conflictProcessing: null,
    },
    learning, consolidation, growth,
    operations: { consolidation: growth.consolidationOperations, proceduralLearning: growth.proceduralLearningOperations },
    providerCost: null,
    live,
    weaknesses,
  };
}

export function memoryBenchmarkReportToJson(report: MemoryBenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}

export function memoryBenchmarkReportToMarkdown(report: MemoryBenchmarkReport): string {
  const lines = [
    "# Production Memory Benchmark Report",
    "",
    `- Benchmark version: **${report.benchmarkVersion}**`,
    `- Commit: ${report.commit ?? "unavailable"}`,
    `- Generated: ${report.generatedAt}`,
    `- Deterministic regression gates: **${report.passed ? "PASS" : "FAIL"}**`,
    `- Live evaluation: **${report.live.status}**`,
    "",
    "## Memory ON vs OFF",
    "",
    "| Scenario | OFF success | Full success | Success delta | Mistake delta | Memory tokens | Preparation delta ms |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...report.comparison.map(item => `| ${item.scenario} | ${Number(item.memoryOffSuccess)} | ${Number(item.fullMemorySuccess)} | ${item.successDelta} | ${item.repeatedMistakeDelta} | ${item.memoryTokenDelta} | ${item.preparationLatencyDeltaMs} |`),
    "",
    "## Full-memory Scenarios",
    "",
    "| Scenario | Success | Candidates | Selected | Precision | Recall | Noise | Tokens | Prep ms | Conflict suppressed |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...report.scenarios.filter(item => item.mode === "full").map(item => `| ${item.scenario} | ${Number(item.taskOutcome.passed)} | ${item.candidateCount} | ${item.selectedCount} | ${item.precision ?? "n/a"} | ${item.recall} | ${item.noiseRate} | ${item.memoryTokens} | ${item.memoryPreparationLatencyMs} | ${item.conflictSuppressed} |`),
    "",
    "## Aggregate",
    "",
    ...Object.entries(report.aggregate).map(([key, value]) => `- ${key}: ${value}`),
    `- retrieval latency p50/p95/max ms: ${report.latency.retrieval.p50} / ${report.latency.retrieval.p95} / ${report.latency.retrieval.max}`,
    `- preparation latency p50/p95/max ms: ${report.latency.memoryPreparation.p50} / ${report.latency.memoryPreparation.p95} / ${report.latency.memoryPreparation.max}`,
    "- provider monetary cost: unavailable (not fabricated)",
    "",
    "## Learning Quality",
    "",
    `- Episodic meaningful/trivial/duplicate/retrieved: ${report.learning.episodic.meaningfulCreated}/${report.learning.episodic.trivialRejected}/${report.learning.episodic.duplicateAvoided}/${report.learning.episodic.relevantLaterRetrieved}`,
    `- Procedure precision: ${report.learning.procedural.procedurePrecision}`,
    `- Procedural learned/reinforced/missed: ${report.learning.procedural.learnedProcedures}/${report.learning.procedural.reinforcements}/${report.learning.procedural.missedLearningOpportunities}`,
    "",
    "## Consolidation Quality",
    "",
    `- Accuracy: ${report.consolidation.accuracy}`,
    `- False merges: ${report.consolidation.falseMerges}`,
    `- Missed duplicates: ${report.consolidation.missedDuplicates}`,
    ...report.consolidation.cases.map(item => `- ${item.id}: expected ${item.expected}, actual ${item.actual} (${item.correct ? "correct" : "incorrect"})`),
    "",
    "## Memory Growth",
    "",
    `- Synthetic runs: ${report.growth.runs}`,
    `- Final semantic/episodic/procedural/superseded: ${report.growth.final.semanticCount}/${report.growth.final.episodicCount}/${report.growth.final.proceduralCount}/${report.growth.final.supersededCount}`,
    `- Final average candidates/selected/tokens/precision: ${report.growth.final.averageCandidateCount}/${report.growth.final.averageSelectedCount}/${report.growth.final.averageMemoryTokens}/${report.growth.final.retrievalPrecision}`,
    "",
    "## Security Gates",
    "",
    `- Cross-tenant leakage: ${report.scenarios.reduce((sum, item) => sum + item.crossTenantLeakage, 0)}`,
    `- Cross-namespace leakage: ${report.scenarios.reduce((sum, item) => sum + item.crossNamespaceLeakage, 0)}`,
    `- Invalidated injection: ${report.aggregate.invalidatedInjection}`,
    `- Superseded injection: ${report.aggregate.supersededInjection}`,
    "",
    "## Weaknesses Found",
    "",
    ...report.weaknesses.map(item => `${item.rank}. **${item.impact.toUpperCase()} — ${item.issue}.** ${item.evidence}`),
  ];
  if (report.regressionGateFailures.length) lines.push("", "## Regression Gate Failures", "", ...report.regressionGateFailures.map(failure => `- ${failure}`));
  return lines.join("\n");
}
