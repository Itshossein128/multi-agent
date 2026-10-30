import type { ConsolidatedGapReport } from "./supervisorOutcome";

export type ApprovalStatus = "requested" | "approved" | "rejected" | "expired" | "cancelled";

export type ApprovalDecision = "approved" | "rejected";

export interface ApprovalRequest {
  id: string;
  runId: string;
  nodeId: string;
  status: ApprovalStatus;
  message: string;
  requestedAt: string;
  resolvedAt?: string;
  context?: Record<string, unknown>;
  response?: string;
  metadata: Record<string, unknown>;
}

export interface ApprovalDecisionRequest {
  decision: ApprovalDecision;
  response?: string;
  /** Structured clarification answers; used by /clarification submit, not Approve/Reject UI. */
  clarificationAnswers?: Array<{ questionId: string; value: string }>;
}

export type HumanApprovalRole = "admin" | "project_manager" | "lead_architect";
export type HumanApprovalDecision = "approved" | "rejected" | "needs_clarification";

export interface HumanApprovalGateConfig {
  message?: string;
  approvalType: "required";
  timeoutSeconds: number; // e.g., 86400 (24h)
  requiredRoles: HumanApprovalRole[];
  onTimeout: "fail_closed";
  allowedDecisions: HumanApprovalDecision[];
}

export interface HumanApprovalInterruptContext {
  gateId: string;
  runId: string;
  nodeId: string;
  consolidatedGapReport: ConsolidatedGapReport;
  requestedAt: string;
  timeoutAt: string;
  message: string;
}

export interface HumanApprovalDecisionPayload {
  decision: HumanApprovalDecision;
  reviewerId: string;
  reviewerRole: string;
  decisionNotes?: string;
  decidedAt: string;
}
