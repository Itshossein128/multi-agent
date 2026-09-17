"use client";

import React from "react";
import { StatCards } from "@/components/dashboard/StatCards";
import { RunningAgentsSection } from "@/components/dashboard/RunningAgentsSection";
import { QueueAndFailedSection } from "@/components/dashboard/QueueAndFailedSection";
import { CompletedAndCostSection } from "@/components/dashboard/CompletedAndCostSection";
import { GraphFlowPreview } from "@/components/dashboard/GraphFlowPreview";
import { useStudioStore } from "@/store/useStudioStore";
import { ShieldCheck } from "lucide-react";
import { formatTime } from "@/lib/formatDateTime";

export default function DashboardPage() {
  const { lastUpdated } = useStudioStore();

  return (
    <>
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
            {lastUpdated && <span>(Synced: {formatTime(lastUpdated)})</span>}
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
    </>
  );
}
