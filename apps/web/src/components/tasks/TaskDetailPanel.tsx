"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertOctagon,
  Ban,
  CircleCheck,
  ExternalLink,
  GitBranch,
  Link2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  BoardAgent,
  BoardWorkflow,
  STATUS_TRANSITIONS,
  TASK_PRIORITIES,
  Task,
  TaskPriority,
  TaskStatus,
  formatRelativeTime,
  statusBadgeConfig,
  toCanonicalStatus,
} from "@/lib/taskStatus";
import { Button } from "@/components/ui/button";
import { UpdateTaskInput } from "@/hooks/useTasksQuery";

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
const selectClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500";

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
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignedAgent, setAssignedAgent] = useState(task.assignedAgent ?? "");
  const [workflowId, setWorkflowId] = useState(task.workflowId ?? "");
  const [parentTaskId, setParentTaskId] = useState(task.parentTaskId ?? "");
  const [dependencies, setDependencies] = useState<string[]>(task.dependencies ?? []);
  const [output, setOutput] = useState(task.output ?? "");
  const [addDependencyId, setAddDependencyId] = useState("");

  const canonical = toCanonicalStatus(task.status);
  const isTerminal = canonical === "completed" || canonical === "failed" || canonical === "cancelled";
  const badge = statusBadgeConfig(task.status);

  const candidateDeps = tasks.filter(
    (t) => t.id !== task.id && !dependencies.includes(t.id),
  );

  const handleSave = async () => {
    await onUpdate({
      taskId: task.id,
      title,
      description,
      priority,
      assignedAgent: assignedAgent || null,
      assignedAgents: assignedAgent ? [assignedAgent] : [],
      workflowId: workflowId || null,
      parentTaskId: parentTaskId || null,
      dependencies,
    });
  };

  const handleAddDependency = () => {
    if (!addDependencyId || dependencies.includes(addDependencyId)) return;
    setDependencies((prev) => [...prev, addDependencyId]);
    setAddDependencyId("");
  };

  const transitionTargets = STATUS_TRANSITIONS[task.status] ?? [];
  const canStart = !task.paused && (canonical === "backlog" || canonical === "ready");

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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
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
          {/* Status + Domain Badge + Actions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className={labelClass}>Status & Actions</label>
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

            {/* Action buttons */}
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

          {/* Linked Backend Run Inspection */}
          {task.runId && (
            <div className="rounded-lg border border-cyan-800/40 bg-cyan-950/20 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300">
                  <Activity className="h-3.5 w-3.5" />
                  Linked Runtime Run
                </span>
                <Link
                  href={`/runs/${task.runId}`}
                  className="flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                >
                  View Details
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
              <p className="font-mono text-xs text-cyan-200 truncate">{task.runId}</p>
            </div>
          )}

          {/* Last Failure Inspection */}
          {task.lastError && (
            <div className="rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 space-y-1 text-xs text-rose-300">
              <span className="flex items-center gap-1 font-semibold text-rose-200">
                <AlertOctagon className="h-3.5 w-3.5 flex-shrink-0" />
                Last Execution Error
              </span>
              <p className="font-mono text-[11px] whitespace-pre-wrap">{task.lastError}</p>
            </div>
          )}

          {/* Priority + Agent */}
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

          {/* Workflow + Parent Task */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelClass}>Workflow</label>
              <select
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
                className={selectClass}
              >
                <option value="">None (Direct Agent)</option>
                {workflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Parent Task</label>
              <select
                value={parentTaskId}
                onChange={(e) => setParentTaskId(e.target.value)}
                className={selectClass}
              >
                <option value="">None (Root Task)</option>
                {tasks.filter((t) => t.id !== task.id).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
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
              Dependencies ({dependencies.length})
            </label>
            <div className="space-y-1.5">
              {dependencies.length === 0 && (
                <p className="text-xs text-zinc-600">No dependencies configured.</p>
              )}
              {dependencies.map((depId) => {
                const dep = tasks.find((t) => t.id === depId);
                const depDone = dep && toCanonicalStatus(dep.status) === "completed";
                return (
                  <div
                    key={depId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                          depDone ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                      />
                      <span className="truncate text-xs text-zinc-200">
                        {dep?.title ?? "Unknown task"}
                      </span>
                      <span className="flex-shrink-0 text-[10px] capitalize text-zinc-500">
                        {dep ? statusBadgeConfig(dep.status).label : ""}
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

          {/* Final Output / Execution Result */}
          <div className="space-y-1.5">
            <label className={labelClass}>Final Output / Execution Result</label>
            <textarea
              value={output}
              rows={4}
              readOnly
              placeholder={isTerminal ? "Execution produced no output." : "Execution output will appear here once started."}
              className={`${selectClass} cursor-default opacity-80`}
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
