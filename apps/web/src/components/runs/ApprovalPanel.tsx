"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, FileSearch, ShieldCheck, XCircle } from "lucide-react";
import type { ApprovalDecision, ApprovalRequest, Run, RunEvent } from "@multi-agent/types";
import { runService } from "@/services/runService";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/formatDateTime";

type Fact = { label: string; value: string };
type EvidenceItem = { label: string; value: string; tone: "neutral" | "good" | "risk" };

/** A review-oriented approval surface: evidence first, decision scope second, controls last. */
export function ApprovalPanel({ runId, approvals, run, events = [], onResolved }: { runId: string; approvals: ApprovalRequest[]; run?: Run | null; events?: RunEvent[]; onResolved?: () => void }) {
  const pending = approvals.filter((approval) => approval.status === "requested");
  if (!pending.length) return null;
  return <section className="space-y-4 rounded-xl border border-amber-700/60 bg-amber-950/20 p-4" aria-label="Human approval review">
    <div className="flex items-start gap-3"><div className="rounded-lg bg-amber-400/10 p-2 text-amber-300"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></div><div><h2 className="text-sm font-semibold text-amber-100">Human review required</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-amber-200/75">Review the evidence and scope below before deciding. Approval resumes this run; rejection stops this approval path and records your reason.</p></div></div>
    {pending.map((approval) => <ApprovalCard key={approval.id} runId={runId} approval={approval} run={run} events={events} onResolved={onResolved} />)}
  </section>;
}

function ApprovalCard({ runId, approval, run, events, onResolved }: { runId: string; approval: ApprovalRequest; run?: Run | null; events: RunEvent[]; onResolved?: () => void }) {
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState<ApprovalDecision | null>(null);
  const [error, setError] = useState("");
  const review = useMemo(() => buildReview(approval, run, events), [approval, run, events]);
  const decide = async (decision: ApprovalDecision) => {
    if (decision === "rejected" && !response.trim()) { setError("Add a short reason before rejecting this approval."); return; }
    setBusy(decision); setError("");
    try { await runService.resolveApproval(runId, approval.id, decision, response.trim() || undefined); onResolved?.(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  return <article className="space-y-4 rounded-lg border border-zinc-700 bg-zinc-950/80 p-4 text-sm" aria-labelledby={`approval-${approval.id}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Decision request</p><h3 id={`approval-${approval.id}`} className="mt-1 text-base font-semibold text-zinc-100">{approval.message || "Approval requested."}</h3></div><span className="rounded-full border border-amber-700/70 bg-amber-400/10 px-2 py-1 text-[10px] font-medium text-amber-200">Waiting for decision</span></div>
    <dl className="grid gap-2 text-xs text-zinc-400 sm:grid-cols-3"><Fact label="Approval node" value={approval.nodeId} /><Fact label="Requested" value={formatDateTime(approval.requestedAt)} /><Fact label="Run status" value={run?.status ?? "waiting_for_human"} /></dl>
    <ReviewSection icon={<FileSearch className="h-4 w-4" />} title="What is being reviewed">{review.scope.length ? <dl className="grid gap-2 sm:grid-cols-2">{review.scope.map((item) => <Fact key={`${item.label}-${item.value}`} {...item} />)}</dl> : <MissingEvidence text="The approval scope was not included in the stored request." />}</ReviewSection>
    <ReviewSection icon={<CheckCircle2 className="h-4 w-4" />} title={`Evidence available${review.evidence.length ? ` · ${review.evidence.length} item${review.evidence.length === 1 ? "" : "s"}` : ""}`}>{review.evidence.length ? <div className="space-y-2">{review.evidence.map((item, index) => <EvidenceRow key={`${item.label}-${index}`} item={item} />)}</div> : <MissingEvidence text="No structured evidence was attached to this approval. Inspect the event timeline before deciding." />}</ReviewSection>
    {review.risks.length > 0 && <ReviewSection icon={<AlertTriangle className="h-4 w-4 text-amber-300" />} title={`Risks or blockers · ${review.risks.length}`}><div className="space-y-2">{review.risks.map((item, index) => <EvidenceRow key={`${item.label}-${index}`} item={item} />)}</div></ReviewSection>}
    {!review.hasStructuredContext && <p role="status" className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs leading-5 text-amber-200">This approval has no structured context. The details above were recovered from run history where possible; do not treat missing evidence as evidence of safety.</p>}
    <details className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs"><summary className="cursor-pointer text-zinc-400">Show raw approval payload</summary><pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-zinc-500">{JSON.stringify(approval.context ?? { unavailable: true }, null, 2)}</pre></details>
    <div className="rounded-lg border border-indigo-900/60 bg-indigo-950/20 p-3 text-xs leading-5 text-indigo-100/80"><p className="font-medium text-indigo-100">Before you decide</p><ul className="mt-1 list-disc space-y-0.5 pl-4"><li>Evidence matches the requested scope.</li><li>Risks and blockers are understood.</li><li>You know what continuing this run will do.</li></ul></div>
    <label className="block text-xs text-zinc-400" htmlFor={`approval-response-${approval.id}`}>Decision note <span className="text-zinc-600">(optional for approval, required for rejection)</span><textarea id={`approval-response-${approval.id}`} rows={3} placeholder="Explain your decision or record follow-up work" aria-describedby={`approval-help-${approval.id}`} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-2 focus:outline-indigo-400" value={response} onChange={(event) => setResponse(event.target.value)} /></label>
    <p id={`approval-help-${approval.id}`} className="text-[11px] text-zinc-500">Your note is stored with the decision for auditability.</p>
    <div className="flex flex-wrap gap-2"><Button disabled={busy !== null} onClick={() => void decide("approved")}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{busy === "approved" ? "Approving…" : "Approve and continue"}</Button><Button variant="destructive" disabled={busy !== null} onClick={() => void decide("rejected")}><XCircle className="mr-1.5 h-3.5 w-3.5" />{busy === "rejected" ? "Rejecting…" : "Reject with reason"}</Button></div>
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
  </article>;
}

function ReviewSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) { return <section className="space-y-2 border-t border-zinc-800 pt-3"><h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">{icon}{title}</h4>{children}</section>; }
function Fact({ label, value }: Fact) { return <div className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-2"><dt className="text-[10px] uppercase tracking-wide text-zinc-600">{label}</dt><dd className="mt-0.5 break-words text-zinc-300">{value}</dd></div>; }
function MissingEvidence({ text }: { text: string }) { return <p className="rounded-md border border-dashed border-zinc-700 px-3 py-2 text-xs text-zinc-500">{text}</p>; }
function EvidenceRow({ item }: { item: EvidenceItem }) { return <div className={`rounded-md border px-3 py-2 text-xs leading-5 ${item.tone === "risk" ? "border-red-900/60 bg-red-950/20 text-red-200" : item.tone === "good" ? "border-emerald-900/60 bg-emerald-950/20 text-emerald-200" : "border-zinc-800 bg-zinc-900/60 text-zinc-300"}`}><span className="font-medium">{item.label}:</span> {item.value}</div>; }

function buildReview(approval: ApprovalRequest, run?: Run | null, events: RunEvent[] = []) {
  const context = asRecord(approval.context);
  const result = asRecord(run?.result);
  const input = asRecord(run?.input);
  const sources = [context, result, input, ...events.filter((event) => ["agent.completed", "agent.failed", "state.updated", "log"].includes(event.type)).map((event) => asRecord(event.payload))].filter(Boolean) as Record<string, unknown>[];
  const scope = uniqueFacts([fact("Repository", input?.repository), fact("Branch", input?.branch), fact("Base ref", input?.baseRef), fact("Implementation scope", input?.implementationScope), fact("Integration required", input?.requiresIntegration), fact("Requested change", input?.change_request), fact("Allowed paths", input?.allowedPaths)]);
  const evidence: EvidenceItem[] = []; const risks: EvidenceItem[] = [];
  for (const source of sources) collectItems(source, "", evidence, risks);
  const dedupe = (items: EvidenceItem[]) => items.filter((item, index) => items.findIndex((other) => other.label === item.label && other.value === item.value) === index).slice(0, 16);
  return { scope, evidence: dedupe(evidence), risks: dedupe(risks), hasStructuredContext: Object.keys(context ?? {}).length > 0 || Boolean(run?.result) };
}
function collectItems(value: Record<string, unknown>, parent: string, evidence: EvidenceItem[], risks: EvidenceItem[]) {
  for (const [key, raw] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll("-", "_");
    if (raw === undefined || raw === null || normalized === "approvalid" || normalized === "timeoutseconds") continue;
    const label = prettyLabel(key);
    if (["blockers", "risks", "warnings", "remainingwork", "remaining_work", "diagnostics", "error"].includes(normalized)) { addItems(label, raw, risks, "risk"); continue; }
    if (["evidence", "findings", "decisions", "assumptions", "acceptancecriteria", "acceptance_criteria", "nextaction", "next_action", "summary", "status", "reason"].includes(normalized)) { addItems(label, raw, evidence, normalized === "status" && String(raw).toLowerCase() !== "success" ? "risk" : "neutral"); continue; }
    const nested = typeof raw === "string" ? parseJsonRecord(raw) : raw;
    if (isRecord(nested) && parent.length < 2) collectItems(nested, `${parent}.${key}`, evidence, risks);
  }
}
function addItems(label: string, raw: unknown, target: EvidenceItem[], tone: EvidenceItem["tone"]) { if (Array.isArray(raw)) raw.slice(0, 8).forEach((item, index) => target.push({ label: `${label} ${index + 1}`, value: readable(item), tone })); else target.push({ label, value: readable(raw), tone }); }
function fact(label: string, value: unknown): Fact | null { return value === undefined || value === null || value === "" ? null : { label, value: readable(value) }; }
function uniqueFacts(items: (Fact | null)[]) { return items.filter((item): item is Fact => Boolean(item)).filter((item, index, all) => all.findIndex((other) => other.label === item.label) === index); }
function asRecord(value: unknown): Record<string, unknown> | undefined { return isRecord(value) ? value : undefined; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function parseJsonRecord(value: string): Record<string, unknown> | undefined { try { const parsed: unknown = JSON.parse(value); return isRecord(parsed) ? parsed : undefined; } catch { return undefined; } }
function readable(value: unknown): string { if (typeof value === "string") return value; if (typeof value === "number" || typeof value === "boolean") return String(value); try { return JSON.stringify(value); } catch { return "Unavailable"; } }
function prettyLabel(value: string) { return value.replaceAll(/([a-z])([A-Z])/g, "$1 $2").replaceAll(/[_-]/g, " ").replace(/^./, (char) => char.toUpperCase()); }
