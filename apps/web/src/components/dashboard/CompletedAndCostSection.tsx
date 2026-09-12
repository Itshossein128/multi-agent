"use client";

import React from "react";
import { useStudioStore, TimeFilter } from "@/store/useStudioStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Coins,
  Clock,
  Sparkles,
} from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";
import { matchesTimeFilter } from "@/lib/dashboardFilters";
import Link from "next/link";

export function CompletedAndCostSection() {
  const { completedTasks, tokenMetrics, timeFilter, setTimeFilter } = useStudioStore();

  const filteredTasks = completedTasks.filter((task) => matchesTimeFilter(task.period, timeFilter));

  const periodCost = filteredTasks.reduce((acc, t) => acc + (t.cost || 0), 0);
  const periodTokens = filteredTasks.reduce((acc, t) => acc + t.tokens, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Completed Tasks List (Spans 2 columns) */}
      <Card className="border-zinc-800/80 bg-zinc-900/40 lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-purple-400" />
                Completed Executions
              </CardTitle>
              <Badge variant="outline" className="text-purple-400 border-purple-500/30 bg-purple-950/30 text-[11px]">
                {filteredTasks.length} Completed
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-400 mt-1">
              Live history of finished workflow cycles and created artifacts.
            </CardDescription>
          </div>

          {/* Time Filter Buttons */}
          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 text-xs">
            {(["today", "week", "month"] as TimeFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => setTimeFilter(filter)}
                className={`px-3 py-1 text-xs font-medium rounded capitalize transition-all cursor-pointer ${timeFilter === filter
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
                  }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </CardHeader>

        <CardContent>
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-zinc-500">
              <Sparkles className="h-8 w-8 text-zinc-600 mb-2" />
              <p className="text-sm font-medium text-zinc-300">No completed tasks in this period</p>
              <p className="text-xs text-zinc-500">Run an agent task to see real executions recorded here.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/60 p-3.5 hover:border-zinc-700 transition-colors"
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {task.source === "run" ? "Run" : "Board"}
                      </Badge>
                      <span className="text-xs font-semibold text-zinc-300">
                        {task.agent}
                      </span>
                      <span className="text-[11px] text-zinc-500">• {formatDateTime(task.completedAt)}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                        <Clock className="h-3 w-3" /> {task.duration}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-zinc-100 truncate">
                      {task.source === "run" ? (
                        <Link href={`/runs/${encodeURIComponent(task.id)}`} className="hover:text-indigo-300 hover:underline">
                          {task.title}
                        </Link>
                      ) : (
                        <Link href="/tasks" className="hover:text-indigo-300 hover:underline">
                          {task.title}
                        </Link>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <div className="text-xs font-medium text-zinc-200">
                        {(task.tokens / 1000).toFixed(1)}k tokens
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {task.cost !== null && task.cost !== undefined ? `$${task.cost.toFixed(4)}` : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-3 text-xs text-zinc-400">
            <span>Period Total: {(periodTokens / 1000).toFixed(1)}k tokens</span>
            <span className="font-semibold text-zinc-200">
              Aggregated Cost: ${periodCost.toFixed(4)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Token & Cost Analytics (Spans 1 column) */}
      <Card className="border-zinc-800/80 bg-zinc-900/40">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-400" />
              Token & Cost Breakdown
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-zinc-400 mt-1">
            Real usage queried from active LLM runtime.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Budget Progress Bar */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Monthly Budget Burn</span>
              <span className="font-semibold text-white">
                ${tokenMetrics.totalCostUsd.toFixed(4)} / ${tokenMetrics.budgetUsd.toFixed(0)}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-400"
                style={{
                  width: `${Math.min(
                    100,
                    (tokenMetrics.totalCostUsd / tokenMetrics.budgetUsd) * 100
                  )}%`,
                }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-zinc-500">
              <span>{((tokenMetrics.totalCostUsd / tokenMetrics.budgetUsd) * 100).toFixed(2)}% used</span>
              <span>${(tokenMetrics.budgetUsd - tokenMetrics.totalCostUsd).toFixed(2)} remaining</span>
            </div>
          </div>

          {/* Provider & Model Distribution */}
          <div className="space-y-2.5">
            <h5 className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Active Provider Allocation
            </h5>
            {tokenMetrics.providerBreakdown.length === 0 ? (
              <div className="text-xs text-zinc-500 py-3 text-center">
                Waiting for first agent invocation...
              </div>
            ) : (
              tokenMetrics.providerBreakdown.map((item) => {
                const pct = tokenMetrics.totalTokens > 0 ? ((item.tokens / tokenMetrics.totalTokens) * 100).toFixed(0) : "0";
                return (
                  <div
                    key={item.model}
                    className="flex items-center justify-between rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-2.5"
                  >
                    <div>
                      <div className="text-xs font-semibold text-zinc-200">
                        {item.model}
                      </div>
                      <div className="text-[11px] text-zinc-500">{item.provider}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-medium text-zinc-200">
                        ${item.cost.toFixed(4)}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {(item.tokens / 1000).toFixed(1)}k ({pct}%)
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Prompt vs Completion Breakdown */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-800/60 text-xs">
            <div className="rounded border border-zinc-800/60 bg-zinc-950/40 p-2 text-center">
              <span className="text-zinc-500 block text-[10px] uppercase">Input Tokens</span>
              <span className="font-semibold text-zinc-200">
                {(tokenMetrics.promptTokens / 1000).toFixed(1)}k
              </span>
            </div>
            <div className="rounded border border-zinc-800/60 bg-zinc-950/40 p-2 text-center">
              <span className="text-zinc-500 block text-[10px] uppercase">Output Tokens</span>
              <span className="font-semibold text-zinc-200">
                {(tokenMetrics.completionTokens / 1000).toFixed(1)}k
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
