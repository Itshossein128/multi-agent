"use client";

import React, { useLayoutEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  APPEARANCE_STORAGE_KEY,
  readAppearance,
  toggleAppearance,
  writeAppearance,
  type Appearance,
} from "@/lib/appearance";

function applyAppearance(value: Appearance) {
  document.documentElement.dataset.appearance = value;
}

export function AppearanceToggle() {
  const [appearance, setAppearance] = useState<Appearance>("dark");

  useLayoutEffect(() => {
    const sync = () => {
      const next = readAppearance(window.localStorage);
      setAppearance(next);
      applyAppearance(next);
    };
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== APPEARANCE_STORAGE_KEY) return;
      sync();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const nextLabel = appearance === "dark" ? "Dark" : "Light";
  const accessibleName = appearance === "dark"
    ? "Dark appearance, switch to light"
    : "Light appearance, switch to dark";
  const Icon = appearance === "dark" ? Moon : Sun;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="appearance-toggle"
      aria-pressed={appearance === "light"}
      aria-label={accessibleName}
      className="h-8 shrink-0 gap-1.5 px-2 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
      onClick={() => {
        const next = toggleAppearance(appearance);
        setAppearance(next);
        writeAppearance(window.localStorage, next);
        applyAppearance(next);
      }}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {nextLabel}
    </Button>
  );
}
