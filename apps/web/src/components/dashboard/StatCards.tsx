"use client";

import React from "react";
import { useStudioStore, TimeFilter } from "@/store/useStudioStore";
import { useDashboardQuery } from "@/hooks/useDashboardQuery";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bot,
  ListOrdered,
  CheckCircle2,
  AlertTriangle,
  Coins,
  Radio,
} from "lucide-react";

export function StatCards() {
  const { agents, queue, completedTasks, failedTasks, tokenMetrics, timeFilter, setTimeFilter, isLive } =
    useStudioStore();

  // Trigger continuous React-Query polling
  useDashboardQuery();

  const runningCount = agents.filter((a) => a.status === "running").length;
  const queueCount = queue.length;

  const filteredCompleted = completedTasks.filter((task) => {
    if (timeFilter === "today") return task.period === "today";
    if (timeFilter === "week") return task.period === "today" || task.period === "week";
    return true; // month includes all
  });

  const failedCount = failedTasks.length;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {/* 1. Running Agents */}
      <Card className="relative overflow-hidden border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 transition-all">
        <div className="absolute top-0 left-0 h-1 w-full bg-emerald-500" />
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Running Agents
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <Bot className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {runningCount}
            </span>
            <span className="text-xs text-zinc-500">/ {agents.length} nodes</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{isLive ? "Live Engine" : "Connecting..."}</span>
          </div>
        </CardContent>
      </Card>

      {/* 2. Task Queue */}
      <Card className="relative overflow-hidden border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 transition-all">
        <div className="absolute top-0 left-0 h-1 w-full bg-blue-500" />
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Queue
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <ListOrdered className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {queueCount}
            </span>
            <span className="text-xs text-zinc-500">pending dispatch</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-zinc-400">
            <span className="text-blue-400 font-medium">{queue.length > 0 ? "Active pipeline" : "Idle queue"}</span>
          </div>
        </CardContent>
      </Card>

      {/* 3. Completed (With Today / Week / Month Filter) */}
      <Card className="relative overflow-hidden border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 transition-all col-span-1 sm:col-span-2 lg:col-span-1">
        <div className="absolute top-0 left-0 h-1 w-full bg-purple-500" />
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Completed
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {filteredCompleted.length}
            </span>
            <span className="text-xs capitalize text-zinc-400">
              {timeFilter === "today" ? "today" : `this ${timeFilter}`}
            </span>
          </div>

          {/* Time Filter Pills */}
          <div className="mt-3 inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 text-xs">
            {(["today", "week", "month"] as TimeFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => setTimeFilter(filter)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded capitalize transition-all cursor-pointer ${
                  timeFilter === filter
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 4. Failed Tasks */}
      <Card className="relative overflow-hidden border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 transition-all">
        <div className="absolute top-0 left-0 h-1 w-full bg-rose-500" />
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Failed Tasks
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {failedCount}
            </span>
            <Badge variant={failedCount > 0 ? "destructive" : "outline"} className="text-[10px] px-1.5 py-0">
              {failedCount > 0 ? "Needs Attention" : "All Healthy"}
            </Badge>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs text-zinc-500">
            <span>{failedCount > 0 ? `${failedCount} error trace(s)` : "No active failures"}</span>
          </div>
        </CardContent>
      </Card>

      {/* 5. Token / Cost */}
      <Card className="relative overflow-hidden border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 transition-all">
        <div className="absolute top-0 left-0 h-1 w-full bg-amber-500" />
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Token / Cost
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
              <Coins className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              ${tokenMetrics.totalCostUsd.toFixed(4)}
            </span>
            <span className="text-xs text-zinc-500">
              / ${tokenMetrics.budgetUsd.toFixed(0)} cap
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-zinc-400">
            <span>{(tokenMetrics.totalTokens / 1000).toFixed(1)}k tokens</span>
            <span className="text-emerald-400 flex items-center text-[11px]">
              <Radio className="h-3 w-3 mr-0.5 animate-pulse" /> Real-time
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
