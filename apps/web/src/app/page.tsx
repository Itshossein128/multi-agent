"use client";

import React, { useState } from "react";
import Link from "next/link";
import { StatCards } from "@/components/dashboard/StatCards";
import { RunningAgentsSection } from "@/components/dashboard/RunningAgentsSection";
import { QueueAndFailedSection } from "@/components/dashboard/QueueAndFailedSection";
import { CompletedAndCostSection } from "@/components/dashboard/CompletedAndCostSection";
import { GraphFlowPreview } from "@/components/dashboard/GraphFlowPreview";
import { useDashboardQuery } from "@/hooks/useDashboardQuery";
import { useStudioStore } from "@/store/useStudioStore";
import {
  Layers,
  Sparkles,
  ShieldCheck,
  Radio,
  Columns3,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function DashboardPage() {
  const { isLive, lastUpdated } = useStudioStore();
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
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
        <div className="container mx-auto px-4 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/20">
              <Layers className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-white">
                  AGENT STUDIO
                </span>
                <Badge variant="outline" className="text-[10px] text-zinc-400 border-zinc-700 bg-zinc-900/60">
                  Live React-Query
                </Badge>
              </div>
              <p className="text-[11px] text-zinc-400">Multi-Agent Orchestration & Observability</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-emerald-500/30 bg-emerald-950/30 text-emerald-400 text-xs font-medium">
              <Radio className="h-3 w-3 text-emerald-400 animate-pulse" />
              <span>{isLive ? "Live Telemetry Connected" : "Connecting..."}</span>
            </div>

            <Link
              href="/org"
              title="Visual workflow editor"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-transparent px-3 text-xs font-medium text-zinc-300 shadow-sm transition-colors hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <Workflow className="h-3.5 w-3.5" />
              Org
            </Link>

            <Link
              href="/tasks"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 bg-transparent px-3 text-xs font-medium text-zinc-300 shadow-sm transition-colors hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
            >
              <Columns3 className="h-3.5 w-3.5" />
              Task Board
            </Link>

            <Button
              size="sm"
              onClick={() => setModalOpen(true)}
              className="h-8 gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Launch Agent Task
            </Button>
          </div>
        </div>
      </header>

      {/* Task Creation Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-400" />
                Dispatch Agent Workflow Task
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
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
                  className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs cursor-pointer"
                >
                  Dispatch to Pipeline
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Content Dashboard */}
      <main className="flex-1 container mx-auto px-4 lg:px-8 py-6 space-y-6">
        {/* 1. Header Metrics Row */}
        <section>
          <StatCards />
        </section>

        {/* 2. Interactive React Flow Canvas */}
        <section>
          <GraphFlowPreview />
        </section>

        {/* 3. Active Running Agents */}
        <section>
          <RunningAgentsSection />
        </section>

        {/* 4. Queue and Failed Incidents */}
        <section>
          <QueueAndFailedSection />
        </section>

        {/* 5. Completed Tasks & Token / Cost Analytics */}
        <section>
          <CompletedAndCostSection />
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900 bg-zinc-950/50 py-4 mt-12">
        <div className="container mx-auto px-4 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span>Multi-Agent Platform • Self-Hosted Studio</span>
            {lastUpdated && <span>(Synced: {new Date(lastUpdated).toLocaleTimeString()})</span>}
          </div>
          <div className="flex items-center gap-4 text-zinc-400">
            <span>LangGraph Engine</span>
            <span>•</span>
            <span>Langfuse Observability</span>
            <span>•</span>
            <span>TanStack React-Query</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
