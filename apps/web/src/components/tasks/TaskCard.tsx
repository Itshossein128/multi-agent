"use client";

import React from "react";
import {
  CircleCheck,
  Clock,
  Cpu,
  Link2,
  Lock,
  Pause,
  Play,
  RotateCcw,
  XCircle,
} from "lucide-react";
import {
  Task,
  TaskStatus,
  canMoveStatus,
  formatRelativeTime,
  getDependencyBlockers,
  priorityBadgeClasses,
} from "@/lib/taskStatus";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: Task;
  tasksById: Map<string, Task>;
  isMutating: boolean;
  isDragging: boolean;
  onOpen: (task: Task) => void;
  onMove: (taskId: string, toStatus: TaskStatus) => void;
  onPauseToggle: (task: Task) => void;
  onCancel: (task: Task) => void;
  onRetry: (task: Task) => void;
  onDragStart: (taskId: string) => void;
  onDragEnd: () => void;
}

export function TaskCard({
  task,
  tasksById,
  isMutating,
  isDragging,
  onOpen,
  onMove,
  onPauseToggle,
  onCancel,
  onRetry,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const blockers = getDependencyBlockers(task, tasksById);
  const isTerminal = task.status === "done" || task.status === "failed";

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", task.id);
    e.dataTransfer.effectAllowed = "move";
    onDragStart(task.id);
  };

  const startStatus: TaskStatus | null =
    task.status === "in_progress" || task.paused
      ? null
      : canMoveStatus(task.status, "in_progress")
        ? "in_progress"
        : null;

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
        task.priority === "high" && "border-l-2 border-l-red-500/70"
      )}
    >
      {/* Top row: priority + paused + blocked */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-wider",
            priorityBadgeClasses(task.priority)
          )}
        >
          {task.priority}
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

      {/* Output preview for finished tasks */}
      {task.output && isTerminal && (
        <p
          className={cn(
            "rounded bg-zinc-900/80 px-2 py-1 text-[11px] leading-snug line-clamp-2 border border-zinc-800/60",
            task.status === "failed" ? "text-rose-300/90" : "text-emerald-300/80"
          )}
        >
          {task.output}
        </p>
      )}

      {/* Dependencies */}
      {task.dependencies.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <Link2 className="h-3 w-3 text-zinc-600" />
          {task.dependencies.slice(0, 2).map((depId) => {
            const dep = tasksById.get(depId);
            if (!dep) return null;
            return (
              <span
                key={depId}
                className="flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400 border border-zinc-800 max-w-[110px]"
                title={`${dep.title} — ${dep.status.replace("_", " ")}`}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full flex-shrink-0",
                    dep.status === "done" ? "bg-emerald-400" : "bg-amber-400"
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

      {/* Footer: agent + time + actions */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-800/70">
        <div className="flex items-center gap-2 min-w-0 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1 min-w-0">
            <Cpu className="h-3 w-3 text-zinc-600 flex-shrink-0" />
            <span className="truncate">{task.assignedAgent ?? "Unassigned"}</span>
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
          {startStatus && !task.paused && (
            <CardActionButton
              title={`Move to In Progress`}
              disabled={isMutating}
              onClick={() => onMove(task.id, startStatus)}
            >
              <Play className="h-3.5 w-3.5" />
            </CardActionButton>
          )}
          {(task.status === "in_progress" || task.paused) && (
            <CardActionButton
              title={task.paused ? "Resume" : "Pause"}
              disabled={isMutating}
              onClick={() => onPauseToggle(task)}
            >
              {task.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </CardActionButton>
          )}
          {task.status === "review" && (
            <CardActionButton
              title="Mark Done"
              disabled={isMutating}
              onClick={() => onMove(task.id, "done")}
            >
              <CircleCheck className="h-3.5 w-3.5" />
            </CardActionButton>
          )}
          {task.status === "failed" && (
            <CardActionButton
              title="Retry (back to Todo)"
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
        danger ? "hover:bg-red-950/60 hover:text-red-400" : "hover:bg-zinc-800 hover:text-zinc-100"
      )}
    >
      {children}
    </button>
  );
}
