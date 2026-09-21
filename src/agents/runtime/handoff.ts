import { randomUUID } from "node:crypto";
import { nowIso } from "@multi-agent/types";

// ─── Handoff Types ───────────────────────────────────────────────────────────

export type HandoffStatus = "completed" | "partial" | "blocked" | "failed";

export interface HandoffFinding {
  id: string;
  content: string;
  evidenceRefs?: string[];
  importance?: number;
}

export interface HandoffDecision {
  id: string;
  decision: string;
  rationale?: string;
  evidenceRefs?: string[];
}

export interface HandoffAssumption {
  id: string;
  content: string;
  confidence?: number;
}

export interface HandoffWorkItem {
  id: string;
  content: string;
  priority?: "low" | "medium" | "high" | "critical";
}

export interface HandoffWarning {
  id: string;
  content: string;
  severity?: "info" | "warning" | "error";
}

export interface HandoffArtifactRef {
  type: string;
  ref: string;
  description?: string;
}

export interface AgentHandoff {
  /** Schema version for forward compatibility. */
  version: 1;
  /** Unique handoff identifier. */
  id: string;
  /** Run-scoped: handoffs do not cross run boundaries. */
  runId: string;
  workflowId: string;
  /** Source node that produced this handoff. */
  sourceNodeId: string;
  /** Source agent that produced this handoff. */
  sourceAgentId?: string;
  /** Target node (for fan-out targeting). Optional for broadcast. */
  targetNodeId?: string;
  /** Target agent (for fan-out targeting). Optional for broadcast. */
  targetAgentId?: string;
  /** Optional task description from the source agent. */
  task?: string;
  /** Handoff status. */
  status: HandoffStatus;
  /** Compact summary of what was accomplished/attempted. */
  summary: string;
  /** Key findings from the agent's work. */
  findings: HandoffFinding[];
  /** Decisions made during execution. */
  decisions: HandoffDecision[];
  /** Assumptions the agent made. */
  assumptions: HandoffAssumption[];
  /** Work remaining for downstream agents. */
  remainingWork: HandoffWorkItem[];
  /** Warnings about the work performed. */
  warnings: HandoffWarning[];
  /** References to artifacts (files, commits, etc). */
  artifactRefs: HandoffArtifactRef[];
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
  /** Creation timestamp. */
  createdAt: string;
}

// ─── Size Limits ─────────────────────────────────────────────────────────────

export const HANDOFF_LIMITS = {
  maxSummaryLength: 2000,
  maxFindings: 20,
  maxDecisions: 20,
  maxAssumptions: 10,
  maxRemainingWork: 10,
  maxWarnings: 10,
  maxArtifactRefs: 10,
  maxFieldLength: 2000,
  maxMetadataBytes: 4096,
} as const;

// ─── Validation ──────────────────────────────────────────────────────────────

export class HandoffValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffValidationError";
  }
}

export function validateHandoff(handoff: unknown): handoff is AgentHandoff {
  if (!handoff || typeof handoff !== "object") throw new HandoffValidationError("Handoff must be an object");
  const h = handoff as Record<string, unknown>;
  if (h.version !== 1) throw new HandoffValidationError(`Unsupported handoff version: ${h.version}`);
  if (typeof h.id !== "string" || !h.id) throw new HandoffValidationError("Handoff id is required");
  if (typeof h.runId !== "string" || !h.runId) throw new HandoffValidationError("Handoff runId is required");
  if (typeof h.workflowId !== "string" || !h.workflowId) throw new HandoffValidationError("Handoff workflowId is required");
  if (typeof h.sourceNodeId !== "string" || !h.sourceNodeId) throw new HandoffValidationError("Handoff sourceNodeId is required");
  if (!["completed", "partial", "blocked", "failed"].includes(h.status as string)) {
    throw new HandoffValidationError(`Invalid handoff status: ${h.status}`);
  }
  if (typeof h.summary !== "string") throw new HandoffValidationError("Handoff summary is required");
  if (h.summary.length > HANDOFF_LIMITS.maxSummaryLength) {
    throw new HandoffValidationError(`Handoff summary exceeds ${HANDOFF_LIMITS.maxSummaryLength} chars`);
  }
  if (!Array.isArray(h.findings)) throw new HandoffValidationError("Handoff findings must be an array");
  if (h.findings.length > HANDOFF_LIMITS.maxFindings) throw new HandoffValidationError(`Too many findings (max ${HANDOFF_LIMITS.maxFindings})`);
  if (!Array.isArray(h.decisions)) throw new HandoffValidationError("Handoff decisions must be an array");
  if (h.decisions.length > HANDOFF_LIMITS.maxDecisions) throw new HandoffValidationError(`Too many decisions (max ${HANDOFF_LIMITS.maxDecisions})`);
  if (!Array.isArray(h.assumptions)) throw new HandoffValidationError("Handoff assumptions must be an array");
  if (h.assumptions.length > HANDOFF_LIMITS.maxAssumptions) throw new HandoffValidationError(`Too many assumptions (max ${HANDOFF_LIMITS.maxAssumptions})`);
  if (!Array.isArray(h.remainingWork)) throw new HandoffValidationError("Handoff remainingWork must be an array");
  if (h.remainingWork.length > HANDOFF_LIMITS.maxRemainingWork) throw new HandoffValidationError(`Too many remainingWork items (max ${HANDOFF_LIMITS.maxRemainingWork})`);
  if (!Array.isArray(h.warnings)) throw new HandoffValidationError("Handoff warnings must be an array");
  if (h.warnings.length > HANDOFF_LIMITS.maxWarnings) throw new HandoffValidationError(`Too many warnings (max ${HANDOFF_LIMITS.maxWarnings})`);
  if (!Array.isArray(h.artifactRefs)) throw new HandoffValidationError("Handoff artifactRefs must be an array");
  if (h.artifactRefs.length > HANDOFF_LIMITS.maxArtifactRefs) throw new HandoffValidationError(`Too many artifactRefs (max ${HANDOFF_LIMITS.maxArtifactRefs})`);
  if (typeof h.createdAt !== "string") throw new HandoffValidationError("Handoff createdAt is required");
  return true;
}

// ─── Handoff Builder ─────────────────────────────────────────────────────────

export interface HandoffBuildInput {
  runId: string;
  workflowId: string;
  sourceNodeId: string;
  sourceAgentId?: string;
  targetNodeId?: string;
  targetAgentId?: string;
  /** Raw agent output — used as source for structured extraction. */
  rawOutput: unknown;
  /** Agent execution succeeded. */
  succeeded: boolean;
  /** Optional error if agent failed. */
  error?: string;
}

/**
 * Builds a structured handoff from agent execution results.
 * Produces a deterministic, validated handoff from raw output.
 * Falls back to a minimal valid handoff if extraction fails.
 */
export function buildHandoff(input: HandoffBuildInput): AgentHandoff {
  const now = nowIso();
  const base: AgentHandoff = {
    version: 1,
    id: `ho-${randomUUID().slice(0, 12)}`,
    runId: input.runId,
    workflowId: input.workflowId,
    sourceNodeId: input.sourceNodeId,
    sourceAgentId: input.sourceAgentId,
    targetNodeId: input.targetNodeId,
    targetAgentId: input.targetAgentId,
    status: input.succeeded ? "completed" : "failed",
    summary: "",
    findings: [],
    decisions: [],
    assumptions: [],
    remainingWork: [],
    warnings: [],
    artifactRefs: [],
    createdAt: now,
  };

  if (!input.succeeded) {
    base.summary = input.error ? `Agent failed: ${input.error.slice(0, 500)}` : "Agent execution failed";
    base.warnings.push({
      id: `warn-${randomUUID().slice(0, 8)}`,
      content: input.error?.slice(0, 500) ?? "Unknown error",
      severity: "error",
    });
    return base;
  }

  // Extract structured handoff from raw output
  try {
    const extracted = extractFromOutput(input.rawOutput);
    base.summary = truncate(extracted.summary, HANDOFF_LIMITS.maxSummaryLength);
    base.findings = extracted.findings.slice(0, HANDOFF_LIMITS.maxFindings);
    base.decisions = extracted.decisions.slice(0, HANDOFF_LIMITS.maxDecisions);
    base.assumptions = extracted.assumptions.slice(0, HANDOFF_LIMITS.maxAssumptions);
    base.remainingWork = extracted.remainingWork.slice(0, HANDOFF_LIMITS.maxRemainingWork);
    base.warnings = extracted.warnings.slice(0, HANDOFF_LIMITS.maxWarnings);
    base.artifactRefs = extracted.artifactRefs.slice(0, HANDOFF_LIMITS.maxArtifactRefs);
    base.task = extracted.task;
  } catch {
    // Extraction failed — produce minimal valid handoff from raw output
    const text = typeof input.rawOutput === "string"
      ? input.rawOutput
      : JSON.stringify(input.rawOutput ?? {});
    base.summary = truncate(text, HANDOFF_LIMITS.maxSummaryLength);
    base.warnings.push({
      id: `warn-${randomUUID().slice(0, 8)}`,
      content: "Handoff extraction failed; raw output used as summary",
      severity: "info",
    });
  }

  return base;
}

// ─── Extraction Helpers ──────────────────────────────────────────────────────

interface ExtractedHandoff {
  summary: string;
  findings: HandoffFinding[];
  decisions: HandoffDecision[];
  assumptions: HandoffAssumption[];
  remainingWork: HandoffWorkItem[];
  warnings: HandoffWarning[];
  artifactRefs: HandoffArtifactRef[];
  task?: string;
}

function extractFromOutput(output: unknown): ExtractedHandoff {
  const result: ExtractedHandoff = {
    summary: "",
    findings: [],
    decisions: [],
    assumptions: [],
    remainingWork: [],
    warnings: [],
    artifactRefs: [],
  };

  if (output === null || output === undefined) {
    result.summary = "No output produced";
    return result;
  }

  // If output is already structured with handoff-like fields
  if (typeof output === "object" && !Array.isArray(output)) {
    const obj = output as Record<string, unknown>;
    if (typeof obj.summary === "string") result.summary = obj.summary;
    if (typeof obj.task === "string") result.task = obj.task;
    if (Array.isArray(obj.findings)) result.findings = obj.findings.map(normalizeFinding);
    if (Array.isArray(obj.decisions)) result.decisions = obj.decisions.map(normalizeDecision);
    if (Array.isArray(obj.assumptions)) result.assumptions = obj.assumptions.map(normalizeAssumption);
    if (Array.isArray(obj.remainingWork)) result.remainingWork = obj.remainingWork.map(normalizeWorkItem);
    if (Array.isArray(obj.warnings)) result.warnings = obj.warnings.map(normalizeWarning);
    if (Array.isArray(obj.artifactRefs)) result.artifactRefs = obj.artifactRefs.map(normalizeArtifactRef);
  }

  // If output has a content field (from agent executor)
  if (!result.summary && typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    if (typeof obj.content === "string") result.summary = obj.content;
    else if (obj.content !== undefined) result.summary = JSON.stringify(obj.content);
  }

  // If output is a plain string
  if (!result.summary && typeof output === "string") {
    result.summary = output;
  }

  // Fallback
  if (!result.summary) {
    result.summary = JSON.stringify(output).slice(0, HANDOFF_LIMITS.maxSummaryLength);
  }

  return result;
}

function normalizeFinding(raw: unknown): HandoffFinding {
  if (!raw || typeof raw !== "object") return { id: `f-${randomUUID().slice(0, 8)}`, content: String(raw ?? "") };
  const r = raw as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : `f-${randomUUID().slice(0, 8)}`,
    content: truncate(typeof r.content === "string" ? r.content : String(r.content ?? ""), HANDOFF_LIMITS.maxFieldLength),
    evidenceRefs: Array.isArray(r.evidenceRefs) ? r.evidenceRefs.filter((e): e is string => typeof e === "string") : undefined,
    importance: typeof r.importance === "number" ? r.importance : undefined,
  };
}

function normalizeDecision(raw: unknown): HandoffDecision {
  if (!raw || typeof raw !== "object") return { id: `d-${randomUUID().slice(0, 8)}`, decision: String(raw ?? "") };
  const r = raw as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : `d-${randomUUID().slice(0, 8)}`,
    decision: truncate(typeof r.decision === "string" ? r.decision : String(r.decision ?? ""), HANDOFF_LIMITS.maxFieldLength),
    rationale: typeof r.rationale === "string" ? truncate(r.rationale, HANDOFF_LIMITS.maxFieldLength) : undefined,
    evidenceRefs: Array.isArray(r.evidenceRefs) ? r.evidenceRefs.filter((e): e is string => typeof e === "string") : undefined,
  };
}

function normalizeAssumption(raw: unknown): HandoffAssumption {
  if (!raw || typeof raw !== "object") return { id: `a-${randomUUID().slice(0, 8)}`, content: String(raw ?? "") };
  const r = raw as Record<string, unknown>;
  return {
    id: typeof r.id === "string" ? r.id : `a-${randomUUID().slice(0, 8)}`,
    content: truncate(typeof r.content === "string" ? r.content : String(r.content ?? ""), HANDOFF_LIMITS.maxFieldLength),
    confidence: typeof r.confidence === "number" ? r.confidence : undefined,
  };
}

function normalizeWorkItem(raw: unknown): HandoffWorkItem {
  if (!raw || typeof raw !== "object") return { id: `w-${randomUUID().slice(0, 8)}`, content: String(raw ?? "") };
  const r = raw as Record<string, unknown>;
  const priority = typeof r.priority === "string" && ["low", "medium", "high", "critical"].includes(r.priority)
    ? r.priority as HandoffWorkItem["priority"] : undefined;
  return {
    id: typeof r.id === "string" ? r.id : `w-${randomUUID().slice(0, 8)}`,
    content: truncate(typeof r.content === "string" ? r.content : String(r.content ?? ""), HANDOFF_LIMITS.maxFieldLength),
    priority,
  };
}

function normalizeWarning(raw: unknown): HandoffWarning {
  if (!raw || typeof raw !== "object") return { id: `w-${randomUUID().slice(0, 8)}`, content: String(raw ?? "") };
  const r = raw as Record<string, unknown>;
  const severity = typeof r.severity === "string" && ["info", "warning", "error"].includes(r.severity)
    ? r.severity as HandoffWarning["severity"] : undefined;
  return {
    id: typeof r.id === "string" ? r.id : `w-${randomUUID().slice(0, 8)}`,
    content: truncate(typeof r.content === "string" ? r.content : String(r.content ?? ""), HANDOFF_LIMITS.maxFieldLength),
    severity,
  };
}

function normalizeArtifactRef(raw: unknown): HandoffArtifactRef {
  if (!raw || typeof raw !== "object") return { type: "unknown", ref: String(raw ?? "") };
  const r = raw as Record<string, unknown>;
  return {
    type: typeof r.type === "string" ? r.type : "unknown",
    ref: typeof r.ref === "string" ? r.ref : String(r.ref ?? ""),
    description: typeof r.description === "string" ? truncate(r.description, HANDOFF_LIMITS.maxFieldLength) : undefined,
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Remove the ellipsis character to stay within limit
  return text.slice(0, max - 1) + "\u2026";
}

// ─── Handoff Serialization for Context ───────────────────────────────────────

/**
 * Serialize a handoff into a compact, untrusted context string
 * suitable for inclusion in agent prompts.
 */
export function serializeHandoffForContext(handoff: AgentHandoff): string {
  const sections: string[] = [];

  sections.push(`[handoff status=${handoff.status}]`);
  if (handoff.summary) sections.push(`Summary: ${handoff.summary}`);

  if (handoff.findings.length) {
    sections.push(`Findings (${handoff.findings.length}):`);
    for (const f of handoff.findings) {
      sections.push(`  - [${f.id}] ${f.content}`);
    }
  }
  if (handoff.decisions.length) {
    sections.push(`Decisions (${handoff.decisions.length}):`);
    for (const d of handoff.decisions) {
      sections.push(`  - [${d.id}] ${d.decision}${d.rationale ? ` (${d.rationale})` : ""}`);
    }
  }
  if (handoff.assumptions.length) {
    sections.push(`Assumptions (${handoff.assumptions.length}):`);
    for (const a of handoff.assumptions) {
      sections.push(`  - [${a.id}] ${a.content}`);
    }
  }
  if (handoff.remainingWork.length) {
    sections.push(`Remaining Work (${handoff.remainingWork.length}):`);
    for (const w of handoff.remainingWork) {
      sections.push(`  - [${w.id}] [${w.priority ?? "medium"}] ${w.content}`);
    }
  }
  if (handoff.warnings.length) {
    sections.push(`Warnings (${handoff.warnings.length}):`);
    for (const w of handoff.warnings) {
      sections.push(`  - [${w.severity ?? "info"}] ${w.content}`);
    }
  }

  return sections.join("\n");
}
