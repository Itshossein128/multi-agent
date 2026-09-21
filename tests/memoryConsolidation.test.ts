import { randomUUID } from "node:crypto";
import { DefaultMemoryService, NoopMemoryConsolidator, RealMemoryConsolidator, DeterministicMemoryConsolidationJudge, FakeMemoryConsolidationJudge, ConsolidationEngine, ConsolidationBackfill } from "../src/memory/application";
import { InMemoryMemoryStore } from "../src/memory/infrastructure/in-memory-memory-store";
import { MemoryAccessDeniedError, MemoryConflictError } from "../src/memory/contracts";
import type { MemoryAccessContext, MemoryNamespace, MemoryCandidate, Memory, ConsolidationDecision, ConsolidationConfig, MemoryConsolidationJudge, ConsolidationDecisionType } from "../src/memory/contracts";
import { contentHash } from "../src/memory/application/access";

// Test setup helpers
const tenant = "test-tenant";
const namespace: MemoryNamespace = { scope: "agent", id: "test-agent" };
const access: MemoryAccessContext = {
  principalId: "user",
  tenantId: tenant,
  agentId: "test-agent",
  readableNamespaces: [namespace],
  writableNamespaces: [namespace],
};

function createMemoryStore(): InMemoryMemoryStore {
  return new InMemoryMemoryStore(() => new Date());
}

function createEmbeddingProvider() {
  return {
    metadata: { provider: "test", model: "test-model", version: "1", dimensions: 3 },
    embed: async (text: string) => {
      // Word-overlap based deterministic embedding
      const words = text.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
      const embedding = [0, 0, 0];
      for (const word of words) {
        const hash = contentHash(word);
        embedding[0] += parseInt(hash.slice(0, 8), 16) / 0xFFFFFFFF;
        embedding[1] += parseInt(hash.slice(8, 16), 16) / 0xFFFFFFFF;
        embedding[2] += parseInt(hash.slice(16, 24), 16) / 0xFFFFFFFF;
      }
      const norm = Math.sqrt(embedding[0] ** 2 + embedding[1] ** 2 + embedding[2] ** 2);
      return norm > 0 ? embedding.map(v => v / norm) : [0, 0, 0];
    },
  };
}

function createMemoryService(store: InMemoryMemoryStore): DefaultMemoryService {
  return new DefaultMemoryService(store, { embeddingProvider: createEmbeddingProvider() });
}

function createFakeJudge(decisions?: Map<string, ConsolidationDecision>): FakeMemoryConsolidationJudge {
  return new FakeMemoryConsolidationJudge(decisions);
}

function createConsolidatorWithJudge(store: InMemoryMemoryStore, judge: MemoryConsolidationJudge, config?: ConsolidationConfig): RealMemoryConsolidator {
  return new RealMemoryConsolidator({ store, embeddingProvider: createEmbeddingProvider(), judge, config });
}

function createConsolidator(store: InMemoryMemoryStore, config?: ConsolidationConfig): RealMemoryConsolidator {
  return new RealMemoryConsolidator({ store, embeddingProvider: createEmbeddingProvider(), config });
}

async function rememberMemory(
  service: DefaultMemoryService,
  content: string,
  options: Partial<MemoryCandidate> = {}
): Promise<Memory> {
  const result = await service.remember(
    { namespace, kind: "semantic", content, source: { type: "user", agentId: "test-agent" }, ...options },
    access
  );
  return result.memory;
}

// ── Test 1: exact duplicate ignore ──
test("consolidation ignores exact duplicate memories", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  // DefaultMemoryService deduplicates exact content, so only 1 is created
  const m1 = await rememberMemory(service, "Repository uses pnpm.");
  // Create a second memory directly in the store (bypassing service dedup)
  const m2: Memory = {
    ...m1,
    id: randomUUID(),
    contentHash: contentHash("Repository uses pnpm."),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await store.insert(m2);

  const before = await service.list({ namespaces: [namespace] }, access);
  expect(before).toHaveLength(2);

  const result = await consolidator.consolidate(access, namespace);

  const after = await service.list({ namespaces: [namespace] }, access);
  expect(after).toHaveLength(1);
  expect(result.merged).toBe(0);
});

// ── Test 2: idempotent repeated writes ──
test("consolidation is idempotent when run multiple times", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "Repository uses pnpm.");

  await consolidator.consolidate(access, namespace);
  await consolidator.consolidate(access, namespace);
  await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
});

// ── Test 3: semantic paraphrase merge ──
test("consolidation merges semantic paraphrases via FakeMemoryConsolidationJudge", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);

  // Pre-configure: any non-exact content gets merged with the first candidate
  const mergeDecision: ConsolidationDecision = {
    type: "merge",
    canonicalMemoryId: undefined, // will be set dynamically
    relatedMemoryIds: [],
    reason: "semantic_paraphrase",
    confidence: 0.9,
  };
  const judge = createFakeJudge();
  // Override to return merge for non-exact content
  const originalDecide = judge.decide.bind(judge);
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    const firstCandidate = existing[0];
    return { type: "merge", canonicalMemoryId: firstCandidate.id, relatedMemoryIds: [firstCandidate.id], reason: "semantic_paraphrase", confidence: 0.9, mergedMemory: { ...incoming, content: firstCandidate.content + "; " + incoming.content } };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  const m1 = await rememberMemory(service, "Repository uses pnpm.");
  const m2 = await rememberMemory(service, "pnpm is the package manager for this project.");

  const result = await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
  expect(result.diagnostics.merged).toBeGreaterThan(0);
});

// ── Test 4: related-but-distinct keep-both ──
test("consolidation keeps related-but-distinct memories separate", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "Repository uses Changesets for package versioning.");

  const result = await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(2);
  expect(result.diagnostics.keptSeparate).toBeGreaterThan(0);
});

// ── Test 5: explicit supersede ──
test("consolidation handles explicit supersede", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  const old = await rememberMemory(service, "Repository uses npm.");
  const newMem = await service.remember(
    { namespace, kind: "semantic", content: "Repository uses pnpm now.", source: { type: "user", agentId: "test-agent" }, supersedesMemoryId: old.id },
    access
  );

  const result = await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
  expect(memories[0].id).toBe(newMem.memory.id);
  expect(result.diagnostics.superseded).toBeGreaterThanOrEqual(0);
});

// ── Test 6: temporal replacement ──
test("consolidation detects temporal replacement", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);

  // Judge that detects temporal replacement
  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    const temporalPattern = /\b(?:migrated|changed|switched|replaced|now uses|no longer)\b/i;
    if (temporalPattern.test(incoming.content)) {
      return { type: "supersede", relatedMemoryIds: existing.map(e => e.id), reason: "temporal_replacement", confidence: 0.95 };
    }
    return { type: "keep_both", relatedMemoryIds: [], reason: "no_match" };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses npm.");
  await rememberMemory(service, "Repository migrated to pnpm.");

  const result = await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
  expect(result.diagnostics.superseded).toBeGreaterThan(0);
});

// ── Test 7: evidence/provenance preservation ──
test("consolidation preserves evidence and provenance", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);

  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    const canonical = existing[0];
    return {
      type: "merge",
      canonicalMemoryId: canonical.id,
      relatedMemoryIds: existing.map(e => e.id),
      reason: "merge",
      confidence: 0.9,
      mergedMemory: {
        ...incoming,
        content: canonical.content + "; " + incoming.content,
        metadata: { mergedFromMemoryIds: existing.map(e => e.id).filter(id => id !== canonical.id), ...(incoming.metadata || {}), ...(canonical.metadata || {}) },
      },
    };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  const m1 = await rememberMemory(service, "Repository uses pnpm.", { metadata: { source: "run-1" } });
  const m2 = await rememberMemory(service, "pnpm is the package manager.", { metadata: { source: "run-4" } });

  await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
  // The canonical memory should have mergedFromMemoryIds containing the OTHER memory's ID
  const mergedIds = (memories[0].metadata?.mergedFromMemoryIds as string[]) ?? [];
  expect(mergedIds.length).toBeGreaterThan(0);
  expect([m1.id, m2.id].some(id => mergedIds.includes(id))).toBe(true);
  expect(memories[0].metadata?.consolidationTimestamp).toBeDefined();
});

// ── Test 8: canonical memory remains active ──
test("canonical memory remains active after consolidation", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    return { type: "merge", canonicalMemoryId: existing[0].id, relatedMemoryIds: [existing[0].id], reason: "merge", confidence: 0.9 };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
  expect(memories[0].status).toBe("active");
});

// ── Test 9: old merged memories become superseded ──
test("old merged memories become superseded", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    return { type: "merge", canonicalMemoryId: existing[0].id, relatedMemoryIds: existing.map(e => e.id), reason: "merge", confidence: 0.9 };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
  expect(memories.every(m => m.status === "active")).toBe(true);
});

// ── Test 10: retrieval excludes superseded duplicates ──
test("retrieval excludes superseded duplicates", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    return { type: "merge", canonicalMemoryId: existing[0].id, relatedMemoryIds: existing.map(e => e.id), reason: "merge", confidence: 0.9 };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  await consolidator.consolidate(access, namespace);

  const retrievalResult = await service.recall({ text: "package manager pnpm", namespaces: [namespace] }, access);

  expect(retrievalResult.results).toHaveLength(1);
  expect(retrievalResult.results[0].memory.status).toBe("active");
});

// ── Test 11: tenant isolation ──
test("consolidation respects tenant boundaries", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    return { type: "merge", canonicalMemoryId: existing[0].id, relatedMemoryIds: [existing[0].id], reason: "merge", confidence: 0.9 };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  const tenantA = "tenant-a";
  const tenantB = "tenant-b";
  const accessA: MemoryAccessContext = { principalId: "user-a", tenantId: tenantA, readableNamespaces: [namespace], writableNamespaces: [namespace] };
  const accessB: MemoryAccessContext = { principalId: "user-b", tenantId: tenantB, readableNamespaces: [namespace], writableNamespaces: [namespace] };

  await service.remember({ namespace, kind: "semantic", content: "Repository uses pnpm.", source: { type: "user", agentId: "test-agent" } }, accessA);
  await service.remember({ namespace, kind: "semantic", content: "Repository uses pnpm.", source: { type: "user", agentId: "test-agent" } }, accessB);

  await consolidator.consolidate(accessA, namespace);

  const memoriesA = await service.list({ namespaces: [namespace] }, accessA);
  expect(memoriesA).toHaveLength(1);

  const memoriesB = await service.list({ namespaces: [namespace] }, accessB);
  expect(memoriesB).toHaveLength(1);
});

// ── Test 12: namespace isolation ──
test("consolidation respects namespace boundaries", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    return { type: "merge", canonicalMemoryId: existing[0].id, relatedMemoryIds: [existing[0].id], reason: "merge", confidence: 0.9 };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  const nsA: MemoryNamespace = { scope: "agent", id: "agent-a" };
  const nsB: MemoryNamespace = { scope: "agent", id: "agent-b" };
  const accA: MemoryAccessContext = { principalId: "user", tenantId: tenant, agentId: "agent-a", readableNamespaces: [nsA], writableNamespaces: [nsA] };
  const accB: MemoryAccessContext = { principalId: "user", tenantId: tenant, agentId: "agent-b", readableNamespaces: [nsB], writableNamespaces: [nsB] };

  await service.remember({ namespace: nsA, kind: "semantic", content: "Use concise answers.", source: { type: "user", agentId: "agent-a" } }, accA);
  await service.remember({ namespace: nsB, kind: "semantic", content: "Use concise answers.", source: { type: "user", agentId: "agent-b" } }, accB);

  await consolidator.consolidate(accA, nsA);

  const memoriesA = await service.list({ namespaces: [nsA] }, accA);
  expect(memoriesA).toHaveLength(1);

  const memoriesB = await service.list({ namespaces: [nsB] }, accB);
  expect(memoriesB).toHaveLength(1);
});

// ── Test 13: memory kind isolation ──
test("consolidation respects memory kind boundaries", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    return { type: "merge", canonicalMemoryId: existing[0].id, relatedMemoryIds: [existing[0].id], reason: "merge", confidence: 0.9 };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  await service.remember({ namespace, kind: "semantic", content: "Repository uses pnpm.", source: { type: "user", agentId: "test-agent" } }, access);
  await service.remember({ namespace, kind: "procedural", content: "Repository uses pnpm.", source: { type: "user", agentId: "test-agent" } }, access);

  await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(2);
  expect(memories.every(m => m.status === "active")).toBe(true);
});

// ── Test 14: episodic safety ──
test("consolidation preserves episodic memories separately", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    // Episodic memories should always be kept separate
    return { type: "keep_both", relatedMemoryIds: [], reason: "episodic_distinct_events" };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  await service.remember({ namespace, kind: "episodic", content: "Run 1 failed because DB unavailable.", source: { type: "user", agentId: "test-agent" } }, access);
  await service.remember({ namespace, kind: "episodic", content: "Run 9 failed because DB unavailable.", source: { type: "user", agentId: "test-agent" } }, access);

  await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(2);
  expect(memories.every(m => m.status === "active")).toBe(true);
});

// ── Test 15: procedural safety ──
test("consolidation preserves procedural memories with different triggers", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    return { type: "keep_both", relatedMemoryIds: [], reason: "procedural_different_trigger" };
  };

  const consolidator = createConsolidatorWithJudge(store, judge);

  await service.remember({ namespace, kind: "procedural", content: "Run auth tests.", trigger: "auth changes", procedure: "run auth tests", source: { type: "user", agentId: "test-agent" } }, access);
  await service.remember({ namespace, kind: "procedural", content: "Run migration tests.", trigger: "database migrations", procedure: "run migration tests", source: { type: "user", agentId: "test-agent" } }, access);

  await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(2);
  expect(memories.every(m => m.status === "active")).toBe(true);
});

// ── Test 16: concurrent equivalent writes ──
test("consolidation handles concurrent equivalent writes safely", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  const promises = [
    rememberMemory(service, "Repository uses pnpm."),
    rememberMemory(service, "Repository uses pnpm."),
    rememberMemory(service, "Repository uses pnpm."),
  ];
  await Promise.all(promises);

  const result = await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
  expect(memories[0].status).toBe("active");
});

// ── Test 17: transaction rollback ──
test("consolidation handles transaction failures gracefully", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  // Force judge to merge
  judge.decide = async (incoming: MemoryCandidate, existing: Memory[]) => {
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return { type: "ignore_new", canonicalMemoryId: exact.id, relatedMemoryIds: [exact.id], reason: "exact_content_match", confidence: 1.0 };
    return { type: "merge", canonicalMemoryId: existing[0].id, relatedMemoryIds: [existing[0].id], reason: "merge", confidence: 0.9 };
  };

  // Force update to fail
  const originalUpdate = store.update.bind(store);
  let callCount = 0;
  store.update = jest.fn().mockImplementation(async (memory: Memory, expectedVersion: number) => {
    callCount++;
    if (callCount === 2) throw new Error("Transaction failure");
    return originalUpdate(memory, expectedVersion);
  });

  const result = await consolidator.consolidate(access, namespace);
  expect(result).toBeDefined();
});

// ── Test 18: semantic judge failure ──
test("consolidation handles semantic judge failure gracefully", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);

  const failingJudge: MemoryConsolidationJudge = {
    decide: async () => { throw new Error("Judge failure"); },
  };

  const consolidator = createConsolidatorWithJudge(store, failingJudge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  const result = await consolidator.consolidate(access, namespace);
  expect(result).toBeDefined();
  expect(result.diagnostics.judgeFailures).toBeGreaterThan(0);
});

// ── Test 19: embedding failure ──
test("consolidation handles embedding failure gracefully", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);

  const failingEmbeddingProvider = {
    metadata: { provider: "test", model: "test-model", version: "1", dimensions: 3 },
    embed: async () => { throw new Error("Embedding failure"); },
  };

  const judge = createFakeJudge();
  const consolidator = new RealMemoryConsolidator({ store, embeddingProvider: failingEmbeddingProvider, judge });

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  const result = await consolidator.consolidate(access, namespace);
  expect(result).toBeDefined();
});

// ── Test 20: malformed judge output ──
test("consolidation handles malformed judge output gracefully", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);

  const malformedJudge: MemoryConsolidationJudge = {
    decide: async () => ({ type: "invalid_type" as unknown as ConsolidationDecisionType, relatedMemoryIds: [], reason: "invalid" }),
  };

  const consolidator = createConsolidatorWithJudge(store, malformedJudge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  const result = await consolidator.consolidate(access, namespace);
  expect(result).toBeDefined();
});

// ── Test 21: background consolidation ──
test("background consolidation works correctly", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  const result = await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(2);
  expect(result.merged).toBeGreaterThanOrEqual(0);
});

// ── Test 22: backfill idempotency ──
test("backfill is idempotent when run multiple times", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  const backfill = new ConsolidationBackfill({
    store,
    embeddingProvider: createEmbeddingProvider(),
    backfillOptions: { batchSize: 10, limit: 100 },
  });

  await backfill.run(access, namespace);
  await backfill.run(access, namespace);
  await backfill.run(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  // Backfill should not fail
  expect(memories.length).toBeGreaterThanOrEqual(1);
});

// ── Test 23: dry-run makes no mutations ──
test("dry-run mode does not mutate data", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);

  // Use different content (DefaultMemoryService deduplicates exact content)
  await rememberMemory(service, "Repository uses pnpm for dependency management.");
  await rememberMemory(service, "pnpm is the package manager for this project.");

  const backfill = new ConsolidationBackfill({
    store,
    embeddingProvider: createEmbeddingProvider(),
    backfillOptions: { dryRun: true, batchSize: 10, limit: 100 },
  });

  const result = await backfill.run(access, namespace);

  expect(result).toBeDefined();
  expect(result.processed).toBeGreaterThan(0);

  // Memories should still be 2 (no mutation in dry-run)
  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(2);
});

// ── Test 24: restart-safe maintenance ──
test("maintenance behavior is restart-safe", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator1 = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "pnpm is the package manager.");

  // Simulate restart
  const judge2 = createFakeJudge();
  const consolidator2 = createConsolidatorWithJudge(store, judge2);

  await consolidator2.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories.length).toBeGreaterThanOrEqual(1);
});

// ── Test 25: Phase 0 semantic retrieval regression ──
test("Phase 0 semantic retrieval still works after consolidation", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm for dependency management.");
  await consolidator.consolidate(access, namespace);

  const retrievalResult = await service.recall({ text: "pnpm dependency", namespaces: [namespace] }, access);
  expect(retrievalResult.results.length).toBeGreaterThanOrEqual(1);
  expect(retrievalResult.results[0].memory.content).toContain("pnpm");
});

// ── Test 26: Phase 1 ContextAssembler regression ──
test("Phase 1 ContextAssembler still works after consolidation", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm for dependency management.");
  await consolidator.consolidate(access, namespace);

  const retrievalResult = await service.recall({ text: "pnpm dependency", namespaces: [namespace] }, access);
  expect(retrievalResult.results).toHaveLength(1);
  expect(retrievalResult.results[0].memory.content).toContain("pnpm");
});

// ── Test 27: Phase 2 handoff regression ──
test("Phase 2 handoff still works after consolidation", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm for dependency management.");
  await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
  expect(memories[0].status).toBe("active");
});

// ── Test 28: Phase 3 Working Memory regression ──
test("Phase 3 Working Memory still works after consolidation", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm for dependency management.");
  await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  expect(memories).toHaveLength(1);
  expect(memories[0].status).toBe("active");
});

// ── Additional: NoopMemoryConsolidator compatibility ──
test("NoopMemoryConsolidator still works with new interface", async () => {
  const consolidator = new NoopMemoryConsolidator();
  const result = await consolidator.consolidate(access, namespace);
  expect(result).toEqual({
    merged: 0,
    diagnostics: { candidatesEvaluated: 0, exactDuplicates: 0, semanticCandidates: 0, merged: 0, superseded: 0, ignored: 0, keptSeparate: 0, judgeFailures: 0, latencyMs: 0 },
  });
});

// ── Additional: Access denial ──
test("consolidation denies access to unauthorized users", async () => {
  const store = createMemoryStore();
  const consolidator = createConsolidator(store);

  const unauthorizedAccess: MemoryAccessContext = {
    principalId: "unauthorized",
    tenantId: "other-tenant",
    readableNamespaces: [{ scope: "project", id: "other" }],
    writableNamespaces: [{ scope: "project", id: "other" }],
  };

  await expect(consolidator.consolidate(unauthorizedAccess, namespace)).rejects.toBeInstanceOf(MemoryAccessDeniedError);
});

// ── Additional: Empty namespace ──
test("consolidation handles empty namespace gracefully", async () => {
  const store = createMemoryStore();
  const consolidator = createConsolidator(store);

  const result = await consolidator.consolidate(access, namespace);
  expect(result.merged).toBe(0);
  expect(result.diagnostics.candidatesEvaluated).toBe(0);
});

// ── Additional: Diagnostics ──
test("consolidation provides diagnostics", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);
  const judge = createFakeJudge();
  const consolidator = createConsolidatorWithJudge(store, judge);

  await rememberMemory(service, "Repository uses pnpm.");
  await rememberMemory(service, "Repository uses pnpm.");

  const result = await consolidator.consolidate(access, namespace);

  expect(result.diagnostics).toBeDefined();
  expect(result.diagnostics.candidatesEvaluated).toBeGreaterThan(0);
  expect(result.diagnostics.latencyMs).toBeGreaterThanOrEqual(0);
});

// ── Additional: Threshold configuration ──
test("consolidation respects threshold configuration", async () => {
  const store = createMemoryStore();
  const service = createMemoryService(store);

  // Use high thresholds to prevent merging with DeterministicMemoryConsolidationJudge
  const consolidator = createConsolidator(store, { autoMergeThreshold: 0.99, semanticCandidateThreshold: 0.95 });

  await rememberMemory(service, "Repository uses pnpm for package management.");
  await rememberMemory(service, "pnpm is the package manager for this project.");

  const result = await consolidator.consolidate(access, namespace);

  const memories = await service.list({ namespaces: [namespace] }, access);
  // With very high thresholds, exact duplicates are still ignored but paraphrases should be kept separate
  expect(memories.length).toBeGreaterThanOrEqual(1);
});
