"use client";

import React, { useEffect, useState } from "react";
import { Link2, Sparkles, X } from "lucide-react";
import {
  BoardAgent,
  BoardWorkflow,
  TASK_COLUMNS,
  TASK_PRIORITIES,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/lib/taskStatus";
import { Button } from "@/components/ui/button";
import { CreateTaskInput } from "@/hooks/useTasksQuery";

interface EntityOption {
  id: string;
  name: string;
}

interface CreateTaskModalProps {
  defaultStatus: TaskStatus;
  tasks: Task[];
  agents: BoardAgent[];
  workflows: BoardWorkflow[];
  isMutating: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onCreate: (input: CreateTaskInput) => Promise<unknown>;
}

const selectClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500";
const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-zinc-500";

export function CreateTaskModal({
  defaultStatus,
  tasks,
  agents,
  workflows,
  isMutating,
  errorMessage,
  onClose,
  onCreate,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [assignedAgent, setAssignedAgent] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [parentTaskId, setParentTaskId] = useState("");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [workspaces, setWorkspaces] = useState<EntityOption[]>([]);
  const [projects, setProjects] = useState<EntityOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wsRes, projRes] = await Promise.all([fetch("/api/workspaces"), fetch("/api/projects")]);
        const [wsBody, projBody] = await Promise.all([wsRes.json(), projRes.json()]);
        if (!wsRes.ok) throw new Error(wsBody.error ?? "Failed to load workspaces");
        if (!projRes.ok) throw new Error(projBody.error ?? "Failed to load projects");
        if (cancelled) return;
        const ws = (wsBody as EntityOption[]) ?? [];
        const proj = (projBody as EntityOption[]) ?? [];
        setWorkspaces(ws);
        setProjects(proj);
        if (ws[0]) setWorkspaceId(ws[0].id);
        if (proj[0]) setProjectIds([proj[0].id]);
      } catch (err) {
        if (!cancelled) setOptionsError(err instanceof Error ? err.message : "Failed to load options");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleDependency = (taskId: string) => {
    setDependencies((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  };

  const toggleProject = (id: string) => {
    setProjectIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isMutating || !workspaceId || projectIds.length === 0) return;
    await onCreate({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      status,
      assignedAgent: assignedAgent || null,
      assignedAgents: assignedAgent ? [assignedAgent] : [],
      workflowId: workflowId || null,
      parentTaskId: parentTaskId || null,
      dependencies,
      workspaceId,
      projectIds,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            Create Task
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4 overflow-y-auto flex-1">
          <div className="space-y-1.5">
            <label className={labelClass}>Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="E.g., Implement JWT auth middleware"
              autoFocus
              className={selectClass}
            />
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Acceptance criteria, context, links..."
              rows={3}
              className={selectClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelClass}>Workspace *</label>
              <select
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                className={selectClass}
                required
              >
                <option value="">Select workspace</option>
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>{ws.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Projects * ({projectIds.length})</label>
              <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                {projects.length === 0 && <p className="text-xs text-zinc-600 px-1">No active projects.</p>}
                {projects.map((project) => (
                  <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-800/60">
                    <input
                      type="checkbox"
                      checked={projectIds.includes(project.id)}
                      onChange={() => toggleProject(project.id)}
                      className="h-3.5 w-3.5 accent-indigo-500"
                    />
                    <span className="truncate text-zinc-200">{project.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

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
              <label className={labelClass}>Initial Column</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className={selectClass}
              >
                {TASK_COLUMNS.filter((c) => c.id !== "done" && c.id !== "failed").map(
                  (c) => (
                    <option key={c.targetStatus} value={c.targetStatus}>
                      {c.label}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={labelClass}>Assign Agent</label>
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
            <div className="space-y-1.5">
              <label className={labelClass}>Workflow (Optional)</label>
              <select
                value={workflowId}
                onChange={(e) => setWorkflowId(e.target.value)}
                className={selectClass}
              >
                <option value="">No workflow selected</option>
                {workflows.map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelClass}>Parent Task (Optional)</label>
            <select
              value={parentTaskId}
              onChange={(e) => setParentTaskId(e.target.value)}
              className={selectClass}
            >
              <option value="">None (Top-level task)</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              <Link2 className="h-3 w-3" />
              Dependencies ({dependencies.length})
            </label>
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
              {tasks.length === 0 && (
                <p className="px-1 py-2 text-xs text-zinc-600">No other tasks to depend on yet.</p>
              )}
              {tasks.map((task) => (
                <label
                  key={task.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-zinc-800/60"
                >
                  <input
                    type="checkbox"
                    checked={dependencies.includes(task.id)}
                    onChange={() => toggleDependency(task.id)}
                    className="h-3.5 w-3.5 accent-indigo-500"
                  />
                  <span className="flex-1 truncate text-zinc-200">{task.title}</span>
                  <span className="text-[10px] text-zinc-500 capitalize">
                    {task.status.replace("_", " ")}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {(errorMessage || optionsError) && (
            <p className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {errorMessage ?? optionsError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800/60">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-xs cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isMutating || !title.trim() || !workspaceId || projectIds.length === 0}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs cursor-pointer"
            >
              {isMutating ? "Creating..." : "Create Task"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
