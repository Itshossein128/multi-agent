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

export function QueueAndFailedSection() {
  const { queue, failedTasks } = useStudioStore();
  const { retryTask, cancelTask, enqueueTask, isMutating } = useDashboardQuery();

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [targetRole, setTargetRole] = useState("Developer Agent");
  const [showAddForm, setShowAddForm] = useState(false);

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
                {queue.length} Tasks
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-400 mt-1">
              Live workloads awaiting agent capacity from LangGraph engine.
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

          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-zinc-500">
              <Sparkles className="h-8 w-8 text-zinc-600 mb-2" />
              <p className="text-sm font-medium text-zinc-300">Queue is currently clear</p>
              <p className="text-xs text-zinc-500">Active agent runs or scheduled jobs will appear here.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {queue.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/70 p-3.5 transition-colors hover:border-zinc-700"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {getPriorityBadge(task.priority)}
                      <span className="text-xs text-zinc-400 font-medium">
                        Target: {task.agentRole}
                      </span>
                      <span className="text-[11px] text-zinc-600">• {task.queuedAt}</span>
                    </div>
                    <p className="text-sm font-medium text-zinc-200 truncate">
                      {task.title}
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
                Failed Tasks & Incidents
              </CardTitle>
              <Badge variant={failedTasks.length > 0 ? "destructive" : "outline"} className="text-[11px]">
                {failedTasks.length} Issues
              </Badge>
            </div>
            <CardDescription className="text-xs text-zinc-400 mt-1">
              Exceptions tracked via LangGraph / Langfuse error handlers.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {failedTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-zinc-500">
              <ShieldCheck className="h-8 w-8 text-emerald-500/80 mb-2" />
              <p className="text-sm font-medium text-zinc-300">Zero active failures</p>
              <p className="text-xs text-zinc-500">All agent executions have completed normally.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {failedTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-lg border border-red-900/40 bg-red-950/20 p-3.5 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive" className="text-[10px]">
                          Attempt {task.retryCount} Failed
                        </Badge>
                        <span className="text-xs text-zinc-400">{task.agent}</span>
                        <span className="text-[11px] text-zinc-500">• {task.failedAt}</span>
                      </div>
                      <h5 className="text-sm font-semibold text-zinc-200 mt-1">
                        {task.title}
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
