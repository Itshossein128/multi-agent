"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ApprovalDecision, ApprovalRequest, ClarificationPackage } from "@multi-agent/types";
import { useOptionalOrg } from "@/components/organization/OrgProvider";
import { ApprovalPanel } from "@/components/runs/ApprovalPanel";
import { Button } from "@/components/ui/button";
import { runService } from "@/services/runService";
import { useRunStore } from "@/store/useRunStore";
import { approvalAllowedDecisions, createLiveApprovalActions, isClarificationApproval } from "./liveApprovalActions";

function canReview(approval: ApprovalRequest, role?: string): boolean {
  if (typeof approval.metadata.canDecide === "boolean") return approval.metadata.canDecide;
  if (role === "viewer") return false;
  if (!role) return true; // Legacy hosts still rely on authenticated server authorization.
  const required = approval.metadata.requiredRoles ?? approval.context?.requiredRoles;
  const knownRequired = Array.isArray(required) ? required.filter(value => value === "admin" || value === "project_manager" || value === "lead_architect") : [];
  if (!knownRequired.length) return true;
  const knownRole = role === "owner" || role === "admin" ? "admin" : "project_manager";
  return knownRequired.includes(knownRole);
}

export interface LiveApprovalBannerProps {
  runId: string;
  onInspectNode?: (nodeId: string) => void;
  onAttachRun?: (runId: string) => Promise<void> | void;
}

export function LiveApprovalBanner({ runId, onInspectNode, onAttachRun }: LiveApprovalBannerProps) {
  const role = useOptionalOrg()?.org.role;
  const approvals = useRunStore(state => state.approvals);
  const pending = approvals.filter(approval => approval.runId === runId && approval.status === "requested");
  const clarificationApproval = pending.find(isClarificationApproval);
  const actions = useMemo(() => createLiveApprovalActions(runId, () => useRunStore.getState().approvals), [runId]);
  const [expanded, setExpanded] = useState(false);
  const [pkg, setPackage] = useState<ClarificationPackage | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const answerKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const formId = useId();
  const clarificationId = clarificationApproval?.id;
  useEffect(() => {
    if (!clarificationId) return;
    let cancelled = false;
    void runService.getRunClarification(runId).then(next => {
      if (!cancelled && next.runId === runId) { setPackage(next); setValues({}); setError(null); }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [runId, clarificationId]);

  const refreshApprovals = async () => {
    try {
      await useRunStore.getState().refreshApprovals(runId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const decide = async (approval: ApprovalRequest, decision: ApprovalDecision, notes?: string) => {
    if (!canReview(approval, role)) return;
    setError(null);
    await actions.resolve(approval.id, decision, notes);
    if (decision === "needs_clarification") {
      try { const next = await runService.getRunClarification(runId); if (next.runId === runId) { setPackage(next); setValues({}); } }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    await refreshApprovals();
  };
  const submitAnswers = async () => {
    if (submittingRef.current || !pkg?.canSubmit || pkg.runId !== runId) return;
    const current = useRunStore.getState().approvals.find(approval => approval.id === pkg.approvalId);
    if (!current || current.runId !== runId || current.status !== "requested" || !canReview(current, role) || !approvalAllowedDecisions(current).includes("approved")) { setError("This approval is no longer pending. Reopen the current request before submitting."); return; }
    if (pkg.continuation !== "resume") { setError("This clarification requires a task-scoped follow-up. Open the associated task to continue."); return; }
    const answers = pkg.questions.map(question => ({ questionId: question.id, value: (values[question.id] ?? pkg.answers?.find(answer => answer.questionId === question.id)?.value ?? "").trim() }));
    if (pkg.questions.some(question => question.required !== false && !answers.find(answer => answer.questionId === question.id)?.value)) {
      setError("Answer each required question before submitting."); return;
    }
    const fingerprint = JSON.stringify(answers);
    if (answerKey.current?.fingerprint !== fingerprint) answerKey.current = { fingerprint, key: globalThis.crypto?.randomUUID?.() ?? `clarification-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    submittingRef.current = true; setSubmitting(true); setError(null);
    try {
      const result = await runService.submitRunClarification(runId, answers, answerKey.current!.key);
      setPackage(result.package);
      if (!result.ok) { setError("Answers were recorded, but continuation failed. Review the run before retrying."); return; }
      setMessage("Answers submitted; run continuing.");
      await refreshApprovals();
      if (result.followUpRunId) await onAttachRun?.(result.followUpRunId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };
  if (!pending.length) {
    return message ? <p role="status" className="absolute left-3 right-3 top-3 z-10 rounded border border-emerald-800 bg-zinc-950 p-3 text-xs text-emerald-300">{message}</p> : null;
  }
  const packageApproval = approvals.find(approval => approval.runId === runId && approval.id === pkg?.approvalId && approval.status === "requested");
  const clarificationAllowed = Boolean(packageApproval && canReview(packageApproval, role) && approvalAllowedDecisions(packageApproval).includes("approved") && pkg?.continuation === "resume");
  return <section aria-label="Live human approval" className="absolute left-3 right-3 top-3 z-10 max-h-[65%] overflow-y-auto rounded-xl border border-amber-600/60 bg-zinc-950/95 p-3 shadow-xl">
    <div className="flex flex-wrap items-center gap-2">
      <p role="status" className="text-xs font-semibold text-amber-300">{pending.length ? `${pending.length} request${pending.length === 1 ? "" : "s"} waiting for human review` : "Clarification"}</p>
      {pending.map(approval => <button key={approval.id} type="button" data-approval-node={approval.nodeId} onClick={() => onInspectNode?.(approval.nodeId)} className="rounded border border-amber-700 px-2 py-1 text-xs text-amber-200 hover:bg-amber-950">Inspect {approval.nodeId}</button>)}
      {pending.some(approval => !isClarificationApproval(approval)) && <Button size="sm" variant="outline" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{expanded ? "Hide decisions" : "Review decisions"}</Button>}
    </div>
    {!expanded && pending.map(approval => <p key={approval.id} className="mt-1 text-xs text-zinc-300">{approval.message}</p>)}
    {expanded && pending.filter(approval => !isClarificationApproval(approval)).map(approval => <div key={approval.id} className="mt-2"><ApprovalPanel runId={runId} approvals={[approval]} canDecide={canReview(approval, role)} onDecision={decide} /></div>)}
    {pkg && pending.some(approval => approval.id === pkg.approvalId) && <form className="mt-3 space-y-3" onSubmit={event => { event.preventDefault(); void submitAnswers(); }}>
      <h3 className="text-sm font-semibold text-zinc-100">Clarification required</h3>
      {pkg.reason && <p className="text-xs text-zinc-300">{pkg.reason}</p>}
      {!pkg.questions.length && <p className="text-xs text-zinc-400">No structured questions are available in recorded evidence.</p>}
      {pkg.questions.map((question, index) => <div key={question.id} className="space-y-1"><label htmlFor={`${formId}-${index}`} className="block text-xs text-zinc-200">{question.prompt}{question.required !== false ? " *" : ""}</label><textarea id={`${formId}-${index}`} aria-label={question.prompt} rows={2} required={question.required !== false} disabled={submitting || !pkg.canSubmit || !clarificationAllowed} value={values[question.id] ?? pkg.answers?.find(answer => answer.questionId === question.id)?.value ?? ""} onChange={event => setValues(previous => ({ ...previous, [question.id]: event.target.value }))} className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed" /></div>)}
      {pkg.canSubmit && clarificationAllowed && pkg.questions.length > 0 && <Button type="submit" size="sm" disabled={submitting}>{submitting ? "Submitting…" : "Submit answers"}</Button>}
      {!clarificationAllowed && <p className="text-xs text-zinc-400">{pkg.continuation === "follow_up" ? "This clarification requires a task-scoped follow-up. Open the associated task to continue." : "A matching pending request and authorized reviewer are required to submit answers."}</p>}
    </form>}
    {message && <p role="status" className="mt-2 text-xs text-emerald-300">{message}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
  </section>;
}
