"use client";

import { useEffect, useState } from "react";
import { BoardAgent, BoardWorkflow, Task, TaskPriority, TASK_PRIORITIES, toCanonicalStatus } from "@/lib/taskStatus";

const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-zinc-500";
const selectClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500";

interface EntityOption {
  id: string;
  name: string;
}

interface TaskFieldsProps {
  task: Task;
  tasks: Task[];
  agents: BoardAgent[];
  workflows: BoardWorkflow[];
  isMutating: boolean;
  draft: {
    priority: TaskPriority;
    setPriority: (value: TaskPriority) => void;
    assignedAgent: string;
    setAssignedAgent: (value: string) => void;
    workflowId: string;
    setWorkflowId: (value: string) => void;
    parentTaskId: string;
    setParentTaskId: (value: string) => void;
    description: string;
    setDescription: (value: string) => void;
    workspaceId: string;
    setWorkspaceId: (value: string) => void;
    projectIds: string[];
    setProjectIds: (value: string[]) => void;
  };
}

/**
 * Assignment and description fields: priority, agent, workflow, parent task,
 * workspace/projects, description, and the read-only execution output.
 */
export function TaskFields({ task, tasks, agents, workflows, isMutating, draft }: TaskFieldsProps) {
  const canonical = toCanonicalStatus(task.status);
  const isTerminal = canonical === "completed" || canonical === "failed" || canonical === "cancelled";
  const [workspaces, setWorkspaces] = useState<EntityOption[]>([]);
  const [projects, setProjects] = useState<EntityOption[]>([]);
  const [retiredProjects, setRetiredProjects] = useState<EntityOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [wsRes, projRes, retiredRes] = await Promise.all([
          fetch("/api/workspaces"),
          fetch("/api/projects"),
          fetch("/api/projects?status=retired"),
        ]);
        const [wsBody, projBody, retiredBody] = await Promise.all([
          wsRes.json(),
          projRes.json(),
          retiredRes.json(),
        ]);
        if (!wsRes.ok) throw new Error(wsBody.error ?? "Failed to load workspaces");
        if (!projRes.ok) throw new Error(projBody.error ?? "Failed to load projects");
        if (!retiredRes.ok) throw new Error(retiredBody.error ?? "Failed to load retired projects");
        if (cancelled) return;
        setWorkspaces(wsBody as EntityOption[]);
        setProjects(projBody as EntityOption[]);
        setRetiredProjects(retiredBody as EntityOption[]);
      } catch (err) {
        if (!cancelled) setOptionsError(err instanceof Error ? err.message : "Failed to load options");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleProject = (id: string) => {
    draft.setProjectIds(
      draft.projectIds.includes(id)
        ? draft.projectIds.filter((item) => item !== id)
        : [...draft.projectIds, id],
    );
  };

  const stuckProjectIds = draft.projectIds.filter((id) => !projects.some((project) => project.id === id));
  const retiredNameById = new Map(retiredProjects.map((project) => [project.id, project.name]));

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className={labelClass}>Priority</label>
          <select
            value={draft.priority}
            onChange={(e) => draft.setPriority(e.target.value as TaskPriority)}
            disabled={isMutating}
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
            value={draft.assignedAgent}
            onChange={(e) => draft.setAssignedAgent(e.target.value)}
            disabled={isMutating}
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className={labelClass}>Workflow</label>
          <select
            value={draft.workflowId}
            onChange={(e) => draft.setWorkflowId(e.target.value)}
            disabled={isMutating}
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
            value={draft.parentTaskId}
            onChange={(e) => draft.setParentTaskId(e.target.value)}
            disabled={isMutating}
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className={labelClass}>Workspace *</label>
          <select
            value={draft.workspaceId}
            onChange={(e) => draft.setWorkspaceId(e.target.value)}
            disabled={isMutating}
            className={selectClass}
            required
          >
            <option value="">Select workspace</option>
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
            {draft.workspaceId && !workspaces.some((ws) => ws.id === draft.workspaceId) && (
              <option value={draft.workspaceId}>{draft.workspaceId} (current)</option>
            )}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className={labelClass}>Projects * ({draft.projectIds.length})</label>
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
            {projects.length === 0 && stuckProjectIds.length === 0 && (
              <p className="text-xs text-zinc-600 px-1">No active projects.</p>
            )}
            {stuckProjectIds.map((id) => (
              <label
                key={`stuck-${id}`}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-800/60"
              >
                <input
                  type="checkbox"
                  checked
                  onChange={() => toggleProject(id)}
                  disabled={isMutating}
                  className="h-3.5 w-3.5 accent-amber-500"
                />
                <span className="truncate text-amber-200/90">
                  {retiredNameById.get(id) ?? id} (retired — uncheck to remove)
                </span>
              </label>
            ))}
            {projects.map((project) => (
              <label key={project.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-zinc-800/60">
                <input
                  type="checkbox"
                  checked={draft.projectIds.includes(project.id)}
                  onChange={() => toggleProject(project.id)}
                  disabled={isMutating}
                  className="h-3.5 w-3.5 accent-indigo-500"
                />
                <span className="truncate text-zinc-200">{project.name}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      {optionsError && <p className="text-xs text-red-300">{optionsError}</p>}

      <div className="space-y-1.5">
        <label className={labelClass}>Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => draft.setDescription(e.target.value)}
          disabled={isMutating}
          rows={4}
          className={selectClass}
        />
      </div>

      <div className="space-y-1.5">
        <label className={labelClass}>Final Output / Execution Result</label>
        <textarea
          value={task.output ?? ""}
          readOnly
          placeholder={isTerminal ? "Execution produced no output." : "Execution output will appear here once started."}
          className={`${selectClass} cursor-default opacity-80`}
        />
      </div>
    </>
  );
}
