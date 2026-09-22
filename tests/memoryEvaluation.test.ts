/**
 * Phase 8: Memory Evaluation & Observability Tests
 *
 * Covers: retrieval traces, selection diagnostics, retrieved vs injected
 * distinction, token accounting, feedback ledger, privacy boundaries,
 * retention/sampling, and no-runtime-impact guarantees.
 */
import { createAgentRecord, type AgentRecord, type MemoryNamespace } from "@multi-agent/types";
import { AgentRuntime } from "../src/agents/runtime/agentRuntime";
import { DefaultContextAssembler, type ContextAssemblyRequest } from "../src/agents/runtime/contextAssembler";
import {
  InMemoryMemoryEvaluationSink, MemoryEvaluationRecorder, MemoryFeedbackLedger,
  evaluateMemoryRelevance, explainMemoryDecision, computePopulationMetrics, emptyPopulationMetrics,
  aggregateByKind, aggregateByAgent, MEMORY_METRIC_DEFINITIONS,
  type MemoryEvaluationSink, type MemoryRetrievalTrace, type MemorySelectionDiagnostic,
  type MemoryInvocationEvaluation, type MemoryTokenAccounting,
} from "../src/memory/application/memoryEvaluation";
import { DefaultMemoryService, DefaultMemoryExtractor, DefaultMemoryWritePolicy, DefaultMemoryContextFormatter, DefaultMemoryBackgroundJobs } from "../src/memory/application";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import type { RuntimeMemoryDependencies, MemoryAccessContext } from "../src/memory/contracts";
import type { AgentExecutionInput } from "../src/agents/runtime/types";
import { DeterministicFreshnessPolicy } from "../src/memory/application/memoryReliability";

const ns: MemoryNamespace = { scope: "agent", id: "agent-a" };
const access: MemoryAccessContext = { principalId: "user", tenantId: "tenant", readableNamespaces: [ns], writableNamespaces: [ns] };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function noopSink(): MemoryEvaluationSink {
  return { recordRetrieval: () => undefined, recordSelections: () => undefined, recordInjection: () => undefined, recordInvocation: () => undefined };
}

function selection(overrides: Partial<MemorySelectionDiagnostic> = {}): MemorySelectionDiagnostic {
  return { memoryId: "m1", kind: "semantic", finalScore: 0.5, stage: "selected", selected: true, ...overrides };
}

// ─── Retrieval Traces ────────────────────────────────────────────────────────

describe("Retrieval traces", () => {
  test("records a trace with safe metadata from retrieval diagnostics", () => {
    const sink = new InMemoryMemoryEvaluationSink();
    const recorder = new MemoryEvaluationRecorder(sink);
    recorder.recordRetrieval(
      { runId: "run-1", invocationId: "run-1:node-1", agentId: "agent-a", nodeId: "node-1" },
      {
        results: [],
        diagnostics: {
          latencyMs: 12, embeddingLatencyMs: 3, candidateCount: 7, selectedCount: 2,
          deduplicatedCount: 1, warnings: [], retrievalMode: "hybrid",
          kinds: { semantic: 5, episodic: 2 }, candidates: [],
        },
      },
    );
    const traces = sink.getTraces();
    expect(traces).toHaveLength(1);
    const trace: MemoryRetrievalTrace = traces[0];
    expect(trace.runId).toBe("run-1");
    expect(trace.invocationId).toBe("run-1:node-1");
    expect(trace.candidateCount).toBe(7);
    expect(trace.selectedCount).toBe(2);
    expect(trace.retrievalMode).toBe("hybrid");
    expect(trace.kinds).toEqual({ semantic: 5, episodic: 2 });
  });

  test("traces contain only counts, scores and statuses — never memory content", async () => {
    const store = new InMemoryMemoryStore();
    const service = new DefaultMemoryService(store);
    await service.remember({ namespace: ns, kind: "semantic", content: "The database cluster runs on dedicated hardware", source: { type: "user" } }, access);
    const sink = new InMemoryMemoryEvaluationSink();
    const recorder = new MemoryEvaluationRecorder(sink);
    const result = await service.recall({ text: "database", namespaces: [ns] }, access);
    recorder.recordRetrieval({ runId: "r", invocationId: "r:n", agentId: "a", nodeId: "n" }, result);
    const serialized = JSON.stringify(sink.getTraces()) + JSON.stringify(sink.getInvocations());
    expect(serialized).not.toContain("dedicated hardware");
    expect(serialized).not.toContain("cluster");
  });
});

// ─── Selection Diagnostics ───────────────────────────────────────────────────

describe("Selection diagnostics", () => {
  test("candidate diagnostics include retriever-computed scores only", async () => {
    const store = new InMemoryMemoryStore();
    const service = new DefaultMemoryService(store);
    await service.remember({ namespace: ns, kind: "semantic", content: "Project uses pnpm", subject: "pkg", source: { type: "user" } }, access);
    await service.remember({ namespace: ns, kind: "semantic", content: "Bananas are yellow", subject: "fruit", source: { type: "user" }, importance: 1 }, access);
    const result = await service.recall({ text: "pnpm", namespaces: [ns] }, access);
    expect(result.diagnostics.candidates.length).toBeGreaterThanOrEqual(2);
    for (const candidate of result.diagnostics.candidates) {
      expect(candidate.scores).toHaveProperty("semantic");
      expect(candidate.scores).toHaveProperty("lexical");
      expect(typeof candidate.kind).toBe("string");
      expect(candidate.reliabilityFactor).toBeGreaterThanOrEqual(0);
    }
  });

  test("explainMemoryDecision returns scores, stage and drop reason without content", () => {
    const selections = [
      selection({ memoryId: "kept", stage: "injected", selected: true, estimatedTokens: 42, semanticScore: 0.9, lexicalScore: 0.4, reliabilityScore: 1 }),
      selection({ memoryId: "dropped", stage: "dropped", selected: false, dropReason: "low_score", finalScore: 0.05 }),
    ];
    const kept = explainMemoryDecision(selections, "kept");
    expect(kept?.selected).toBe(true);
    expect(kept?.scores.semantic).toBe(0.9);
    expect(kept?.estimatedTokens).toBe(42);
    expect(kept?.explanation).toContain("injected");
    const dropped = explainMemoryDecision(selections, "dropped");
    expect(dropped?.dropReason).toBe("low_score");
    expect(explainMemoryDecision(selections, "unknown-id")).toBeUndefined();
  });

  test("invalidated memories are excluded from retrieval with a drop reason", async () => {
    const store = new InMemoryMemoryStore();
    const service = new DefaultMemoryService(store);
    const { memory } = await service.remember({ namespace: ns, kind: "semantic", content: "Repository uses npm here", source: { type: "user" } }, access);
    // Invalidate via the Phase 7 verification service path (metadata manipulation on the raw store).
    const raw = await store.get("tenant", memory.id);
    await store.update({ ...raw!, metadata: { ...raw!.metadata, __reliability_verification_status: "invalidated" }, version: raw!.version + 1 }, raw!.version);
    const result = await service.recall({ text: "Repository uses", namespaces: [ns] }, access);
    expect(result.results).toHaveLength(0);
    const invalidated = result.diagnostics.candidates.find(c => c.memoryId === memory.id);
    expect(invalidated?.reason).toBe("invalidated");
    expect(invalidated?.reliabilityFactor).toBe(0);
  });
});

// ─── Retrieved vs Injected distinction ───────────────────────────────────────

describe("Retrieved vs injected distinction", () => {
  function runtimeFixture(memoryContent: string, maxTokens: number) {
    const agent: AgentRecord = { ...createAgentRecord(), id: ns.id };
    agent.memory = { enabled: true, type: "run", scope: "agent", mode: "read", maxEntries: 5, shortTerm: { enabled: false }, longTerm: { enabled: true, readableNamespaces: [ns], retrieval: { maxTokens, maxMemories: 5, minScore: 0 } } };
    const store = new InMemoryMemoryStore();
    const seedService = new DefaultMemoryService(store);
    return { agent, store, seedService } as const;
  }

  test("retrieved and injected are recorded distinctly when budget forces drops", async () => {
    const { agent, store } = runtimeFixture("", 400);
    const seed = new DefaultMemoryService(store);
    await seed.remember({ namespace: ns, kind: "semantic", content: "Memory one about databases with substantial padding text to consume budget space", source: { type: "user" } }, access);
    await seed.remember({ namespace: ns, kind: "semantic", content: "Memory two about deployments with substantial padding text to consume budget space", source: { type: "user" } }, access);
    await seed.remember({ namespace: ns, kind: "semantic", content: "Memory three about testing with substantial padding text to consume budget space", source: { type: "user" } }, access);
    const sink = new InMemoryMemoryEvaluationSink();
    const deps: RuntimeMemoryDependencies = {
      service: new DefaultMemoryService(store),
      extractor: new DefaultMemoryExtractor(), writePolicy: new DefaultMemoryWritePolicy(),
      formatter: new DefaultMemoryContextFormatter(), jobs: new DefaultMemoryBackgroundJobs(),
      evaluation: { recorder: new MemoryEvaluationRecorder(sink) },
    };
    const seen: AgentExecutionInput[] = [];
    const runtime = new AgentRuntime({ create: () => ({ async *execute(input: AgentExecutionInput) { seen.push(input); yield { type: "agent.completed" as const, timestamp: new Date().toISOString(), agentId: input.agent.id, runId: input.runId, nodeId: input.nodeId, payload: { content: "done" } }; } }) }, deps);
    const input: AgentExecutionInput = { agent, input: "databases deployments testing", runId: "run-1", nodeId: "node-1", workflowId: "wf", memoryAccess: access };
    for await (const _event of runtime.execute(input)) { /* drain */ }
    const invocation = sink.getInvocation("run-1:node-1");
    expect(invocation).toBeDefined();
    // All three candidates are scored; the retriever's token budget keeps only what fits.
    const trace = sink.getTraces().find(t => t.invocationId === "run-1:node-1");
    expect(trace?.candidateCount).toBe(3);
    expect(trace?.selectedCount).toBe(1);
    expect(invocation!.evaluation.retrievedMemoryCount).toBe(1);
    expect(invocation!.evaluation.injectedMemoryCount).toBe(1);
    expect(invocation!.evaluation.memoryTokens).toBeGreaterThan(0);
    // Stage distinction recorded in selections: 1 injected, 2 dropped by budget.
    expect(invocation!.selections.filter(s => s.stage === "injected")).toHaveLength(1);
    const dropped = invocation!.selections.filter(s => s.stage === "dropped");
    expect(dropped).toHaveLength(2);
    expect(dropped.every(s => s.dropReason === "budget")).toBe(true);
  });

  test("evaluation disabled (no evaluation runtime) leaves runtime behavior identical", async () => {
    const { agent, store } = runtimeFixture("", 2048);
    const seed = new DefaultMemoryService(store);
    await seed.remember({ namespace: ns, kind: "semantic", content: "Plain memory about pnpm", source: { type: "user" } }, access);
    const deps: RuntimeMemoryDependencies = {
      service: new DefaultMemoryService(store),
      extractor: new DefaultMemoryExtractor(), writePolicy: new DefaultMemoryWritePolicy(),
      formatter: new DefaultMemoryContextFormatter(), jobs: new DefaultMemoryBackgroundJobs(),
    };
    const seen: AgentExecutionInput[] = [];
    const runtime = new AgentRuntime({ create: () => ({ async *execute(input: AgentExecutionInput) { seen.push(input); yield { type: "agent.completed" as const, timestamp: new Date().toISOString(), agentId: input.agent.id, runId: input.runId, nodeId: input.nodeId, payload: { content: "done" } }; } }) }, deps);
    for await (const _event of runtime.execute({ agent, input: "pnpm", runId: "r2", nodeId: "n2", workflowId: "wf", memoryAccess: access })) { /* drain */ }
    expect(seen[0].context?.memoryContext).toContain("pnpm");
  });
});

// ─── Token accounting ────────────────────────────────────────────────────────

describe("Context token accounting", () => {
  test("injection token accounting is broken down by memory kind", () => {
    const sink = new InMemoryMemoryEvaluationSink();
    const recorder = new MemoryEvaluationRecorder(sink);
    const freshness = new DeterministicFreshnessPolicy();
    recorder.recordInjection(
      { runId: "r", invocationId: "r:n", agentId: "a", nodeId: "n" },
      [
        { memory: { id: "s1", kind: "semantic", updatedAt: new Date().toISOString() }, tokenCount: 100 },
        { memory: { id: "e1", kind: "episodic", updatedAt: new Date().toISOString() }, tokenCount: 50 },
        { memory: { id: "p1", kind: "procedural", updatedAt: new Date().toISOString() }, tokenCount: 25 },
      ],
      freshness,
    );
    const injection = sink.getInjections()[0];
    expect(injection.tokens).toBe(175);
    expect(injection.tokensByKind).toEqual({ semantic: 100, episodic: 50, procedural: 25 } satisfies MemoryTokenAccounting);
  });

  test("ContextAssembler reports long-term memory metadata with memoryIds and per-kind tokens", async () => {
    const assembler = new DefaultContextAssembler();
    const request: ContextAssemblyRequest = {
      runId: "r", workflowId: "wf", nodeId: "n", agentId: "a",
      agent: { ...createAgentRecord(), id: "a" } as never,
      task: "task",
      longTermMemoryContext: "Untrusted memory data",
      longTermMemoryMeta: { memoryIds: ["m1", "m2"], tokens: 220, tokensByKind: { semantic: 150, episodic: 70, procedural: 0 } },
    };
    const assembled = await assembler.assemble(request);
    const memoryItem = assembled.items.find(item => item.source === "long_term_memory");
    expect(memoryItem?.metadata?.memoryIds).toEqual(["m1", "m2"]);
    expect(memoryItem?.metadata?.tokensByKind).toEqual({ semantic: 150, episodic: 70, procedural: 0 });
    expect(assembled.diagnostics.sources.long_term_memory.tokens).toBeGreaterThan(0);
  });
});

// ─── Invocation evaluation ───────────────────────────────────────────────────

describe("Invocation-level evaluation", () => {
  test("records counts, tokens by kind and outcome per invocation", () => {
    const sink = new InMemoryMemoryEvaluationSink();
    const recorder = new MemoryEvaluationRecorder(sink, new MemoryFeedbackLedger());
    recorder.recordInjection(
      { runId: "r", invocationId: "r:n", agentId: "a", nodeId: "n", relevanceRules: { relevantMarkers: ["pkg"], harmfulMarkers: ["stale"] } },
      [
        { memory: { id: "useful-1", kind: "semantic", subject: "pkg", updatedAt: new Date().toISOString() }, tokenCount: 30 },
        { memory: { id: "stale-1", kind: "semantic", subject: "stale", updatedAt: new Date().toISOString() }, tokenCount: 20 },
      ],
    );
    recorder.recordInvocation({ runId: "r", invocationId: "r:n", agentId: "a", nodeId: "n" }, {
      retrievedMemoryCount: 5, selectedMemoryCount: 3, injectedMemoryCount: 2, memoryTokens: 50,
      tokensByKind: { semantic: 50, episodic: 0, procedural: 0 }, outcome: "success",
    });
    const invocation: MemoryInvocationEvaluation | undefined = sink.getInvocation("r:n")?.evaluation;
    expect(invocation).toMatchObject({
      retrievedMemoryCount: 5, selectedMemoryCount: 3, injectedMemoryCount: 2, memoryTokens: 50, outcome: "success",
    });
    expect(invocation?.relevantCount).toBe(1);
    expect(invocation?.harmfulCount).toBe(1);
  });
});

// ─── Usefulness labels & relevance ───────────────────────────────────────────

describe("Usefulness evaluation", () => {
  test("evaluateMemoryRelevance applies deterministic rules and stays unknown without rules", () => {
    const memory = { id: "m", kind: "semantic" as const, subject: "package-manager", trigger: undefined, title: undefined };
    expect(evaluateMemoryRelevance(memory, { relevantMarkers: ["package-manager"] })).toBe("useful");
    expect(evaluateMemoryRelevance(memory, { relevantMarkers: ["other"], harmfulMarkers: ["package-manager"] })).toBe("harmful");
    expect(evaluateMemoryRelevance(memory, { relevantMarkers: ["other"] })).toBe("irrelevant");
    expect(evaluateMemoryRelevance(memory, undefined)).toBe("unknown");
  });

  test("unknown label is never inferred from scores or confidence (no evaluation hallucination)", () => {
    // High scores alone must never produce a useful label.
    const memory = { id: "m", kind: "semantic" as const };
    expect(evaluateMemoryRelevance(memory, undefined)).toBe("unknown");
  });
});

// ─── Feedback ────────────────────────────────────────────────────────────────

describe("Human feedback ledger", () => {
  test("records feedback with provenance and aggregates per memory", () => {
    const ledger = new MemoryFeedbackLedger();
    ledger.record({ memoryId: "m1", label: "useful", providedBy: "alice", runId: "r1", reason: "helped" });
    ledger.record({ memoryId: "m1", label: "irrelevant", providedBy: "bob" });
    ledger.record({ memoryId: "m2", label: "harmful", providedBy: "alice" });
    ledger.recordInjection("m1");
    ledger.recordInjection("m1");
    const m1 = ledger.summary("m1");
    expect(m1).toMatchObject({ memoryId: "m1", useful: 1, irrelevant: 1, harmful: 0, timesInjected: 2 });
    expect(m1.lastFeedbackAt).toBeDefined();
    expect(ledger.summary("m2").harmful).toBe(1);
  });

  test("feedback validation rejects malformed input", () => {
    const ledger = new MemoryFeedbackLedger();
    expect(() => ledger.record({ memoryId: "", label: "useful", providedBy: "a" })).toThrow();
    expect(() => ledger.record({ memoryId: "m", label: "excellent" as never, providedBy: "a" })).toThrow();
    expect(() => ledger.record({ memoryId: "m", label: "useful", providedBy: "" })).toThrow();
  });

  test("feedback never mutates memory truth: reinforcement/verification untouched", async () => {
    const store = new InMemoryMemoryStore();
    const service = new DefaultMemoryService(store);
    const { memory } = await service.remember({ namespace: ns, kind: "semantic", content: "Repository uses pnpm", source: { type: "user" } }, access);
    const ledger = new MemoryFeedbackLedger();
    ledger.record({ memoryId: memory.id, label: "useful", providedBy: "alice" });
    ledger.record({ memoryId: memory.id, label: "harmful", providedBy: "bob" });
    const raw = await store.get("tenant", memory.id);
    expect(raw?.reinforcementCount ?? 0).toBe(0);
    expect(raw?.confidence).toBe(memory.confidence);
    expect(raw?.metadata?.__reliability_verification_status).toBeUndefined();
  });
});

// ─── Metrics ─────────────────────────────────────────────────────────────────

describe("Population metrics", () => {
  test("metric definitions are non-vague (explicit numerators/denominators)", () => {
    for (const definition of Object.values(MEMORY_METRIC_DEFINITIONS)) {
      expect(definition.length).toBeGreaterThan(10);
      expect(definition).toMatch(/\//);
    }
  });

  test("rates are zero-safe and computed from counts", () => {
    const metrics = emptyPopulationMetrics();
    metrics.invocations = 4;
    metrics.emptyRetrievals = 1;
    metrics.retrievedCount = 8;
    metrics.duplicateCandidates = 2;
    metrics.selectedCount = 6;
    metrics.droppedAfterSelectionCount = 2;
    metrics.injectedCount = 4;
    metrics.knownLabelCount = 4;
    metrics.irrelevantInjections = 1;
    metrics.harmfulInjections = 0;
    metrics.memoryTokens = 100;
    metrics.totalInputTokens = 1000;
    const computed = computePopulationMetrics(metrics);
    expect(computed.retrieval_hit_rate).toBeCloseTo(0.75);
    expect(computed.empty_retrieval_rate).toBeCloseTo(0.25);
    expect(computed.context_pollution_rate).toBeCloseTo(0.25);
    expect(computed.memory_token_share).toBeCloseTo(0.1);
    expect(computePopulationMetrics(emptyPopulationMetrics()).context_pollution_rate).toBe(0);
  });

  test("aggregations by kind and agent work", () => {
    const invocations = [
      { invocationId: "i1", runId: "r", agentId: "a1", nodeId: "n", retrievedMemoryCount: 0, selectedMemoryCount: 0, injectedMemoryCount: 1, memoryTokens: 10, tokensByKind: { semantic: 10, episodic: 0, procedural: 0 }, at: "" },
      { invocationId: "i2", runId: "r", agentId: "a2", nodeId: "n", retrievedMemoryCount: 0, selectedMemoryCount: 0, injectedMemoryCount: 1, memoryTokens: 20, tokensByKind: { semantic: 0, episodic: 20, procedural: 0 }, at: "" },
    ];
    expect(aggregateByKind(invocations).semantic.tokens).toBe(10);
    expect(aggregateByKind(invocations).episodic.tokens).toBe(20);
    expect(aggregateByAgent(invocations).a1.memoryTokens).toBe(10);
    expect(aggregateByAgent(invocations).a2.injected).toBe(1);
  });
});

// ─── Retention & sampling ────────────────────────────────────────────────────

describe("Retention and sampling", () => {
  test("expired traces are pruned by retention window", () => {
    const now = Date.parse("2026-09-22T00:00:00Z");
    let clock = now;
    const sink = new InMemoryMemoryEvaluationSink({ retentionMs: 1000, now: () => clock });
    const recorder = new MemoryEvaluationRecorder(sink);
    recorder.recordRetrieval({ runId: "old", invocationId: "old", agentId: "a", nodeId: "n" }, {
      results: [], diagnostics: { latencyMs: 1, embeddingLatencyMs: 0, candidateCount: 0, selectedCount: 0, deduplicatedCount: 0, warnings: [], candidates: [] },
    });
    clock += 2000;
    recorder.recordRetrieval({ runId: "new", invocationId: "new", agentId: "a", nodeId: "n" }, {
      results: [], diagnostics: { latencyMs: 1, embeddingLatencyMs: 0, candidateCount: 0, selectedCount: 0, deduplicatedCount: 0, warnings: [], candidates: [] },
    });
    const traces = sink.getTraces();
    expect(traces.map(t => t.runId)).toEqual(["new"]);
  });

  test("sampling at 0 drops ordinary traces; full-rate default keeps everything", () => {
    const sampled = new InMemoryMemoryEvaluationSink({ sampleRate: 0 });
    const recorder = new MemoryEvaluationRecorder(sampled);
    recorder.recordRetrieval({ runId: "r", invocationId: "i", agentId: "a", nodeId: "n" }, {
      results: [], diagnostics: { latencyMs: 1, embeddingLatencyMs: 0, candidateCount: 0, selectedCount: 0, deduplicatedCount: 0, warnings: [], candidates: [] },
    });
    expect(sampled.getTraces()).toHaveLength(0);
    const full = new InMemoryMemoryEvaluationSink();
    new MemoryEvaluationRecorder(full).recordRetrieval({ runId: "r", invocationId: "i", agentId: "a", nodeId: "n" }, {
      results: [], diagnostics: { latencyMs: 1, embeddingLatencyMs: 0, candidateCount: 0, selectedCount: 0, deduplicatedCount: 0, warnings: [], candidates: [] },
    });
    expect(full.getTraces()).toHaveLength(1);
  });

  test("sink failure never breaks the runtime: recorder is fail-soft", () => {
    const failingSink: MemoryEvaluationSink = {
      recordRetrieval: () => { throw new Error("sink down"); },
      recordSelections: () => { throw new Error("sink down"); },
      recordInjection: () => { throw new Error("sink down"); },
      recordInvocation: () => { throw new Error("sink down"); },
    };
    const recorder = new MemoryEvaluationRecorder(failingSink);
    expect(() => recorder.recordRetrieval({ runId: "r", invocationId: "i", agentId: "a", nodeId: "n" }, {
      results: [], diagnostics: { latencyMs: 1, embeddingLatencyMs: 0, candidateCount: 0, selectedCount: 0, deduplicatedCount: 0, warnings: [], candidates: [] },
    })).not.toThrow();
    expect(() => recorder.recordInvocation({ runId: "r", invocationId: "i", agentId: "a", nodeId: "n" }, {
      retrievedMemoryCount: 0, selectedMemoryCount: 0, injectedMemoryCount: 0, memoryTokens: 0, tokensByKind: { semantic: 0, episodic: 0, procedural: 0 },
    })).not.toThrow();
  });
});

// ─── Observational guarantee ─────────────────────────────────────────────────

describe("Evaluation observes, never controls", () => {
  test("identical retrieval results with and without an evaluation recorder", async () => {
    const fixedNow = Date.parse("2026-09-22T00:00:00Z");
    const buildStore = async () => {
      const store = new InMemoryMemoryStore(() => new Date(fixedNow));
      const service = new DefaultMemoryService(store, { now: () => fixedNow });
      // Distinct importance values make ranking score-driven instead of UUID-tiebreak-driven.
      await service.remember({ namespace: ns, kind: "semantic", content: "Deployment uses blue green strategy", subject: "deploy-blue", importance: 0.8, source: { type: "user" } }, access);
      await service.remember({ namespace: ns, kind: "semantic", content: "Deployment uses canary rollout instead", subject: "deploy-canary", importance: 0.2, source: { type: "user" } }, access);
      return store;
    };
    const withEval = await (async () => {
      const store = await buildStore();
      const service = new DefaultMemoryService(store, { now: () => fixedNow });
      return service.recall({ text: "deployment", namespaces: [ns] }, access);
    })();
    const withoutEval = await (async () => {
      const store = await buildStore();
      const service = new DefaultMemoryService(store, { now: () => fixedNow });
      const recorder = new MemoryEvaluationRecorder(new InMemoryMemoryEvaluationSink());
      const result = await service.recall({ text: "deployment", namespaces: [ns] }, access);
      recorder.recordRetrieval({ runId: "r", invocationId: "i", agentId: "a", nodeId: "n" }, result);
      return result;
    })();
    // Distinct stores mint distinct UUIDs; compare stable identity (subjects) and scores instead.
    expect(withoutEval.results.map(r => r.memory.subject)).toEqual(withEval.results.map(r => r.memory.subject));
    expect(withoutEval.results.map(r => r.score)).toEqual(withEval.results.map(r => r.score));
  });
});
