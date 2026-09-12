"use client";

import React, { useState } from "react";
import { useStudioStore } from "@/store/useStudioStore";
import { useDashboardQuery } from "@/hooks/useDashboardQuery";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ListOrdered,
  AlertOctagon,
  RotateCcw,
  XCircle,
  Sparkles,
  ShieldCheck,
  Plus,
} from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";
import { matchesTimeFilter } from "@/lib/dashboardFilters";
import Link from "next/link";

export function QueueAndFailedSection() {
  const { queue, failedTasks, timeFilter } = useStudioStore();
  const { retryTask, cancelTask, enqueueTask, isMutating } = useDashboardQuery();

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [targetRole, setTargetRole] = useState("Developer Agent");
  const [showAddForm, setShowAddForm] = useState(false);

  const filteredQueue = queue.filter((item) => matchesTimeFilter(item.period, timeFilter));
  const filteredFailed = failedTasks.filter((item) => matchesTimeFilter(item.period, timeFilter));

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    enqueueTask({
      title: newTaskTitle.trim(),
      role: targetRole,
      priority: "medium",
    });
    setNewTaskTitle("");
    setShowAddForm(false);
  };

  const getPriorityBadge = (priority: "high" | "medium" | "low") => {
    switch (priority) {
      case "high":
        return (
          <Badge variant="destructive" className="text-[10px] uppercase font-bold tracking-wider">
            High
          </Badge>
        );
      case "medium":
        return (
          <Badge variant="warning" className="text-[10px] uppercase font-semibold tracking-wider">
            Medium
          </Badge>
        );
      case "low":
        return (
          <Badge variant="outline" className="text-[10px] uppercase text-zinc-400">
            Low
          </Badge>
        );
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Task Queue */}
      <Card className="border-zinc-800/80 bg-zinc-900/40">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                <ListOrdered className="h-5 w-5 text-blue-400" />
                Execution Queue
              </CardTitle>
              <Badge variant="outline" className="text-blue-400 border-blue-500/30 bg-blue-950/30 text-[11px]">
                {filteredQueue.length} pending
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-400 mt-1">
              Board tasks (Todo/Planning) plus queued workflow runs — same window as the stat cards.
            </CardDescription>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            className="h-8 text-xs gap-1.5 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            Enqueue Task
          </Button>
        </CardHeader>

        <CardContent>
          {showAddForm && (
            <form onSubmit={handleCreateTask} className="mb-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2.5">
              <div className="text-xs font-semibold text-zinc-200">Dispatch New Task</div>
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="E.g., Implement auth middleware validation endpoint"
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex items-center justify-between gap-2">
                <select
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 focus:outline-none"
                >
                  <option value="Developer Agent">Developer Agent</option>
                  <option value="Doc Generator Agent">Doc Generator Agent</option>
                  <option value="Orchestrator Agent">Orchestrator Agent</option>
                </select>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAddForm(false)}
                    className="h-7 text-xs text-zinc-400 hover:text-white"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isMutating || !newTaskTitle.trim()}
                    className="h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white cursor-pointer"
                  >
                    Submit
                  </Button>
                </div>
              </div>
            </form>
          )}

          {filteredQueue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-zinc-500">
              <Sparkles className="h-8 w-8 text-zinc-600 mb-2" />
              <p className="text-sm font-medium text-zinc-300">Queue is currently clear</p>
              <p className="text-xs text-zinc-500">
                Board Todo/Planning tasks and queued runs for this period appear here.{" "}
                <Link href="/tasks" className="text-blue-300 hover:underline">Open task board</Link>
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredQueue.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-3.5 transition-colors hover:border-zinc-700"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getPriorityBadge(task.priority)}
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {task.source === "run" ? "Run" : "Board"}
                      </Badge>
                      <span className="text-xs text-zinc-400 font-medium">
                        Target: {task.agentRole}
                      </span>
                      <span className="text-[11px] text-zinc-600">• {formatDateTime(task.queuedAt)}</span>
                    </div>
                    <p className="text-sm font-medium text-zinc-200 truncate">
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
                    <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                      <span>Est. ~{(task.estimatedTokens / 1000).toFixed(1)}k tokens</span>
                      <span>ID: {task.id}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelTask(task.id)}
                      disabled={isMutating}
                      className="h-8 text-xs text-zinc-400 hover:text-red-400 cursor-pointer"
                      title="Cancel Task"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Failed Tasks */}
      <Card className="border-zinc-800/80 bg-zinc-900/40">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold text-white flex items-center gap-2">
                <AlertOctagon className="h-5 w-5 text-rose-400" />
                Failures
              </CardTitle>
              <Badge variant={filteredFailed.length > 0 ? "destructive" : "outline"} className="text-[11px]">
                {filteredFailed.length} Issues
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-400 mt-1">
              Board Failed column plus failed workflow runs for the selected period.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {filteredFailed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-zinc-500">
              <ShieldCheck className="h-8 w-8 text-emerald-500/80 mb-2" />
              <p className="text-sm font-medium text-zinc-300">Zero failures in this period</p>
              <p className="text-xs text-zinc-500">
                Board failures show on <Link href="/tasks" className="text-rose-300 hover:underline">/tasks</Link>;
                run failures on <Link href="/runs?status=failed" className="text-rose-300 hover:underline">/runs</Link>.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredFailed.map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border border-red-900/40 bg-red-950/20 p-3.5 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="destructive" className="text-[10px]">
                          Attempt {task.retryCount} Failed
                        </Badge>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {task.source === "run" ? "Run" : "Board"}
                        </Badge>
                        <span className="text-xs text-zinc-400">{task.agent}</span>
                        <span className="text-[11px] text-zinc-500">• {formatDateTime(task.failedAt)}</span>
                      </div>
                      <h5 className="text-sm font-semibold text-zinc-200 mt-1">
                        {task.source === "run" ? (
                          <Link href={`/runs/${encodeURIComponent(task.id)}`} className="hover:text-indigo-300 hover:underline">
                            {task.title}
                          </Link>
                        ) : (
                          <Link href="/tasks" className="hover:text-indigo-300 hover:underline">
                            {task.title}
                          </Link>
                        )}
                      </h5>
                    </div>
                  </div>

                  <div className="rounded bg-black/40 p-2 text-xs font-mono text-rose-300/90 border border-red-900/30 break-all">
                    {task.error}
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs">
                    <span className="text-zinc-500">
                      {task.recoverable ? "Recoverable with manual intervention" : "Unrecoverable error"}
                    </span>
                    <Button
                      variant={task.recoverable ? "default" : "secondary"}
                      size="sm"
                      onClick={() => retryTask(task.id)}
                      disabled={isMutating}
                      className="h-7 text-xs gap-1 cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Retry to Queue
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
