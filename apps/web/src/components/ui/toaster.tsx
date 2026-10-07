"use client";

import React, { useEffect } from "react";
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
        "pointer-events-auto flex min-w-55 max-w-sm items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg",
        variant === "success"
          ? "border-emerald-800/80 bg-emerald-950/95 text-emerald-100"
          : "border-red-800/80 bg-red-950/95 text-red-100",
      )}
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 text-xs opacity-60 hover:opacity-100"
        onClick={() => dismiss(id)}
      >
        ✕
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
