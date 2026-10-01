import type { MemoryCandidate, MemoryAccessContext, MemoryNamespace, MemoryService } from "../contracts";
import { containsSecretAssignment, containsSensitiveContent, isTrivialContent } from "./memoryWritePolicy";
import { contentHash } from "./access";

// ─── Episodic Domain Model ───────────────────────────────────────────────────

export const EPISODIC_EXTRACTOR_VERSION = 1;

export interface EpisodeExtractionInput {
  /** Unique run identifier. */
  runId: string;
  /** Workflow that produced this run. */
  workflowId: string;
  /** Node that produced the final result. */
  nodeId: string;
  /** Agent that executed. */
  agentId: string;
  /** Original task/input given to the agent. */
  task: unknown;
  /** Final output or error. */
  output?: unknown;
  /** Whether the run succeeded. */
  succeeded: boolean;
  /** Error message if failed. */
  error?: string;
  /** Structured handoffs produced during the run. */
  handoffs?: Record<string, unknown>;
  /** Active working memory entries at completion. */
  workingMemory?: Record<string, unknown>;
  /** Timestamps. */
  startedAt?: string;
  completedAt?: string;
  /** Retry count for this run. */
  retryCount?: number;
  /** Human approval decisions during the run. */
  approvals?: Array<{ decision: string; context?: string }>;
  /** Namespace for the episode. */
  namespace: MemoryNamespace;
}

export interface EpisodePolicyDecision {
  remember: boolean;
  reason: string;
  importance?: number;
}

export interface EpisodicMemoryCandidate {
  situation: string;
  action?: string;
  result: string;
  lesson?: string;
  success: boolean;
  failureReason?: string;
  importantDecisions?: string[];
  relevantConstraints?: string[];
  evidenceRefs?: string[];
}

// ─── Significance Policy ─────────────────────────────────────────────────────

export interface EpisodicMemoryPolicy {
  shouldCreateEpisode(input: EpisodeExtractionInput): Promise<EpisodePolicyDecision>;
}

/**
 * Deterministic significance policy: decides whether a run is worth remembering.
 *
 * Good episodic candidates:
 * - unexpected failure
 * - meaningful recovery
 * - important architectural decision
 * - non-obvious debugging discovery
 * - successful strategy worth reusing
 * - failed strategy worth avoiding
 * - constraint discovered during implementation
 * - important human correction
 * - repeated operational failure with clear cause
 *
 * Low-value events:
 * - simple successful task with nothing learned
 * - greetings
 * - trivial CRUD execution
 * - routine tool calls
 * - empty runs
 * - purely cosmetic changes
 */
export class DeterministicEpisodicPolicy implements EpisodicMemoryPolicy {
  async shouldCreateEpisode(input: EpisodeExtractionInput): Promise<EpisodePolicyDecision> {
    // Always remember meaningful failures
    if (!input.succeeded && input.error) {
      const errorText = input.error.toLowerCase();
      // Skip trivial cancellations
      if (errorText.includes("cancelled") && !errorText.includes("unsafe")) {
        return { remember: false, reason: "trivial_cancellation" };
      }
      // Meaningful failures are worth remembering
      return { remember: true, importance: 0.7, reason: "meaningful_failure" };
    }

    // Check for human approval signals — high value
    if (input.approvals && input.approvals.length > 0) {
      const hasRejection = input.approvals.some(a => a.decision === "rejected");
      if (hasRejection) {
        return { remember: true, importance: 0.8, reason: "human_correction" };
      }
    }

    // Check for retry recovery — worth remembering
    if (input.retryCount && input.retryCount > 0 && input.succeeded) {
      return { remember: true, importance: 0.6, reason: "retry_recovery" };
    }

    // Check for handoffs with warnings or decisions
    if (input.handoffs) {
      const handoffs = Object.values(input.handoffs) as Array<Record<string, unknown>>;
      const hasWarnings = handoffs.some(h => {
        const warnings = h.warnings as unknown[];
        return Array.isArray(warnings) && warnings.length > 0;
      });
      if (hasWarnings) {
        return { remember: true, importance: 0.6, reason: "handoff_with_warnings" };
      }
      const hasDecisions = handoffs.some(h => {
        const decisions = h.decisions as unknown[];
        return Array.isArray(decisions) && decisions.length > 0;
      });
      if (hasDecisions) {
        return { remember: true, importance: 0.5, reason: "handoff_with_decisions" };
      }
    }

    // Check working memory for high-importance findings
    if (input.workingMemory) {
      const entries = Object.values(input.workingMemory) as Array<Record<string, unknown>>;
      const highImportance = entries.filter(e =>
        typeof e.importance === "number" && e.importance >= 0.7
      );
      if (highImportance.length > 0) {
        return { remember: true, importance: 0.6, reason: "high_importance_findings" };
      }
      // Check for constraints — often valuable
      const constraints = entries.filter(e => e.kind === "constraint");
      if (constraints.length > 0) {
        return { remember: true, importance: 0.5, reason: "discovered_constraints" };
      }
    }

    // Successful run with no special signals — usually not worth an episode
    // unless the task itself suggests importance (longer tasks are more likely meaningful)
    if (input.succeeded) {
      return { remember: false, reason: "trivial_success" };
    }

    // Failed without error message — borderline, skip
    return { remember: false, reason: "failure_without_signal" };
  }
}

// ─── Episode Extractor ────────────────────────────────────────────────────────

export interface EpisodicMemoryExtractor {
  extract(input: EpisodeExtractionInput): Promise<EpisodicMemoryCandidate | null>;
}

/**
 * Deterministic episode extractor. Produces structured episodes from runtime data
 * without requiring an LLM call. Semantic fields (situation, action, lesson) are
 * constructed from available structured data.
 */
export class DeterministicEpisodeExtractor implements EpisodicMemoryExtractor {
  async extract(input: EpisodeExtractionInput): Promise<EpisodicMemoryCandidate | null> {
    const situation = this.extractSituation(input);
    const result = this.extractResult(input);
    const action = this.extractAction(input);
    const lesson = this.extractLesson(input);
    const failureReason = !input.succeeded ? input.error : undefined;
    const evidenceRefs = this.extractEvidenceRefs(input);
    const importantDecisions = this.extractDecisions(input);
    const relevantConstraints = this.extractConstraints(input);

    // Validate: must have meaningful situation and result
    if (!situation || !result) return null;

    // Validate content isn't trivial or secret
    if (isTrivialContent(situation, 10) || isTrivialContent(result, 5)) return null;
    if (containsSecretAssignment(situation) || containsSensitiveContent(situation)) return null;
    if (containsSecretAssignment(result) || containsSensitiveContent(result)) return null;

    return {
      situation,
      action,
      result,
      lesson,
      success: input.succeeded,
      failureReason,
      importantDecisions,
      relevantConstraints,
      evidenceRefs,
    };
  }

  private extractSituation(input: EpisodeExtractionInput): string {
    // Try to build situation from task
    const taskText = typeof input.task === "string"
      ? input.task
      : (input.task && typeof input.task === "object"
        ? (input.task as Record<string, unknown>).input
          ?? (input.task as Record<string, unknown>).message
          ?? (input.task as Record<string, unknown>).task
          ?? JSON.stringify(input.task)
        : String(input.task ?? ""));
    if (typeof taskText === "string" && taskText.trim()) {
      return taskText.trim().slice(0, 500);
    }
    return "";
  }

  private extractResult(input: EpisodeExtractionInput): string {
    if (!input.succeeded && input.error) {
      return `Failed: ${input.error.slice(0, 500)}`;
    }
    if (input.succeeded) {
      // Try to extract a meaningful result summary from output
      const outputText = this.outputToText(input.output);
      if (outputText) {
        return outputText.slice(0, 500);
      }
      return "Task completed successfully.";
    }
    return "";
  }

  private extractAction(input: EpisodeExtractionInput): string | undefined {
    // Extract action from handoff summary
    if (input.handoffs) {
      const handoffs = Object.values(input.handoffs) as Array<Record<string, unknown>>;
      for (const handoff of handoffs) {
        if (typeof handoff.summary === "string" && handoff.summary.trim()) {
          return handoff.summary.trim().slice(0, 500);
        }
      }
    }

    // Extract from working memory decisions
    if (input.workingMemory) {
      const entries = Object.values(input.workingMemory) as Array<Record<string, unknown>>;
      const decisions = entries.filter(e => e.kind === "decision" && typeof e.content === "string");
      if (decisions.length > 0) {
        return decisions.map(d => d.content).join("; ").slice(0, 500);
      }
    }

    return undefined;
  }

  private extractLesson(input: EpisodeExtractionInput): string | undefined {
    // Extract from working memory findings with lesson-like content
    if (input.workingMemory) {
      const entries = Object.values(input.workingMemory) as Array<Record<string, unknown>>;
      const findings = entries.filter(e =>
        (e.kind === "finding" || e.kind === "constraint") && typeof e.content === "string"
      );
      if (findings.length > 0) {
        // Prioritize high-importance findings
        findings.sort((a: Record<string, unknown>, b: Record<string, unknown>) => ((b.importance as number) ?? 0) - ((a.importance as number) ?? 0));
        return findings.slice(0, 3).map(f => f.content).join("; ").slice(0, 500);
      }
    }
    return undefined;
  }

  private extractEvidenceRefs(input: EpisodeExtractionInput): string[] {
    const refs: string[] = [];
    if (input.runId) refs.push(`run:${input.runId}`);
    if (input.nodeId) refs.push(`node:${input.nodeId}`);
    if (input.agentId) refs.push(`agent:${input.agentId}`);
    return refs;
  }

  private extractDecisions(input: EpisodeExtractionInput): string[] | undefined {
    if (!input.handoffs) return undefined;
    const decisions: string[] = [];
    const handoffs = Object.values(input.handoffs) as Array<Record<string, unknown>>;
    for (const handoff of handoffs) {
      if (Array.isArray(handoff.decisions)) {
        for (const d of handoff.decisions) {
          const dec = d as Record<string, unknown>;
          if (typeof dec.decision === "string") {
            decisions.push(dec.decision.slice(0, 200));
          }
        }
      }
    }
    return decisions.length > 0 ? decisions.slice(0, 10) : undefined;
  }

  private extractConstraints(input: EpisodeExtractionInput): string[] | undefined {
    if (!input.workingMemory) return undefined;
    const entries = Object.values(input.workingMemory) as Array<Record<string, unknown>>;
    const constraints = entries
      .filter(e => e.kind === "constraint" && typeof e.content === "string")
      .map(e => (e.content as string).slice(0, 200));
    return constraints.length > 0 ? constraints.slice(0, 10) : undefined;
  }

  private outputToText(output: unknown): string | undefined {
    if (typeof output === "string") return output.trim();
    if (output && typeof output === "object") {
      const obj = output as Record<string, unknown>;
      if (typeof obj.content === "string") return obj.content.trim();
    }
    return undefined;
  }
}

// ─── Episode to MemoryCandidate ───────────────────────────────────────────────

export function episodeToMemoryCandidate(
  candidate: EpisodicMemoryCandidate,
  input: EpisodeExtractionInput,
): MemoryCandidate {
  const parts: string[] = [];
  parts.push(`Situation: ${candidate.situation}`);
  if (candidate.action) parts.push(`Action: ${candidate.action}`);
  parts.push(`Result: ${candidate.result}`);
  if (candidate.lesson) parts.push(`Lesson: ${candidate.lesson}`);
  if (candidate.failureReason) parts.push(`Failure: ${candidate.failureReason}`);

  const content = parts.join("\n");
  const importance = candidate.success ? 0.5 : 0.7;

  return {
    namespace: input.namespace,
    kind: "episodic",
    content,
    importance,
    source: {
      type: "agent",
      agentId: input.agentId,
      runId: input.runId,
      nodeId: input.nodeId,
      workflowId: input.workflowId,
    },
    explicit: true,
    situation: candidate.situation,
    action: candidate.action,
    result: candidate.result,
    lesson: candidate.lesson,
    success: candidate.success,
    idempotencyKey: `episode:${input.runId}:${EPISODIC_EXTRACTOR_VERSION}`,
    metadata: {
      extractorVersion: EPISODIC_EXTRACTOR_VERSION,
      evidenceRefs: candidate.evidenceRefs,
      importantDecisions: candidate.importantDecisions,
      relevantConstraints: candidate.relevantConstraints,
    },
  };
}

// ─── Episode Service ──────────────────────────────────────────────────────────

export interface EpisodeExtractionResult {
  created: boolean;
  memoryId?: string;
  reason: string;
}

export interface EpisodeService {
  processRun(input: EpisodeExtractionInput, access?: MemoryAccessContext): Promise<EpisodeExtractionResult>;
}

export interface EpisodeServiceOptions {
  policy?: EpisodicMemoryPolicy;
  extractor?: EpisodicMemoryExtractor;
}

/**
 * Orchestrates the full episode lifecycle:
 * significance policy → extraction → validation → MemoryService persistence.
 */
export class DefaultEpisodeService implements EpisodeService {
  private readonly policy: EpisodicMemoryPolicy;
  private readonly extractor: EpisodicMemoryExtractor;
  constructor(
    private readonly memoryService: MemoryService,
    private readonly options: EpisodeServiceOptions = {},
  ) {
    this.policy = options.policy ?? new DeterministicEpisodicPolicy();
    this.extractor = options.extractor ?? new DeterministicEpisodeExtractor();
  }

  async processRun(input: EpisodeExtractionInput, access?: MemoryAccessContext): Promise<EpisodeExtractionResult> {
    // 1. Significance policy check
    const policyDecision = await this.policy.shouldCreateEpisode(input);
    if (!policyDecision.remember) {
      return { created: false, reason: policyDecision.reason };
    }

    // 2. Extract episode candidate
    let episode: EpisodicMemoryCandidate | null;
    try {
      episode = await this.extractor.extract(input);
    } catch {
      return { created: false, reason: "extraction_failed" };
    }
    if (!episode) {
      return { created: false, reason: "extraction_failed" };
    }

    // 3. Convert to memory candidate and persist
    const memoryCandidate = episodeToMemoryCandidate(episode, input);
    const resolvedAccess: MemoryAccessContext = access ?? {
      principalId: `episode:${input.agentId}`,
      tenantId: input.namespace.id,
      readableNamespaces: [input.namespace],
      writableNamespaces: [input.namespace],
    };

    try {
      const result = await this.memoryService.remember(memoryCandidate, resolvedAccess);
      return {
        created: result.action !== "duplicate",
        memoryId: result.memory.id,
        reason: policyDecision.reason,
      };
    } catch {
      return { created: false, reason: "persistence_failed" };
    }
  }
}
