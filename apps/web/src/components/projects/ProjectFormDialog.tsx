"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ProjectFormValues {
  name: string;
  description: string;
}

interface ProjectFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialValues?: ProjectFormValues;
  projectTitle?: string;
  onClose: () => void;
  onSubmit: (values: ProjectFormValues) => Promise<void>;
}

/** Accessible modal dialog wrapper that mounts fresh form state each time it opens. */
export function ProjectFormDialog({
  open,
  mode,
  initialValues,
  projectTitle,
  onClose,
  onSubmit,
}: ProjectFormDialogProps) {
  if (!open) return null;
  return (
    <ProjectFormDialogContent
      mode={mode}
      initialValues={initialValues}
      projectTitle={projectTitle}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

function ProjectFormDialogContent({
  mode,
  initialValues,
  projectTitle,
  onClose,
  onSubmit,
}: Omit<ProjectFormDialogProps, "open">) {
  const titleId = useId();
  const nameId = useId();
  const nameHintId = useId();
  const nameErrorId = useId();
  const descId = useId();
  const formErrorId = useId();

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus();
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
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  const isEdit = mode === "edit";

  function validateName(value: string): string | null {
    if (isEdit && !value.trim()) {
      return "Project name is required.";
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const validationError = validateName(name);
    if (validationError) {
      setNameError(validationError);
      nameInputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({ name: name.trim(), description: description.trim() });
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : isEdit ? "Failed to save project" : "Failed to create project",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const nameDescribedBy = [
    !isEdit ? nameHintId : null,
    nameError ? nameErrorId : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-zinc-100">
              {isEdit ? "Edit Project" : "New Project"}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              {isEdit && projectTitle
                ? `Update details for "${projectTitle}".`
                : "Group repositories, workspaces, and agent tasks under one project."}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={submitting}
            onClick={onClose}
            aria-label="Close dialog"
            className="h-8 w-8 shrink-0 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="block text-xs font-medium text-zinc-200">
              Project name{" "}
              {!isEdit ? (
                <span className="font-normal text-zinc-500">(optional)</span>
              ) : (
                <span aria-hidden="true" className="text-red-400">*</span>
              )}
            </label>
            {!isEdit ? (
              <p id={nameHintId} className="text-xs text-zinc-500">
                Leave blank to create &ldquo;Untitled project&rdquo;.
              </p>
            ) : null}
            <input
              ref={nameInputRef}
              id={nameId}
              name="name"
              type="text"
              value={name}
              required={isEdit}
              maxLength={120}
              aria-invalid={nameError ? "true" : undefined}
              aria-describedby={nameDescribedBy}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError && event.target.value.trim()) setNameError(null);
              }}
              onBlur={() => {
                if (isEdit && nameError) setNameError(validateName(name));
              }}
              placeholder={isEdit ? "Enter project name" : "e.g. Core Runtime, Support Triage"}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 aria-invalid:border-red-500"
            />
            {nameError ? (
              <p
                id={nameErrorId}
                role="alert"
                className="text-xs text-red-400 [html[data-appearance='light']_&]:text-red-700"
              >
                {nameError}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={descId} className="block text-xs font-medium text-zinc-200">
              Description <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <textarea
              id={descId}
              name="description"
              rows={3}
              maxLength={600}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Summarize scope, repositories, or what agents work on here…"
              className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            />
          </div>

          {submitError ? (
            <div
              id={formErrorId}
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300 [html[data-appearance='light']_&]:text-red-700"
            >
              {submitError}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={submitting}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="bg-indigo-600 text-white hover:bg-indigo-500"
            >
              {submitting
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save changes"
                  : "Create project"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
