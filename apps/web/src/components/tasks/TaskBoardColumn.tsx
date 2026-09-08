"use client";

import React, { useState } from "react";
import {
  AlertOctagon,
  CircleCheck,
  ClipboardList,
  Eye,
  Hourglass,
  ListTodo,
  Play,
  Plus,
} from "lucide-react";
import { Task, TaskColumnConfig, TaskStatus } from "@/lib/taskStatus";
import { cn } from "@/lib/utils";
import { TaskCard } from "@/components/tasks/TaskCard";

const COLUMN_ICONS: Record<TaskStatus, React.ComponentType<{ className?: string }>> = {
  todo: ListTodo,
  planning: ClipboardList,
  in_progress: Play,
  waiting_tool: Hourglass,
  review: Eye,
  done: CircleCheck,
  failed: AlertOctagon,
};

interface TaskBoardColumnProps {
  config: TaskColumnConfig;
  tasks: Task[];
  tasksById: Map<string, Task>;
  isMutating: boolean;
  draggingTaskId: string | null;
  onOpenTask: (task: Task) => void;
  onMoveTask: (taskId: string, toStatus: TaskStatus) => void;
  onPauseToggle: (task: Task) => void;
  onCancelTask: (task: Task) => void;
  onRetryTask: (task: Task) => void;
  onAddTask: (status: TaskStatus) => void;
  onDragStartTask: (taskId: string) => void;
  onDragEndTask: () => void;
}

export function TaskBoardColumn({
  config,
  tasks,
  tasksById,
  isMutating,
  draggingTaskId,
  onOpenTask,
  onMoveTask,
  onPauseToggle,
  onCancelTask,
  onRetryTask,
  onAddTask,
  onDragStartTask,
  onDragEndTask,
}: TaskBoardColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const Icon = COLUMN_ICONS[config.status];

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only clear when actually leaving the column (not moving between children).
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const taskId = e.dataTransfer.getData("text/plain");
    if (taskId) onMoveTask(taskId, config.status);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "flex w-[280px] flex-shrink-0 flex-col rounded-xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-sm transition-shadow",
        isDragOver && config.dragOverRing
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn("h-4 w-4 flex-shrink-0", config.accent)} />
          <span className={cn("text-xs font-semibold uppercase tracking-wider", config.accent)}>
            {config.label}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", config.dot)} />
            <span className="text-xs text-zinc-500">{tasks.length}</span>
          </span>
        </div>
        <button
          type="button"
          title={`New task in ${config.label}`}
          onClick={() => onAddTask(config.status)}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 pb-3 pt-1 min-h-[120px] max-h-[calc(100vh-320px)]">
        {tasks.length === 0 && (
          <div
            className={cn(
              "flex h-24 items-center justify-center rounded-lg border border-dashed text-xs",
              isDragOver ? "border-zinc-500 text-zinc-300" : "border-zinc-800 text-zinc-600"
            )}
          >
            {isDragOver ? "Drop to move here" : "No tasks"}
          </div>
        )}
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            tasksById={tasksById}
            isMutating={isMutating}
            isDragging={draggingTaskId === task.id}
            onOpen={onOpenTask}
            onMove={onMoveTask}
            onPauseToggle={onPauseToggle}
            onCancel={onCancelTask}
            onRetry={onRetryTask}
            onDragStart={onDragStartTask}
            onDragEnd={onDragEndTask}
          />
        ))}
      </div>
    </div>
  );
}
