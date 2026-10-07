"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useDashboardQuery } from "@/hooks/useDashboardQuery";
import { useStudioStore } from "@/store/useStudioStore";
import { Layers, Menu, Radio, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "./UserMenu";

type AppHeaderProps = {
  onMenuClick?: () => void;
  menuOpen?: boolean;
};

export function AppHeader({ onMenuClick, menuOpen = false }: AppHeaderProps) {
  const { isLive } = useStudioStore();
  const { enqueueTask, isMutating } = useDashboardQuery();
  const [modalOpen, setModalOpen] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState("");

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
        <div className="flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onMenuClick}
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={menuOpen}
              aria-controls="app-sidebar"
              className="h-9 w-9 shrink-0 p-0 text-zinc-300 hover:bg-zinc-800 hover:text-white lg:hidden"
            >
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>

            <Link
              href="/"
              className="flex min-w-0 items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/20">
                <Layers className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-bold text-sm tracking-tight text-white">
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

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-1 text-xs font-medium text-emerald-400 md:flex">
              <Radio className="h-3 w-3 animate-pulse text-emerald-400" />
              <span>{isLive ? "Live" : "Connecting..."}</span>
            </div>

            <Button
              size="sm"
              onClick={() => setModalOpen(true)}
              className="h-8 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Launch Agent Task</span>
            </Button>

            <div className="mx-1 hidden h-5 w-px bg-zinc-800 sm:block" />

            <UserMenu />
          </div>
        </div>
      </header>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                Dispatch Agent Workflow Task
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleLaunchTask} className="space-y-3">
              <textarea
                value={taskPrompt}
                onChange={(e) => setTaskPrompt(e.target.value)}
                placeholder="Describe your requirement (e.g. 'Build a JWT auth service with login and register endpoints')..."
                rows={4}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />

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
