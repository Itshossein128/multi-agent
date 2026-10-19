"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { APPEARANCE_STORAGE_KEY, readAppearance } from "@/lib/appearance";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";

const SIDEBAR_COLLAPSED_KEY = "app-sidebar-collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      setSidebarCollapsed(
        window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
      );
    } catch {
      // Ignore storage access failures (private mode, disabled storage).
    }
  }, []);

  useLayoutEffect(() => {
    const apply = () => {
      document.documentElement.dataset.appearance = readAppearance(window.localStorage);
    };
    apply();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== APPEARANCE_STORAGE_KEY) return;
      apply();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") apply();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Lock body scroll + Escape closes the mobile drawer
  useEffect(() => {
    if (!sidebarOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [sidebarOpen]);

  const handleCollapsedChange = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // Ignore storage access failures (private mode, disabled storage).
    }
  };

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <AppSidebar
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onNavigate={() => setSidebarOpen(false)}
        onCollapsedChange={handleCollapsedChange}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader
          onMenuClick={() => setSidebarOpen((open) => !open)}
          menuOpen={sidebarOpen}
          onCollapseClick={() => handleCollapsedChange(!sidebarCollapsed)}
          collapsed={sidebarCollapsed}
        />
        <main className="flex flex-1 flex-col bg-zinc-950 text-zinc-100">{children}</main>
      </div>
    </div>
  );
}
