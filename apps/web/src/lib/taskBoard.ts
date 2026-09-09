/**
 * Task board store backed by the Studio persistence API on the execution server.
 * Keeps dashboard runtimeTracker sync as a side effect of board mutations.
 */

import { runtimeTracker } from "@/lib/runtimeTracker";
import {
  BoardAgent,
  DEP_GATED_STATUSES,
  Task,
  TaskBoardData,
  TaskPriority,
  TaskStatus,
  canMoveStatus,
  hasDependencyCycle,
} from "@/lib/taskStatus";

const API_URL = process.env.NEXT_PUBLIC_EXECUTION_API_URL ?? process.env.EXECUTION_API_URL ?? "http://localhost:4000";
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const OUTPUT_MAX = 4000;

export class TaskActionError extends Error {
  public statusCode: number;
  public blockedBy: { id: string; title: string; status: TaskStatus }[];

  constructor(
    message: string,
    options?: {
      statusCode?: number;
      blockedBy?: { id: string; title: string; status: TaskStatus }[];
    }
  ) {
    super(message);
    this.name = "TaskActionError";
    this.statusCode = options?.statusCode ?? 400;
    this.blockedBy = options?.blockedBy ?? [];
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function studioRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/studio${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new TaskActionError(body.error ?? `Studio task request failed (${response.status})`, { statusCode: response.status });
  }
  return response.json() as Promise<T>;
}

async function loadTasks(): Promise<Task[]> {
  try {
    return await studioRequest<Task[]>("/tasks");
  } catch {
    return [];
  }
}

async function saveTasks(tasks: Task[]): Promise<void> {
  await studioRequest("/tasks", { method: "PUT", body: JSON.stringify(tasks) });
}

let writeChain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run;
}

function assertAgentExists(assignedAgent: string | null | undefined): void {
  if (!assignedAgent) return;
  const exists = runtimeTracker.agents.some((a) => a.name === assignedAgent);
  if (!exists) {
    throw new TaskActionError(`Unknown agent: ${assignedAgent}`);
  }
}

function validateDependencies(tasks: Task[], taskId: string, dependencies: string[]): string[] {
  const unique = Array.from(new Set(dependencies));
  for (const depId of unique) {
    if (depId === taskId) {
      throw new TaskActionError("A task cannot depend on itself");
    }
    if (!tasks.some((t) => t.id === depId)) {
      throw new TaskActionError(`Unknown dependency task: ${depId}`);
    }
  }
  if (hasDependencyCycle(tasks, taskId, unique)) {
    throw new TaskActionError("Dependency would create a circular chain");
  }
  return unique;
}

function syncAgentActivity(tasks: Task[]): void {
  const idleMessages: Record<string, string> = {
    "agent-orchestrator": "Listening for workflow requests & routing to LangGraph nodes",
  };
  for (const agent of runtimeTracker.agents) {
    const active = tasks.find(
      (t) => t.assignedAgent === agent.name && t.status === "in_progress" && !t.paused
    );
    if (active) {
      agent.status = "running";
      agent.currentTask = active.title;
    } else {
      agent.status = agent.id === "agent-orchestrator" ? "running" : "idle";
      agent.currentTask =
        idleMessages[agent.id] ?? "Standing by for next dispatched task";
    }
  }
}

function recordCompletion(task: Task, status: "COMPLETED" | "FAILED"): void {
  runtimeTracker.recordExecution({
    name: task.title,
    status,
    agent: task.assignedAgent ?? "Orchestrator Agent",
    error: status === "FAILED" ? task.output ?? "Marked as failed on the task board" : undefined,
  });
}

export async function getBoardData(): Promise<TaskBoardData> {
  const tasks = await loadTasks();
  syncAgentActivity(tasks);
  const agents: BoardAgent[] = runtimeTracker.agents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    model: a.model,
    status: a.status,
  }));
  return { tasks, agents, lastUpdated: nowIso() };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string | null;
  dependencies?: string[];
  status?: TaskStatus;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  return serialized(async () => {
    const tasks = await loadTasks();

    const title = (input.title ?? "").trim();
    if (!title) throw new TaskActionError("Task title is required");
    if (title.length > TITLE_MAX) {
      throw new TaskActionError(`Task title must be at most ${TITLE_MAX} characters`);
    }
    const description = (input.description ?? "").trim();
    if (description.length > DESCRIPTION_MAX) {
      throw new TaskActionError(`Description must be at most ${DESCRIPTION_MAX} characters`);
    }
    const status: TaskStatus = input.status ?? "todo";
    if (!canCreateInStatus(status)) {
      throw new TaskActionError(`Tasks cannot be created directly in "${status}"`);
    }
    assertAgentExists(input.assignedAgent ?? null);
    const dependencies = validateDependencies(tasks, randomId() + "-pending", input.dependencies ?? []);

    const task: Task = {
      id: randomId(),
      title,
      description,
      priority: input.priority ?? "medium",
      status,
      assignedAgent: input.assignedAgent ?? null,
      dependencies,
      output: null,
      retryCount: 0,
      paused: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    tasks.unshift(task);
    syncAgentActivity(tasks);
    await saveTasks(tasks);
    return task;
  });
}

function canCreateInStatus(status: TaskStatus): boolean {
  return status !== "done" && status !== "failed";
}

export async function moveTask(taskId: string, toStatus: TaskStatus): Promise<Task> {
  return serialized(async () => {
    const tasks = await loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new TaskActionError("Task not found", { statusCode: 404 });
    if (task.status === toStatus) return task;
    if (!canMoveStatus(task.status, toStatus)) {
      throw new TaskActionError(
        `Invalid transition: "${task.status}" → "${toStatus}"`,
        { statusCode: 409 }
      );
    }
    if (DEP_GATED_STATUSES.includes(toStatus)) {
      const blockers = task.dependencies
        .map((id) => tasks.find((t) => t.id === id))
        .filter((dep): dep is Task => dep !== undefined && dep.status !== "done");
      if (blockers.length > 0) {
        throw new TaskActionError(
          `Blocked by ${blockers.length} unfinished dependent task${blockers.length > 1 ? "s" : ""}`,
          {
            statusCode: 409,
            blockedBy: blockers.map((b) => ({ id: b.id, title: b.title, status: b.status })),
          }
        );
      }
    }

    task.status = toStatus;
    task.paused = false;
    task.updatedAt = nowIso();

    if (toStatus === "done" && !task.output) {
      task.output = `Completed by ${task.assignedAgent ?? "the pipeline"} at ${nowIso()}`;
    }
    if (toStatus === "failed" && !task.output) {
      task.output = "Marked as failed during workflow execution";
    }

    if (toStatus === "done") recordCompletion(task, "COMPLETED");
    if (toStatus === "failed") recordCompletion(task, "FAILED");

    syncAgentActivity(tasks);
    await saveTasks(tasks);
    return task;
  });
}

export interface UpdateTaskPatch {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assignedAgent?: string | null;
  dependencies?: string[];
  output?: string | null;
}

export async function updateTask(taskId: string, patch: UpdateTaskPatch): Promise<Task> {
  return serialized(async () => {
    const tasks = await loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new TaskActionError("Task not found", { statusCode: 404 });

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new TaskActionError("Task title is required");
      if (title.length > TITLE_MAX) {
        throw new TaskActionError(`Task title must be at most ${TITLE_MAX} characters`);
      }
      task.title = title;
    }
    if (patch.description !== undefined) {
      const description = patch.description.trim();
      if (description.length > DESCRIPTION_MAX) {
        throw new TaskActionError(`Description must be at most ${DESCRIPTION_MAX} characters`);
      }
      task.description = description;
    }
    if (patch.priority !== undefined) task.priority = patch.priority;
    if (patch.assignedAgent !== undefined) {
      assertAgentExists(patch.assignedAgent);
      task.assignedAgent = patch.assignedAgent || null;
    }
    if (patch.dependencies !== undefined) {
      task.dependencies = validateDependencies(tasks, taskId, patch.dependencies);
    }
    if (patch.output !== undefined) {
      const output = patch.output === null ? null : patch.output.slice(0, OUTPUT_MAX);
      task.output = output && output.length > 0 ? output : null;
    }

    task.updatedAt = nowIso();
    syncAgentActivity(tasks);
    await saveTasks(tasks);
    return task;
  });
}

export async function retryTask(taskId: string): Promise<Task> {
  return serialized(async () => {
    const tasks = await loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new TaskActionError("Task not found", { statusCode: 404 });
    if (task.status !== "failed") {
      throw new TaskActionError("Only failed tasks can be retried", { statusCode: 409 });
    }

    task.status = "todo";
    task.paused = false;
    task.retryCount += 1;
    task.output = null;
    task.updatedAt = nowIso();

    syncAgentActivity(tasks);
    await saveTasks(tasks);
    return task;
  });
}

export async function setTaskPaused(taskId: string, paused: boolean): Promise<Task> {
  return serialized(async () => {
    const tasks = await loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new TaskActionError("Task not found", { statusCode: 404 });
    if (task.status === "done" || task.status === "failed") {
      throw new TaskActionError("Completed or failed tasks cannot be paused", { statusCode: 409 });
    }
    if (paused && task.status === "todo") {
      throw new TaskActionError("Todo tasks have not started yet", { statusCode: 409 });
    }

    task.paused = paused;
    task.updatedAt = nowIso();
    syncAgentActivity(tasks);
    await saveTasks(tasks);
    return task;
  });
}

export async function cancelTask(taskId: string): Promise<{ id: string }> {
  return serialized(async () => {
    const tasks = await loadTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new TaskActionError("Task not found", { statusCode: 404 });

    const remaining = tasks
      .filter((t) => t.id !== taskId)
      .map((t) =>
        t.dependencies.includes(taskId)
          ? { ...t, dependencies: t.dependencies.filter((d) => d !== taskId), updatedAt: nowIso() }
          : t
      );

    await saveTasks(remaining);
    return { id: taskId };
  });
}
