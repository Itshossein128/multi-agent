"use client";

import { useState } from "react";
import type { ApprovalDecision, ApprovalRequest } from "@multi-agent/types";
import { runService } from "@/services/runService";
import { Button } from "@/components/ui/button";

/** Pending human-approval requests for a run, with Approve/Reject actions. */
export function ApprovalPanel({ runId, approvals, onResolved }: { runId: string; approvals: ApprovalRequest[]; onResolved?: () => void }) {
  const pending = approvals.filter((approval) => approval.status === "requested");
  if (!pending.length) return null;
  return <section className="space-y-3 rounded-xl border border-amber-700/60 bg-amber-950/20 p-4" aria-label="Pending approvals">
    <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300">Waiting for your decision</h2>
    {pending.map((approval) => <ApprovalCard key={approval.id} runId={runId} approval={approval} onResolved={onResolved} />)}
  </section>;
}

function ApprovalCard({ runId, approval, onResolved }: { runId: string; approval: ApprovalRequest; onResolved?: () => void }) {
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState("");

  const decide = async (decision: ApprovalDecision) => {
    setBusy(decision); setError("");
    try { await runService.resolveApproval(runId, approval.id, decision, response.trim() || undefined); onResolved?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };

  return <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm">
    <p className="text-zinc-100">{approval.message || "Approval requested."}</p>
    <p className="text-xs text-zinc-500">Node: {approval.nodeId} · Requested: {approval.requestedAt}</p>
    {approval.context !== undefined && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-900 p-2 text-xs text-zinc-400">{JSON.stringify(approval.context, null, 2)}</pre>}
    <textarea rows={2} placeholder="Optional response / notes" className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-2 focus:outline-indigo-400" value={response} onChange={(event) => setResponse(event.target.value)} />
    <div className="flex gap-2">
      <Button disabled={busy !== null} onClick={() => void decide("approved")}>{busy === "approved" ? "Approving…" : "Approve"}</Button>
      <Button variant="destructive" disabled={busy !== null} onClick={() => void decide("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject"}</Button>
    </div>
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </div>;
}
