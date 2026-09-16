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
  dependencies: string[];
  addDependency: (id: string) => void;
  removeDependency: (id: string) => void;
  savePayload: () => UpdateTaskInput;
}

export function useTaskDraft(task: Task): TaskDraft {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [assignedAgent, setAssignedAgent] = useState(task.assignedAgent ?? "");
  const [workflowId, setWorkflowId] = useState(task.workflowId ?? "");
  const [parentTaskId, setParentTaskId] = useState(task.parentTaskId ?? "");
  const [dependencies, setDependencies] = useState<string[]>(task.dependencies ?? []);

  const addDependency = (id: string) => {
    if (!id || dependencies.includes(id)) return;
    setDependencies((prev) => [...prev, id]);
  };

  const removeDependency = (id: string) => {
    setDependencies((prev) => prev.filter((depId) => depId !== id));
  };

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
    dependencies,
    addDependency,
    removeDependency,
    savePayload,
  };
}

/** Tasks eligible as dependencies: not the task itself, not already listed. */
export function candidateDependencies(task: Task, tasks: Task[], current: string[]): Task[] {
  return tasks.filter((t) => t.id !== task.id && !current.includes(t.id));
}
