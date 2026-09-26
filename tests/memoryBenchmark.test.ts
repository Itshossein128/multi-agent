import {
  memoryBenchmarkReportToJson,
  memoryBenchmarkReportToMarkdown,
  runMemoryBenchmark,
} from "../src/memory/benchmark/memoryBenchmarkRunner";
import { MEMORY_BENCHMARK_SCENARIOS, MEMORY_BENCHMARK_VERSION } from "../src/memory/benchmark/memoryBenchmarkFixtures";

describe("Phase 5 deterministic production memory benchmark", () => {
  let report: Awaited<ReturnType<typeof runMemoryBenchmark>>;

  beforeAll(async () => {
    report = await runMemoryBenchmark({ growthRuns: 20 });
  });

  test("catalog covers the required retrieval and budget categories", () => {
    expect(MEMORY_BENCHMARK_VERSION).toBe(1);
    const categories = new Set(MEMORY_BENCHMARK_SCENARIOS.map(scenario => scenario.category));
    for (const category of [
      "semantic-recall", "episodic-recall", "procedural-recall", "novel-task",
      "conflict", "supersession", "episodic-diversity", "procedural-conflict",
      "vocabulary-mismatch", "context-budget",
    ]) expect(categories.has(category as never)).toBe(true);
  });

  test("compares identical scenarios with memory disabled and full memory", () => {
    const semantic = report.comparison.find(item => item.scenario === "semantic-recall");
    expect(semantic).toMatchObject({ memoryOffSuccess: false, fullMemorySuccess: true, successDelta: 1 });
    const novel = report.comparison.find(item => item.scenario === "novel-task");
    expect(novel).toMatchObject({ memoryOffSuccess: true, fullMemorySuccess: true, successDelta: 0 });
  });

  test("records objective retrieval, cost, latency, and empty-retrieval metrics", () => {
    const semantic = report.scenarios.find(item => item.scenario === "semantic-recall" && item.mode === "full")!;
    expect(semantic).toMatchObject({ precision: 1, recall: 1, memoryHit: true, forbiddenRetrieved: 0 });
    expect(semantic.memoryTokens).toBeGreaterThan(0);
    expect(semantic.memoryPreparationLatencyMs).toBeGreaterThanOrEqual(0);
    const novel = report.scenarios.find(item => item.scenario === "novel-task" && item.mode === "full")!;
    expect(novel.correctEmptyRetrieval).toBe(true);
    expect(novel.selectedCount).toBe(0);
  });

  test("keeps zero-tolerance security and lifecycle gates", () => {
    expect(report.aggregate.securityViolations).toBe(0);
    expect(report.aggregate.invalidatedInjection).toBe(0);
    expect(report.aggregate.supersededInjection).toBe(0);
    expect(report.learning.episodic).toMatchObject({ meaningfulCreated: 1, trivialRejected: 1, duplicateAvoided: 1, relevantLaterRetrieved: 1 });
    expect(report.learning.procedural).toMatchObject({ minimumEvidenceRejected: true, duplicateEvidenceRejected: true, majorityFailureRejected: true });
    expect(report.consolidation.falseMerges).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.regressionGateFailures).toEqual([]);
  });

  test("exposes known weaknesses instead of converting them into passing fixtures", () => {
    const vocabulary = report.scenarios.find(item => item.scenario === "vocabulary-mismatch" && item.mode === "full")!;
    expect(vocabulary.taskOutcome.passed).toBe(false);
    expect(vocabulary.recall).toBe(0);
    const unknownConflict = report.scenarios.find(item => item.scenario === "unknown-domain-conflict" && item.mode === "full")!;
    expect(unknownConflict.forbiddenRetrieved).toBe(1);
    expect(unknownConflict.conflictSuppressed).toBe(0);
    expect(report.weaknesses.some(item => item.issue.includes("Vocabulary mismatch"))).toBe(true);
    expect(report.weaknesses.some(item => item.issue.includes("domain-specific"))).toBe(true);
  });

  test("measures learning, consolidation, and repeated-run growth", () => {
    expect(report.learning.procedural.procedurePrecision).toBe(1);
    expect(report.consolidation.cases).toHaveLength(4);
    expect(report.growth.runs).toBe(20);
    expect(report.growth.meaningfulRuns).toBe(4);
    expect(report.growth.snapshots.length).toBeGreaterThanOrEqual(3);
    expect(report.operations.proceduralLearning).toBe(1);
  });

  test("serializes stable machine-readable and human-readable reports", () => {
    const parsed = JSON.parse(memoryBenchmarkReportToJson(report));
    expect(parsed.benchmarkVersion).toBe(1);
    expect(parsed.commit).toEqual(expect.any(String));
    expect(parsed.configuration.embeddingProvider).toBe("eval-deterministic");
    const markdown = memoryBenchmarkReportToMarkdown(report);
    expect(markdown).toContain("# Production Memory Benchmark Report");
    expect(markdown).toContain("## Memory ON vs OFF");
    expect(markdown).toContain("## Weaknesses Found");
  });
});
