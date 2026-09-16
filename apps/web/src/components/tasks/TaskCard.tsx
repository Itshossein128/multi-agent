"use client";

import React from "react";
import Link from "next/link";
import {
  Activity,
  AlertOctagon,
  Clock,
  Cpu,
  ExternalLink,
  GitBranch,
  Link2,
  Lock,
  Pause,
  Play,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { getDependencyBlockers, toCanonicalStatus, Task, TaskStatus } from "@/lib/taskStatus";
import { priorityBadgeClasses, statusBadgeConfig } from "@/lib/taskBadge";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: Task;
  tasksById: Map<string, Task>;
  workflowName?: string;
  isMutating: boolean;
  isDragging: boolean;
  onOpen: (task: Task) => void;
  onMove: (taskId: string, toStatus: TaskStatus) => void;
  onStart: (task: Task) => void;
  onPauseToggle: (task: Task) => void;
  onCancel: (task: Task) => void;
  onRetry: (task: Task) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
}

export function TaskCard({
  task,
  tasksById,
  workflowName,
  isMutating,
  isDragging,
  onOpen,
  onMove: _onMove,
  onStart,
  onPauseToggle,
  onCancel,
  onRetry,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const blockers = getDependencyBlockers(task, tasksById);
  const canonical = toCanonicalStatus(task.status);
  const isTerminal = canonical === "completed" || canonical === "failed" || canonical === "cancelled";
  const badge = statusBadgeConfig(task.status);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", task.id);
    e.dataTransfer.effectAllowed = "move";
    onDragStart(task.id);
  };

  const canStart = !task.paused && (canonical === "backlog" || canonical === "ready");

  return (
    <div
      draggable={!isMutating && !task.paused && !isTerminal}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(task)}
      className={cn(
        "group cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950/90 p-3 space-y-2 transition-colors hover:border-zinc-600",
        isDragging && "opacity-40",
        task.paused && "opacity-75",
        task.priority === "high" && "border-l-2 border-l-red-500/70",
      )}
    >
      {/* Top row: priority + domain status badge + blockers + paused */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-wider",
            priorityBadgeClasses(task.priority),
          )}
        >
          {task.priority}
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        {task.paused && (
          <span className="rounded bg-amber-950/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300 border border-amber-800/80">
            Paused
          </span>
        )}
        {task.retryCount > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
            <RotateCcw className="h-3 w-3" />×{task.retryCount}
          </span>
        )}
        {blockers.length > 0 && (
          <span
            className="flex items-center gap-0.5 text-[10px] text-amber-400"
            title={`Blocked by: ${blockers.map((b) => b.title).join(", ")}`}
          >
            <Lock className="h-3 w-3" />
            {blockers.length}
          </span>
        )}
      </div>

      {/* Title + description */}
      <p className="text-sm font-medium text-zinc-100 leading-snug line-clamp-2">
        {task.title}
      </p>
      {task.description && (
        <p className="text-xs text-zinc-500 leading-snug line-clamp-2">{task.description}</p>
      )}

      {/* Workflow Reference */}
      {workflowName && (
        <div className="flex items-center gap-1 text-[11px] text-indigo-400">
          <GitBranch className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{workflowName}</span>
        </div>
      )}

      {/* Linked Run Badge / Link */}
      {task.runId && (
        <div
          className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300"
          onClick={(e) => e.stopPropagation()}
        >
          <Activity className="h-3 w-3 flex-shrink-0" />
          <Link
            href={`/runs/${task.runId}`}
            className="flex items-center gap-1 hover:underline truncate"
            title="Open backend run execution"
          >
            Run: {task.runId.slice(0, 16)}…
            <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>
      )}

      {/* Last Error if failed */}
      {task.lastError && (
        <div className="rounded bg-red-950/40 p-1.5 border border-red-900/50 flex items-start gap-1 text-[11px] text-red-300">
          <AlertOctagon className="h-3 w-3 flex-shrink-0 mt-0.5" />
          <span className="line-clamp-2">{task.lastError}</span>
        </div>
      )}

      {/* Output preview for finished tasks */}
      {task.output && isTerminal && !task.lastError && (
        <p
          className={cn(
            "rounded bg-zinc-900/80 px-2 py-1 text-[11px] leading-snug line-clamp-2 border border-zinc-800/60 text-emerald-300/80",
          )}
        >
          {task.output}
        </p>
      )}

      {/* Dependencies */}
      {task.dependencies && task.dependencies.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <Link2 className="h-3 w-3 text-zinc-600" />
          {task.dependencies.slice(0, 2).map((depId) => {
            const dep = tasksById.get(depId);
            if (!dep) return null;
            const depDone = toCanonicalStatus(dep.status) === "completed";
            return (
              <span
                key={depId}
                className="flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 border border-zinc-800 max-w-[110px]"
                title={`${dep.title} — ${dep.status}`}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full flex-shrink-0",
                    depDone ? "bg-emerald-400" : "bg-amber-400",
                  )}
                />
                <span className="truncate">{dep.title}</span>
              </span>
            );
          })}
          {task.dependencies.length > 2 && (
            <span className="text-[10px] text-zinc-500">+{task.dependencies.length - 2} more</span>
          )}
        </div>
      )}

      {/* Footer: agent + time + action buttons */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/70">
        <div className="flex items-center gap-2 min-w-0 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1 min-w-0">
            <Cpu className="h-3 w-3 text-zinc-600 flex-shrink-0" />
            <span className="truncate">
              {task.assignedAgents && task.assignedAgents.length > 0
                ? task.assignedAgents.join(", ")
                : task.assignedAgent ?? "Unassigned"}
            </span>
          </span>
          <span className="flex items-center gap-1 flex-shrink-0">
            <Clock className="h-3 w-3 text-zinc-600" />
            {formatRelativeTime(task.createdAt)}
          </span>
        </div>

        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {canStart && (
            <CardActionButton
              title="Start Run"
              disabled={isMutating}
              onClick={() => onStart(task)}
            >
              <Play className="h-3.5 w-3.5 text-emerald-400" />
            </CardActionButton>
          )}
          {(canonical === "running" || task.paused) && (
            <CardActionButton
              title={task.paused ? "Resume" : "Pause"}
              disabled={isMutating}
              onClick={() => onPauseToggle(task)}
            >
              {task.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </CardActionButton>
          )}
          {canonical === "failed" && (
            <CardActionButton
              title="Retry Run"
              disabled={isMutating}
              onClick={() => onRetry(task)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </CardActionButton>
          )}
          {!isTerminal && (
            <CardActionButton
              title="Cancel task"
              disabled={isMutating}
              danger
              onClick={() => onCancel(task)}
            >
              <XCircle className="h-3.5 w-3.5" />
            </CardActionButton>
          )}
        </div>
      </div>
    </div>
  );
}

function CardActionButton({
  title,
  disabled,
  danger,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors cursor-pointer disabled:opacity-40",
        danger ? "hover:bg-red-950/60 hover:text-red-400" : "hover:bg-zinc-800 hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}
