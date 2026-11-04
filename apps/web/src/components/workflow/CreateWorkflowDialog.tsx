"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { ARCHETYPE_DESCRIPTORS, type WorkflowArchetypeCategory } from "@multi-agent/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CreateWorkflowDialogSubmitPayload {
  name: string;
  archetype: WorkflowArchetypeCategory;
}

export interface CreateWorkflowDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateWorkflowDialogSubmitPayload) => Promise<void>;
  isSubmitting?: boolean;
}

const ARCHETYPE_ORDER: WorkflowArchetypeCategory[] = [
  "linear-pipeline",
  "hierarchical-supervisor",
  "evaluator-optimizer",
  "autonomous-swarm",
];

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hasAttribute("disabled"));
}

export function validateWorkflowName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    return "Workflow name must be 1–200 characters.";
  }
  return null;
}

export function CreateWorkflowDialog({ isOpen, onClose, onSubmit, isSubmitting = false }: CreateWorkflowDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("Untitled Workflow");
  const [archetype, setArchetype] = useState<WorkflowArchetypeCategory>("linear-pipeline");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName("Untitled Workflow");
    setArchetype("linear-pipeline");
    setError(null);
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("input")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = focusableElements(dialogRef.current);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function submit() {
    const nameError = validateWorkflowName(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    setError(null);
    await onSubmit({ name: name.trim(), archetype });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-zinc-100">New workflow</h2>
        <p id={descriptionId} className="mt-1 text-xs text-zinc-400">
          Choose how this workflow executes. You can convert the archetype later without deleting the graph.
        </p>
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="block space-y-1 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Workflow name
            <input
              aria-label="Workflow name"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              value={name}
              maxLength={200}
              disabled={isSubmitting}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-sm font-normal normal-case tracking-normal text-zinc-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-indigo-400"
            />
          </label>
          {error && (
            <p id={errorId} role="alert" className="text-xs text-red-300">{error}</p>
          )}
          <fieldset className="space-y-2" disabled={isSubmitting}>
            <legend className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Archetype</legend>
            {ARCHETYPE_ORDER.map((id) => {
              const descriptor = ARCHETYPE_DESCRIPTORS[id];
              const selected = archetype === id;
              return (
                <label
                  key={id}
                  className={cn(
                    "flex cursor-pointer gap-3 rounded-lg border p-3 focus-within:ring-1 focus-within:ring-indigo-400",
                    selected ? descriptor.badgeClass : "border-zinc-800 bg-zinc-900/40 text-zinc-300",
                  )}
                >
                  <input
                    type="radio"
                    name="workflow-archetype"
                    value={id}
                    checked={selected}
                    aria-label={descriptor.label}
                    className="mt-1"
                    onChange={() => setArchetype(id)}
                  />
                  <span>
                    <span className="block text-sm font-semibold normal-case tracking-normal">{descriptor.label}</span>
                    <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-zinc-300">{descriptor.description}</span>
                    <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-zinc-400">{descriptor.topologyConstraint}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Creating…" : "Create"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
