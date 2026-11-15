"use client";

/**
 * Shared form primitives for the workflow properties panel.
 * Pure presentation — no domain or store logic.
 */

import React, { useId, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

const SELECT_CHEVRON_BG =
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

export const inputClass =
  "min-h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900/90 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 transition-colors hover:border-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export const selectClass = cn(
  inputClass,
  "appearance-none pr-8 bg-[length:14px_14px] bg-[right_0.6rem_center] bg-no-repeat cursor-pointer",
);

export const checkboxClass =
  "h-3.5 w-3.5 shrink-0 rounded border-zinc-700 bg-zinc-900 accent-indigo-500 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed";

export const labelClass = "block text-[10px] font-semibold uppercase tracking-wider text-zinc-400";

export function selectChevronStyle(): React.CSSProperties {
  return { backgroundImage: SELECT_CHEVRON_BG };
}

export function PanelSection({
  title,
  badge,
  action,
  className,
  children,
}: {
  title?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-900/35 p-3",
        className,
      )}
    >
      {(title || badge || action) && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            {title && <h3 className={labelClass}>{title}</h3>}
            {badge}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function CopyIdChip({ id, label = "Copy ID" }: { id: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API may be unavailable in non-HTTPS or test environments.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={copied ? "Copied ID" : label}
      title={`${label}: ${id}`}
      className="group inline-flex max-w-full items-center gap-1.5 rounded-md border border-zinc-800/80 bg-zinc-900/70 px-2 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
    >
      <span className="truncate">{id}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-zinc-500 group-hover:text-zinc-300" aria-hidden="true" />
      )}
    </button>
  );
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const fallbackId = useId();
  const childArray = React.Children.toArray(children);
  const firstControl = childArray.find(
    (child): child is React.ReactElement<Record<string, unknown>> =>
      React.isValidElement<Record<string, unknown>>(child) &&
      (child.type === "input" || child.type === "select" || child.type === "textarea"),
  );
  const firstControlExistingId =
    firstControl && typeof firstControl.props.id === "string"
      ? firstControl.props.id
      : undefined;
  const resolvedFor = htmlFor ?? firstControlExistingId ?? (firstControl ? fallbackId : undefined);

  const enhancedChildren = childArray.map((child) => {
    if (!React.isValidElement<Record<string, unknown>>(child)) return child;
    const isControl =
      child.type === "input" || child.type === "select" || child.type === "textarea";
    if (!isControl) return child;

    const existingId = typeof child.props.id === "string" ? child.props.id : undefined;
    const patch: Record<string, unknown> = {};
    if (!existingId && child === firstControl && resolvedFor) {
      patch.id = resolvedFor;
    }
    if (child.type === "select" && !child.props.style) {
      patch.style = selectChevronStyle();
    }
    return Object.keys(patch).length > 0 ? React.cloneElement(child, patch) : child;
  });

  return (
    <div className="space-y-1.5">
      <label htmlFor={resolvedFor} className={labelClass}>
        {label}
      </label>
      {enhancedChildren}
    </div>
  );
}

/** JSON object field that only commits valid JSON. */
export function JsonField<T extends Record<string, unknown>>({
  label,
  value,
  onChange,
}: {
  label: string;
  value: T;
  onChange: (next: T) => void;
}) {
  const [raw, setRaw] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  const handleChange = (next: string) => {
    setRaw(next);
    if (next.trim() === "") {
      setError(null);
      onChange({} as T);
      return;
    }
    try {
      const parsed = JSON.parse(next) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError("Must be a JSON object");
        return;
      }
      setError(null);
      onChange(parsed as T);
    } catch {
      setError("Invalid JSON");
    }
  };

  return (
    <Field label={label}>
      <textarea
        value={raw}
        onChange={(event) => handleChange(event.target.value)}
        rows={4}
        spellCheck={false}
        aria-invalid={error ? "true" : undefined}
        className={cn(
          inputClass,
          "font-mono text-[11px]",
          error && "border-red-500/70 focus-visible:ring-red-500",
        )}
      />
      {error && (
        <p role="alert" className="text-[11px] text-red-400">
          {error}
        </p>
      )}
    </Field>
  );
}
