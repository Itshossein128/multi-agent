import type { MemoryCandidate, MemoryAccessContext, MemoryNamespace, MemoryService, Memory } from "../contracts";
import { containsSecretAssignment, containsSensitiveContent, isTrivialContent } from "./memoryWritePolicy";
import { contentHash } from "./access";
import { RELIABILITY_KEYS } from "./memoryReliability";

// ─── Procedural Domain Model ─────────────────────────────────────────────────

export const PROCEDURAL_EXTRACTOR_VERSION = 1;

export type ProcedureOrigin = "explicit" | "learned" | "human_confirmed";

export interface ProceduralMemoryData {
  /** When this procedure should be applied. */
  trigger: string;
  /** Ordered steps to perform. */
  procedure: string[];
  /** What the procedure aims to achieve. */
  goal?: string;
  /** Conditions that must hold before starting. */
  preconditions?: string[];
  /** Constraints to respect during execution. */
  constraints?: string[];
  /** What success looks like. */
  expectedOutcome?: string;
  /** Steps to verify completion. */
  verificationSteps?: string[];
  /** Common failure modes to watch for. */
  failureModes?: string[];
  /** References to supporting evidence. */
  evidenceRefs?: string[];
  /** How confident we are in this procedure (0-1). */
  confidence?: number;
  /** Origin of the procedure. */
  origin?: ProcedureOrigin;
}

export interface ProceduralExtractionInput {
  /** Episodic memories to analyze for patterns. */
  episodes: Memory[];
  /** Namespace scope for the procedure. */
  namespace: MemoryNamespace;
  /** Agent ID for provenance. */
  agentId: string;
  /** Trusted runtime access; never derived from episode content. */
  access?: MemoryAccessContext;
}

export interface ProceduralMemoryCandidate {
  trigger: string;
  procedure: string[];
  goal?: string;
  preconditions?: string[];
  constraints?: string[];
  expectedOutcome?: string;
  verificationSteps?: string[];
  failureModes?: string[];
  evidenceRefs?: string[];
  confidence: number;
  origin: ProcedureOrigin;
  /** Success ratio of the independent evidence cluster. */
  successRatio?: number;
}

export interface ProceduralPolicyDecision {
  remember: boolean;
  reason: string;
  confidence: number;
}

// ─── Evidence Threshold Configuration ────────────────────────────────────────

export interface ProceduralEvidenceConfig {
  /** Minimum independent episodes to consider a learned procedure. */
  minEpisodes: number;
  /** Minimum consistency ratio (success/total) for learned procedures. */
  minConsistency: number;
  /** Confidence boost per additional supporting episode. */
  confidenceBoostPerEpisode: number;
  /** Maximum confidence for learned procedures (before human confirmation). */
  maxLearnedConfidence: number;
}

export const DEFAULT_PROCEDURAL_EVIDENCE_CONFIG: ProceduralEvidenceConfig = {
  minEpisodes: 2,
  minConsistency: 0.6,
  confidenceBoostPerEpisode: 0.15,
  maxLearnedConfidence: 0.7,
};

// ─── Procedural Policy ───────────────────────────────────────────────────────

export interface ProceduralMemoryPolicy {
  shouldCreateProcedure(candidate: ProceduralMemoryCandidate): Promise<ProceduralPolicyDecision>;
}

/**
 * Deterministic policy for procedural memory creation.
 * Handles both explicit (trusted) and learned (inferred) procedures differently.
 */
export class DeterministicProceduralPolicy implements ProceduralMemoryPolicy {
  constructor(private readonly config: ProceduralEvidenceConfig = DEFAULT_PROCEDURAL_EVIDENCE_CONFIG) {}

  async shouldCreateProcedure(candidate: ProceduralMemoryCandidate): Promise<ProceduralPolicyDecision> {
    // Explicit procedures from trusted sources are always accepted
    if (candidate.origin === "explicit" || candidate.origin === "human_confirmed") {
      return { remember: true, reason: "trusted_source", confidence: candidate.confidence };
    }

    // Learned procedures require sufficient evidence
    if (candidate.origin === "learned") {
      const evidenceCount = candidate.evidenceRefs?.length ?? 0;
      if (evidenceCount < this.config.minEpisodes) {
        return { remember: false, reason: "insufficient_evidence", confidence: 0 };
      }
      if (candidate.successRatio !== undefined && candidate.successRatio < this.config.minConsistency) {
        return { remember: false, reason: "inconsistent_evidence", confidence: 0 };
      }

      // Cap confidence for learned procedures
      const confidence = Math.min(candidate.confidence, this.config.maxLearnedConfidence);
      return { remember: true, reason: "sufficient_evidence", confidence };
    }

    return { remember: false, reason: "unknown_origin", confidence: 0 };
  }
}

// ─── Procedural Extractor ────────────────────────────────────────────────────

export interface ProceduralMemoryExtractor {
  extract(input: ProceduralExtractionInput): Promise<ProceduralMemoryCandidate[]>;
}

/**
 * Extracts procedural memory candidates from repeated episodic patterns.
 * Groups episodes by task similarity and derives procedures from successful patterns.
 */
export class DeterministicProceduralExtractor implements ProceduralMemoryExtractor {
  constructor(private readonly config: ProceduralEvidenceConfig = DEFAULT_PROCEDURAL_EVIDENCE_CONFIG) {}

  async extract(input: ProceduralExtractionInput): Promise<ProceduralMemoryCandidate[]> {
    const distinctEpisodes = this.distinctEpisodes(input.episodes);
    if (!distinctEpisodes.length) return [];

    // Group episodes by task similarity (simple clustering)
    const clusters = this.clusterEpisodes(distinctEpisodes);
    const candidates: ProceduralMemoryCandidate[] = [];

    for (const cluster of clusters) {
      if (cluster.length < this.config.minEpisodes) continue;

      const candidate = this.deriveProcedureFromCluster(cluster, input);
      if (candidate) candidates.push(candidate);
    }

    return candidates;
  }

  private distinctEpisodes(episodes: Memory[]): Memory[] {
    const seen = new Set<string>();
    return episodes.filter((episode) => {
      const key = episode.source.runId ? `run:${episode.source.runId}` : `episode:${episode.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private clusterEpisodes(episodes: Memory[]): Memory[][] {
    // Simple clustering: group by normalized situation/subject similarity
    const clusters: Memory[][] = [];
    const assigned = new Set<string>();

    for (const episode of episodes) {
      if (assigned.has(episode.id)) continue;

      const cluster: Memory[] = [episode];
      assigned.add(episode.id);

      const episodeText = this.normalizeText(episode.situation ?? episode.content);

      for (const other of episodes) {
        if (assigned.has(other.id)) continue;
        const otherText = this.normalizeText(other.situation ?? other.content);
        if (this.textSimilarity(episodeText, otherText) > 0.5) {
          cluster.push(other);
          assigned.add(other.id);
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  private deriveProcedureFromCluster(cluster: Memory[], input: ProceduralExtractionInput): ProceduralMemoryCandidate | null {
    // Analyze the cluster for patterns
    const successes = cluster.filter(e => e.success);
    const failures = cluster.filter(e => !e.success);

    // Need majority success for a reliable procedure
    if (successes.length < failures.length) return null;

    // Extract common trigger from the cluster
    const trigger = this.extractCommonTrigger(cluster);
    if (!trigger) return null;

    // Extract procedure steps from successful episodes
    const procedure = this.extractProcedureSteps(successes);
    if (procedure.length === 0) return null;

    // Calculate confidence based on evidence strength
    const successRatio = successes.length / cluster.length;
    const confidence = this.calculateConfidence(cluster.length, successes.length);

    // Build evidence references
    const evidenceRefs = cluster.map(e => `episode:${e.id}`);

    return {
      trigger,
      procedure,
      confidence,
      origin: "learned",
      evidenceRefs,
      successRatio,
    };
  }

  private extractCommonTrigger(episodes: Memory[]): string | undefined {
    // Use the most common situation/subject as trigger
    const situations = episodes
      .map(e => e.situation ?? e.subject)
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0);

    if (situations.length === 0) return undefined;

    // Return the most frequent situation
    const counts = new Map<string, number>();
    for (const s of situations) {
      const normalized = this.normalizeText(s);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }

    let maxCount = 0;
    let trigger = "";
    for (const [text, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        trigger = text;
      }
    }

    return trigger || undefined;
  }

  private extractProcedureSteps(successfulEpisodes: Memory[]): string[] {
    // Extract steps from actions and results
    const steps: string[] = [];

    for (const episode of successfulEpisodes) {
      if (episode.action) {
        const actionSteps = episode.action.split(/[;.]\s*/).filter(s => s.trim());
        steps.push(...actionSteps);
      }
    }

    // Deduplicate while preserving order
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const step of steps) {
      const normalized = this.normalizeText(step);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        unique.push(step.trim());
      }
    }

    return unique.slice(0, 10); // Bounded
  }

  private calculateConfidence(totalEpisodes: number, successfulEpisodes: number): number {
    const consistency = successfulEpisodes / totalEpisodes;
    const evidenceStrength = Math.min(totalEpisodes / 5, 1); // Max at 5 episodes
    const base = consistency * 0.6 + evidenceStrength * 0.4;
    return Math.min(base, this.config.maxLearnedConfidence);
  }

  private normalizeText(text: string): string {
    return text.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(" "));
    const wordsB = new Set(b.split(" "));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }
}

// ─── Procedural to MemoryCandidate ───────────────────────────────────────────

export function proceduralToMemoryCandidate(
  candidate: ProceduralMemoryCandidate,
  input: ProceduralExtractionInput,
): MemoryCandidate {
  const parts: string[] = [];
  parts.push(`Trigger: ${candidate.trigger}`);
  parts.push(`Procedure: ${candidate.procedure.join("; ")}`);
  if (candidate.goal) parts.push(`Goal: ${candidate.goal}`);
  if (candidate.constraints?.length) parts.push(`Constraints: ${candidate.constraints.join("; ")}`);
  if (candidate.verificationSteps?.length) parts.push(`Verification: ${candidate.verificationSteps.join("; ")}`);

  const content = parts.join("\n");

  return {
    namespace: input.namespace,
    kind: "procedural",
    content,
    importance: candidate.confidence,
    confidence: candidate.confidence,
    source: {
      type: "agent",
      agentId: input.agentId,
    },
    explicit: true,
    trigger: candidate.trigger,
    procedure: candidate.procedure.join("; "),
    idempotencyKey: `procedure:${contentHash(candidate.trigger)}:${PROCEDURAL_EXTRACTOR_VERSION}`,
    metadata: {
      extractorVersion: PROCEDURAL_EXTRACTOR_VERSION,
      origin: candidate.origin,
      evidenceRefs: candidate.evidenceRefs,
      goal: candidate.goal,
      preconditions: candidate.preconditions,
      constraints: candidate.constraints,
      expectedOutcome: candidate.expectedOutcome,
      verificationSteps: candidate.verificationSteps,
      failureModes: candidate.failureModes,
    },
  };
}

// ─── Procedural Service ──────────────────────────────────────────────────────

export interface ProceduralExtractionResult {
  created: number;
  reinforced: number;
  skipped: number;
  reason: string;
  failed?: boolean;
}

export interface ProceduralService {
  learnFromEpisodes(input: ProceduralExtractionInput): Promise<ProceduralExtractionResult>;
  learnFromAuthorizedEpisodes(input: { access: MemoryAccessContext; namespace: MemoryNamespace; agentId: string }): Promise<ProceduralExtractionResult>;
}

export interface ProceduralServiceOptions {
  policy?: ProceduralMemoryPolicy;
  extractor?: ProceduralMemoryExtractor;
  evidenceConfig?: ProceduralEvidenceConfig;
  onDiagnostic?: (diagnostic: { namespace: MemoryNamespace; qualifyingEpisodes: number; distinctRuns: number; reason: string }) => void;
}

/**
 * Orchestrates the procedural memory lifecycle:
 * episode analysis → clustering → candidate extraction → policy → persistence.
 */
export class DefaultProceduralService implements ProceduralService {
  private readonly policy: ProceduralMemoryPolicy;
  private readonly extractor: ProceduralMemoryExtractor;
  constructor(
    private readonly memoryService: MemoryService,
    private readonly options: ProceduralServiceOptions = {},
  ) {
    this.policy = options.policy ?? new DeterministicProceduralPolicy(options.evidenceConfig);
    this.extractor = options.extractor ?? new DeterministicProceduralExtractor(options.evidenceConfig);
  }

  async learnFromEpisodes(input: ProceduralExtractionInput): Promise<ProceduralExtractionResult> {
    let created = 0;
    let reinforced = 0;
    let skipped = 0;
    let persistenceFailures = 0;

    try {
      // 1. Extract procedural candidates from episodes
      // A retry or duplicate write must not manufacture independent evidence.
      // Production episodes carry source.runId; the memory id is the safe fallback
      // for older/imported records without a run reference.
      const seenRuns = new Set<string>();
      const episodes = input.episodes.filter((episode) => {
        if (episode.kind !== "episodic" || episode.status !== "active") return false;
        const verification = episode.metadata?.[RELIABILITY_KEYS.verificationStatus];
        if (verification === "invalidated" || verification === "disputed" || verification === "stale") return false;
        const runKey = episode.source.runId ? `run:${episode.source.runId}` : `episode:${episode.id}`;
        if (seenRuns.has(runKey)) return false;
        seenRuns.add(runKey);
        return true;
      });
      this.options.onDiagnostic?.({ namespace: input.namespace, qualifyingEpisodes: episodes.length, distinctRuns: seenRuns.size, reason: episodes.length ? "evidence_evaluated" : "insufficient_evidence" });
      const candidates = await this.extractor.extract({ ...input, episodes });

      for (const candidate of candidates) {
        // 2. Policy check
        const policyDecision = await this.policy.shouldCreateProcedure(candidate);
        if (!policyDecision.remember) {
          skipped++;
          continue;
        }

        // 3. Check if similar procedure already exists (reinforcement)
        const existing = await this.findSimilarProcedure(candidate, input);
        if (existing) {
          // Reinforce existing procedure
          await this.reinforceProcedure(existing, candidate, input);
          reinforced++;
        } else {
          // Create new procedure
          const memoryCandidate = proceduralToMemoryCandidate(candidate, input);
          const access: MemoryAccessContext = input.access ?? {
            principalId: `procedure:${input.agentId}`,
            tenantId: input.namespace.id,
            readableNamespaces: [input.namespace],
            writableNamespaces: [input.namespace],
          };

          try {
            await this.memoryService.remember(memoryCandidate, access);
            created++;
          } catch {
            persistenceFailures++;
            // Persistence failure is non-fatal to the originating workflow.
          }
        }
      }
    } catch {
      // Extraction failure is non-fatal to the originating workflow.
      return { created, reinforced, skipped, reason: "extraction_complete", failed: true };
    }

    return {
      created,
      reinforced,
      skipped,
      reason: persistenceFailures ? "persistence_failed" : (created || reinforced ? "extraction_complete" : "insufficient_evidence"),
      ...(persistenceFailures ? { failed: true } : {}),
    };
  }

  async learnFromAuthorizedEpisodes(input: { access: MemoryAccessContext; namespace: MemoryNamespace; agentId: string }): Promise<ProceduralExtractionResult> {
    if (input.access.tenantId === "" || !input.access.writableNamespaces.some(ns => ns.scope === input.namespace.scope && ns.id === input.namespace.id)) {
      return { created: 0, reinforced: 0, skipped: 0, reason: "unauthorized_namespace" };
    }
    const episodes = await this.memoryService.list({ namespaces: [input.namespace], kinds: ["episodic"], limit: 100 }, input.access);
    return this.learnFromEpisodes({ episodes, namespace: input.namespace, agentId: input.agentId, access: input.access });
  }

  private async findSimilarProcedure(
    candidate: ProceduralMemoryCandidate,
    input: ProceduralExtractionInput,
  ): Promise<Memory | null> {
    const access: MemoryAccessContext = input.access ?? {
      principalId: `procedure:${input.agentId}`,
      tenantId: input.namespace.id,
      readableNamespaces: [input.namespace],
      writableNamespaces: [input.namespace],
    };

    try {
      const result = await this.memoryService.recall(
        {
          text: candidate.trigger,
          namespaces: [input.namespace],
          kinds: ["procedural"],
          limit: 5,
        },
        access,
      );

      // Find the most similar existing procedure
      for (const item of result.results) {
        if (item.memory.kind === "procedural" && item.memory.trigger) {
          const similarity = this.textSimilarity(
            candidate.trigger.toLowerCase(),
            item.memory.trigger.toLowerCase(),
          );
          if (similarity > 0.7) {
            return item.memory;
          }
        }
      }
    } catch {
      // Retrieval failure is non-fatal
    }

    return null;
  }

  private async reinforceProcedure(
    existing: Memory,
    candidate: ProceduralMemoryCandidate,
    input: ProceduralExtractionInput,
  ): Promise<void> {
    const access: MemoryAccessContext = input.access ?? {
      principalId: `procedure:${input.agentId}`,
      tenantId: input.namespace.id,
      readableNamespaces: [input.namespace],
      writableNamespaces: [input.namespace],
    };

    try {
      // Update confidence and reinforcement count
      const currentConfidence = existing.confidence ?? 0;
      const newConfidence = Math.min(currentConfidence + 0.1, 1.0);
      const currentReinforcements = (existing.metadata?.reinforcements as number) ?? 0;

      await this.memoryService.update(existing.id, {
        confidence: newConfidence,
        metadata: {
          ...existing.metadata,
          reinforcements: currentReinforcements + 1,
          evidenceRefs: [...new Set([
            ...((existing.metadata?.evidenceRefs as string[] | undefined) ?? []),
            ...((candidate.evidenceRefs as string[] | undefined) ?? []),
          ])],
          lastReinforcedAt: new Date().toISOString(),
        },
      }, access);
    } catch {
      // Update failure is non-fatal
    }
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.split(/\s+/));
    const wordsB = new Set(b.split(/\s+/));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return union > 0 ? intersection / union : 0;
  }
}

// ─── Trigger-Aware Retrieval ─────────────────────────────────────────────────

export interface ProceduralRetrievalQuery {
  /** Current task description for trigger matching. */
  task: string;
  /** Namespace to search within. */
  namespace: MemoryNamespace;
  /** Optional: specific trigger keywords to match. */
  triggerKeywords?: string[];
  /** Maximum procedures to return. */
  limit?: number;
}

export interface ProceduralRetrievalResult {
  procedures: Memory[];
  triggerMatches: number;
  semanticMatches: number;
}

/**
 * Retrieves procedural memories with trigger-aware scoring.
 * Prioritizes trigger relevance over generic text similarity.
 */
export async function retrieveProcedures(
  service: MemoryService,
  query: ProceduralRetrievalQuery,
  access: MemoryAccessContext,
): Promise<ProceduralRetrievalResult> {
  const limit = query.limit ?? 3;

  // Retrieve procedural memories
  const result = await service.recall(
    {
      text: query.task,
      namespaces: [query.namespace],
      kinds: ["procedural"],
      limit: limit * 2, // Over-fetch for re-ranking
    },
    access,
  );

  // Re-rank with trigger-specific scoring
  const scored = result.results.map(item => ({
    memory: item.memory,
    triggerScore: calculateTriggerScore(query.task, query.triggerKeywords, item.memory),
    semanticScore: item.score,
    totalScore: 0,
  }));

  // Weighted scoring: trigger match is primary
  for (const item of scored) {
    item.totalScore = item.triggerScore * 0.6 + item.semanticScore * 0.4;
  }

  scored.sort((a, b) => b.totalScore - a.totalScore);

  const procedures = scored.slice(0, limit).map(item => item.memory);
  const triggerMatches = scored.filter(s => s.triggerScore > 0.5).length;
  const semanticMatches = scored.filter(s => s.semanticScore > 0.5).length;

  return { procedures, triggerMatches, semanticMatches };
}

function calculateTriggerScore(task: string, triggerKeywords: string[] | undefined, memory: Memory): number {
  if (!memory.trigger) return 0;

  const taskLower = task.toLowerCase();
  const triggerLower = memory.trigger.toLowerCase();

  // Direct trigger match
  const triggerWords = new Set(triggerLower.split(/\s+/));
  const taskWords = new Set(taskLower.split(/\s+/));
  const directMatch = [...triggerWords].filter(w => taskWords.has(w) && w.length > 3).length;

  // Keyword match
  let keywordMatch = 0;
  if (triggerKeywords) {
    keywordMatch = triggerKeywords.filter(k => triggerLower.includes(k.toLowerCase())).length;
  }

  // Jaccard similarity
  const intersection = [...triggerWords].filter(w => taskWords.has(w)).length;
  const union = new Set([...triggerWords, ...taskWords]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  return Math.min((directMatch * 0.3 + keywordMatch * 0.4 + jaccard * 0.3), 1);
}
