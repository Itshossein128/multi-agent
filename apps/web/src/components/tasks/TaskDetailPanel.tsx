"use client";

import React from "react";
import { Ban, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BoardAgent, BoardWorkflow, Task, TaskStatus, toCanonicalStatus } from "@/lib/taskStatus";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { UpdateTaskInput } from "@/hooks/useTasksQuery";
import { StatusActions } from "./detail/StatusActions";
import { TaskFields } from "./detail/TaskFields";
import { DependencyEditor } from "./detail/DependencyEditor";
import { LinkedRunCard } from "./detail/LinkedRunCard";
import { LastErrorCard } from "./detail/LastErrorCard";
import { useTaskDraft } from "./detail/useTaskDraft";

interface TaskDetailPanelProps {
  task: Task;
  tasks: Task[];
  agents: BoardAgent[];
  workflows: BoardWorkflow[];
  isMutating: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<unknown>;
  onMove: (taskId: string, toStatus: TaskStatus) => void;
  onStart: (task: Task) => void;
  onPauseToggle: (task: Task) => void;
  onRetry: (task: Task) => void;
  onCancel: (task: Task) => void;
  onDelete: (task: Task) => void;
}

const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-zinc-500";

/**
 * Task detail panel shell: composition and layout only.
 * Form state lives in useTaskDraft; sections live in ./detail/.
 */
export function TaskDetailPanel({
  task,
  tasks,
  agents,
  workflows,
  isMutating,
  errorMessage,
  onClose,
  onUpdate,
  onMove,
  onStart,
  onPauseToggle,
  onRetry,
  onCancel,
  onDelete,
}: TaskDetailPanelProps) {
  const draft = useTaskDraft(task);
  const canonical = toCanonicalStatus(task.status);
  const isTerminal = canonical === "completed" || canonical === "failed" || canonical === "cancelled";

  const handleSave = async () => {
    await onUpdate(draft.savePayload());
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-lg flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1">
            <label className={labelClass}>Title</label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => draft.setTitle(e.target.value)}
              disabled={isMutating}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <div className="pt-1 flex items-center gap-2 flex-wrap font-mono text-[10px] text-zinc-500">
              <span>{task.id}</span>
              <span>· created {formatRelativeTime(task.createdAt)}</span>
              {task.startedAt && <span>· started {formatRelativeTime(task.startedAt)}</span>}
              {task.completedAt && <span>· completed {formatRelativeTime(task.completedAt)}</span>}
              {task.retryCount > 0 && <span>· retries {task.retryCount}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <StatusActions
            task={task}
            isMutating={isMutating}
            onStart={onStart}
            onPauseToggle={onPauseToggle}
            onRetry={onRetry}
            onMove={onMove}
          />

          <LinkedRunCard runId={task.runId} />
          <LastErrorCard lastError={task.lastError} />

          <TaskFields
            task={task}
            tasks={tasks}
            agents={agents}
            workflows={workflows}
            isMutating={isMutating}
            draft={draft}
          />

          <DependencyEditor
            task={task}
            tasks={tasks}
            dependencies={draft.dependencies}
            onAddDependency={draft.addDependency}
            onRemoveDependency={draft.removeDependency}
          />

          {errorMessage && (
            <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {errorMessage}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-1.5">
            {!isTerminal && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isMutating}
                onClick={() => onCancel(task)}
                className="gap-1 text-xs cursor-pointer"
              >
                <Ban className="h-3.5 w-3.5" />
                Cancel
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isMutating}
              onClick={() => onDelete(task)}
              className="gap-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>

          <Button
            type="button"
            size="sm"
            disabled={isMutating}
            onClick={handleSave}
            className="gap-1 bg-indigo-600 text-xs text-white hover:bg-indigo-500 cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            {isMutating ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </aside>
    </div>
  );
}
