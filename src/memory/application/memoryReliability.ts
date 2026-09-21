import type { Memory, MemoryCandidate, MemoryAccessContext, MemoryNamespace, MemoryService, MemoryStore, MemoryStoreQuery } from "../contracts";
import { contentHash, isLive } from "./access";

// ─── Reliability Model ───────────────────────────────────────────────────────

export type VerificationStatus = "unverified" | "verified" | "stale" | "disputed" | "invalidated";
export type FreshnessStatus = "fresh" | "aging" | "stale" | "expired";
export type ConflictRelation = "duplicate" | "compatible" | "temporal_successor" | "contradiction" | "uncertain";

export interface MemoryReliability {
  confidence: number;
  verificationStatus: VerificationStatus;
  validFrom?: string;
  validUntil?: string;
  lastVerifiedAt?: string;
  verificationCount?: number;
  reinforcementCount: number;
  contradictionCount: number;
  evidenceCount: number;
  evidenceRefs: string[];
}

export interface MemoryFreshnessResult {
  status: FreshnessStatus;
  reason: string;
  score: number;
}

export interface MemoryConflictResult {
  memoryId: string;
  relation: ConflictRelation;
  confidence: number;
  reason: string;
}

export interface MemoryVerification {
  at: string;
  sourceType: string;
  sourceRef?: string;
  result: "confirmed" | "rejected" | "inconclusive";
  verifier?: string;
}

// ─── Metadata Keys ───────────────────────────────────────────────────────────

export const RELIABILITY_KEYS = {
  verificationStatus: "__reliability_verification_status",
  validFrom: "__reliability_valid_from",
  validUntil: "__reliability_valid_until",
  lastVerifiedAt: "__reliability_last_verified_at",
  verificationCount: "__reliability_verification_count",
  contradictionCount: "__reliability_contradiction_count",
  evidenceCount: "__reliability_evidence_count",
  evidenceRefs: "__reliability_evidence_refs",
  verificationHistory: "__reliability_verification_history",
  conflictWithMemoryIds: "__reliability_conflict_with",
  freshnessStatus: "__reliability_freshness_status",
  lastFreshnessCheck: "__reliability_last_freshness_check",
  origin: "__reliability_origin",
} as const;

// ─── Extract Reliability from Memory ─────────────────────────────────────────

export function extractReliability(memory: Memory): MemoryReliability {
  const meta = memory.metadata ?? {};
  return {
    confidence: memory.confidence ?? 0.5,
    verificationStatus: (meta[RELIABILITY_KEYS.verificationStatus] as VerificationStatus) ?? "unverified",
    validFrom: meta[RELIABILITY_KEYS.validFrom] as string | undefined,
    validUntil: meta[RELIABILITY_KEYS.validUntil] as string | undefined,
    lastVerifiedAt: meta[RELIABILITY_KEYS.lastVerifiedAt] as string | undefined,
    verificationCount: meta[RELIABILITY_KEYS.verificationCount] as number | undefined,
    reinforcementCount: memory.reinforcementCount ?? 0,
    contradictionCount: (meta[RELIABILITY_KEYS.contradictionCount] as number) ?? 0,
    evidenceCount: (meta[RELIABILITY_KEYS.evidenceCount] as number) ?? 0,
    evidenceRefs: (meta[RELIABILITY_KEYS.evidenceRefs] as string[]) ?? [],
  };
}

// ─── Set Reliability Metadata on Memory ──────────────────────────────────────

export function setReliabilityMetadata(memory: Memory, reliability: Partial<MemoryReliability>): Memory {
  const meta = { ...memory.metadata };
  if (reliability.verificationStatus !== undefined) meta[RELIABILITY_KEYS.verificationStatus] = reliability.verificationStatus;
  if (reliability.validFrom !== undefined) meta[RELIABILITY_KEYS.validFrom] = reliability.validFrom;
  if (reliability.validUntil !== undefined) meta[RELIABILITY_KEYS.validUntil] = reliability.validUntil;
  if (reliability.lastVerifiedAt !== undefined) meta[RELIABILITY_KEYS.lastVerifiedAt] = reliability.lastVerifiedAt;
  if (reliability.verificationCount !== undefined) meta[RELIABILITY_KEYS.verificationCount] = reliability.verificationCount;
  if (reliability.contradictionCount !== undefined) meta[RELIABILITY_KEYS.contradictionCount] = reliability.contradictionCount;
  if (reliability.evidenceCount !== undefined) meta[RELIABILITY_KEYS.evidenceCount] = reliability.evidenceCount;
  if (reliability.evidenceRefs !== undefined) meta[RELIABILITY_KEYS.evidenceRefs] = reliability.evidenceRefs;
  return { ...memory, metadata: meta };
}

// ─── Freshness Policy ────────────────────────────────────────────────────────

export interface MemoryFreshnessPolicy {
  evaluate(memory: Memory): MemoryFreshnessResult;
}

/** Freshness config per memory kind (in milliseconds). */
export interface FreshnessConfig {
  semanticFreshMs: number;
  semanticAgingMs: number;
  proceduralFreshMs: number;
  proceduralAgingMs: number;
  // Episodic memories don't expire — historical events remain valid
}

export const DEFAULT_FRESHNESS_CONFIG: FreshnessConfig = {
  semanticFreshMs: 30 * 24 * 60 * 60 * 1000,    // 30 days fresh
  semanticAgingMs: 90 * 24 * 60 * 60 * 1000,    // 90 days aging
  proceduralFreshMs: 60 * 24 * 60 * 60 * 1000,  // 60 days fresh
  proceduralAgingMs: 180 * 24 * 60 * 60 * 1000, // 180 days aging
};

export class DeterministicFreshnessPolicy implements MemoryFreshnessPolicy {
  constructor(private readonly config: FreshnessConfig = DEFAULT_FRESHNESS_CONFIG, private readonly now: () => number = () => Date.now()) {}

  evaluate(memory: Memory): MemoryFreshnessResult {
    const now = this.now();
    const age = now - Date.parse(memory.updatedAt ?? memory.createdAt);

    // Episodic memories: historical events don't become stale
    if (memory.kind === "episodic") {
      return { status: "fresh", reason: "episodic_historical", score: 1.0 };
    }

    // Check explicit validity windows
    const validUntil = memory.metadata?.[RELIABILITY_KEYS.validUntil] as string | undefined;
    if (validUntil && Date.parse(validUntil) <= now) {
      return { status: "expired", reason: "valid_until_exceeded", score: 0 };
    }

    const validFrom = memory.metadata?.[RELIABILITY_KEYS.validFrom] as string | undefined;
    if (validFrom && Date.parse(validFrom) > now) {
      return { status: "stale", reason: "not_yet_valid", score: 0.2 };
    }

    // Kind-specific freshness thresholds
    if (memory.kind === "semantic") {
      if (age <= this.config.semanticFreshMs) return { status: "fresh", reason: "within_fresh_window", score: 1.0 };
      if (age <= this.config.semanticAgingMs) return { status: "aging", reason: "past_fresh_window", score: 0.7 };
      return { status: "stale", reason: "past_aging_window", score: 0.3 };
    }

    if (memory.kind === "procedural") {
      if (age <= this.config.proceduralFreshMs) return { status: "fresh", reason: "within_fresh_window", score: 1.0 };
      if (age <= this.config.proceduralAgingMs) return { status: "aging", reason: "past_fresh_window", score: 0.7 };
      return { status: "stale", reason: "past_aging_window", score: 0.3 };
    }

    return { status: "fresh", reason: "default", score: 0.8 };
  }
}

// ─── Confidence Policy ───────────────────────────────────────────────────────

export interface MemoryConfidencePolicy {
  compute(input: { reliability: MemoryReliability; freshness: MemoryFreshnessResult; kind: string }): number;
}

export class DeterministicConfidencePolicy implements MemoryConfidencePolicy {
  compute(input: { reliability: MemoryReliability; freshness: MemoryFreshnessResult; kind: string }): number {
    const { reliability, freshness, kind } = input;

    // Base confidence from reliability
    let confidence = reliability.confidence;

    // Verification adjustment
    const verificationBonus: Record<VerificationStatus, number> = {
      verified: 0.15,
      unverified: 0,
      stale: -0.1,
      disputed: -0.2,
      invalidated: -0.5,
    };
    confidence += verificationBonus[reliability.verificationStatus] ?? 0;

    // Freshness adjustment (only for non-episodic)
    if (kind !== "episodic") {
      const freshnessPenalty: Record<FreshnessStatus, number> = {
        fresh: 0,
        aging: -0.1,
        stale: -0.25,
        expired: -0.5,
      };
      confidence += freshnessPenalty[freshness.status] ?? 0;
    }

    // Reinforcement boost (diminishing returns)
    const reinforcementBoost = Math.min(reliability.reinforcementCount * 0.05, 0.2);
    confidence += reinforcementBoost;

    // Contradiction penalty
    const contradictionPenalty = Math.min(reliability.contradictionCount * 0.1, 0.3);
    confidence -= contradictionPenalty;

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, confidence));
  }
}

// ─── Conflict Detector ───────────────────────────────────────────────────────

export interface MemoryConflictDetector {
  detect(incoming: MemoryCandidate, existing: Memory[]): Promise<MemoryConflictResult[]>;
}

/** Deterministic conflict detection using content and metadata signals. */
export class DeterministicConflictDetector implements MemoryConflictDetector {
  async detect(incoming: MemoryCandidate, existing: Memory[]): Promise<MemoryConflictResult[]> {
    const results: MemoryConflictResult[] = [];
    const incomingHash = contentHash(incoming.content);

    for (const mem of existing) {
      if (mem.status !== "active") continue;

      // Exact duplicate
      if (mem.contentHash === incomingHash) {
        results.push({ memoryId: mem.id, relation: "duplicate", confidence: 1.0, reason: "exact_content_match" });
        continue;
      }

      // Temporal successor (explicit supersede)
      if (incoming.supersedesMemoryId === mem.id) {
        results.push({ memoryId: mem.id, relation: "temporal_successor", confidence: 1.0, reason: "explicit_supersedes" });
        continue;
      }

      // Same subject + different exclusive values → possible contradiction
      if (incoming.subject && mem.subject && incoming.subject === mem.subject) {
        if (incoming.content !== mem.content) {
          results.push({ memoryId: mem.id, relation: "uncertain", confidence: 0.5, reason: "same_subject_different_content" });
        }
        continue;
      }

      // High content overlap → compatible/duplicate
      const overlap = this.contentOverlap(incoming.content, mem.content);
      if (overlap > 0.8) {
        results.push({ memoryId: mem.id, relation: "compatible", confidence: 0.8, reason: "high_content_overlap" });
        continue;
      }

      // Moderate overlap → uncertain
      if (overlap > 0.4) {
        results.push({ memoryId: mem.id, relation: "uncertain", confidence: 0.4, reason: "moderate_content_overlap" });
      }
    }

    return results;
  }

  private contentOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }
}

// ─── Verification Service ────────────────────────────────────────────────────

export interface VerificationInput {
  memoryId: string;
  sourceType: string;
  sourceRef?: string;
  result: "confirmed" | "rejected" | "inconclusive";
  verifier?: string;
}

export interface VerificationResult {
  success: boolean;
  newStatus: VerificationStatus;
  reason: string;
}

export interface MemoryVerificationService {
  verify(input: VerificationInput, access: MemoryAccessContext): Promise<VerificationResult>;
  getVerificationHistory(memoryId: string, access: MemoryAccessContext): Promise<MemoryVerification[]>;
}

export class DefaultMemoryVerificationService implements MemoryVerificationService {
  constructor(private readonly store: MemoryStore) {}

  async verify(input: VerificationInput, access: MemoryAccessContext): Promise<VerificationResult> {
    const memory = await this.store.get(access.tenantId, input.memoryId);
    if (!memory) return { success: false, newStatus: "unverified", reason: "memory_not_found" };

    const now = new Date().toISOString();
    const verification: MemoryVerification = {
      at: now,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
      result: input.result,
      verifier: input.verifier,
    };

    const currentMeta = memory.metadata ?? {};
    const history = (currentMeta[RELIABILITY_KEYS.verificationHistory] as MemoryVerification[]) ?? [];
    history.push(verification);
    // Keep bounded history
    const trimmedHistory = history.slice(-20);

    let newStatus: VerificationStatus;
    if (input.result === "confirmed") {
      newStatus = "verified";
    } else if (input.result === "rejected") {
      newStatus = "invalidated";
    } else {
      newStatus = memory.status === "active" ? "unverified" : "unverified";
    }

    const verificationCount = ((currentMeta[RELIABILITY_KEYS.verificationCount] as number) ?? 0) + 1;

    const updatedMeta = {
      ...currentMeta,
      [RELIABILITY_KEYS.verificationStatus]: newStatus,
      [RELIABILITY_KEYS.lastVerifiedAt]: now,
      [RELIABILITY_KEYS.verificationCount]: verificationCount,
      [RELIABILITY_KEYS.verificationHistory]: trimmedHistory,
    };

    await this.store.update(
      { ...memory, metadata: updatedMeta, updatedAt: now, version: memory.version + 1 },
      memory.version,
    );

    return { success: true, newStatus, reason: `verification_${input.result}` };
  }

  async getVerificationHistory(memoryId: string, access: MemoryAccessContext): Promise<MemoryVerification[]> {
    const memory = await this.store.get(access.tenantId, memoryId);
    if (!memory) return [];
    return (memory.metadata?.[RELIABILITY_KEYS.verificationHistory] as MemoryVerification[]) ?? [];
  }
}

// ─── Reinforcement Service ───────────────────────────────────────────────────

export interface ReinforcementInput {
  memoryId: string;
  evidenceRef: string;
  evidenceType: string;
  positive: boolean;
}

export interface ReinforcementResult {
  success: boolean;
  newReinforcementCount: number;
  reason: string;
}

export interface MemoryReinforcementService {
  reinforce(input: ReinforcementInput, access: MemoryAccessContext): Promise<ReinforcementResult>;
}

export class DefaultMemoryReinforcementService implements MemoryReinforcementService {
  constructor(private readonly store: MemoryStore) {}

  async reinforce(input: ReinforcementInput, access: MemoryAccessContext): Promise<ReinforcementResult> {
    const memory = await this.store.get(access.tenantId, input.memoryId);
    if (!memory) return { success: false, newReinforcementCount: 0, reason: "memory_not_found" };

    const currentMeta = memory.metadata ?? {};
    const evidenceRefs = (currentMeta[RELIABILITY_KEYS.evidenceRefs] as string[]) ?? [];

    // Check for duplicate evidence (idempotency)
    if (evidenceRefs.includes(input.evidenceRef)) {
      return { success: false, newReinforcementCount: memory.reinforcementCount ?? 0, reason: "duplicate_evidence" };
    }

    // Add evidence reference
    evidenceRefs.push(input.evidenceRef);
    const trimmedRefs = evidenceRefs.slice(-50); // Bounded

    const evidenceCount = ((currentMeta[RELIABILITY_KEYS.evidenceCount] as number) ?? 0) + 1;

    // Update reinforcement count (only for positive evidence)
    let reinforcementCount = memory.reinforcementCount ?? 0;
    if (input.positive) {
      reinforcementCount += 1;
    } else {
      // Negative evidence: increment contradiction count
      const contradictionCount = ((currentMeta[RELIABILITY_KEYS.contradictionCount] as number) ?? 0) + 1;
      currentMeta[RELIABILITY_KEYS.contradictionCount] = contradictionCount;
    }

    const now = new Date().toISOString();
    const updatedMeta = {
      ...currentMeta,
      [RELIABILITY_KEYS.evidenceRefs]: trimmedRefs,
      [RELIABILITY_KEYS.evidenceCount]: evidenceCount,
    };

    await this.store.update(
      { ...memory, metadata: updatedMeta, reinforcementCount, updatedAt: now, version: memory.version + 1 },
      memory.version,
    );

    return { success: true, newReinforcementCount: reinforcementCount, reason: input.positive ? "reinforced" : "negative_evidence_recorded" };
  }
}

// ─── Reliability-Aware Retrieval Scoring ─────────────────────────────────────

export interface ReliabilityScoringConfig {
  verificationWeight: number;
  freshnessWeight: number;
  confidenceWeight: number;
  conflictPenalty: number;
}

export const DEFAULT_RELIABILITY_SCORING: ReliabilityScoringConfig = {
  verificationWeight: 0.15,
  freshnessWeight: 0.15,
  confidenceWeight: 0.2,
  conflictPenalty: 0.3,
};

/**
 * Compute a reliability factor for a memory.
 * Returns a multiplier in [0, 1] that should be applied to the relevance score.
 */
export function computeReliabilityFactor(
  memory: Memory,
  freshnessPolicy: MemoryFreshnessPolicy,
  config: ReliabilityScoringConfig = DEFAULT_RELIABILITY_SCORING,
): number {
  const reliability = extractReliability(memory);
  const freshness = freshnessPolicy.evaluate(memory);

  // Invalidated memories are excluded from normal retrieval
  if (reliability.verificationStatus === "invalidated") return 0;

  let factor = 1.0;

  // Verification factor
  const verificationFactors: Record<VerificationStatus, number> = {
    verified: 1.0,
    unverified: 0.9,
    stale: 0.7,
    disputed: 0.5,
    invalidated: 0.0,
  };
  factor *= (1 - config.verificationWeight) + config.verificationWeight * (verificationFactors[reliability.verificationStatus] ?? 0.9);

  // Freshness factor (only for non-episodic)
  if (memory.kind !== "episodic") {
    factor *= (1 - config.freshnessWeight) + config.freshnessWeight * freshness.score;
  }

  // Confidence factor
  factor *= (1 - config.confidenceWeight) + config.confidenceWeight * reliability.confidence;

  // Conflict penalty
  if (reliability.contradictionCount > 0) {
    factor *= Math.max(0, 1 - config.conflictPenalty * Math.min(reliability.contradictionCount / 3, 1));
  }

  return Math.max(0, Math.min(1, factor));
}

// ─── Reliability Service ─────────────────────────────────────────────────────

export interface ReliabilityServiceOptions {
  freshnessConfig?: FreshnessConfig;
  confidencePolicy?: MemoryConfidencePolicy;
  conflictDetector?: MemoryConflictDetector;
  freshnessPolicy?: MemoryFreshnessPolicy;
}

export interface ReliabilityScanResult {
  totalScanned: number;
  conflictsFound: number;
  staleMemories: number;
  unverifiedMemories: number;
  disputedMemories: number;
}

export interface MemoryReliabilityService {
  getReliability(memory: Memory): MemoryReliability;
  evaluateFreshness(memory: Memory): MemoryFreshnessResult;
  computeConfidence(memory: Memory): number;
  detectConflicts(incoming: MemoryCandidate, existing: Memory[]): Promise<MemoryConflictResult[]>;
  scanTenant(namespace: MemoryNamespace, access: MemoryAccessContext): Promise<ReliabilityScanResult>;
}

export class DefaultMemoryReliabilityService implements MemoryReliabilityService {
  private readonly freshnessPolicy: MemoryFreshnessPolicy;
  private readonly confidencePolicy: MemoryConfidencePolicy;
  private readonly conflictDetector: MemoryConflictDetector;

  constructor(
    private readonly store: MemoryStore,
    options: ReliabilityServiceOptions = {},
  ) {
    this.freshnessPolicy = options.freshnessPolicy ?? new DeterministicFreshnessPolicy(options.freshnessConfig);
    this.confidencePolicy = options.confidencePolicy ?? new DeterministicConfidencePolicy();
    this.conflictDetector = options.conflictDetector ?? new DeterministicConflictDetector();
  }

  getReliability(memory: Memory): MemoryReliability {
    return extractReliability(memory);
  }

  evaluateFreshness(memory: Memory): MemoryFreshnessResult {
    return this.freshnessPolicy.evaluate(memory);
  }

  computeConfidence(memory: Memory): number {
    const reliability = extractReliability(memory);
    const freshness = this.freshnessPolicy.evaluate(memory);
    return this.confidencePolicy.compute({ reliability, freshness, kind: memory.kind });
  }

  async detectConflicts(incoming: MemoryCandidate, existing: Memory[]): Promise<MemoryConflictResult[]> {
    return this.conflictDetector.detect(incoming, existing);
  }

  async scanTenant(namespace: MemoryNamespace, access: MemoryAccessContext): Promise<ReliabilityScanResult> {
    const result: ReliabilityScanResult = {
      totalScanned: 0, conflictsFound: 0, staleMemories: 0, unverifiedMemories: 0, disputedMemories: 0,
    };

    let offset = 0;
    const batchSize = 100;
    let hasMore = true;

    while (hasMore) {
      const batch = await this.store.search({
        tenantId: access.tenantId,
        namespaces: [namespace],
        status: "active",
        includeExpired: false,
        limit: batchSize,
        offset,
      });

      if (!batch.length) { hasMore = false; break; }
      result.totalScanned += batch.length;

      for (const memory of batch) {
        const reliability = extractReliability(memory);
        const freshness = this.freshnessPolicy.evaluate(memory);

        if (freshness.status === "stale" || freshness.status === "expired") result.staleMemories++;
        if (reliability.verificationStatus === "unverified") result.unverifiedMemories++;
        if (reliability.verificationStatus === "disputed") result.disputedMemories++;
      }

      offset += batch.length;
      hasMore = batch.length === batchSize;
    }

    return result;
  }
}
