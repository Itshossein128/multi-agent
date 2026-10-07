"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BoardAgent, BoardWorkflow, Task, TaskPriority, TASK_PRIORITIES, toCanonicalStatus } from "@/lib/taskStatus";

const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-zinc-500";
const selectClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500";

interface ProjectOption {
  id: string;
  name: string;
  usesDefaultWorkspace?: boolean;
}

interface WorkspaceOption {
  id: string;
  name: string;
  projectId: string;
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
    projectId: string;
    setProjectId: (value: string) => void;
    workspaceId: string;
    setWorkspaceId: (value: string) => void;
    workspaceRequired: boolean;
    setWorkspaceRequired: (value: boolean) => void;
  };
}

/**
 * Assignment and description fields: priority, agent, workflow, parent task,
 * project/workspace, description, and the read-only execution output.
 */
export function TaskFields({ task, tasks, agents, workflows, isMutating, draft }: TaskFieldsProps) {
  const canonical = toCanonicalStatus(task.status);
  const isTerminal = canonical === "completed" || canonical === "failed" || canonical === "cancelled";
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [retiredProjects, setRetiredProjects] = useState<ProjectOption[]>([]);
  const [projectWorkspaces, setProjectWorkspaces] = useState<WorkspaceOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);

  const selectedProject =
    projects.find((p) => p.id === draft.projectId) ??
    retiredProjects.find((p) => p.id === draft.projectId);
  const usesDefaultWorkspace =
    Boolean(selectedProject?.usesDefaultWorkspace) ||
    (Boolean(draft.projectId) && projectWorkspaces.length === 0);
  const workspaceRequired = Boolean(draft.projectId) && !usesDefaultWorkspace;

  const { setWorkspaceRequired, setWorkspaceId, projectId } = draft;

  useEffect(() => {
    setWorkspaceRequired(workspaceRequired);
  }, [workspaceRequired, setWorkspaceRequired]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [projRes, retiredRes] = await Promise.all([
          fetch("/api/projects"),
          fetch("/api/projects?status=retired"),
        ]);
        const [projBody, retiredBody] = await Promise.all([projRes.json(), retiredRes.json()]);
        if (!projRes.ok) throw new Error(projBody.error ?? "Failed to load projects");
        if (!retiredRes.ok) throw new Error(retiredBody.error ?? "Failed to load retired projects");
        if (cancelled) return;
        setProjects(projBody as ProjectOption[]);
        setRetiredProjects(retiredBody as ProjectOption[]);
      } catch (err) {
        if (!cancelled) setOptionsError(err instanceof Error ? err.message : "Failed to load options");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!projectId) {
      setProjectWorkspaces([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/workspaces`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Failed to load workspaces");
        if (cancelled) return;
        const list = (body as WorkspaceOption[]) ?? [];
        setProjectWorkspaces(list);
        const project =
          projects.find((p) => p.id === projectId) ??
          retiredProjects.find((p) => p.id === projectId);
        if (project?.usesDefaultWorkspace || list.length === 0) {
          setWorkspaceId("");
        }
      } catch (err) {
        if (!cancelled) {
          setProjectWorkspaces([]);
          setOptionsError(err instanceof Error ? err.message : "Failed to load workspaces");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, projects, retiredProjects, setWorkspaceId]);

  const projectMissing =
    Boolean(draft.projectId) &&
    !projects.some((p) => p.id === draft.projectId) &&
    !retiredProjects.some((p) => p.id === draft.projectId);

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

      <div className="space-y-1.5">
        <label className={labelClass}>Project *</label>
        <select
          value={draft.projectId}
          onChange={(e) => draft.setProjectId(e.target.value)}
          disabled={isMutating}
          className={selectClass}
          required
        >
          <option value="">Select project</option>
          {projectMissing && (
            <option value={draft.projectId}>{draft.projectId} (current)</option>
          )}
          {retiredProjects
            .filter((p) => p.id === draft.projectId || !projects.some((a) => a.id === p.id))
            .filter((p) => p.id === draft.projectId)
            .map((p) => (
              <option key={`retired-${p.id}`} value={p.id}>
                {p.name} (retired)
              </option>
            ))}
          {projects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}</option>
          ))}
        </select>
        <p className="text-[11px] text-zinc-500 pt-1">
          To create a new project, use New Task or the Projects page (projects are only created on save).
        </p>
        {draft.projectId && (
          <Link
            href={`/projects/${encodeURIComponent(draft.projectId)}`}
            className="text-[11px] text-indigo-300 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Open project →
          </Link>
        )}
      </div>

      {workspaceRequired && (
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
            {projectWorkspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
            {draft.workspaceId && !projectWorkspaces.some((ws) => ws.id === draft.workspaceId) && (
              <option value={draft.workspaceId}>{draft.workspaceId} (current)</option>
            )}
          </select>
          {draft.workspaceId && (
            <Link
              href={`/workspaces/${encodeURIComponent(draft.workspaceId)}`}
              className="text-[11px] text-indigo-300 hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              Open workspace →
            </Link>
          )}
        </div>
      )}
      {draft.projectId && usesDefaultWorkspace && (
        <p className="text-[11px] text-zinc-500">Uses the project default workspace.</p>
      )}
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
