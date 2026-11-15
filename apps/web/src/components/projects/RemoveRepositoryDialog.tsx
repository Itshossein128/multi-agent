"use client";

import React, { useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/projects/ModalShell";

export interface RemoveRepoTarget {
  id: string;
  name: string;
  source: string;
}

interface RemoveRepositoryDialogProps {
  repository: RemoveRepoTarget | null;
  onClose: () => void;
  onRemove: (
    repoId: string,
    confirmDiscardChanges: boolean,
  ) => Promise<{ conflictMessage?: string } | void>;
}

/** Accessible alertdialog replacing two-step window.confirm prompts when removing a repository. */
export function RemoveRepositoryDialog({
  repository,
  onClose,
  onRemove,
}: RemoveRepositoryDialogProps) {
  if (!repository) return null;
  return (
    <RemoveRepositoryDialogContent
      repository={repository}
      onClose={onClose}
      onRemove={onRemove}
    />
  );
}

function RemoveRepositoryDialogContent({
  repository,
  onClose,
  onRemove,
}: {
  repository: RemoveRepoTarget;
  onClose: () => void;
  onRemove: (
    repoId: string,
    confirmDiscardChanges: boolean,
  ) => Promise<{ conflictMessage?: string } | void>;
}) {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await onRemove(repository.id, Boolean(conflictMessage));
      if (result && result.conflictMessage) {
        setConflictMessage(result.conflictMessage);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove repository failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      role="alertdialog"
      titleId={titleId}
      describedById={descId}
      maxWidthClass="max-w-md"
      busy={submitting}
      closeLabel="Close confirmation dialog"
      initialFocusRef={cancelRef}
      onClose={onClose}
      header={
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 [html[data-appearance='light']_&]:text-red-700">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 id={titleId} className="text-base font-semibold text-zinc-100">
              {conflictMessage ? "Discard uncommitted changes?" : "Remove repository?"}
            </h2>
            <p id={descId} className="mt-1 text-sm text-zinc-400">
              {conflictMessage ? (
                <>
                  {conflictMessage} Removing{" "}
                  <span className="font-medium text-zinc-200">{repository.name}</span> now will
                  discard those uncommitted workspace changes.
                </>
              ) : (
                <>
                  Detach <span className="font-medium text-zinc-200">{repository.name}</span>{" "}
                  (<span className="font-mono text-xs">{repository.source}</span>) from this project?
                </>
              )}
            </p>
          </div>
        </div>
      }
    >
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button
          ref={cancelRef}
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          onClick={onClose}
        >
          {conflictMessage ? "Keep changes" : "Cancel"}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={submitting}
          onClick={() => void handleConfirm()}
        >
          {submitting
            ? "Removing…"
            : conflictMessage
              ? "Discard & remove"
              : "Remove repository"}
        </Button>
      </div>
    </ModalShell>
  );
}
