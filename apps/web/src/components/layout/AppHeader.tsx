"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useDashboardQuery } from "@/hooks/useDashboardQuery";
import { useStudioStore } from "@/store/useStudioStore";
import { Layers, Menu, PanelLeftClose, PanelLeftOpen, Radio, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOptionalOrg } from "@/components/organization/OrgProvider";
import { orgPath } from "@/lib/orgRoute";
import { AppearanceToggle } from "./AppearanceToggle";
import { UserMenu } from "./UserMenu";

type AppHeaderProps = {
  onMenuClick?: () => void;
  menuOpen?: boolean;
  onCollapseClick?: () => void;
  collapsed?: boolean;
};

export function AppHeader({
  onMenuClick,
  menuOpen = false,
  onCollapseClick,
  collapsed = false,
}: AppHeaderProps) {
  const { isLive } = useStudioStore();
  const { enqueueTask, isMutating } = useDashboardQuery();
  const org = useOptionalOrg();
  const homeHref = org ? orgPath(org.org.slug, "/") : "/";
  const [modalOpen, setModalOpen] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogTitleId = useId();
  const taskPromptId = useId();

  useEffect(() => {
    if (!modalOpen) return;
    const trigger = triggerRef.current;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("textarea")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setModalOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [modalOpen]);

  const handleLaunchTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskPrompt.trim()) return;
    enqueueTask({
      title: taskPrompt.trim(),
      role: "Orchestrator Agent",
      priority: "high",
    });
    setTaskPrompt("");
    setModalOpen(false);
  };

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between gap-2 px-3 sm:gap-3 sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onMenuClick}
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="app-sidebar"
              className="h-9 w-9 shrink-0 p-0 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
            >
              {menuOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCollapseClick}
              aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
              aria-expanded={!collapsed}
              aria-controls="app-sidebar"
              className="hidden h-9 w-9 shrink-0 p-0 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 lg:inline-flex"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>

            <Link
              href={homeHref}
              className="flex min-w-0 items-center gap-2 sm:gap-3 hover:opacity-80 transition-opacity"
            >
              <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/20">
                <Layers className="h-4 w-4 sm:h-5 sm:w-5 text-white" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-bold text-xs sm:text-sm tracking-tight text-zinc-100">
                    AGENT STUDIO
                  </span>
                  <Badge
                    variant="outline"
                    className="hidden text-[10px] text-zinc-400 border-zinc-700 bg-zinc-900/60 sm:inline-flex"
                  >
                    Live React-Query
                  </Badge>
                </div>
                <p className="hidden truncate text-[11px] text-zinc-400 sm:block">
                  Multi-Agent Orchestration & Observability
                </p>
              </div>
            </Link>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-1 text-xs font-medium text-emerald-400 md:flex">
              <Radio className="h-3 w-3 animate-pulse text-emerald-400" aria-hidden="true" />
              <span>{isLive ? "Live" : "Connecting..."}</span>
            </div>

            <Button
              ref={triggerRef}
              size="sm"
              aria-label="Launch Agent Task"
              title="Launch Agent Task"
              onClick={() => setModalOpen(true)}
              className="h-8 gap-1.5 px-2.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Launch Agent Task</span>
            </Button>

            <AppearanceToggle />

            <div className="mx-1 hidden h-5 w-px bg-zinc-800 sm:block" />

            <UserMenu />
          </div>
        </div>
      </header>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setModalOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="w-full max-w-md space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 id={dialogTitleId} className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                <Sparkles className="h-4 w-4 text-indigo-400" aria-hidden="true" />
                Dispatch Agent Workflow Task
              </h3>
              <button
                type="button"
                aria-label="Close dialog"
                onClick={() => setModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleLaunchTask} className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor={taskPromptId} className="block text-xs font-medium text-zinc-300">
                  Task requirement
                </label>
                <textarea
                  id={taskPromptId}
                  value={taskPrompt}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  placeholder="Describe your requirement (e.g. 'Build a JWT auth service with login and register endpoints')..."
                  rows={4}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-100 placeholder-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setModalOpen(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isMutating || !taskPrompt.trim()}
                  className="cursor-pointer bg-indigo-600 text-xs text-white hover:bg-indigo-500"
                >
                  Dispatch to Pipeline
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
