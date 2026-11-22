"use client";

import React, { useEffect, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatDateTime";

export function StatusBar() {
  const definition = useWorkflowStore((s) => s.definition);
  const issues = useWorkflowStore((s) => s.issues);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const saveState = useWorkflowStore((s) => s.saveState);
  const saveError = useWorkflowStore((s) => s.saveError);
  const lastSavedAt = useWorkflowStore((s) => s.lastSavedAt);
  const focusIssue = useWorkflowStore((s) => s.focusIssue);
  const [showIssues, setShowIssues] = useState(false);

  useEffect(() => {
    if (!showIssues) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowIssues(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showIssues]);

  const errors = useMemo(() => issues.filter((i) => i.severity === "error"), [issues]);
  const warnings = useMemo(() => issues.filter((i) => i.severity === "warning"), [issues]);
  const infos = useMemo(() => issues.filter((i) => i.severity === "info"), [issues]);

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "error"
        ? saveError ?? "Save failed"
        : isDirty
          ? "Unsaved changes"
          : lastSavedAt
            ? `Saved · ${formatTime(lastSavedAt)}`
            : "Ready";

  return (
    <div className="relative flex min-h-9 flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 bg-zinc-950/90 px-3 py-1.5 text-[11px]">
      {/* Validation summary */}
      <div className="flex min-w-0 items-center gap-2">
        {errors.length === 0 && warnings.length === 0 ? (
          <span className="flex items-center gap-1 text-emerald-400">
            <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {infos.length > 0 ? infos[0].message : "Workflow is valid"}
          </span>
        ) : (
          <button
            type="button"
            aria-expanded={showIssues}
            aria-controls="workflow-validation-issues"
            onClick={() => setShowIssues((v) => !v)}
            className="flex min-h-6 items-center gap-2 rounded px-1.5 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
          >
            {errors.length > 0 && (
              <span className="flex items-center gap-1 text-red-400 hover:text-red-300">
                <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                {errors.length} error{errors.length === 1 ? "" : "s"}
              </span>
            )}
            {warnings.length > 0 && (
              <span className="flex items-center gap-1 text-amber-400 hover:text-amber-300">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                {warnings.length} warning{warnings.length === 1 ? "" : "s"}
              </span>
            )}
            <span className="text-zinc-600" aria-hidden="true">{showIssues ? "▲" : "▼"}</span>
          </button>
        )}
        <span className="text-zinc-700">|</span>
        <span className="text-zinc-500">
          {definition.nodes.length} nodes · {definition.edges.length} edges
        </span>
      </div>

      {/* Save state */}
      <div className="flex items-center gap-1.5">
        {saveState === "saving" && (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" />
        )}
        <span
          className={cn(
            saveState === "error"
              ? "text-red-400"
              : isDirty && saveState !== "saving"
                ? "text-amber-400"
                : "text-zinc-500"
          )}
        >
          {saveLabel}
        </span>
      </div>

      {/* Issues list */}
      {showIssues && (
        <div
          id="workflow-validation-issues"
          role="region"
          aria-label="Validation issues"
          className="absolute bottom-9 left-0 right-0 max-h-48 overflow-y-auto border-t border-zinc-800 bg-zinc-950/95 p-2 shadow-2xl backdrop-blur"
        >
          {issues.length === 0 && (
            <p className="flex items-center gap-1.5 px-1 py-1 text-emerald-400">
              <CircleCheck className="h-3.5 w-3.5" />
              No validation issues.
            </p>
          )}
          {issues.map((issue) => (
            <button
              key={issue.id}
              type="button"
              onClick={() => {
                focusIssue(issue);
                setShowIssues(false);
              }}
              className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-900 cursor-pointer"
            >
              {issue.severity === "error" ? (
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400" />
              ) : issue.severity === "warning" ? (
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-400" />
              ) : (
                <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
              )}
              <span
                className={cn(
                  "leading-snug",
                  issue.severity === "error"
                    ? "text-red-300"
                    : issue.severity === "warning"
                      ? "text-amber-300"
                      : "text-zinc-400"
                )}
              >
                {issue.message}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
