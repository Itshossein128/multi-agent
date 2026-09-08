"use client";

import React, { useState } from "react";
import {
  Ban,
  CircleCheck,
  Link2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import {
  BoardAgent,
  STATUS_TRANSITIONS,
  TASK_COLUMNS,
  TASK_PRIORITIES,
  Task,
  TaskPriority,
  TaskStatus,
  formatRelativeTime,
} from "@/lib/taskStatus";
import { Button } from "@/components/ui/button";
import { UpdateTaskInput } from "@/hooks/useTasksQuery";

interface TaskDetailPanelProps {
  task: Task;
  tasks: Task[];
  agents: BoardAgent[];
  isMutating: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onUpdate: (input: UpdateTaskInput) => Promise<unknown>;
  onMove: (taskId: string, toStatus: TaskStatus) => void;
  onPauseToggle: (task: Task) => void;
  onRetry: (task: Task) => void;
  onCancel: (task: Task) => void;
}

const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-zinc-500";
const selectClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500";

function statusLabel(status: TaskStatus): string {
  return TASK_COLUMNS.find((c) => c.status === status)?.label ?? status;
}

export function TaskDetailPanel({
  task,
  tasks,
  agents,
  isMutating,
  errorMessage,
  onClose,
  onUpdate,
  onMove,
  onPauseToggle,
  onRetry,
  onCancel,
}: TaskDetailPanelProps) {
  // State is seeded from props; the parent re-mounts this panel with a
  // `key={task.id}` whenever a different task is opened.
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignedAgent, setAssignedAgent] = useState(task.assignedAgent ?? "");
  const [dependencies, setDependencies] = useState<string[]>(task.dependencies);
  const [output, setOutput] = useState(task.output ?? "");
  const [addDependencyId, setAddDependencyId] = useState("");

  const isTerminal = task.status === "done" || task.status === "failed";
  const candidateDeps = tasks.filter(
    (t) => t.id !== task.id && !dependencies.includes(t.id)
  );

  const handleSave = async () => {
    await onUpdate({
      taskId: task.id,
      title,
      description,
      priority,
      assignedAgent: assignedAgent || null,
      dependencies,
      output: output || null,
    });
  };

  const handleAddDependency = () => {
    if (!addDependencyId || dependencies.includes(addDependencyId)) return;
    setDependencies((prev) => [...prev, addDependencyId]);
    setAddDependencyId("");
  };

  const transitionTargets = STATUS_TRANSITIONS[task.status] ?? [];

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs" onClick={onClose} />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1">
            <label className={labelClass}>Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isMutating}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="pt-1 font-mono text-[10px] text-zinc-600">
              {task.id} · created {formatRelativeTime(task.createdAt)} · retries {task.retryCount}
            </p>
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
          {/* Status + transitions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={labelClass}>Status</label>
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] font-semibold text-zinc-200">
                  {statusLabel(task.status)}
                </span>
                {task.paused && (
                  <span className="rounded bg-amber-950/70 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                    Paused
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
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
                  → {statusLabel(target)}
                </Button>
              ))}
              {task.status === "failed" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isMutating}
                  onClick={() => onRetry(task)}
                  className="h-7 gap-1 text-[11px] cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry ({task.retryCount})
                </Button>
              )}
              {task.status === "review" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isMutating}
                  onClick={() => onMove(task.id, "done")}
                  className="h-7 gap-1 text-[11px] cursor-pointer"
                >
                  <CircleCheck className="h-3 w-3" />
                  Approve
                </Button>
              )}
            </div>
          </div>

          {/* Priority + agent */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelClass}>Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className={selectClass}
              >
                {TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Assigned Agent</label>
              <select
                value={assignedAgent}
                onChange={(e) => setAssignedAgent(e.target.value)}
                className={selectClass}
              >
                <option value="">Unassigned</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.name}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className={labelClass}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className={selectClass}
            />
          </div>

          {/* Dependencies */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              <Link2 className="h-3 w-3" />
              Depends On ({dependencies.length})
            </label>
            <div className="space-y-1.5">
              {dependencies.length === 0 && (
                <p className="text-xs text-zinc-600">No dependencies.</p>
              )}
              {dependencies.map((depId) => {
                const dep = tasks.find((t) => t.id === depId);
                return (
                  <div
                    key={depId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                          dep?.status === "done" ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                      />
                      <span className="truncate text-xs text-zinc-200">
                        {dep?.title ?? "Unknown task"}
                      </span>
                      <span className="flex-shrink-0 text-[10px] capitalize text-zinc-500">
                        {dep ? statusLabel(dep.status) : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      title="Remove dependency"
                      onClick={() =>
                        setDependencies((prev) => prev.filter((id) => id !== depId))
                      }
                      className="text-zinc-500 hover:text-red-400 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            {candidateDeps.length > 0 && (
              <div className="flex gap-1.5">
                <select
                  value={addDependencyId}
                  onChange={(e) => setAddDependencyId(e.target.value)}
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:outline-none"
                >
                  <option value="">Add dependency…</option>
                  {candidateDeps.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddDependency}
                  disabled={!addDependencyId}
                  className="h-8 w-8 p-0 cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Output */}
          <div className="space-y-1.5">
            <label className={labelClass}>
              Output / Result {task.status === "failed" ? "(failure reason)" : ""}
            </label>
            <textarea
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              rows={3}
              placeholder={isTerminal ? "Summary of what the agent produced..." : "Not produced yet"}
              className={selectClass}
            />
          </div>

          {errorMessage && (
            <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {errorMessage}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-5 py-3.5">
          {!isTerminal ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isMutating}
              onClick={() => onCancel(task)}
              className="gap-1 text-xs cursor-pointer"
            >
              <Ban className="h-3.5 w-3.5" />
              Cancel Task
            </Button>
          ) : (
            <span />
          )}
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
