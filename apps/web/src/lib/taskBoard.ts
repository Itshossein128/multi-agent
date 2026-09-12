/**
 * Task board store backed by the Studio persistence API on the execution server.
 * Backend-authoritative: all mutations, validations, transitions, cycles, gating,
 * and run orchestration occur on the server boundary.
 */

import {
  BoardAgent,
  BoardWorkflow,
  Task,
  TaskBoardData,
  TaskPriority,
  TaskStatus,
} from "@/lib/taskStatus";
import { createInternalPrincipalAssertion, type AuthenticatedPrincipal } from "../../../../src/auth/internalPrincipal";

const API_URL = process.env.NEXT_PUBLIC_EXECUTION_API_URL ?? process.env.EXECUTION_API_URL ?? "http://localhost:4000";

export class TaskActionError extends Error {
  public statusCode: number;
  public blockedBy: { id: string; title: string; status: TaskStatus }[];

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      blockedBy?: { id: string; title: string; status: TaskStatus }[];
    },
  ) {
    super(message);
    this.name = "TaskActionError";
    this.statusCode = options?.statusCode ?? 400;
    this.blockedBy = options?.blockedBy ?? [];
  }
}

async function studioRequest<T>(
  path: string,
  init?: RequestInit,
  principal?: AuthenticatedPrincipal | null,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const secret = process.env.INTERNAL_PRINCIPAL_SECRET;
  if (principal && secret) {
    headers.set("X-Multi-Agent-Principal", createInternalPrincipalAssertion(principal, secret));
  }
  const response = await fetch(`${API_URL}/studio${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string; blockedBy?: { id: string; title: string; status: TaskStatus }[] };
    throw new TaskActionError(body.error ?? `Studio task request failed (${response.status})`, {
      statusCode: response.status,
      blockedBy: body.blockedBy ?? [],
    });
  }
  return response.json() as Promise<T>;
}

async function loadTasks(principal?: AuthenticatedPrincipal | null): Promise<Task[]> {
  try {
    return await studioRequest<Task[]>("/tasks", undefined, principal);
  } catch {
    return [];
  }
}

async function loadAgents(principal?: AuthenticatedPrincipal | null): Promise<BoardAgent[]> {
  try {
    const agents = await studioRequest<Array<{ id: string; name: string; description?: string; backend?: { model?: string } }>>("/agents", undefined, principal);
    if (agents && agents.length > 0) {
      return agents.map((a) => ({
        id: a.id,
        name: a.name,
        role: a.description || a.name,
        model: a.backend?.model || "default",
        status: "idle",
      }));
    }
  } catch {
    // fallback below
  }
  return [
    { id: "agent-orchestrator", name: "Orchestrator Agent", role: "Intent Classification & Task Decomposer", model: process.env.LLM_MODEL || "gemini-3.6-flash", status: "idle" },
    { id: "agent-developer", name: "Developer Agent", role: "Code Generator & Version Control", model: process.env.LLM_MODEL || "gemini-3.6-flash", status: "idle" },
    { id: "agent-doc-generator", name: "Doc Generator Agent", role: "BookStack Chapter & Specification Author", model: process.env.LLM_MODEL || "gemini-3.6-flash", status: "idle" },
  ];
}

async function loadWorkflows(principal?: AuthenticatedPrincipal | null): Promise<BoardWorkflow[]> {
  try {
    const wfs = await studioRequest<Array<{ id: string; name: string }>>("/workflows", undefined, principal);
    return (wfs ?? []).map((w) => ({ id: w.id, name: w.name }));
  } catch {
    return [];
  }
}

export async function getBoardData(principal?: AuthenticatedPrincipal | null): Promise<TaskBoardData> {
  const [tasks, agents, workflows] = await Promise.all([
    loadTasks(principal),
    loadAgents(principal),
    loadWorkflows(principal),
  ]);
  for (const agent of agents) {
    const active = tasks.find(
      (t) => (t.assignedAgent === agent.name || t.assignedAgent === agent.id || (t.assignedAgents && t.assignedAgents.includes(agent.id))) && (t.status === "in_progress" || t.status === "running") && !t.paused,
    );
    agent.status = active ? "running" : "idle";
  }
  return { tasks, agents, workflows, lastUpdated: new Date().toISOString() };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string | null;
  assignedAgents?: string[];
  workflowId?: string | null;
  parentTaskId?: string | null;
  dependencies?: string[];
  status?: TaskStatus;
}

export async function createTask(input: CreateTaskInput, principal?: AuthenticatedPrincipal | null): Promise<Task> {
  return studioRequest<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  }, principal);
}

export interface UpdateTaskPatch {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  assignedAgent?: string | null;
  assignedAgents?: string[];
  workflowId?: string | null;
  parentTaskId?: string | null;
  dependencies?: string[];
}

export async function updateTask(taskId: string, patch: UpdateTaskPatch, principal?: AuthenticatedPrincipal | null): Promise<Task> {
  return studioRequest<Task>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }, principal);
}

export async function moveTask(taskId: string, toStatus: TaskStatus, principal?: AuthenticatedPrincipal | null): Promise<Task> {
  return studioRequest<Task>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: toStatus }),
  }, principal);
}

export async function startTask(taskId: string, principal?: AuthenticatedPrincipal | null): Promise<{ success: boolean; task: Task; runId: string }> {
  return studioRequest<{ success: boolean; task: Task; runId: string }>(`/tasks/${taskId}/start`, {
    method: "POST",
  }, principal);
}

export async function retryTask(taskId: string, principal?: AuthenticatedPrincipal | null): Promise<{ success: boolean; task: Task; runId?: string }> {
  return studioRequest<{ success: boolean; task: Task; runId?: string }>(`/tasks/${taskId}/retry`, {
    method: "POST",
  }, principal);
}

export async function setTaskPaused(taskId: string, paused: boolean, principal?: AuthenticatedPrincipal | null): Promise<{ success: boolean; task: Task }> {
  return studioRequest<{ success: boolean; task: Task }>(`/tasks/${taskId}/${paused ? "pause" : "resume"}`, {
    method: "POST",
  }, principal);
}

export async function cancelTask(taskId: string, principal?: AuthenticatedPrincipal | null): Promise<{ success: boolean; task: Task }> {
  return studioRequest<{ success: boolean; task: Task }>(`/tasks/${taskId}/cancel`, {
    method: "POST",
  }, principal);
}

export async function deleteTask(taskId: string, principal?: AuthenticatedPrincipal | null): Promise<{ id: string }> {
  await studioRequest(`/tasks/${taskId}`, { method: "DELETE" }, principal);
  return { id: taskId };
}
