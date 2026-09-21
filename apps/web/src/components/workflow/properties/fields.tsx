"use client";

/**
 * Shared form primitives for the workflow properties panel.
 * Pure presentation — no domain or store logic.
 */

import React, { useState } from "react";
import { cn } from "@/lib/utils";

export const inputClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500";
export const labelClass = "text-[10px] font-bold uppercase tracking-widest text-zinc-500";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      {children}
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
        className={cn(
          inputClass,
          "font-mono text-[11px]",
          error && "border-red-500/70 focus:ring-red-500"
        )}
      />
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </Field>
  );
}
