"use client";

import React, { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/projects/ModalShell";

interface AttachRepositoryDialogProps {
  open: boolean;
  onClose: () => void;
  onAttach: (payload: {
    name: string;
    source: string;
    defaultBranch: string;
  }) => Promise<void>;
}

/** Modal dialog for attaching a Git repository to a project with deferred validation. */
export function AttachRepositoryDialog({
  open,
  onClose,
  onAttach,
}: AttachRepositoryDialogProps) {
  if (!open) return null;
  return <AttachRepositoryDialogContent onClose={onClose} onAttach={onAttach} />;
}

function AttachRepositoryDialogContent({
  onClose,
  onAttach,
}: Omit<AttachRepositoryDialogProps, "open">) {
  const titleId = useId();
  const nameId = useId();
  const nameErrorId = useId();
  const sourceId = useId();
  const sourceHintId = useId();
  const sourceErrorId = useId();
  const branchId = useId();
  const branchErrorId = useId();

  const nameRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const branchRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [branch, setBranch] = useState("main");
  const [errors, setErrors] = useState<{
    name?: string;
    source?: string;
    branch?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validateField(field: "name" | "source" | "branch", value: string): string | undefined {
    if (field === "name" && !value.trim()) return "Repository name is required.";
    if (field === "source" && !value.trim()) return "Repository source URL or path is required.";
    if (field === "branch" && !value.trim()) return "Default branch is required.";
    return undefined;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = {
      name: validateField("name", name),
      source: validateField("source", source),
      branch: validateField("branch", branch),
    };
    if (nextErrors.name || nextErrors.source || nextErrors.branch) {
      setErrors(nextErrors);
      if (nextErrors.name) nameRef.current?.focus();
      else if (nextErrors.source) sourceRef.current?.focus();
      else branchRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onAttach({
        name: name.trim(),
        source: source.trim(),
        defaultBranch: branch.trim(),
      });
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Attach repository failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      titleId={titleId}
      busy={submitting}
      initialFocusRef={nameRef}
      onClose={onClose}
      header={
        <div>
          <h2 id={titleId} className="text-lg font-semibold text-zinc-100">
            Attach Repository
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Connect a repository and default branch to make it available in project workspaces.
          </p>
        </div>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={nameId} className="block text-xs font-medium text-zinc-200">
            Repository name <span aria-hidden="true" className="text-red-400">*</span>
          </label>
          <input
            ref={nameRef}
            id={nameId}
            name="repoName"
            type="text"
            required
            maxLength={120}
            value={name}
            aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={errors.name ? nameErrorId : undefined}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name && event.target.value.trim()) {
                setErrors((prev) => ({ ...prev, name: undefined }));
              }
            }}
            onBlur={() => {
              if (errors.name) setErrors((prev) => ({ ...prev, name: validateField("name", name) }));
            }}
            placeholder="e.g. velora-engine"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 aria-invalid:border-red-500"
          />
          {errors.name ? (
            <p
              id={nameErrorId}
              role="alert"
              className="text-xs text-red-400 [html[data-appearance='light']_&]:text-red-700"
            >
              {errors.name}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={sourceId} className="block text-xs font-medium text-zinc-200">
            Source URL or path <span aria-hidden="true" className="text-red-400">*</span>
          </label>
          <p id={sourceHintId} className="text-xs text-zinc-500">
            HTTPS remote URL, SSH clone URL, or local repository path.
          </p>
          <input
            ref={sourceRef}
            id={sourceId}
            name="repoSource"
            type="text"
            required
            value={source}
            aria-invalid={errors.source ? "true" : undefined}
            aria-describedby={[sourceHintId, errors.source ? sourceErrorId : null].filter(Boolean).join(" ")}
            onChange={(event) => {
              setSource(event.target.value);
              if (errors.source && event.target.value.trim()) {
                setErrors((prev) => ({ ...prev, source: undefined }));
              }
            }}
            onBlur={() => {
              if (errors.source) setErrors((prev) => ({ ...prev, source: validateField("source", source) }));
            }}
            placeholder="https://github.com/org/repo.git"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 aria-invalid:border-red-500"
          />
          {errors.source ? (
            <p
              id={sourceErrorId}
              role="alert"
              className="text-xs text-red-400 [html[data-appearance='light']_&]:text-red-700"
            >
              {errors.source}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <label htmlFor={branchId} className="block text-xs font-medium text-zinc-200">
            Default branch <span aria-hidden="true" className="text-red-400">*</span>
          </label>
          <input
            ref={branchRef}
            id={branchId}
            name="defaultBranch"
            type="text"
            required
            value={branch}
            aria-invalid={errors.branch ? "true" : undefined}
            aria-describedby={errors.branch ? branchErrorId : undefined}
            onChange={(event) => {
              setBranch(event.target.value);
              if (errors.branch && event.target.value.trim()) {
                setErrors((prev) => ({ ...prev, branch: undefined }));
              }
            }}
            onBlur={() => {
              if (errors.branch) setErrors((prev) => ({ ...prev, branch: validateField("branch", branch) }));
            }}
            placeholder="main"
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 aria-invalid:border-red-500"
          />
          {errors.branch ? (
            <p
              id={branchErrorId}
              role="alert"
              className="text-xs text-red-400 [html[data-appearance='light']_&]:text-red-700"
            >
              {errors.branch}
            </p>
          ) : null}
        </div>

        {submitError ? (
          <div
            role="alert"
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
          >
            {submitError}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={submitting}
            className="bg-indigo-600 text-white hover:bg-indigo-500"
          >
            {submitting ? "Attaching…" : "Attach repository"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
