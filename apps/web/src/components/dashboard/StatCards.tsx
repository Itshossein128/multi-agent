"use client";

import React from "react";
import Link from "next/link";
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
import { matchesTimeFilter } from "@/lib/dashboardFilters";

export function StatCards() {
  const { agents, queue, completedTasks, failedTasks, tokenMetrics, timeFilter, setTimeFilter, isLive } =
    useStudioStore();

  useDashboardQuery();

  const runningCount = agents.filter((a) => a.status === "running").length;
  const filteredQueue = queue.filter((item) => matchesTimeFilter(item.period, timeFilter));
  const filteredCompleted = completedTasks.filter((task) => matchesTimeFilter(task.period, timeFilter));
  const filteredFailed = failedTasks.filter((task) => matchesTimeFilter(task.period, timeFilter));

  const queueTasks = filteredQueue.filter((item) => item.source === "task").length;
  const queueRuns = filteredQueue.filter((item) => item.source === "run").length;
  const failedTasksCount = filteredFailed.filter((item) => item.source === "task").length;
  const failedRunsCount = filteredFailed.filter((item) => item.source === "run").length;
  const completedTasksCount = filteredCompleted.filter((item) => item.source === "task").length;
  const completedRunsCount = filteredCompleted.filter((item) => item.source === "run").length;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
            <span className="text-xs text-zinc-500">/ {agents.length} agents</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{isLive ? "Live Engine" : "Connecting..."}</span>
          </div>
        </CardContent>
      </Card>

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
              {filteredQueue.length}
            </span>
            <span className="text-xs text-zinc-500">pending</span>
          </div>
          <div className="mt-3 text-xs text-zinc-400">
            {queueTasks} board · {queueRuns} runs
          </div>
        </CardContent>
      </Card>

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
          <div className="mt-1 text-xs text-zinc-500">
            {completedTasksCount} board · {completedRunsCount} runs
          </div>

          <div className="mt-3 inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 text-xs">
            {(["today", "week", "month"] as TimeFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => setTimeFilter(filter)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded capitalize transition-all cursor-pointer ${timeFilter === filter
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

      <Card className="relative overflow-hidden border-zinc-800/80 bg-zinc-900/60 hover:border-zinc-700 transition-all">
        <div className="absolute top-0 left-0 h-1 w-full bg-rose-500" />
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Failures
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-white">
              {filteredFailed.length}
            </span>
            <Badge variant={filteredFailed.length > 0 ? "destructive" : "outline"} className="text-[10px] px-1.5 py-0">
              {filteredFailed.length > 0 ? "Needs Attention" : "All Healthy"}
            </Badge>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-zinc-500">
            <span>
              {failedTasksCount} board · {failedRunsCount} runs
            </span>
            {failedRunsCount > 0 && (
              <Link href="/runs?status=failed" className="text-rose-300 hover:underline">
                View runs
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

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
