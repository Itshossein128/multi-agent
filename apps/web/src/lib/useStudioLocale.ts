"use client";

import { useEffect, useState } from "react";

export type StudioLocale = "en" | "fa";

export function useStudioLocale() {
  const [locale, setLocaleState] = useState<StudioLocale>("en");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("studio_locale") as StudioLocale | null;
      if (saved === "en" || saved === "fa") {
        setLocaleState(saved);
      }
    } catch {
      // LocalStorage unavailable in SSR
    }
  }, []);

  const setLocale = (newLocale: StudioLocale) => {
    setLocaleState(newLocale);
    try {
      localStorage.setItem("studio_locale", newLocale);
    } catch {
      // ignore
    }
  };

  const direction = locale === "fa" ? "rtl" : "ltr";

  return {
    locale,
    direction,
    isRTL: locale === "fa",
    setLocale,
    toggleLocale: () => setLocale(locale === "en" ? "fa" : "en"),
  };
}
