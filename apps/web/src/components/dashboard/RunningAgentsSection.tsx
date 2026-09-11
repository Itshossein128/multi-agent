"use client";

import React from "react";
import { useStudioStore } from "@/store/useStudioStore";
import { useDashboardQuery } from "@/hooks/useDashboardQuery";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, Cpu, Zap, Activity, RefreshCw } from "lucide-react";

export function RunningAgentsSection() {
  const { agents } = useStudioStore();
  const { refetch, isFetching } = useDashboardQuery();

  const formatUptime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  };

  return (
    <Card className="border-zinc-800/80 bg-zinc-900/40">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
              <Bot className="h-5 w-5 text-emerald-400" />
              Active Agents Overview
            </CardTitle>
            <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-950/30 text-[11px]">
              {agents.filter((a) => a.status === "running").length} Running
            </Badge>
          </div>
          <CardDescription className="text-xs text-zinc-400 mt-1">
            Real-time status of LangGraph nodes and configured LLM models.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-8 gap-1.5 text-xs cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Syncing..." : "Refresh"}
        </Button>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {agents.map((agent) => {
            const isRunning = agent.status === "running";
            return (
              <div
                key={agent.id}
                className="group relative rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-950/90"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                        isRunning
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-zinc-700 bg-zinc-800/50 text-zinc-400"
                      }`}
                    >
                      <Cpu className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-zinc-100 group-hover:text-white">
                          {agent.name}
                        </h4>
                      </div>
                      <p className="text-xs text-zinc-400">{agent.role}</p>
                      <span className="text-[10px] text-zinc-500 font-mono">Model: {agent.model}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        isRunning ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"
                      }`}
                    />
                    <span
                      className={`text-xs capitalize font-medium ${
                        isRunning ? "text-emerald-400" : "text-zinc-500"
                      }`}
                    >
                      {agent.status}
                    </span>
                  </div>
                </div>

                {/* Current Active Task */}
                <div className="mt-3 rounded-md bg-zinc-900/80 p-2.5 border border-zinc-800/60">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1">
                    <span className="font-medium text-zinc-300 flex items-center gap-1">
                      <Activity className="h-3 w-3 text-blue-400" /> Workload State
                    </span>
                    <span className="text-zinc-500">Up {formatUptime(agent.uptimeSeconds)}</span>
                  </div>
                  <p className="text-xs text-zinc-200 line-clamp-2 leading-relaxed">
                    {agent.currentTask || "Idle — Waiting for dispatched tasks"}
                  </p>
                </div>

                {/* Telemetry Footer */}
                <div className="mt-3 flex items-center justify-between text-xs text-zinc-400 pt-2 border-t border-zinc-800/50">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Zap className="h-3.5 w-3.5 text-amber-400" />
                      {(agent.tokensUsed / 1000).toFixed(1)}k tokens
                    </span>
                    <span>•</span>
                    <span className="text-zinc-300 font-medium">
                      {agent.cost !== null && agent.cost !== undefined ? `$${agent.cost.toFixed(4)}` : "—"}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
