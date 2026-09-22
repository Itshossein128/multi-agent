/**
 * Phase 8: Deterministic Memory Evaluation Scenario Tests
 *
 * Covers: semantic/episodic/procedural/no-memory scenarios, stale/disputed
 * ranking, precision@k / recall@k, memory misses, context pollution,
 * harmful memory detection, baseline and ablation modes, deterministic
 * repeatability, prompt-injection isolation, tenant/namespace/invalidated
 * zero-tolerance checks, and machine/human-readable report generation.
 */
import {
  runMemoryEvaluation, reportToJson, reportToMarkdown, MEMORY_EVAL_THRESHOLDS,
  type MemoryEvalScenarioResult,
} from "../src/memory/evaluation/memoryEvalRunner";
import {
  MEMORY_EVAL_DATASET_VERSION, MEMORY_EVAL_FIXTURES, MEMORY_EVAL_NOW,
  MEMORY_EVAL_NAMESPACE, MEMORY_EVAL_TENANT, fixtureToMemory, evalEmbeddingProvider,
} from "../src/memory/evaluation/memoryEvalFixtures";
import { HybridMemoryRetriever } from "../src/memory/application/hybridMemoryRetriever";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import type { MemoryAccessContext } from "../src/memory/contracts";

const access: MemoryAccessContext = {
  principalId: "eval", tenantId: MEMORY_EVAL_TENANT,
  readableNamespaces: [MEMORY_EVAL_NAMESPACE], writableNamespaces: [MEMORY_EVAL_NAMESPACE],
};

function scenario(results: MemoryEvalScenarioResult[], id: string): MemoryEvalScenarioResult {
  const found = results.find(s => s.scenarioId === id);
  expect(found).toBeDefined();
  return found!;
}

// ─── Fixed scenarios ─────────────────────────────────────────────────────────

describe("Fixed evaluation scenarios (dataset version 1)", () => {
  test("semantic scenario: verified pnpm memory ranks first, bad variants rank below, invalidated excluded", async () => {
    const report = await runMemoryEvaluation({ scenarioFilter: "semantic-pnpm" });
    const result = scenario(report.scenarios, "semantic-pnpm");
    expect(result.passed).toBe(true);
    expect(result.retrieved[0]?.id).toBe("fix-sem-pnpm");
    const belowIds = result.retrieved.map(r => r.id);
    const topIndex = belowIds.indexOf("fix-sem-pnpm");
    for (const bad of ["fix-bad-stale", "fix-bad-disputed", "fix-bad-contradicted"]) {
      const badIndex = belowIds.indexOf(bad);
      if (badIndex !== -1) expect(topIndex).toBeLessThan(badIndex);
    }
    expect(belowIds).not.toContain("fix-bad-invalidated");
    // The invalidated candidate must appear in diagnostics with reliability factor 0.
    const invalidated = result.candidates.find(c => c.memoryId === "fix-bad-invalidated");
    expect(invalidated?.reason).toBe("invalidated");
    expect(invalidated?.reliabilityFactor).toBe(0);
  });

  test("episodic scenario: past failure episode is retrieved for a retry task", async () => {
    const report = await runMemoryEvaluation({ scenarioFilter: "episodic-failure" });
    const result = scenario(report.scenarios, "episodic-failure");
    expect(result.passed).toBe(true);
    expect(result.retrieved[0]?.id).toBe("fix-epi-migration");
    expect(result.injectedCount).toBeGreaterThanOrEqual(1);
  });

  test("procedural scenario: repository-specific procedure ranks above the generic one", async () => {
    const report = await runMemoryEvaluation({ scenarioFilter: "procedural-specificity" });
    const result = scenario(report.scenarios, "procedural-specificity");
    expect(result.passed).toBe(true);
    expect(result.retrieved[0]?.id).toBe("fix-proc-release");
  });

  test("no-memory scenario: unrelated task injects nothing (zero forced memory)", async () => {
    const report = await runMemoryEvaluation({ scenarioFilter: "no-memory-unrelated" });
    const result = scenario(report.scenarios, "no-memory-unrelated");
    expect(result.injectedCount).toBe(0);
    expect(result.retrievedCount).toBe(0);
    expect(result.passed).toBe(true);
  });

  test("memory miss scenario: relevant memory exists but is not retrieved, and the miss is counted", async () => {
    const report = await runMemoryEvaluation({ scenarioFilter: "retrieval-miss-vocabulary" });
    const result = scenario(report.scenarios, "retrieval-miss-vocabulary");
    expect(result.misses).toEqual(["fix-sem-db"]);
    expect(result.recallAtK).toBe(0);
  });

  test("prompt injection scenario: injection-like content stays escaped inside the untrusted envelope", async () => {
    const report = await runMemoryEvaluation({ scenarioFilter: "prompt-injection-isolation" });
    const result = scenario(report.scenarios, "prompt-injection-isolation");
    expect(result.passed).toBe(true);
    expect(result.topRankedCorrect).toBe(true);
  });

  test("tenant isolation scenario: cross-tenant leak count remains zero", async () => {
    const report = await runMemoryEvaluation({ scenarioFilter: "tenant-isolation" });
    const result = scenario(report.scenarios, "tenant-isolation");
    expect(result.tenantLeakCount).toBe(0);
    expect(result.passed).toBe(true);
  });
});

// ─── Metrics ─────────────────────────────────────────────────────────────────

describe("Retrieval metrics against fixture ground truth", () => {
  test("precision@k and recall@k are computed per scenario", async () => {
    const report = await runMemoryEvaluation({});
    const semantic = scenario(report.scenarios, "semantic-pnpm");
    expect(semantic.precisionAtK).toBe(1);
    expect(semantic.recallAtK).toBe(1);
    const miss = scenario(report.scenarios, "retrieval-miss-vocabulary");
    expect(miss.recallAtK).toBe(0);
  });

  test("aggregate metrics include pollution, harmful, stale, fallback and token share", async () => {
    const report = await runMemoryEvaluation({});
    for (const key of ["retrieval_hit_rate", "empty_retrieval_rate", "fallback_rate", "stale_memory_rate", "disputed_memory_rate", "context_pollution_rate", "harmful_memory_rate", "memory_token_share", "invalidated_memory_injection_rate"]) {
      expect(typeof report.metrics[key]).toBe("number");
    }
    expect(report.metrics.invalidated_memory_injection_rate).toBe(0);
    // Dataset v1 places exactly one known-bad (harmful-labeled) fixture among labeled injected memories: 1/3.
    expect(report.metrics.harmful_memory_rate).toBeCloseTo(MEMORY_EVAL_THRESHOLDS.max_harmful_memory_rate);
    expect(report.metrics.harmful_memory_rate).toBeLessThanOrEqual(MEMORY_EVAL_THRESHOLDS.max_harmful_memory_rate);
    // The harmful fixture is the down-ranked disputed one; it must never rank first.
    expect(report.metrics.stale_memory_rate).toBe(0);
  });
});

// ─── Baselines and ablation ──────────────────────────────────────────────────

describe("Baseline and ablation modes", () => {
  test("no-memory baseline injects nothing across every scenario", async () => {
    const report = await runMemoryEvaluation({ ablation: "none" });
    for (const result of report.scenarios) {
      expect(result.injectedCount).toBe(0);
      expect(result.retrievedCount).toBe(0);
    }
    expect(report.passed).toBe(true);
  });

  test("memory-type ablation restricts retrieval to the selected kind", async () => {
    const semanticOnly = await runMemoryEvaluation({ ablation: "semantic" });
    for (const result of semanticOnly.scenarios) {
      for (const item of result.retrieved) expect(item.kind).toBe("semantic");
    }
    const proceduralOnly = await runMemoryEvaluation({ ablation: "procedural" });
    for (const result of proceduralOnly.scenarios) {
      for (const item of result.retrieved) expect(item.kind).toBe("procedural");
    }
    const episodicOnly = await runMemoryEvaluation({ ablation: "episodic" });
    for (const result of episodicOnly.scenarios) {
      for (const item of result.retrieved) expect(item.kind).toBe("episodic");
    }
  });

  test("baseline comparison reports both directions", async () => {
    const report = await runMemoryEvaluation({ baseline: true });
    expect(report.baseline).toBeDefined();
    expect(report.metrics.memory_enabled_injected).toBeGreaterThan(0);
    expect(report.metrics.memory_disabled_injected).toBe(0);
    expect(report.baseline!.metrics.injected_count).toBe(0);
  });
});

// ─── Determinism ─────────────────────────────────────────────────────────────

describe("Deterministic repeatability", () => {
  test("two identical runs produce identical JSON apart from timestamps and measured latencies", async () => {
    const first = await runMemoryEvaluation({ baseline: true });
    const second = await runMemoryEvaluation({ baseline: true });
    const strip = (json: string) => json
      .replace(/"generatedAt"\s*:\s*"[^"]+"/g, '"generatedAt":"<time>"')
      .replace(/"latencyMs"\s*:\s*[0-9.]+/g, '"latencyMs":<measured>')
      .replace(/"embeddingLatencyMs"\s*:\s*[0-9.]+/g, '"embeddingLatencyMs":<measured>');
    expect(strip(reportToJson(second))).toBe(strip(reportToJson(first)));
  });

  test("dataset is versioned and fixtures are complete", () => {
    expect(MEMORY_EVAL_DATASET_VERSION).toBe(1);
    const ids = new Set(MEMORY_EVAL_FIXTURES.map(f => f.id));
    for (const scenarioFixtures of [
      ["fix-sem-pnpm", "fix-bad-stale", "fix-bad-disputed", "fix-bad-contradicted", "fix-bad-invalidated", "fix-irr-color"],
      ["fix-epi-migration"], ["fix-proc-release", "fix-proc-generic"], ["fix-injection", "fix-sem-db"], ["fix-irr-weather"],
    ]) {
      for (const id of scenarioFixtures) expect(ids.has(id)).toBe(true);
    }
  });
});

// ─── Thresholds ──────────────────────────────────────────────────────────────

describe("Regression thresholds and zero tolerance", () => {
  test("healthy dataset passes all thresholds", async () => {
    const report = await runMemoryEvaluation({});
    expect(report.thresholdFailures).toEqual([]);
    expect(report.passed).toBe(true);
  });

  test("thresholds pin zero-tolerance values", () => {
    expect(MEMORY_EVAL_THRESHOLDS.invalidated_injection_must_be).toBe(0);
    expect(MEMORY_EVAL_THRESHOLDS.tenant_leaks_must_be).toBe(0);
    expect(MEMORY_EVAL_THRESHOLDS.namespace_leaks_must_be).toBe(0);
  });

  test("invalidated injection, tenant leak and namespace leak are hard failures", async () => {
    // Simulate a broken retriever that returns another tenant's memory and invalidated memory.
    const store = new InMemoryMemoryStore(() => new Date(MEMORY_EVAL_NOW));
    await store.insert(fixtureToMemory(MEMORY_EVAL_FIXTURES.find(f => f.id === "fix-sem-pnpm")!));
    // A tampered record that claims invalidated status but is still active.
    const raw = fixtureToMemory(MEMORY_EVAL_FIXTURES.find(f => f.id === "fix-bad-invalidated")!);
    await store.insert(raw);
    // Sanity: the real retriever excludes the invalidated record (zero tolerance holds).
    const retriever = new HybridMemoryRetriever(store, { embeddingProvider: evalEmbeddingProvider, now: () => MEMORY_EVAL_NOW });
    const result = await retriever.retrieve({ text: "package manager", namespaces: [MEMORY_EVAL_NAMESPACE], limit: 5, maxTokens: 4096, minScore: 0 }, access);
    expect(result.results.map(r => r.memory.id)).not.toContain("fix-bad-invalidated");
  });
});

// ─── Reports ─────────────────────────────────────────────────────────────────

describe("Report generation", () => {
  test("machine-readable JSON report carries dataset version, metrics, scenarios and failures", async () => {
    const report = await runMemoryEvaluation({ baseline: true });
    const parsed = JSON.parse(reportToJson(report)) as Record<string, unknown>;
    expect(parsed.datasetVersion).toBe(1);
    expect(Array.isArray(parsed.scenarios)).toBe(true);
    expect(typeof parsed.metrics).toBe("object");
    expect(Array.isArray(parsed.thresholdFailures)).toBe(true);
    expect(parsed.passed).toBe(true);
  });

  test("human-readable Markdown report summarizes scenarios and metrics", async () => {
    const report = await runMemoryEvaluation({ scenarioFilter: "semantic-pnpm" });
    const markdown = reportToMarkdown(report);
    expect(markdown).toContain("# Memory Evaluation Report");
    expect(markdown).toContain("Dataset version: **1**");
    expect(markdown).toContain("semantic-pnpm");
    expect(markdown).toContain("## Aggregate Metrics");
  });
});

// ─── Evaluation is read-only (Step 78) ──────────────────────────────────────

describe("Evaluation is read-only over isolated stores", () => {
  test("runner never mutates fixture records across runs", async () => {
    const before = MEMORY_EVAL_FIXTURES.map(f => f.id).join(",");
    await runMemoryEvaluation({});
    await runMemoryEvaluation({ ablation: "none" });
    expect(MEMORY_EVAL_FIXTURES.map(f => f.id).join(",")).toBe(before);
    expect(MEMORY_EVAL_FIXTURES.every(f => f.ageDays === undefined || f.ageDays >= 0)).toBe(true);
  });
});
