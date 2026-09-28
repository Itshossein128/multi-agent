import type { EmbeddingProvider, Memory, MemoryAccessContext, MemoryRetrievalQuery, MemoryRetrievalResult, MemoryRetriever, MemoryStore } from "../contracts";
import { MemoryValidationError } from "../contracts";
import type { MemorySearchResult, CandidateSource } from "@multi-agent/types";
import { boundedInteger, canAccessMemory, isLive, matchesFilters, normalizeContent, publicMemory, requireNamespaces, sameNamespace } from "./access";
import { embedSafely, sameEmbedding, validVector } from "./embedding";
import { computeReliabilityFactor, DeterministicFreshnessPolicy, extractReliability, type MemoryFreshnessPolicy } from "./memoryReliability";
import { DefaultMemoryContextFormatter } from "./memoryContextFormatter";
import { classifyMemoryRelationship, conflictGroupKey } from "./memoryConflictStrategy";
import { DefaultMemoryQueryExpander, evaluateMemoryMatch, type MemoryQueryExpander, STOP_WORDS } from "./queryExpansion";
import { extractSemanticFact } from "./semanticFact";

type Scores = MemorySearchResult["scores"];
export interface HybridMemoryRetrieverOptions {
  embeddingProvider?: EmbeddingProvider; embeddingTimeoutMs?: number;
  candidateLimit?: number; weights?: Partial<Scores>; semanticRelevanceThreshold?: number;
  recencyHalfLifeDays?: number; formatter?: DefaultMemoryContextFormatter; now?: () => number;
  /** Phase 7 reliability-aware ranking; on by default so invalidated memories never rank. */
  reliabilityScoring?: boolean; freshnessPolicy?: MemoryFreshnessPolicy;
  /** Phase 7 query expansion & vocabulary normalizer. */
  queryExpander?: MemoryQueryExpander;
  /** Phase 10: Diagnostic ablation modes for evaluation */
  ablationMode?: "full_hybrid" | "semantic_only" | "expansion_only" | "embedding_only";
}
function words(text: string): Set<string> { return new Set((normalizeContent(text).match(/[\p{L}\p{N}_]+/gu) ?? []).filter(w => !STOP_WORDS.has(w))); }
function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((n, x, i) => n + x * b[i], 0);
  const norm = Math.hypot(...a) * Math.hypot(...b);
  return norm && Number.isFinite(dot / norm) ? Math.max(0, Math.min(1, dot / norm)) : 0;
}
const VERIFICATION_RANK: Record<string, number> = { verified: 4, unverified: 3, stale: 2, disputed: 1, invalidated: 0 };
const KIND_RANK: Record<Memory["kind"], number> = { procedural: 3, semantic: 2, episodic: 1 };
function conflictKey(a: Memory, b: Memory, query?: MemoryRetrievalQuery): string | undefined {
  if (a.kind !== b.kind || a.tenantId !== b.tenantId || a.namespace.scope !== b.namespace.scope || a.namespace.id !== b.namespace.id) return undefined;
  const key = conflictGroupKey(a, b, query);
  return key ? `${a.tenantId}|${a.namespace.scope}:${a.namespace.id}|${key}` : undefined;
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
  const factWinner = winner.memory.kind === "semantic" ? extractSemanticFact(winner.memory) : undefined;
  const factLoser = loser.memory.kind === "semantic" ? extractSemanticFact(loser.memory) : undefined;
  if (factWinner && factLoser && factWinner.temporalScope === "current" && factLoser.temporalScope === "historical") {
    return "same_fact_newer_value";
  }
  const wr = extractReliability(winner.memory), lr = extractReliability(loser.memory);
  if ((VERIFICATION_RANK[wr.verificationStatus] ?? 3) !== (VERIFICATION_RANK[lr.verificationStatus] ?? 3)) return "conflict_weaker_reliability";
  if ((wr.confidence ?? 0) !== (lr.confidence ?? 0)) return "conflict_lower_confidence";
  return freshnessPolicy.evaluate(loser.memory).score < freshnessPolicy.evaluate(winner.memory).score || Date.parse(loser.memory.updatedAt) < Date.parse(winner.memory.updatedAt)
    ? "same_fact_newer_value" : "conflict_weaker_reliability";
}
export class HybridMemoryRetriever implements MemoryRetriever {
  private readonly formatter: DefaultMemoryContextFormatter;
  private readonly weights: Scores;
  private readonly reliabilityScoring: boolean;
  private readonly freshnessPolicy: MemoryFreshnessPolicy;
  private readonly queryExpander: MemoryQueryExpander;
  constructor(private readonly store: MemoryStore, private readonly options: HybridMemoryRetrieverOptions = {}) {
    this.formatter = options.formatter ?? new DefaultMemoryContextFormatter();
    this.weights = { semantic: .4, lexical: .35, recency: .08, importance: .1, context: .07, ...options.weights };
    if (Object.values(this.weights).some(n => !Number.isFinite(n) || n < 0) || Object.values(this.weights).every(n => n === 0)) throw new MemoryValidationError("Invalid memory scoring weights");
    for (const value of [options.embeddingTimeoutMs, options.recencyHalfLifeDays]) if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new MemoryValidationError("Invalid memory retrieval timing");
    if (options.semanticRelevanceThreshold !== undefined && (!Number.isFinite(options.semanticRelevanceThreshold) || options.semanticRelevanceThreshold <= 0 || options.semanticRelevanceThreshold > 1)) throw new MemoryValidationError("Invalid semantic relevance threshold");
    this.reliabilityScoring = options.reliabilityScoring !== false;
    this.freshnessPolicy = options.freshnessPolicy ?? new DeterministicFreshnessPolicy(undefined, this.options.now ?? Date.now);
    this.queryExpander = options.queryExpander ?? new DefaultMemoryQueryExpander();
  }
  async retrieve(query: MemoryRetrievalQuery, access: MemoryAccessContext): Promise<MemoryRetrievalResult> {
    requireNamespaces(query.namespaces, access);
    if (typeof query.text !== "string" || query.text.length > 16000 || (query.minScore !== undefined && (!Number.isFinite(query.minScore) || query.minScore < 0 || query.minScore > 1))) throw new MemoryValidationError("Invalid memory retrieval query");
    const start = Date.now(), now = (this.options.now ?? Date.now)();
    const diagnostics: MemoryRetrievalResult["diagnostics"] = { latencyMs: 0, embeddingLatencyMs: 0, candidateCount: 0, selectedCount: 0, deduplicatedCount: 0, warnings: [], securityViolations: 0, filteredCounts: { unauthorized: 0, expired: 0, superseded: 0, invalidated: 0 }, conflict: { groups: 0, candidates: 0, suppressed: 0, staleSuppressed: 0, disputedSuppressed: 0, unresolved: 0 }, candidates: [] };
    const limit = boundedInteger(query.limit, 8, 100), budget = boundedInteger(query.maxTokens, 2048, 100000);
    if (!query.namespaces.length || !query.text.trim() || !limit || !budget) return { results: [], diagnostics };
    const ablation = this.options.ablationMode ?? "full_hybrid";
    const rawExpanded = this.queryExpander.expand(query.text);
    const expandedQuery = ablation === "embedding_only" || ablation === "semantic_only"
      ? { ...rawExpanded, searchTerms: [query.text] }
      : rawExpanded;

    let embedding: number[] | undefined;
    let embeddingErrorCode: string | undefined;
    let embeddingCacheHit = false;

    if (this.options.embeddingProvider && ablation !== "expansion_only") {
      const embeddingStart = Date.now();
      const initialHits = (this.options.embeddingProvider as any).getStats?.().cacheHits ?? 0;
      embedding = await embedSafely(this.options.embeddingProvider, query.text, this.options.embeddingTimeoutMs ?? 1000);
      diagnostics.embeddingLatencyMs = Date.now() - embeddingStart;
      const postHits = (this.options.embeddingProvider as any).getStats?.().cacheHits ?? 0;
      embeddingCacheHit = postHits > initialHits;
      if (!embedding) {
        diagnostics.warnings.push("Embedding unavailable; lexical retrieval used");
        embeddingErrorCode = "EMBEDDING_UNAVAILABLE";
      }
    }

    diagnostics.embeddingProvider = this.options.embeddingProvider?.metadata.provider;
    diagnostics.embeddingModel = this.options.embeddingProvider?.metadata.model;
    diagnostics.embeddingVersion = this.options.embeddingProvider?.metadata.version;
    diagnostics.embeddingCacheHit = embeddingCacheHit;
    if (embeddingErrorCode) diagnostics.embeddingErrorCode = embeddingErrorCode;

    const candidateLimit = Math.max(1, boundedInteger(this.options.candidateLimit, 200, 500));
    const base = { tenantId: access.tenantId, namespaces: query.namespaces, kinds: query.kinds, filters: query.filters, status: "active" as const, includeExpired: false, limit: candidateLimit };
    const kindCounts: Partial<Record<string, number>> = {};
    // Track candidate source channels: lexical, alias, concept, structured, semantic
    const memorySources = new Map<string, Set<string>>();
    const recordSource = (id: string, src: string) => {
      let set = memorySources.get(id);
      if (!set) { set = new Set(); memorySources.set(id, set); }
      set.add(src);
    };

    let lexical: Memory[] = [];
    let recent: Memory[] = [];

    if (ablation !== "semantic_only") {
      // Bounded lexical search across original query words and top expanded alias/concept terms
      const terms = expandedQuery.searchTerms.slice(0, 10);
    const pools = await Promise.all(terms.map(async text => {
      const pool = await this.store.search({ ...base, text, limit: candidateLimit });
      const src = expandedQuery.queryWords.has(text) ? "lexical"
        : expandedQuery.aliases.has(text) ? "alias"
        : expandedQuery.concepts.has(text) ? "concept" : "expanded_lexical";
      for (const m of pool) recordSource(m.id, src);
      return pool;
    }));
      lexical = pools.flatMap(pool => pool.slice(0, candidateLimit));
      // A bounded recent pool also supports relevance carried by subject/title metadata.
      recent = await this.store.search(base);
      for (const m of recent) recordSource(m.id, "structured");
    }
    let semantic: Memory[] = [];
    if (embedding) {
      const vectorSearchStart = Date.now();
      try {
        semantic = await this.store.search({ ...base, embedding, embeddingMetadata: this.options.embeddingProvider!.metadata });
        for (const m of semantic) recordSource(m.id, "semantic");
      }
      catch { diagnostics.warnings.push("Semantic search unavailable; lexical retrieval used"); }
      finally {
        diagnostics.vectorSearchMs = Date.now() - vectorSearchStart;
      }
    }
    const uniqueIds = new Set<string>();
    const scored: MemorySearchResult[] = [];
    for (const memory of [...lexical.slice(0, candidateLimit), ...recent.slice(0, candidateLimit), ...semantic.slice(0, candidateLimit)]) {
      // Repeat all checks before scoring or diagnostics, even with an over-permissive adapter.
      if (!canAccessMemory(memory, access)) { diagnostics.filteredCounts!.unauthorized++; diagnostics.securityViolations!++; continue; }
      if (!query.namespaces.some(n => sameNamespace(n, memory.namespace))) { diagnostics.filteredCounts!.unauthorized++; diagnostics.securityViolations!++; continue; }
      if (memory.status === "superseded") { diagnostics.filteredCounts!.superseded++; continue; }
      if (memory.expiresAt && Date.parse(memory.expiresAt) <= now) { diagnostics.filteredCounts!.expired++; continue; }
      if (!isLive(memory, now) || (query.kinds && !query.kinds.includes(memory.kind)) || !matchesFilters(memory, query.filters) || uniqueIds.has(memory.id)) continue;
      uniqueIds.add(memory.id);
      const semanticScore = embedding && memory.embedding && sameEmbedding(memory.embeddingMetadata, this.options.embeddingProvider!.metadata) && validVector(memory.embedding, embedding.length) ? cosine(embedding, memory.embedding) : 0;
      const matchEval = evaluateMemoryMatch(expandedQuery, memory, semanticScore, this.options.semanticRelevanceThreshold ?? .65);
      const age = Math.max(0, now - Date.parse(memory.updatedAt));
      const recency = Number.isFinite(age) ? Math.pow(.5, age / (Math.max(.001, this.options.recencyHalfLifeDays ?? 30) * 86400000)) : 0;
      const importance = Math.max(0, Math.min(1, memory.importance));
      const scores: Scores = {
        semantic: semanticScore,
        lexical: matchEval.effectiveLexicalScore,
        context: matchEval.contextScore,
        importance,
        recency,
        structured: matchEval.structuredScore,
      };
      const score = (Object.keys(scores) as (keyof Scores)[]).reduce((sum, key) => sum + (scores[key] ?? 0) * (this.weights[key] ?? 0), 0) / Object.values(this.weights).reduce((a, b) => a + b, 0);
      const relevant = matchEval.isRelevant;

      // Enrich source channels with match signals
      if (matchEval.matchReasons.includes("structured_match")) recordSource(memory.id, "structured");
      if (matchEval.matchReasons.includes("semantic_match")) recordSource(memory.id, "semantic");
      if (matchEval.matchReasons.includes("lexical_match")) recordSource(memory.id, "lexical");
      if (matchEval.matchReasons.includes("alias_match")) recordSource(memory.id, "alias");
      if (matchEval.matchReasons.includes("expanded_term_match")) recordSource(memory.id, "concept");

      const rawSources = Array.from(memorySources.get(memory.id) ?? ["lexical"]);
      const candidateSource: CandidateSource = rawSources.length > 1 ? "multiple"
        : rawSources.includes("semantic") ? "semantic"
        : rawSources.includes("structured") ? "structured"
        : rawSources.includes("alias") ? "alias"
        : rawSources.includes("concept") ? "concept"
        : rawSources.includes("expanded_lexical") ? "expanded_lexical"
        : "lexical";

      // Phase 7 reliability-aware ranking: a multiplier in [0,1] that zeroes out
      // invalidated memories and down-ranks stale/disputed/contradicted ones.
      const reliabilityFactor = this.reliabilityScoring ? computeReliabilityFactor(memory, this.freshnessPolicy) : 1;
      const reliability = extractReliability(memory);
      const freshness = this.freshnessPolicy.evaluate(memory);
      if (reliability.verificationStatus === "invalidated") diagnostics.filteredCounts!.invalidated++;
      kindCounts[memory.kind] = (kindCounts[memory.kind] ?? 0) + 1;
      const fact = memory.kind === "semantic" ? extractSemanticFact(memory) : undefined;

      const isLowConfidence = !relevant || (
        matchEval.literalContentOverlap === 0 &&
        matchEval.structuredScore === 0 &&
        matchEval.semanticScore < (this.options.semanticRelevanceThreshold ?? 0.65) &&
        matchEval.effectiveLexicalScore < 0.25
      );

      const dropReason = reliabilityFactor === 0
        ? "invalidated"
        : isLowConfidence
          ? "candidate_pruned_low_confidence"
          : undefined;

      diagnostics.candidates.push({
        memoryId: memory.id,
        score: score * reliabilityFactor,
        reason: !relevant ? "irrelevant" : isLowConfidence ? "low_confidence" : reliabilityFactor === 0 ? "invalidated" : score < (query.minScore ?? 0) ? "below_min_score" : "eligible",
        dropReason,
        kind: memory.kind,
        reliabilityFactor,
        verificationStatus: reliability.verificationStatus,
        freshnessStatus: freshness.status,
        scores,
        matchReasons: matchEval.matchReasons,
        factSubject: fact?.subject,
        factProperty: fact?.property,
        factValue: fact?.value,
        candidateSource,
        sources: rawSources,
      } as typeof diagnostics.candidates[number] & { verificationStatus: string; freshnessStatus: string });

      if (relevant && !isLowConfidence && score >= (query.minScore ?? 0) && reliabilityFactor > 0) {
        scored.push({
          memory: publicMemory(memory),
          score: score * reliabilityFactor,
          scores,
          tokenCount: 0,
          reliabilityFactor,
          matchReasons: matchEval.matchReasons,
        });
      }
    }
    diagnostics.candidateCount = uniqueIds.size;
    scored.sort((a, b) => b.score - a.score || KIND_RANK[b.memory.kind] - KIND_RANK[a.memory.kind] || a.memory.id.localeCompare(b.memory.id));
    type ConflictDiagnostic = (typeof diagnostics.candidates)[number] & { conflictGroupId?: string; suppressedByMemoryId?: string };
    const diagnosticsById = new Map<string, ConflictDiagnostic>(diagnostics.candidates.map(candidate => [candidate.memoryId, candidate as ConflictDiagnostic]));
    const grouped = new Map<string, MemorySearchResult[]>();
    for (let i = 0; i < scored.length; i++) for (let j = i + 1; j < scored.length; j++) {
      const key = conflictKey(scored[i].memory, scored[j].memory, query);
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
          diagnostic.dropReason = diagnostic.reason === "conflict_superseded_by_current" ? "explicit_superseded" : "conflict_suppressed";
          diagnostic.conflictGroupId = groupId;
          diagnostic.suppressedByMemoryId = winner.memory.id;
        }
      }
      const winnerDiagnostic = diagnosticsById.get(winner.memory.id);
      if (winnerDiagnostic) winnerDiagnostic.conflictGroupId = groupId;
    }
    const suppressedByKind: Partial<Record<Memory["kind"], number>> = {};
    let conflictPairsDetected = 0;
    for (const members of grouped.values()) {
      const unique = [...new Map(members.map(member => [member.memory.id, member])).values()];
      if (unique.length >= 2) conflictPairsDetected += (unique.length * (unique.length - 1)) / 2;
    }
    const conflictMetrics = {
      groups: grouped.size,
      candidates: 0,
      suppressed: suppressed.size,
      staleSuppressed: 0,
      disputedSuppressed: 0,
      unresolved: 0,
      suppressedByKind,
      detected: conflictPairsDetected,
      resolved: suppressed.size,
      falseSuppressed: 0,
    };
    for (const members of grouped.values()) {
      const unique = [...new Map(members.map(member => [member.memory.id, member])).values()];
      conflictMetrics.candidates += unique.length;
      for (const loser of unique) if (suppressed.has(loser.memory.id)) {
        suppressedByKind[loser.memory.kind] = (suppressedByKind[loser.memory.kind] ?? 0) + 1;
        const status = extractReliability(loser.memory).verificationStatus;
        if (status === "stale") conflictMetrics.staleSuppressed++;
        if (status === "disputed") conflictMetrics.disputedSuppressed++;
      }
    }
    diagnostics.conflict = conflictMetrics;
    const conflictFree = scored.filter(item => !suppressed.has(item.memory.id));
    const seen = new Set<string>();
    const deduplicated = conflictFree.filter(item => {
      const duplicate = [...seen].some(id => {
        const prior = conflictFree.find(candidate => candidate.memory.id === id);
        return !!prior && classifyMemoryRelationship(item.memory, prior.memory) === "duplicate";
      });
      if (duplicate) {
        diagnostics.deduplicatedCount++;
        const diagnostic = diagnosticsById.get(item.memory.id);
        if (diagnostic) diagnostic.dropReason = "exact_duplicate";
        return false;
      }
      seen.add(item.memory.id); return true;
    });
    const formattingStart = Date.now();
    const results = this.formatter.select(deduplicated, budget).slice(0, limit);
    const selectedIds = new Set(results.map(result => result.memory.id));
    const selectedLessons = new Set(results.filter(r => r.memory.kind === "episodic" && r.memory.lesson).map(r => r.memory.lesson!.trim().toLowerCase()));
    for (const item of deduplicated) if (!selectedIds.has(item.memory.id)) {
      const diagnostic = diagnosticsById.get(item.memory.id);
      if (diagnostic && !diagnostic.dropReason) {
        if (item.memory.kind === "episodic" && item.memory.lesson && selectedLessons.has(item.memory.lesson.trim().toLowerCase())) {
          diagnostic.dropReason = "budget_diversity_drop";
          diagnostic.reason = "budget_diversity_redundant";
        } else {
          diagnostic.dropReason = "budget_dropped";
        }
      }
    }

    let lexicalCandidates = 0;
    let semanticCandidates = 0;
    let structuredCandidates = 0;
    let expandedTermCandidates = 0;
    let multiSignalCandidates = 0;
    for (const candidate of diagnostics.candidates) {
      const s = candidate.sources ?? [];
      if (s.includes("lexical")) lexicalCandidates++;
      if (s.includes("semantic")) semanticCandidates++;
      if (s.includes("structured")) structuredCandidates++;
      if (s.includes("alias") || s.includes("concept") || s.includes("expanded_lexical")) expandedTermCandidates++;
      if (s.length > 1 || candidate.candidateSource === "multiple") multiSignalCandidates++;
    }
    diagnostics.candidateSources = {
      lexicalCandidates,
      semanticCandidates,
      structuredCandidates,
      expandedTermCandidates,
      multiSignalCandidates,
    };
    diagnostics.queryIntent = expandedQuery.queryIntent;

    diagnostics.formattingLatencyMs = Date.now() - formattingStart;
    diagnostics.selectedCount = results.length;
    diagnostics.latencyMs = Date.now() - start;
    diagnostics.retrievalMode = ablation === "semantic_only" ? "vector"
      : ablation === "expansion_only" ? "lexical"
      : !this.options.embeddingProvider ? "lexical"
      : embedding && semantic.length ? "hybrid"
      : embedding ? "vector"
      : diagnostics.warnings.length ? "fallback" : "lexical";
    diagnostics.kinds = kindCounts;
    return { results, diagnostics };
  }
}
