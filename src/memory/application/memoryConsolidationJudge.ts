import type { ConsolidationConfig, ConsolidationDecision, MemoryConsolidationJudge, MemoryCandidate, Memory } from "../contracts";
import { resolveConsolidationConfig } from "./memoryConsolidationConfig";
import { normalizeContent, contentHash } from "./access";

const STOP_WORDS = new Set("a an and are as at be by for from how i in is it me my of on or our please tell that the this to we what with you about does do uses use".split(" "));
const STOP_WORDS_SMALL = new Set("a an the is are was were be been being have has had do does did will would shall should may might can could of in on at to for with by from as into through during before after above below between".split(" "));

function tokenize(text: string): string[] {
  return normalizeContent(text).split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS_SMALL.has(w));
}

/** Deterministic memory consolidation judge with configurable thresholds. */
export class DeterministicMemoryConsolidationJudge implements MemoryConsolidationJudge {
  private readonly config: Required<ConsolidationConfig>;
  constructor(config?: ConsolidationConfig) { this.config = resolveConsolidationConfig(config); }
  private normalizeSubject(text: string): string {
    return text.toLowerCase().replace(/[^\w\s]/gu, " ").replace(/\s+/gu, " ").trim();
  }
  private extractSubject(memory: Memory | MemoryCandidate): string {
    const parts = [memory.subject, memory.title, memory.content].filter(Boolean);
    return this.normalizeSubject(parts.join(" "));
  }
  private cosine(a: number[], b: number[]): number {
    const dot = a.reduce((n, x, i) => n + x * b[i], 0);
    const norm = Math.hypot(...a) * Math.hypot(...b);
    return norm && Number.isFinite(dot / norm) ? Math.max(0, Math.min(1, dot / norm)) : 0;
  }
  private subjectOverlap(a: string, b: string): number {
    const wordsA = new Set(a.split(" ").filter(Boolean));
    const wordsB = new Set(b.split(" ").filter(Boolean));
    if (!wordsA.size || !wordsB.size) return 0;
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    return intersection / Math.max(wordsA.size, wordsB.size);
  }
  /** Jaccard similarity over tokenized content (semantic-ish without embeddings). */
  private contentOverlap(a: string, b: string): number {
    const tokensA = new Set(tokenize(a));
    const tokensB = new Set(tokenize(b));
    if (!tokensA.size || !tokensB.size) return 0;
    const intersection = [...tokensA].filter(t => tokensB.has(t)).length;
    const union = new Set([...tokensA, ...tokensB]).size;
    return union > 0 ? intersection / union : 0;
  }
  private isProcedural(memory: Memory | MemoryCandidate): boolean { return memory.kind === "procedural"; }
  private isEpisodic(memory: Memory | MemoryCandidate): boolean { return memory.kind === "episodic"; }
  private hasExplicitSupersedes(incoming: MemoryCandidate): boolean {
    return !!incoming.supersedesMemoryId;
  }
  private detectTemporalReplacement(incoming: MemoryCandidate, existing: Memory): boolean {
    const temporalPatterns = /\b(?:migrated|changed|switched|replaced|updated|moved|converted|now uses|no longer uses)\b/i;
    const hasTemporal = temporalPatterns.test(incoming.content);
    const negationPatterns = /\b(?:no longer|not\s|do not|don't|shouldn't|wasn't|isn't)\b/i;
    const hasNegation = negationPatterns.test(incoming.content);
    return hasTemporal || hasNegation;
  }
  /** Combined score: uses embeddings when available, falls back to content overlap. */
  private combinedScore(incoming: MemoryCandidate, candidate: Memory): number {
    const incomingEmbedding = (incoming as unknown as { embedding?: number[] })?.embedding;
    let semanticScore = 0;
    if (incomingEmbedding && candidate.embedding &&
        incomingEmbedding.length === candidate.embedding.length) {
      semanticScore = this.cosine(incomingEmbedding, candidate.embedding);
    }
    const lexicalScore = this.contentOverlap(incoming.content, candidate.content);
    const incomingSubject = this.extractSubject(incoming);
    const existingSubject = this.extractSubject(candidate);
    const subjectScore = this.subjectOverlap(incomingSubject, existingSubject);
    // Weight: semantic 50%, lexical 30%, subject 20%
    if (semanticScore > 0) {
      return semanticScore * 0.5 + lexicalScore * 0.3 + subjectScore * 0.2;
    }
    // Without embeddings: use lexical + subject overlap only
    return lexicalScore * 0.6 + subjectScore * 0.4;
  }
  async decide(incoming: MemoryCandidate, existing: Memory[]): Promise<ConsolidationDecision> {
    // Candidates should already be filtered by the engine to be from the same tenant/namespace/kind
    const candidates = existing.filter(m =>
      m.kind === incoming.kind &&
      m.status === "active" &&
      m.id !== incoming.supersedesMemoryId
    );
    if (!candidates.length) {
      return { type: "keep_both", relatedMemoryIds: [], reason: "no_candidates" };
    }
    const incomingHash = contentHash(incoming.content);
    const exactMatch = candidates.find(c => c.contentHash === incomingHash);
    if (exactMatch) {
      return {
        type: "ignore_new",
        canonicalMemoryId: exactMatch.id,
        relatedMemoryIds: [exactMatch.id],
        reason: "exact_content_match",
        confidence: 1.0,
      };
    }
    // Score all candidates with combined scoring
    const scored: { memory: Memory; score: number }[] = candidates.map(memory => ({
      memory,
      score: this.combinedScore(incoming, memory),
    }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best.score >= this.config.autoMergeThreshold) {
      if (this.hasExplicitSupersedes(incoming)) {
        return {
          type: "supersede",
          canonicalMemoryId: undefined,
          relatedMemoryIds: [best.memory.id],
          reason: "explicit_supersedes",
          confidence: best.score,
        };
      }
      if (this.detectTemporalReplacement(incoming, best.memory)) {
        return {
          type: "supersede",
          canonicalMemoryId: undefined,
          relatedMemoryIds: [best.memory.id],
          reason: "temporal_replacement",
          confidence: best.score,
        };
      }
      if (this.isEpisodic(incoming) || this.isProcedural(incoming)) {
        if (incoming.procedure !== best.memory.procedure || incoming.trigger !== best.memory.trigger) {
          return {
            type: "keep_both",
            relatedMemoryIds: [best.memory.id],
            reason: `${incoming.kind}_different_trigger_or_procedure`,
            confidence: best.score,
          };
        }
      }
      return {
        type: "merge",
        canonicalMemoryId: best.memory.id,
        relatedMemoryIds: scored.filter(s => s.score >= this.config.autoMergeThreshold).map(s => s.memory.id),
        reason: "high_semantic_similarity",
        confidence: best.score,
        mergedMemory: this.createMergedCandidate(incoming, best.memory),
      };
    }
    if (best.score >= this.config.semanticCandidateThreshold) {
      if (this.isEpisodic(incoming)) {
        return {
          type: "keep_both",
          relatedMemoryIds: [best.memory.id],
          reason: "episodic_distinct_events",
          confidence: best.score,
        };
      }
      if (this.isProcedural(incoming) && (incoming.procedure !== best.memory.procedure || incoming.trigger !== best.memory.trigger)) {
        return {
          type: "keep_both",
          relatedMemoryIds: [best.memory.id],
          reason: "procedural_different_trigger",
          confidence: best.score,
        };
      }
      if (best.score >= this.config.reviewThreshold) {
        return {
          type: "merge",
          canonicalMemoryId: best.memory.id,
          relatedMemoryIds: scored.filter(s => s.score >= this.config.reviewThreshold).map(s => s.memory.id),
          reason: "medium_semantic_similarity",
          confidence: best.score,
          mergedMemory: this.createMergedCandidate(incoming, best.memory),
        };
      }
      return {
        type: "keep_both",
        relatedMemoryIds: [best.memory.id],
        reason: "low_semantic_similarity",
        confidence: best.score,
      };
    }
    return { type: "keep_both", relatedMemoryIds: [], reason: "no_similar_candidates" };
  }
  private createMergedCandidate(incoming: MemoryCandidate, existing: Memory): MemoryCandidate {
    const parts = [existing.content.trim(), incoming.content.trim()];
    const uniqueParts = [...new Set(parts.map(p => normalizeContent(p)))];
    const mergedContent = uniqueParts.length === 1
      ? parts[0]
      : parts.filter((p, i) => i === 0 || !normalizeContent(parts[0]).includes(normalizeContent(p))).join("; ");
    return {
      ...incoming,
      content: mergedContent.trim(),
      importance: Math.max(existing.importance, incoming.importance ?? 0.5),
      confidence: incoming.confidence ?? existing.confidence,
      metadata: { ...existing.metadata, ...incoming.metadata, mergedFromMemoryIds: [existing.id] },
    };
  }
}

/** Fake judge for deterministic CI testing. */
export class FakeMemoryConsolidationJudge implements MemoryConsolidationJudge {
  private readonly decisions: Map<string, ConsolidationDecision>;
  constructor(decisions?: Map<string, ConsolidationDecision>) {
    this.decisions = decisions ?? new Map();
  }
  setDecision(memoryId: string, decision: ConsolidationDecision): void { this.decisions.set(memoryId, decision); }
  async decide(incoming: MemoryCandidate, existing: Memory[]): Promise<ConsolidationDecision> {
    const key = `${contentHash(incoming.content)}:${existing.map(e => e.id).join(",")}`;
    const fixed = this.decisions.get(incoming.content) ?? this.decisions.get(key);
    if (fixed) return fixed;
    const hash = contentHash(incoming.content);
    const exact = existing.find(e => e.contentHash === hash);
    if (exact) return {
      type: "ignore_new",
      canonicalMemoryId: exact.id,
      relatedMemoryIds: [exact.id],
      reason: "exact_content_match",
      confidence: 1.0,
    };
    return { type: "keep_both", relatedMemoryIds: [], reason: "no_match" };
  }
}
