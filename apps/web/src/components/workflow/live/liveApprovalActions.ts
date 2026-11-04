import type { ApprovalDecision, ApprovalRequest } from "@multi-agent/types";
import { runService } from "@/services/runService";

export class ApprovalNotActionableError extends Error {
  constructor(message = "This approval is already resolved or is not actionable.") {
    super(message);
    this.name = "ApprovalNotActionableError";
  }
}

export function isClarificationApproval(approval: ApprovalRequest): boolean {
  const context = approval.context as { purpose?: string; envelope?: { needsHuman?: { purpose?: string; questions?: unknown[] } } } | undefined;
  return (context?.purpose ?? context?.envelope?.needsHuman?.purpose) === "clarification" || Boolean(context?.envelope?.needsHuman?.questions?.length);
}

export function approvalAllowedDecisions(approval: ApprovalRequest): ApprovalDecision[] {
  const raw = approval.metadata.allowedDecisions ?? approval.context?.allowedDecisions;
  const valid = Array.isArray(raw) ? raw.filter((value): value is ApprovalDecision => value === "approved" || value === "rejected" || value === "needs_clarification") : [];
  const gate: ApprovalDecision[] = valid.length ? valid : ["approved", "rejected", "needs_clarification"];
  // The server provides this per-viewer subset on GET; legacy hosts omit it.
  if (Array.isArray(approval.metadata.viewerAllowedDecisions)) return gate.filter(decision => (approval.metadata.viewerAllowedDecisions as unknown[]).includes(decision));
  return approval.metadata.canDecide === false ? [] : gate;
}

/** Client duplicate suppression; the authenticated server remains decision authority. */
export function createLiveApprovalActions(runId: string, getApprovals: () => readonly ApprovalRequest[]) {
  const submitting = new Set<string>();
  const submitted = new Set<string>();
  const clarificationRequested = new Set<string>();
  return {
    async resolve(approvalId: string, decision: ApprovalDecision, response?: string): Promise<void> {
      const approval = getApprovals().find(item => item.id === approvalId && item.runId === runId);
      if (!approval || approval.status !== "requested" || submitting.has(approvalId) || submitted.has(approvalId) || (decision === "needs_clarification" && clarificationRequested.has(approvalId)) || !approvalAllowedDecisions(approval).includes(decision)) {
        throw new ApprovalNotActionableError();
      }
      submitting.add(approvalId);
      try {
        await runService.resolveApproval(runId, approvalId, decision, response?.trim() || undefined);
        if (decision === "needs_clarification") clarificationRequested.add(approvalId);
        else submitted.add(approvalId);
      } finally { submitting.delete(approvalId); }
    },
  };
}
