"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCode2,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ConsolidatedGapReport,
  HumanApprovalInterruptContext,
  IdentifiedGap,
} from "@multi-agent/types";

export interface ApprovalGateModalProps {
  isOpen: boolean;
  context: HumanApprovalInterruptContext | null;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onApprove: (decisionNotes?: string) => Promise<void> | void;
  onReject: (decisionNotes?: string) => Promise<void> | void;
  onClose: () => void;
}

export function ApprovalGateModal({
  isOpen,
  context,
  isSubmitting = false,
  errorMessage = null,
  onApprove,
  onReject,
  onClose,
}: ApprovalGateModalProps) {
  const [decisionNotes, setDecisionNotes] = useState("");

  if (!isOpen || !context) {
    return null;
  }

  const report: ConsolidatedGapReport = context.consolidatedGapReport ?? {
    totalUserStories: 0,
    auditedCount: 0,
    averageCompletenessScore: 0,
    criticalGapsCount: 0,
    allGaps: [],
    remediationPlanSummary: "No gaps reported",
    estimatedEffortHours: 0,
    preparedAt: new Date().toISOString(),
  };

  const handleApprove = async () => {
    await onApprove(decisionNotes.trim() || undefined);
  };

  const handleReject = async () => {
    await onReject(decisionNotes.trim() || undefined);
  };

  const severityBadgeClass = (severity: IdentifiedGap["severity"]) => {
    switch (severity) {
      case "critical":
        return "bg-rose-500/10 text-rose-400 border-rose-500/30";
      case "major":
        return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      case "minor":
      default:
        return "bg-sky-500/10 text-sky-400 border-sky-500/30";
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-gate-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/80 px-6 py-4 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="approval-gate-title"
                className="text-base font-semibold text-zinc-100 tracking-tight"
              >
                Human Approval Gate — Remediation Authorization
              </h2>
              <p className="text-xs text-zinc-400">
                Gate ID: <span className="font-mono text-zinc-300">{context.gateId}</span> &bull; Run:{" "}
                <span className="font-mono text-zinc-300">{context.runId}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Gate Message / Alert */}
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400 mt-0.5" />
            <div className="space-y-1">
              <p className="font-medium">{context.message || "Approval required before modifying code."}</p>
              <p className="text-zinc-400">
                Review the consolidated gap audit findings below before authorizing downstream code implementation.
                Rejection cleanly halts execution without modifying sandbox files.
              </p>
            </div>
          </div>

          {/* Metric KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">User Stories</div>
              <div className="mt-1 text-2xl font-bold text-zinc-100">{report.totalUserStories}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Audited Count</div>
              <div className="mt-1 text-2xl font-bold text-zinc-100">{report.auditedCount}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Avg Completeness</div>
              <div
                className={`mt-1 text-2xl font-bold ${
                  report.averageCompletenessScore >= 80
                    ? "text-emerald-400"
                    : report.averageCompletenessScore >= 50
                      ? "text-amber-400"
                      : "text-rose-400"
                }`}
              >
                {report.averageCompletenessScore}%
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Critical Gaps</div>
              <div
                className={`mt-1 text-2xl font-bold ${
                  report.criticalGapsCount > 0 ? "text-rose-400" : "text-emerald-400"
                }`}
              >
                {report.criticalGapsCount}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Estimated Effort</div>
              <div className="mt-1 text-2xl font-bold text-zinc-100">{report.estimatedEffortHours} hrs</div>
            </div>
          </div>

          {/* Remediation Plan Summary */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <FileCode2 className="h-4 w-4 text-indigo-400" />
              Remediation Plan Summary
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
              {report.remediationPlanSummary}
            </p>
          </div>

          {/* Identified Gaps List */}
          {report.allGaps && report.allGaps.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Identified Gaps ({report.allGaps.length})
                </h3>
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {report.allGaps.map((gap, index) => (
                  <div
                    key={`${gap.title}-${index}`}
                    className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-zinc-200">{gap.title}</span>
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${severityBadgeClass(
                          gap.severity,
                        )}`}
                      >
                        {gap.severity}
                      </span>
                    </div>
                    <p className="text-zinc-400 text-[11px]">{gap.description}</p>
                    {gap.missingFiles && gap.missingFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-1">
                        {gap.missingFiles.map((file) => (
                          <span
                            key={file}
                            className="font-mono text-[10px] bg-zinc-800/80 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-700/50"
                          >
                            {file}
                          </span>
                        ))}
                      </div>
                    )}
                    {gap.suggestedFix && (
                      <p className="text-[11px] text-emerald-400/90 pt-1">
                        <span className="font-semibold text-emerald-500">Suggested Fix:</span> {gap.suggestedFix}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reviewer Notes Input */}
          <div className="space-y-2">
            <label
              htmlFor="decision-notes"
              className="block text-xs font-semibold uppercase tracking-wider text-zinc-400"
            >
              Reviewer Decision Notes (Recorded in Audit Trail)
            </label>
            <textarea
              id="decision-notes"
              rows={3}
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              disabled={isSubmitting}
              placeholder="Add optional reviewer comments or justification for approval / rejection..."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Error Message if present */}
          {errorMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-400">
              <XCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Modal Footer with Actions */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 px-6 py-4 bg-zinc-900/60">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Clock className="h-3.5 w-3.5 text-zinc-500" />
            <span>Timeout: {new Date(context.timeoutAt).toLocaleTimeString()}</span>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleReject}
              disabled={isSubmitting}
              className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
            >
              <XCircle className="mr-1.5 h-4 w-4 text-rose-400" />
              Reject &amp; Halt
            </Button>
            <Button
              type="button"
              onClick={handleApprove}
              disabled={isSubmitting}
              className="bg-emerald-600 text-white hover:bg-emerald-500"
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Approve Remediation
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
