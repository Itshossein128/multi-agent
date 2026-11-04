"use client";

import { useRef, useState } from "react";
import type { ApprovalDecision, ApprovalRequest, ConsolidatedGapReport, HumanApprovalInterruptContext } from "@multi-agent/types";
import { ApprovalGateModal } from "@/components/workflow/ApprovalGateModal";
import { runService } from "@/services/runService";
import { Button } from "@/components/ui/button";
import { approvalAllowedDecisions, isClarificationApproval } from "@/components/workflow/live/liveApprovalActions";
import { formatDateTime } from "@/lib/formatDateTime";

/** Pending human-approval requests for a run, with Approve/Reject actions.
 * Clarification Q&A uses ClarificationPanel / /clarification endpoints instead.
 */
export interface ApprovalPanelProps {
  runId: string;
  approvals: ApprovalRequest[];
  onResolved?: () => void;
  onDecision?: (approval: ApprovalRequest, decision: ApprovalDecision, notes?: string) => Promise<void>;
  canDecide?: boolean;
}

export function ApprovalPanel({ runId, approvals, onResolved, onDecision, canDecide = true }: ApprovalPanelProps) {
  const pending = approvals.filter(approval => approval.runId === runId && approval.status === "requested" && !isClarificationApproval(approval));
  if (!pending.length) return null;
  return <section className="space-y-3 rounded-xl border border-amber-700/60 bg-amber-950/20 p-4" aria-label="Pending approvals">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300">Waiting for your decision</h2>
    {pending.map(approval => <ApprovalCard key={approval.id} runId={runId} approval={approval} onResolved={onResolved} onDecision={onDecision} canDecide={canDecide} />)}
  </section>;
}

function ApprovalCard({ runId, approval, onResolved, onDecision, canDecide }: Omit<ApprovalPanelProps, "approvals"> & { approval: ApprovalRequest }) {
  const inFlight = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  const allowedDecisions = approvalAllowedDecisions(approval);
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState("");

  const decide = async (decision: ApprovalDecision, notes?: string) => {
    if (!canDecide || approval.status !== "requested" || inFlight.current || submitted || !allowedDecisions.includes(decision)) return;
    inFlight.current = true;
    setBusy(decision); setError("");
    try {
      const message = (notes ?? response).trim() || undefined;
      if (onDecision) await onDecision(approval, decision, message);
      else await runService.resolveApproval(runId, approval.id, decision, message);
      setSubmitted(decision !== "needs_clarification"); onResolved?.();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { inFlight.current = false; setBusy(null); }
  };

function approvalContext(approval: ApprovalRequest): HumanApprovalInterruptContext | null {
  const context = approval.context as (Partial<HumanApprovalInterruptContext> & { consolidatedGapReport?: ConsolidatedGapReport }) | undefined;
  if (!context?.consolidatedGapReport || !context.gateId || !context.runId || !context.nodeId || !context.requestedAt || !context.timeoutAt) return null;
  return {
    gateId: context.gateId,
    runId: context.runId,
    nodeId: context.nodeId,
    consolidatedGapReport: context.consolidatedGapReport,
    requestedAt: context.requestedAt,
    timeoutAt: context.timeoutAt,
    message: context.message ?? approval.message,
  };
}

  const gateContext = approvalContext(approval);
  if (submitted) return <p role="status" className="text-xs text-emerald-300">Decision submitted; waiting for server updates.</p>;
  if (!canDecide) return <p className="text-sm text-zinc-300">{approval.message || "Approval requested."} An authorized reviewer must resolve this request.</p>;
  if (gateContext) {
    return (
      <ApprovalGateModal
        isOpen
        context={gateContext}
        isSubmitting={busy !== null}
        allowedDecisions={allowedDecisions}
        errorMessage={error || null}
        onApprove={(notes) => decide("approved", notes)}
        onReject={(notes) => decide("rejected", notes)}
        onNeedsClarification={(notes) => decide("needs_clarification", notes)}
        onClose={() => undefined}
      />
    );
  }

  return <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm">
    <p className="text-zinc-100">{approval.message || "Approval requested."}</p>
    <p className="text-xs text-zinc-500">Node: {approval.nodeId} · Requested: {formatDateTime(approval.requestedAt)}</p>
    {approval.context !== undefined && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-900 p-2 text-xs text-zinc-400">{JSON.stringify(approval.context, null, 2)}</pre>}
    <textarea rows={2} aria-label="Decision notes" placeholder="Optional response / notes" className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-2 focus:outline-indigo-400" value={response} onChange={(event) => setResponse(event.target.value)} />
    <div className="flex gap-2">
      {allowedDecisions.includes("approved") && <Button disabled={busy !== null} onClick={() => void decide("approved")}>{busy === "approved" ? "Approving…" : "Approve"}</Button>}
      {allowedDecisions.includes("rejected") && <Button variant="destructive" disabled={busy !== null} onClick={() => void decide("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject"}</Button>}
      {allowedDecisions.includes("needs_clarification") && <Button variant="outline" disabled={busy !== null} onClick={() => void decide("needs_clarification")}>Needs clarification</Button>}
    </div>
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </div>;
}
