"use client";

import React, { useEffect } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useToastStore } from "@/store/useToastStore";
import { cn } from "@/lib/utils";

const AUTO_DISMISS_MS = 3500;

function ToastItem({
  id,
  message,
  variant,
}: {
  id: string;
  message: string;
  variant: "success" | "error";
}) {
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [dismiss, id]);

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex min-w-60 max-w-sm items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-xl backdrop-blur-md",
        variant === "success"
          ? "border-emerald-800/80 bg-emerald-950/95 text-emerald-100 [html[data-appearance='light']_&]:border-emerald-300 [html[data-appearance='light']_&]:bg-emerald-50 [html[data-appearance='light']_&]:text-emerald-900"
          : "border-red-800/80 bg-red-950/95 text-red-100 [html[data-appearance='light']_&]:border-red-300 [html[data-appearance='light']_&]:bg-red-50 [html[data-appearance='light']_&]:text-red-900",
      )}
    >
      {variant === "success" ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
      )}
      <span className="flex-1 leading-snug">{message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
        onClick={() => dismiss(id)}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-100 flex flex-col gap-2"
    >
      {toasts.map((item) => (
        <ToastItem key={item.id} id={item.id} message={item.message} variant={item.variant} />
      ))}
    </div>
  );
}
