"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RetireProjectDialogProps {
  project: { id: string; name: string } | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}

/** Accessible alertdialog wrapper replacing native window.confirm when retiring a project. */
export function RetireProjectDialog({
  project,
  onClose,
  onConfirm,
}: RetireProjectDialogProps) {
  if (!project) return null;
  return (
    <RetireProjectDialogContent
      project={project}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}

function RetireProjectDialogContent({
  project,
  onClose,
  onConfirm,
}: {
  project: { id: string; name: string };
  onClose: () => void;
  onConfirm: (id: string) => Promise<void>;
}) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      cancelBtnRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      triggerRef.current?.focus();
      triggerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [submitting, onClose]);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(project.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retire project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 [html[data-appearance='light']_&]:text-red-700">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 id={titleId} className="text-base font-semibold text-zinc-100">
                Retire project?
              </h2>
              <p id={descId} className="mt-1 text-sm text-zinc-400">
                <span className="font-medium text-zinc-200">&ldquo;{project.name}&rdquo;</span> will
                leave the active list and cannot receive new tasks.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={submitting}
            onClick={onClose}
            aria-label="Close confirmation dialog"
            className="h-8 w-8 shrink-0 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <Button
            ref={cancelBtnRef}
            type="button"
            variant="ghost"
            size="sm"
            disabled={submitting}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={submitting}
            onClick={() => void handleConfirm()}
          >
            {submitting ? "Retiring…" : "Retire project"}
          </Button>
        </div>
      </div>
    </div>
  );
}
