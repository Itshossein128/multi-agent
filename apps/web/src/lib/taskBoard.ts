/**
 * Server-side task board store.
 *
 * Tasks are persisted to `.taskboard.json` next to the web app so they
 * survive dev-server reloads / restarts, and are kept in sync with the
 * shared runtime tracker (agent workload states + execution history)
 * used by the dashboard.
 */

import fs from "node:fs/promises";
import path from "node:path";
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

const DATA_FILE = path.join(process.cwd(), ".taskboard.json");

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const OUTPUT_MAX = 4000;

/** Error carrying an HTTP status code and optional dependency blockers. */
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

async function loadTasks(): Promise<Task[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive normalization so a corrupt/partial file never breaks the board.
    return parsed
      .filter((t): t is Task => Boolean(t && typeof t.id === "string"))
      .map((t) => ({
        ...t,
        description: t.description ?? "",
        priority: t.priority ?? "medium",
        status: t.status ?? "todo",
        assignedAgent: t.assignedAgent ?? null,
        dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
        output: t.output ?? null,
        retryCount: t.retryCount ?? 0,
        paused: Boolean(t.paused),
        createdAt: t.createdAt ?? nowIso(),
        updatedAt: t.updatedAt ?? t.createdAt ?? nowIso(),
      }));
  } catch {
    // First run or unreadable file: start with an empty board.
    return [];
  }
}

async function saveTasks(tasks: Task[]): Promise<void> {
  await fs.writeFile(DATA_FILE, JSON.stringify(tasks, null, 2), "utf8");
}

// Serialize all read-modify-write cycles so concurrent mutations cannot
// clobber each other between load and save.
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

/** Keep the dashboard's agent workload states in sync with the board. */
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

// Tasks may start in any workflow stage except a terminal one.
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

/** Cancel removes the task and cleans up references from other tasks. */
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
