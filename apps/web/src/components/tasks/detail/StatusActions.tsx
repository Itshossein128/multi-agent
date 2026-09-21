"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { statusBadgeConfig } from "@/lib/taskBadge";
import { STATUS_TRANSITIONS, Task, TaskStatus, toCanonicalStatus } from "@/lib/taskStatus";

interface StatusActionsProps {
  task: Task;
  isMutating: boolean;
  onStart: (task: Task) => void;
  onPauseToggle: (task: Task) => void;
  onRetry: (task: Task) => void;
  onMove: (taskId: string, toStatus: TaskStatus) => void;
}

/** Status badge plus the lifecycle action row: start, pause/resume, retry, transitions. */
export function StatusActions({
  task,
  isMutating,
  onStart,
  onPauseToggle,
  onRetry,
  onMove,
}: StatusActionsProps) {
  const canonical = toCanonicalStatus(task.status);
  const badge = statusBadgeConfig(task.status);
  const transitionTargets: TaskStatus[] = STATUS_TRANSITIONS[task.status] ?? [];
  const canStart = !task.paused && (canonical === "backlog" || canonical === "ready");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Status &amp; Actions
        </label>
        <div className="flex items-center gap-1.5">
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}>
            {badge.label}
          </span>
          {task.paused && (
            <span className="rounded bg-amber-950/70 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
              Paused
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        {canStart && (
          <Button
            type="button"
            size="sm"
            disabled={isMutating}
            onClick={() => onStart(task)}
            className="h-7 gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] cursor-pointer"
          >
            <Play className="h-3 w-3" />
            Start Execution
          </Button>
        )}

        {(canonical === "running" || task.paused) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isMutating}
            onClick={() => onPauseToggle(task)}
            className="h-7 gap-1 text-[11px] cursor-pointer"
          >
            {task.paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {task.paused ? "Resume" : "Pause"}
          </Button>
        )}

        {canonical === "failed" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isMutating}
            onClick={() => onRetry(task)}
            className="h-7 gap-1 text-[11px] text-amber-300 cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            Retry Execution ({task.retryCount})
          </Button>
        )}

        {transitionTargets.map((target) => (
          <Button
            key={target}
            type="button"
            variant="outline"
            size="sm"
            disabled={isMutating}
            onClick={() => onMove(task.id, target)}
            className="h-7 text-[11px] cursor-pointer"
          >
            → {statusBadgeConfig(target).label}
          </Button>
        ))}
      </div>
    </div>
  );
}
