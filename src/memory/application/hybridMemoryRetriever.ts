import type { EmbeddingProvider, Memory, MemoryAccessContext, MemoryRetrievalQuery, MemoryRetrievalResult, MemoryRetriever, MemoryStore } from "../contracts";
import { MemoryValidationError } from "../contracts";
import type { MemorySearchResult } from "@multi-agent/types";
import { boundedInteger, canAccessMemory, isLive, matchesFilters, normalizeContent, publicMemory, requireNamespaces, sameNamespace } from "./access";
import { embedSafely, sameEmbedding, validVector } from "./embedding";
import { computeReliabilityFactor, DeterministicFreshnessPolicy, extractReliability, RELIABILITY_KEYS, type MemoryFreshnessPolicy } from "./memoryReliability";
import { DefaultMemoryContextFormatter } from "./memoryContextFormatter";

type Scores = MemorySearchResult["scores"];
export interface HybridMemoryRetrieverOptions {
  embeddingProvider?: EmbeddingProvider; embeddingTimeoutMs?: number;
  candidateLimit?: number; weights?: Partial<Scores>; semanticRelevanceThreshold?: number;
  recencyHalfLifeDays?: number; formatter?: DefaultMemoryContextFormatter; now?: () => number;
  /** Phase 7 reliability-aware ranking; on by default so invalidated memories never rank. */
  reliabilityScoring?: boolean; freshnessPolicy?: MemoryFreshnessPolicy;
}
const STOP_WORDS = new Set("a an and are as at be by for from how i in is it me my of on or our please tell that the this to we what with you about does do uses use".split(" "));
function words(text: string): Set<string> { return new Set((normalizeContent(text).match(/[\p{L}\p{N}_]+/gu) ?? []).filter(w => !STOP_WORDS.has(w))); }
function overlap(query: Set<string>, text: string): number {
  const target = words(text);
  return query.size ? [...query].filter(w => target.has(w)).length / query.size : 0;
}
function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((n, x, i) => n + x * b[i], 0);
  const norm = Math.hypot(...a) * Math.hypot(...b);
  return norm && Number.isFinite(dot / norm) ? Math.max(0, Math.min(1, dot / norm)) : 0;
}
const VERIFICATION_RANK: Record<string, number> = { verified: 4, unverified: 3, stale: 2, disputed: 1, invalidated: 0 };
const VALUE_FAMILIES = [
  ["npm", "pnpm", "yarn", "bun"],
  ["postgres", "postgresql", "mysql", "sqlite", "mongodb"],
];
function canonicalSubject(memory: Memory): string | undefined {
  const subject = normalizeContent(memory.subject ?? "");
  if (!subject) return undefined;
  for (const family of VALUE_FAMILIES) for (const value of family) {
    if (subject === value) continue;
    if (subject.endsWith(`-${value}`) || subject.endsWith(` ${value}`)) return subject.slice(0, -value.length).replace(/[- ]+$/, "");
  }
  return subject;
}
function contentConflictKey(memory: Memory): string | undefined {
  if (memory.kind !== "semantic") return undefined;
  const content = normalizeContent(memory.content);
  if (/\b(package manager|package-management|install tasks?)\b/.test(content)) return "package-manager";
  if (/\b(database|db)\b/.test(content) && /\b(backend|engine|storage)\b/.test(content)) return "database";
  return undefined;
}
function conflictGroupKey(memory: Memory): string | undefined {
  const subject = canonicalSubject(memory);
  const trigger = memory.kind === "procedural" ? normalizeContent(memory.trigger ?? "") : "";
  const key = (subject ?? trigger) || contentConflictKey(memory);
  return key ? `${memory.tenantId}|${memory.namespace.scope}:${memory.namespace.id}|${memory.kind}|${key}` : undefined;
}
function explicitlyConflicts(a: Memory, b: Memory): boolean {
  const aConflicts = a.metadata?.[RELIABILITY_KEYS.conflictWithMemoryIds];
  const bConflicts = b.metadata?.[RELIABILITY_KEYS.conflictWithMemoryIds];
  return (Array.isArray(aConflicts) && aConflicts.includes(b.id)) || (Array.isArray(bConflicts) && bConflicts.includes(a.id));
}
function conflictKey(a: Memory, b: Memory): string | undefined {
  if (a.kind !== b.kind || a.tenantId !== b.tenantId || a.namespace.scope !== b.namespace.scope || a.namespace.id !== b.namespace.id) return undefined;
  if (explicitlyConflicts(a, b)) return `explicit|${[a.id, b.id].sort().join("|")}`;
  const left = conflictGroupKey(a), right = conflictGroupKey(b);
  return left && left === right ? left : undefined;
}
function winnerSort(a: MemorySearchResult, b: MemorySearchResult, freshnessPolicy: MemoryFreshnessPolicy): number {
  const ar = extractReliability(a.memory), br = extractReliability(b.memory);
  const status = (VERIFICATION_RANK[br.verificationStatus] ?? 3) - (VERIFICATION_RANK[ar.verificationStatus] ?? 3);
  if (status) return status;
  const freshness = freshnessPolicy.evaluate(b.memory).score - freshnessPolicy.evaluate(a.memory).score;
  if (freshness) return freshness;
  const confidence = (br.confidence ?? 0) - (ar.confidence ?? 0);
  if (confidence) return confidence;
  const evidence = br.evidenceCount - ar.evidenceCount;
  if (evidence) return evidence;
  if (b.score !== a.score) return b.score - a.score;
  const updated = Date.parse(b.memory.updatedAt) - Date.parse(a.memory.updatedAt);
  if (Number.isFinite(updated) && updated) return updated;
  return a.memory.id.localeCompare(b.memory.id);
}
function suppressionReason(winner: MemorySearchResult, loser: MemorySearchResult, freshnessPolicy: MemoryFreshnessPolicy): string {
  if (loser.memory.supersededByMemoryId === winner.memory.id || winner.memory.supersedesMemoryId === loser.memory.id) return "conflict_superseded_by_current";
  const wr = extractReliability(winner.memory), lr = extractReliability(loser.memory);
  if ((VERIFICATION_RANK[wr.verificationStatus] ?? 3) !== (VERIFICATION_RANK[lr.verificationStatus] ?? 3)) return "conflict_weaker_reliability";
  if ((wr.confidence ?? 0) !== (lr.confidence ?? 0)) return "conflict_lower_confidence";
  return freshnessPolicy.evaluate(loser.memory).score < freshnessPolicy.evaluate(winner.memory).score || Date.parse(loser.memory.updatedAt) < Date.parse(winner.memory.updatedAt)
    ? "conflict_older_canonical" : "conflict_weaker_reliability";
}
export class HybridMemoryRetriever implements MemoryRetriever {
  private readonly formatter: DefaultMemoryContextFormatter;
  private readonly weights: Scores;
  private readonly reliabilityScoring: boolean;
  private readonly freshnessPolicy: MemoryFreshnessPolicy;
  constructor(private readonly store: MemoryStore, private readonly options: HybridMemoryRetrieverOptions = {}) {
    this.formatter = options.formatter ?? new DefaultMemoryContextFormatter();
    this.weights = { semantic: .4, lexical: .35, recency: .08, importance: .1, context: .07, ...options.weights };
    if (Object.values(this.weights).some(n => !Number.isFinite(n) || n < 0) || Object.values(this.weights).every(n => n === 0)) throw new MemoryValidationError("Invalid memory scoring weights");
    for (const value of [options.embeddingTimeoutMs, options.recencyHalfLifeDays]) if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new MemoryValidationError("Invalid memory retrieval timing");
    if (options.semanticRelevanceThreshold !== undefined && (!Number.isFinite(options.semanticRelevanceThreshold) || options.semanticRelevanceThreshold <= 0 || options.semanticRelevanceThreshold > 1)) throw new MemoryValidationError("Invalid semantic relevance threshold");
    this.reliabilityScoring = options.reliabilityScoring !== false;
    this.freshnessPolicy = options.freshnessPolicy ?? new DeterministicFreshnessPolicy(undefined, this.options.now ?? Date.now);
  }
  async retrieve(query: MemoryRetrievalQuery, access: MemoryAccessContext): Promise<MemoryRetrievalResult> {
    requireNamespaces(query.namespaces, access);
    if (typeof query.text !== "string" || query.text.length > 16000 || (query.minScore !== undefined && (!Number.isFinite(query.minScore) || query.minScore < 0 || query.minScore > 1))) throw new MemoryValidationError("Invalid memory retrieval query");
    const start = Date.now(), now = (this.options.now ?? Date.now)();
    const diagnostics: MemoryRetrievalResult["diagnostics"] = { latencyMs: 0, embeddingLatencyMs: 0, candidateCount: 0, selectedCount: 0, deduplicatedCount: 0, warnings: [], candidates: [] };
    const limit = boundedInteger(query.limit, 8, 100), budget = boundedInteger(query.maxTokens, 2048, 100000);
    if (!query.namespaces.length || !query.text.trim() || !limit || !budget) return { results: [], diagnostics };
    const embeddingStart = Date.now();
    const embedding = await embedSafely(this.options.embeddingProvider, query.text, this.options.embeddingTimeoutMs ?? 1000);
    diagnostics.embeddingLatencyMs = Date.now() - embeddingStart;
    if (this.options.embeddingProvider && !embedding) diagnostics.warnings.push("Embedding unavailable; lexical retrieval used");
    const candidateLimit = Math.max(1, boundedInteger(this.options.candidateLimit, 200, 500));
    const base = { tenantId: access.tenantId, namespaces: query.namespaces, kinds: query.kinds, filters: query.filters, status: "active" as const, includeExpired: false, limit: candidateLimit };
    const kindCounts: Partial<Record<string, number>> = {};
    // Independent bounded lexical and vector pools prevent either modality starving the other.
    const queryWords = words(query.text), terms = [...queryWords].slice(0, 8);
    const termLimit = Math.max(1, Math.floor(candidateLimit / Math.max(1, terms.length)));
    const pools = await Promise.all(terms.map(text => this.store.search({ ...base, text, limit: termLimit })));
    const lexical = pools.flatMap(pool => pool.slice(0, termLimit));
    // A bounded recent pool also supports relevance carried by subject/title metadata.
    const recent = await this.store.search(base);
    let semantic: Memory[] = [];
    if (embedding) {
      try { semantic = await this.store.search({ ...base, embedding, embeddingMetadata: this.options.embeddingProvider!.metadata }); }
      catch { diagnostics.warnings.push("Semantic search unavailable; lexical retrieval used"); }
    }
    const uniqueIds = new Set<string>();
    const scored: MemorySearchResult[] = [];
    for (const memory of [...lexical.slice(0, candidateLimit), ...recent.slice(0, candidateLimit), ...semantic.slice(0, candidateLimit)]) {
      // Repeat all checks before scoring or diagnostics, even with an over-permissive adapter.
      if (!canAccessMemory(memory, access) || !query.namespaces.some(n => sameNamespace(n, memory.namespace)) || !isLive(memory, now) || (query.kinds && !query.kinds.includes(memory.kind)) || !matchesFilters(memory, query.filters) || uniqueIds.has(memory.id)) continue;
      uniqueIds.add(memory.id);
      const semanticScore = embedding && memory.embedding && sameEmbedding(memory.embeddingMetadata, this.options.embeddingProvider!.metadata) && validVector(memory.embedding, embedding.length) ? cosine(embedding, memory.embedding) : 0;
      const lexicalScore = overlap(queryWords, memory.content);
      const context = overlap(queryWords, [memory.subject, memory.title, memory.trigger, memory.lesson].filter(Boolean).join(" "));
      const age = Math.max(0, now - Date.parse(memory.updatedAt));
      const scores: Scores = { semantic: semanticScore, lexical: lexicalScore, context, importance: Math.max(0, Math.min(1, memory.importance)), recency: Number.isFinite(age) ? Math.pow(.5, age / (Math.max(.001, this.options.recencyHalfLifeDays ?? 30) * 86400000)) : 0 };
      const score = (Object.keys(scores) as (keyof Scores)[]).reduce((sum, key) => sum + scores[key] * this.weights[key], 0) / Object.values(this.weights).reduce((a, b) => a + b, 0);
      const relevant = lexicalScore > 0 || context > 0 || semanticScore >= Math.max(.01, this.options.semanticRelevanceThreshold ?? .65);
      // Phase 7 reliability-aware ranking: a multiplier in [0,1] that zeroes out
      // invalidated memories and down-ranks stale/disputed/contradicted ones.
      const reliabilityFactor = this.reliabilityScoring ? computeReliabilityFactor(memory, this.freshnessPolicy) : 1;
      const reliability = extractReliability(memory);
      const freshness = this.freshnessPolicy.evaluate(memory);
      kindCounts[memory.kind] = (kindCounts[memory.kind] ?? 0) + 1;
      diagnostics.candidates.push({ memoryId: memory.id, score: score * reliabilityFactor, reason: !relevant ? "irrelevant" : reliabilityFactor === 0 ? "invalidated" : score < (query.minScore ?? 0) ? "below_min_score" : "eligible", kind: memory.kind, reliabilityFactor, verificationStatus: reliability.verificationStatus, freshnessStatus: freshness.status, scores } as typeof diagnostics.candidates[number] & { verificationStatus: string; freshnessStatus: string });
      if (relevant && score >= (query.minScore ?? 0) && reliabilityFactor > 0) scored.push({ memory: publicMemory(memory), score: score * reliabilityFactor, scores, tokenCount: 0, reliabilityFactor });
    }
    diagnostics.candidateCount = uniqueIds.size;
    scored.sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));
    type ConflictDiagnostic = (typeof diagnostics.candidates)[number] & { conflictGroupId?: string; suppressedByMemoryId?: string };
    const diagnosticsById = new Map<string, ConflictDiagnostic>(diagnostics.candidates.map(candidate => [candidate.memoryId, candidate as ConflictDiagnostic]));
    const grouped = new Map<string, MemorySearchResult[]>();
    for (let i = 0; i < scored.length; i++) for (let j = i + 1; j < scored.length; j++) {
      const key = conflictKey(scored[i].memory, scored[j].memory);
      if (key) grouped.set(key, [...(grouped.get(key) ?? []), scored[i], scored[j]]);
    }
    const suppressed = new Set<string>();
    for (const [groupId, members] of grouped) {
      const unique = [...new Map(members.map(member => [member.memory.id, member])).values()];
      if (unique.length < 2) continue;
      const winner = [...unique].sort((a, b) => winnerSort(a, b, this.freshnessPolicy))[0];
      for (const loser of unique) {
        if (loser.memory.id === winner.memory.id) continue;
        suppressed.add(loser.memory.id);
        const diagnostic = diagnosticsById.get(loser.memory.id);
        if (diagnostic) {
          diagnostic.reason = suppressionReason(winner, loser, this.freshnessPolicy);
          diagnostic.conflictGroupId = groupId;
          diagnostic.suppressedByMemoryId = winner.memory.id;
        }
      }
      const winnerDiagnostic = diagnosticsById.get(winner.memory.id);
      if (winnerDiagnostic) winnerDiagnostic.conflictGroupId = groupId;
    }
    const conflictFree = scored.filter(item => !suppressed.has(item.memory.id));
    const seen = new Set<string>();
    const deduplicated = conflictFree.filter(item => {
      const key = normalizeContent(item.memory.content);
      if (seen.has(key)) { diagnostics.deduplicatedCount++; return false; }
      seen.add(key); return true;
    });
    const results = this.formatter.select(deduplicated, budget).slice(0, limit);
    diagnostics.selectedCount = results.length;
    diagnostics.latencyMs = Date.now() - start;
    diagnostics.retrievalMode = !this.options.embeddingProvider ? "lexical"
      : embedding && semantic.length ? "hybrid"
      : embedding ? "vector"
      : diagnostics.warnings.length ? "fallback" : "lexical";
    diagnostics.kinds = kindCounts;
    return { results, diagnostics };
  }
}
