"use client";

import { useState } from "react";
import type { Task, TaskPriority } from "@/lib/taskStatus";
import type { UpdateTaskInput } from "@/hooks/useTasksQuery";

/**
 * Draft-editing state for the task detail panel.
 * Isolates form state management from presentation so the panel component
 * stays a pure composition shell.
 */
export interface TaskDraft {
  title: string;
  setTitle: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  priority: TaskPriority;
  setPriority: (value: TaskPriority) => void;
  assignedAgent: string;
  setAssignedAgent: (value: string) => void;
  workflowId: string;
  setWorkflowId: (value: string) => void;
  parentTaskId: string;
  setParentTaskId: (value: string) => void;
  projectId: string;
  setProjectId: (value: string) => void;
  workspaceId: string;
  setWorkspaceId: (value: string) => void;
  /** When true, workspace is optional (default-workspace project). */
  workspaceRequired: boolean;
  setWorkspaceRequired: (value: boolean) => void;
  dependencies: string[];
  addDependency: (id: string) => void;
  removeDependency: (id: string) => void;
  associationsValid: boolean;
  associationsError: string | null;
  savePayload: () => UpdateTaskInput;
}

export function useTaskDraft(task: Task): TaskDraft {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignedAgent, setAssignedAgent] = useState(task.assignedAgent ?? "");
  const [workflowId, setWorkflowId] = useState(task.workflowId ?? "");
  const [parentTaskId, setParentTaskId] = useState(task.parentTaskId ?? "");
  const [projectId, setProjectId] = useState(task.projectId ?? "");
  const [workspaceId, setWorkspaceId] = useState(task.workspaceId ?? "");
  const [workspaceRequired, setWorkspaceRequired] = useState(Boolean(task.workspaceId));
  const [dependencies, setDependencies] = useState<string[]>(task.dependencies ?? []);

  const addDependency = (id: string) => {
    if (!id || dependencies.includes(id)) return;
    setDependencies((prev) => [...prev, id]);
  };

  const removeDependency = (id: string) => {
    setDependencies((prev) => prev.filter((depId) => depId !== id));
  };

  const associationsValid =
    Boolean(projectId.trim()) && (!workspaceRequired || Boolean(workspaceId.trim()));
  const associationsError = !projectId.trim()
    ? "Select a project before saving."
    : workspaceRequired && !workspaceId.trim()
      ? "Select a workspace before saving."
      : null;

  /** Payload for the update mutation; execution output stays read-only. */
  const savePayload = (): UpdateTaskInput => ({
    taskId: task.id,
    title,
    description,
    priority,
    assignedAgent: assignedAgent || null,
    assignedAgents: assignedAgent ? [assignedAgent] : [],
    workflowId: workflowId || null,
    parentTaskId: parentTaskId || null,
    dependencies,
    projectId,
    workspaceId: workspaceId.trim() ? workspaceId : null,
  });

  return {
    title,
    setTitle,
    description,
    setDescription,
    priority,
    setPriority,
    assignedAgent,
    setAssignedAgent,
    workflowId,
    setWorkflowId,
    parentTaskId,
    setParentTaskId,
    projectId,
    setProjectId,
    workspaceId,
    setWorkspaceId,
    workspaceRequired,
    setWorkspaceRequired,
    dependencies,
    addDependency,
    removeDependency,
    associationsValid,
    associationsError,
    savePayload,
  };
}

/** Tasks eligible as dependencies: not the task itself, not already listed. */
export function candidateDependencies(task: Task, tasks: Task[], current: string[]): Task[] {
  return tasks.filter((t) => t.id !== task.id && !current.includes(t.id));
}
