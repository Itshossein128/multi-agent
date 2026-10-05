"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ClarificationPackage } from "@multi-agent/types";
import { Button } from "@/components/ui/button";
import { runService } from "@/services/runService";
import { toCanonicalStatus, type Task } from "@/lib/taskStatus";

const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-zinc-500";

/**
 * Clarification Q&A form for Review/Blocked or waiting_for_human tasks.
 * Distinct from ApprovalPanel Approve/Reject.
 */
export function ClarificationPanel({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const canonical = toCanonicalStatus(task.status);
  const eligible =
    canonical === "waiting_for_human"
    || canonical === "blocked";

  const [pkg, setPkg] = useState<ClarificationPackage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!eligible || !task.id) return;
    let cancelled = false;
    setLoadError(null);
    void runService.getTaskClarification(task.id)
      .then((next) => {
        if (cancelled) return;
        setPkg(next);
        const initial: Record<string, string> = {};
        for (const q of next.questions) {
          const prior = next.answers?.find((a) => a.questionId === q.id)?.value;
          initial[q.id] = prior ?? "";
        }
        setValues(initial);
      })
      .catch((err) => {
        if (cancelled) return;
        setPkg(null);
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [eligible, task.id, task.runId, task.status, task.updatedAt]);

  const show = useMemo(() => {
    if (!eligible) return false;
    if (!pkg) return false;
    // Structured or legacy-extracted questions
    if (pkg.questions.length > 0) return true;
    // Prior answers (readback after submit)
    if (pkg.answers?.length) return true;
    // Legacy clarification text with no reliable extract — not ordinary blocked/approval waits
    if (pkg.extraction === "unavailable") return true;
    return false;
  }, [eligible, pkg]);

  if (!show) return null;

  const onSubmit = async () => {
    if (!pkg?.canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSuccessMessage(null);
    try {
      const answers = pkg.questions.map((q) => ({
        questionId: q.id,
        value: (values[q.id] ?? "").trim(),
      }));
      const result = await runService.submitTaskClarification(task.id, answers);
      if (!result.ok) {
        setSubmitError("Continuation failed after answers were recorded. The task was not marked Done.");
        setPkg(result.package);
      } else {
        setPkg(result.package);
        setSuccessMessage(
          result.idempotentReplay
            ? "Answers already recorded (idempotent)."
            : result.followUpRunId
              ? `Follow-up run started: ${result.followUpRunId}`
              : "Answers submitted; run continuing.",
        );
        await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-amber-700/60 bg-amber-950/20 p-4" aria-label="Clarification required">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300">Clarification required</h2>

      {loadError && (
        <p role="alert" className="text-xs text-red-300">{loadError}</p>
      )}

      {pkg?.extraction === "unavailable" && !pkg.questions.length && (
        <p className="text-sm text-zinc-300">Structured answers are unavailable for this task’s output.</p>
      )}

      {pkg?.reason && (
        <p className="text-sm text-zinc-200">{pkg.reason}</p>
      )}

      {pkg?.questions.map((question, index) => (
        <div key={question.id} className="space-y-1.5">
          <label className={labelClass}>
            {index + 1}. {question.prompt}
            {question.required !== false ? " *" : ""}
          </label>
          <textarea
            rows={3}
            disabled={submitting || !pkg.canSubmit}
            value={values[question.id] ?? ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [question.id]: e.target.value }))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-2 focus:outline-indigo-400 disabled:opacity-60"
          />
          {pkg.answers?.find((a) => a.questionId === question.id)?.value && !pkg.canSubmit && (
            <p className="text-[11px] text-zinc-500">
              Previous answer: {pkg.answers.find((a) => a.questionId === question.id)?.value}
            </p>
          )}
        </div>
      ))}

      {pkg?.canSubmit && (
        <Button
          type="button"
          size="sm"
          disabled={submitting}
          onClick={() => void onSubmit()}
          className="bg-indigo-600 text-xs text-white hover:bg-indigo-500"
        >
          {submitting ? "Submitting…" : "Submit answers"}
        </Button>
      )}

      {successMessage && <p className="text-xs text-emerald-300">{successMessage}</p>}
      {submitError && <p role="alert" className="text-xs text-red-300">{submitError}</p>}
      {pkg?.continuation === "follow_up" && pkg.canSubmit && (
        <p className="text-[11px] text-zinc-500">Submitting will start a controlled follow-up run (not automatic).</p>
      )}
    </section>
  );
}
