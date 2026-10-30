/**
 * Supervisor Outcome Envelopes and Audit/QA Data Models
 *
 * Defines the structured outcome payloads returned by the supervisor hub
 * and specialist agents (auditor, consolidator, remediation, QA) to drive
 * dynamic condition routing in the orchestration engine.
 */

export type SupervisorActionRoute =
  | "audit_spec"
  | "consolidate"
  | "await_approval"
  | "implement_spec"
  | "qa_verify"
  | "complete"
  | "loop_limit_exceeded"
  | "fail";

export interface IdentifiedGap {
  specCode: string;
  title: string;
  severity: "critical" | "major" | "minor";
  description: string;
  missingFiles?: string[];
  suggestedFix?: string;
}

export interface SpecAuditResultPayload {
  taskId: string;
  userStoryCode: string;
  completenessScore: number; // 0.0 to 100.0
  passedChecks: number;
  totalChecks: number;
  identifiedGaps: IdentifiedGap[];
  inspectedFiles: string[];
  auditTimestamp: string;
}

export interface ConsolidatedGapReport {
  totalUserStories: number;
  auditedCount: number;
  averageCompletenessScore: number;
  criticalGapsCount: number;
  allGaps: IdentifiedGap[];
  remediationPlanSummary: string;
  estimatedEffortHours: number;
  preparedAt: string;
}

export interface QAVerificationResult {
  taskId: string;
  testsPassed: boolean;
  totalTests: number;
  failedTestsCount: number;
  failureOutput?: string;
  iterationCount: number;
  verifiedFiles: string[];
}

export interface SupervisorOutcomeEnvelope {
  /** Target routing decision driving LangGraph conditional edge selection */
  nextAction: SupervisorActionRoute;
  /** Active task ID being processed */
  taskId?: string;
  /** Current iteration count for this task's remediation loop */
  iterationCount?: number;
  /** Spec audit outcome */
  auditResult?: SpecAuditResultPayload;
  /** Consolidated audit outcome across all queued stories */
  consolidatedReport?: ConsolidatedGapReport;
  /** QA verification output */
  qaResult?: QAVerificationResult;
  /** Human-readable status message for logging and UI telemetry */
  statusMessage: string;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export function createSupervisorOutcomeEnvelope(
  payload: {
    nextAction: SupervisorActionRoute;
    statusMessage: string;
    taskId?: string;
    iterationCount?: number;
    auditResult?: SpecAuditResultPayload;
    consolidatedReport?: ConsolidatedGapReport;
    qaResult?: QAVerificationResult;
    metadata?: Record<string, unknown>;
  }
): SupervisorOutcomeEnvelope {
  return {
    ...payload,
  };
}
