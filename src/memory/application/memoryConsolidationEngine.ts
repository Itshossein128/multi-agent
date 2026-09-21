import { randomUUID } from "node:crypto";
import type { ConsolidationConfig, ConsolidationDiagnostics, ConsolidationResult, Memory, MemoryAccessContext, MemoryConsolidationJudge, MemoryNamespace, MemoryStore, MemoryCandidate } from "../contracts";
import { MemoryConsolidationError, MemoryConflictError } from "../contracts";
import { normalizeContent, contentHash, isLive, sameNamespace, namespaceKey, publicMemory, requireNamespaces } from "./access";
import { embedSafely, sameEmbedding, validVector } from "./embedding";
import { DeterministicMemoryConsolidationJudge } from "./memoryConsolidationJudge";
import { resolveConsolidationConfig } from "./memoryConsolidationConfig";

export interface ConsolidationEngineOptions {
  store: MemoryStore;
  embeddingProvider?: { metadata: { provider: string; model: string; version: string; dimensions: number }; embed(text: string): Promise<number[]> };
  embeddingTimeoutMs?: number;
  judge?: MemoryConsolidationJudge;
  config?: ConsolidationConfig;
  now?: () => number;
}

function createDefaultDiagnostics(): ConsolidationDiagnostics {
  return { candidatesEvaluated: 0, exactDuplicates: 0, semanticCandidates: 0, merged: 0, superseded: 0, ignored: 0, keptSeparate: 0, judgeFailures: 0, latencyMs: 0 };
}

/** Core consolidation engine: discovers candidates, makes decisions, persists results. */
export class ConsolidationEngine {
  private readonly store: MemoryStore;
  private readonly embeddingProvider?: ConsolidationEngineOptions["embeddingProvider"];
  private readonly embeddingTimeoutMs: number;
  private readonly judge: MemoryConsolidationJudge;
  private readonly config: Required<ConsolidationConfig>;
  private readonly now: () => number;
  constructor(options: ConsolidationEngineOptions) {
    this.store = options.store;
    this.embeddingProvider = options.embeddingProvider;
    this.embeddingTimeoutMs = options.embeddingTimeoutMs ?? 1000;
    this.judge = options.judge ?? new DeterministicMemoryConsolidationJudge(options.config);
    this.config = resolveConsolidationConfig(options.config);
    this.now = options.now ?? Date.now;
  }
  /** Discover candidate memories that might be related to the incoming memory. */
  private async discoverCandidates(incoming: MemoryCandidate, access: MemoryAccessContext, excludeId?: string): Promise<Memory[]> {
    const baseQuery = {
      tenantId: access.tenantId,
      namespaces: [incoming.namespace],
      kinds: [incoming.kind],
      status: "active" as const,
      includeExpired: false,
      limit: this.config.candidateSearchLimit,
    };
    const lexicalResults = await this.store.search({
      ...baseQuery,
      text: incoming.content.slice(0, 200),
      limit: Math.min(this.config.candidateSearchLimit, 20),
    });
    let semanticResults: Memory[] = [];
    if (this.embeddingProvider) {
      try {
        const embedding = await embedSafely(this.embeddingProvider, incoming.content, this.embeddingTimeoutMs);
        if (embedding && validVector(embedding, this.embeddingProvider.metadata.dimensions)) {
          semanticResults = await this.store.search({
            ...baseQuery,
            embedding,
            embeddingMetadata: this.embeddingProvider.metadata,
            limit: this.config.embeddingSearchLimit,
          });
        }
      } catch { /* Semantic search failure is non-fatal. */ }
    }
    const seen = new Set<string>();
    const candidates: Memory[] = [];
    for (const memory of [...lexicalResults, ...semanticResults]) {
      if (!seen.has(memory.id) && isLive(memory, this.now()) && memory.id !== excludeId) {
        seen.add(memory.id);
        candidates.push(memory);
      }
    }
    return candidates;
  }
  /** Execute the consolidation decision for a single incoming memory. */
  async consolidateMemory(incoming: MemoryCandidate, access: MemoryAccessContext, diagnostics: ConsolidationDiagnostics, excludeId?: string): Promise<{ persisted: boolean; merged: number }> {
    requireNamespaces([incoming.namespace], access, true);
    diagnostics.candidatesEvaluated++;
    const candidates = await this.discoverCandidates(incoming, access, excludeId);
    if (!candidates.length) {
      diagnostics.keptSeparate++;
      return { persisted: false, merged: 0 };
    }
    diagnostics.semanticCandidates += candidates.length;
    let decision;
    try {
      decision = await this.judge.decide(incoming, candidates);
    } catch (error) {
      diagnostics.judgeFailures++;
      return { persisted: false, merged: 0 };
    }
    switch (decision.type) {
      case "ignore_new": {
        diagnostics.exactDuplicates++;
        diagnostics.ignored++;
        // Supersede the current memory in favor of the existing canonical
        if (decision.canonicalMemoryId && incoming.id && incoming.id !== decision.canonicalMemoryId) {
          try {
            await this.store.transaction(namespaceKey(access.tenantId, incoming.namespace), async store => {
              const current = await store.get(access.tenantId, incoming.id!);
              if (current && isLive(current, this.now())) {
                const now = new Date(this.now()).toISOString();
                await store.update({
                  ...current,
                  status: "superseded",
                  supersededByMemoryId: decision.canonicalMemoryId!,
                  version: current.version + 1,
                  updatedAt: now,
                }, current.version);
              }
            });
          } catch { /* Supersede failure is non-fatal for ignore_new. */ }
        }
        return { persisted: false, merged: 0 };
      }
      case "keep_both": {
        diagnostics.keptSeparate++;
        return { persisted: false, merged: 0 };
      }
      case "merge": {
        diagnostics.merged++;
        return this.executeMerge(incoming, decision, access, diagnostics);
      }
      case "supersede": {
        diagnostics.superseded++;
        return this.executeSupersede(incoming, decision, access, diagnostics);
      }
      default:
        diagnostics.keptSeparate++;
        return { persisted: false, merged: 0 };
    }
  }
  private async executeMerge(incoming: MemoryCandidate, decision: { canonicalMemoryId?: string; relatedMemoryIds: string[]; mergedMemory?: MemoryCandidate }, access: MemoryAccessContext, _diagnostics: ConsolidationDiagnostics): Promise<{ persisted: boolean; merged: number }> {
    const canonicalId = decision.canonicalMemoryId;
    if (!canonicalId) return { persisted: false, merged: 0 };
    const mergedContent = decision.mergedMemory?.content ?? incoming.content;
    const mergedCandidate = decision.mergedMemory ?? { ...incoming, content: mergedContent };
    return this.store.transaction(namespaceKey(access.tenantId, incoming.namespace), async store => {
      const canonical = await store.get(access.tenantId, canonicalId);
      if (!canonical || !isLive(canonical, this.now()) || !sameNamespace(canonical.namespace, incoming.namespace) || canonical.kind !== incoming.kind) {
        return { persisted: false, merged: 0 };
      }
      const now = new Date(this.now()).toISOString();
      const updatedCanonical: Memory = {
        ...canonical,
        content: mergedCandidate.content.trim(),
        contentHash: contentHash(mergedCandidate.content),
        importance: Math.max(canonical.importance, mergedCandidate.importance ?? 0.5),
        confidence: mergedCandidate.confidence ?? canonical.confidence,
        metadata: {
          ...canonical.metadata,
          ...mergedCandidate.metadata,
          mergedFromMemoryIds: [
            ...new Set([
              ...((canonical.metadata?.mergedFromMemoryIds as string[]) ?? []),
              ...decision.relatedMemoryIds.filter(id => id !== canonicalId),
              ...((mergedCandidate.metadata?.mergedFromMemoryIds as string[]) ?? []).filter(id => id !== canonicalId),
              // Track the incoming memory's ID when it's superseded
              ...(incoming.id && incoming.id !== canonicalId ? [incoming.id] : []),
            ]),
          ],
          consolidationTimestamp: now,
        },
        version: canonical.version + 1,
        updatedAt: now,
      };
      await store.update(updatedCanonical, canonical.version);
      // Collect all memory IDs that should be superseded (related + incoming if not canonical)
      const toSupersede = new Set<string>();
      for (const relatedId of decision.relatedMemoryIds) {
        if (relatedId !== canonicalId) toSupersede.add(relatedId);
      }
      // If the incoming memory has an ID (was found in the store), supersede it too
      if (incoming.id) toSupersede.add(incoming.id);
      for (const supersedeId of toSupersede) {
        try {
          const related = await store.get(access.tenantId, supersedeId);
          if (related && isLive(related, this.now()) && sameNamespace(related.namespace, incoming.namespace) && related.kind === incoming.kind && related.id !== canonicalId) {
            await store.update({
              ...related,
              status: "superseded",
              supersededByMemoryId: canonicalId,
              version: related.version + 1,
              updatedAt: now,
            }, related.version);
          }
        } catch { /* Individual supersede failure does not break the batch. */ }
      }
      return { persisted: true, merged: 1 };
    });
  }
  private async executeSupersede(incoming: MemoryCandidate, decision: { relatedMemoryIds: string[] }, access: MemoryAccessContext, _diagnostics: ConsolidationDiagnostics): Promise<{ persisted: boolean; merged: number }> {
    return this.store.transaction(namespaceKey(access.tenantId, incoming.namespace), async store => {
      const now = new Date(this.now()).toISOString();
      let supersededCount = 0;
      for (const relatedId of decision.relatedMemoryIds) {
        try {
          const existing = await store.get(access.tenantId, relatedId);
          if (existing && isLive(existing, this.now()) && sameNamespace(existing.namespace, incoming.namespace) && existing.kind === incoming.kind) {
            await store.update({
              ...existing,
              status: "superseded",
              supersededByMemoryId: incoming.supersedesMemoryId ?? "pending",
              version: existing.version + 1,
              updatedAt: now,
            }, existing.version);
            supersededCount++;
          }
        } catch { /* Individual supersede failure does not break the batch. */ }
      }
      return { persisted: supersededCount > 0, merged: supersededCount };
    });
  }
  /** Run full consolidation for a namespace. */
  async consolidate(access: MemoryAccessContext, namespace: MemoryNamespace): Promise<ConsolidationResult> {
    requireNamespaces([namespace], access, true);
    const start = this.now();
    const diagnostics = createDefaultDiagnostics();
    const activeMemories = await this.store.search({
      tenantId: access.tenantId,
      namespaces: [namespace],
      status: "active",
      includeExpired: false,
      limit: 500,
    });
    let totalMerged = 0;
    const processedIds = new Set<string>();
    for (const memory of activeMemories) {
      if (!isLive(memory, this.now()) || processedIds.has(memory.id)) continue;
      const incoming: MemoryCandidate = {
        namespace: memory.namespace,
        kind: memory.kind,
        content: memory.content,
        source: memory.source,
        importance: memory.importance,
        confidence: memory.confidence,
        subject: memory.subject,
        structuredData: memory.structuredData,
        metadata: memory.metadata,
        id: memory.id,
      };
      const result = await this.consolidateMemory(incoming, access, diagnostics, memory.id);
      totalMerged += result.merged;
      processedIds.add(memory.id);
    }
    diagnostics.latencyMs = this.now() - start;
    return { merged: totalMerged, diagnostics };
  }
}
