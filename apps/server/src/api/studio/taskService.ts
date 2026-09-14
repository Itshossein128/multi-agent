import {
  canTransitionStatus,
  createSingleAgentWorkflow,
  isCompletedStatus,
  isStatusDependencyGated,
  nowIso,
  toCanonicalStatus,
  uid,
  type AgentRecord,
  type TaskStatus,
  type WorkflowDefinition,
} from "@multi-agent/types";
import type { StudioStore, StudioTask } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import type { RunExecutor } from "../../runtime/runExecutor";
import { ApiError } from "../shared/http";
import { requireResource } from "./resource";

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;
const OUTPUT_MAX = 4000;
const ERROR_MAX = 4000;
const ID_MAX = 200;
const DEPENDENCY_MAX = 100;
const ASSIGNED_AGENT_MAX = 32;
const METADATA_MAX = 32_768;
const TASK_PRIORITIES = new Set(["high", "medium", "low"]);
const TASK_STATUSES = new Set([
  "backlog", "ready", "queued", "running", "blocked", "waiting_for_human", "completed", "failed", "cancelled",
  "todo", "planning", "in_progress", "waiting_tool", "review", "done",
]);

function boundedText(value: unknown, max: number, field: string): string {
  if (typeof value !== "string") throw new ApiError(400, `${field} must be a string`);
  if (value.length > max) throw new ApiError(400, `${field} must be at most ${max} characters`);
  return value;
}

function normalizeId(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ApiError(400, `${field} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new ApiError(400, `${field} is required`);
  if (normalized.length > ID_MAX) throw new ApiError(400, `${field} must be at most ${ID_MAX} characters`);
  return normalized;
}

function validatePriority(value: unknown): StudioTask["priority"] {
  if (typeof value !== "string" || !TASK_PRIORITIES.has(value)) {
    throw new ApiError(400, "Task priority must be one of: high, medium, low");
  }
  return value as StudioTask["priority"];
}

function validateStatus(value: unknown): TaskStatus {
  if (typeof value !== "string" || !TASK_STATUSES.has(value)) {
    throw new ApiError(400, "Task status is invalid");
  }
  return value as TaskStatus;
}

function validateMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Task metadata must be an object");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ApiError(400, "Task metadata must be JSON serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > METADATA_MAX) {
    throw new ApiError(400, `Task metadata must be at most ${METADATA_MAX} bytes`);
  }
  return value as Record<string, unknown>;
}

function validateStringArray(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value)) throw new ApiError(400, `${field} must be an array`);
  if (value.length > max) throw new ApiError(400, `${field} can contain at most ${max} items`);
  const normalized = value.map((item) => normalizeId(item, `${field} item`));
  return Array.from(new Set(normalized));
}

export function hasDependencyCycle(
  tasks: Pick<StudioTask, "id" | "dependencies">[],
  taskId: string,
  nextDependencies: string[],
): boolean {
  if (nextDependencies.includes(taskId)) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const stack = [...nextDependencies];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === taskId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = byId.get(current);
    if (node && Array.isArray(node.dependencies)) {
      stack.push(...node.dependencies);
    }
  }
  return false;
}

export class TaskService {
  constructor(
    private readonly store: StudioStore,
    private readonly executor?: RunExecutor,
  ) {}

  async list(principal: RequestPrincipal): Promise<StudioTask[]> {
    const tasks = await this.store.listTasks(principal);
    let changed = false;
    for (const task of tasks) {
      if (this.syncTaskWithRun(task)) {
        await this.store.saveTask(task, principal);
        changed = true;
      }
    }
    return changed ? this.store.listTasks(principal) : tasks;
  }

  async get(id: string, principal: RequestPrincipal): Promise<StudioTask> {
    const task = requireResource(await this.store.getTask(id, principal), "Task");
    if (this.syncTaskWithRun(task)) {
      return this.store.saveTask(task, principal);
    }
    return task;
  }

  async create(body: Partial<StudioTask>, principal: RequestPrincipal): Promise<StudioTask> {
    const title = boundedText(body.title ?? "", TITLE_MAX, "Task title").trim();
    if (!title) throw new ApiError(400, "Task title is required");

    const description = boundedText(body.description ?? "", DESCRIPTION_MAX, "Description").trim();
    if (description.length > DESCRIPTION_MAX) throw new ApiError(400, `Description must be at most ${DESCRIPTION_MAX} characters`);

    const tenantTasks = await this.store.listTasks(principal);
    const id = body.id === undefined ? uid("task") : normalizeId(body.id, "Task id");
    if (tenantTasks.some((task) => task.id === id)) throw new ApiError(409, `Task "${id}" already exists`);

    const dependencies = this.validateDependencies(id, body.dependencies, tenantTasks);

    const assignedAgents = body.assignedAgents !== undefined
      ? validateStringArray(body.assignedAgents, "assignedAgents", ASSIGNED_AGENT_MAX)
      : body.assignedAgent === undefined || body.assignedAgent === null
        ? []
        : [normalizeId(body.assignedAgent, "assignedAgent")];
    for (const agentId of assignedAgents) {
      await this.validateAgentExistence(agentId, principal);
    }

    const workflowId = body.workflowId === undefined || body.workflowId === null
      ? null
      : normalizeId(body.workflowId, "workflowId");
    await this.validateWorkflowExistence(workflowId, principal);

    const status: TaskStatus = body.status === undefined ? "backlog" : validateStatus(body.status);
    const canonical = toCanonicalStatus(status);
    if (canonical === "completed" || canonical === "failed") {
      throw new ApiError(400, `Tasks cannot be created directly in "${status}"`);
    }

    const parentTaskId = body.parentTaskId === undefined || body.parentTaskId === null
      ? null
      : normalizeId(body.parentTaskId, "parentTaskId");
    this.validateParentTask(id, parentTaskId, tenantTasks);
    this.checkDependencyGating({ id, title, dependencies }, status, tenantTasks);
    const metadata = validateMetadata(body.metadata);

    const stamp = nowIso();
    const task: StudioTask = {
      id,
      title,
      description,
      priority: body.priority === undefined ? "medium" : validatePriority(body.priority),
      status,
      assignedAgent: assignedAgents[0] ?? null,
      assignedAgents,
      workflowId,
      parentTaskId,
      dependencies,
      runId: null,
      output: null,
      lastError: null,
      retryCount: 0,
      paused: body.paused === true,
      createdAt: stamp,
      updatedAt: stamp,
      metadata,
      tenantId: principal.tenantId,
      ownerId: principal.userId,
    };

    return this.store.saveTask(task, principal);
  }

  async save(id: string, body: StudioTask, principal: RequestPrincipal): Promise<StudioTask> {
    if (body.id !== id) throw new ApiError(400, "Task id mismatch");
    const existing = await this.get(id, principal);
    const tenantTasks = await this.store.listTasks(principal);

    const title = boundedText(body.title ?? existing.title, TITLE_MAX, "Task title").trim();
    if (!title) throw new ApiError(400, "Task title is required");

    const description = boundedText(body.description ?? existing.description ?? "", DESCRIPTION_MAX, "Description").trim();
    if (description.length > DESCRIPTION_MAX) throw new ApiError(400, `Description must be at most ${DESCRIPTION_MAX} characters`);

    const dependencies = body.dependencies !== undefined
      ? this.validateDependencies(id, body.dependencies, tenantTasks)
      : existing.dependencies;

    const assignedAgents = body.assignedAgents !== undefined
      ? validateStringArray(body.assignedAgents, "assignedAgents", ASSIGNED_AGENT_MAX)
      : body.assignedAgent !== undefined
        ? body.assignedAgent === null ? [] : [normalizeId(body.assignedAgent, "assignedAgent")]
        : existing.assignedAgents ?? (existing.assignedAgent ? [existing.assignedAgent] : []);
    for (const agentId of assignedAgents) {
      await this.validateAgentExistence(agentId, principal);
    }

    const workflowId = body.workflowId !== undefined
      ? body.workflowId === null ? null : normalizeId(body.workflowId, "workflowId")
      : existing.workflowId ?? null;
    await this.validateWorkflowExistence(workflowId, principal);

    const targetStatus = body.status === undefined ? existing.status : validateStatus(body.status);
    const parentTaskId = body.parentTaskId !== undefined
      ? body.parentTaskId === null ? null : normalizeId(body.parentTaskId, "parentTaskId")
      : existing.parentTaskId ?? null;
    this.validateParentTask(id, parentTaskId, tenantTasks);
    const metadata = body.metadata === undefined ? existing.metadata ?? {} : validateMetadata(body.metadata);
    const priority = body.priority === undefined ? existing.priority : validatePriority(body.priority);
    if (targetStatus !== existing.status) {
      this.validateStatusTransition(existing.status, targetStatus);
      this.checkDependencyGating({ id, title, dependencies }, targetStatus, tenantTasks);
    }

    const updated: StudioTask = {
      ...existing,
      ...body,
      id,
      title,
      description,
      priority,
      status: targetStatus,
      assignedAgents,
      assignedAgent: assignedAgents[0] ?? null,
      workflowId: workflowId ?? null,
      parentTaskId,
      dependencies,
      // Runtime-owned fields are changed only by start/retry/synchronization.
      output: existing.output ?? null,
      lastError: existing.lastError ?? null,
      runId: existing.runId ?? null,
      startedAt: existing.startedAt ?? null,
      completedAt: existing.completedAt ?? null,
      retryCount: existing.retryCount ?? 0,
      createdAt: existing.createdAt,
      metadata,
      updatedAt: nowIso(),
      tenantId: principal.tenantId,
      ownerId: existing.ownerId ?? principal.userId,
    };

    return this.store.saveTask(updated, principal);
  }

  async patch(id: string, patch: Partial<StudioTask>, principal: RequestPrincipal): Promise<StudioTask> {
    const existing = await this.get(id, principal);
    const merged: StudioTask = {
      ...existing,
      ...patch,
      id,
    };
    return this.save(id, merged, principal);
  }

  async delete(id: string, principal: RequestPrincipal): Promise<void> {
    const task = await this.get(id, principal);
    if (task.runId && this.executor) {
      this.executor.cancel(task.runId);
    }
    await this.store.transaction(async (transactionStore) => {
      await transactionStore.deleteTask(id, principal);
      const tasks = await transactionStore.listTasks(principal);
      for (const other of tasks) {
        if (other.dependencies && other.dependencies.includes(id)) {
          other.dependencies = other.dependencies.filter((d) => d !== id);
          other.updatedAt = nowIso();
          await transactionStore.saveTask(other, principal);
        }
      }
    });
  }

  async replace(tasks: StudioTask[], principal: RequestPrincipal): Promise<StudioTask[]> {
    if (!Array.isArray(tasks)) throw new ApiError(400, "Expected task array");
    const byId = new Map<string, StudioTask>();
    for (const task of tasks) {
      const id = normalizeId(task.id, "Task id");
      if (byId.has(id)) throw new ApiError(409, `Task "${id}" appears more than once`);
      const title = boundedText(task.title, TITLE_MAX, "Task title").trim();
      if (!title) throw new ApiError(400, "Each task must have a title");
      byId.set(id, { ...task, id, title });
    }
    const normalizedTasks = [...byId.values()];
    for (const task of normalizedTasks) {
      const deps = this.validateDependencies(task.id, task.dependencies, normalizedTasks);
      task.dependencies = deps;
      for (const dep of deps) {
        if (!byId.has(dep)) throw new ApiError(400, `Unknown dependency task: ${dep}`);
      }
      validatePriority(task.priority);
      const status = validateStatus(task.status);
      this.checkDependencyGating(task, status, normalizedTasks);
      validateMetadata(task.metadata);
    }
    return this.store.transaction(async (transactionStore) => {
      const existing = await transactionStore.listTasks(principal);
      const keep = new Set(normalizedTasks.map((task) => task.id));
      for (const task of existing) {
        if (!keep.has(task.id)) await transactionStore.deleteTask(task.id, principal);
      }
      for (const task of normalizedTasks) {
        await transactionStore.saveTask(
          { ...task, dependencies: this.validateDependencies(task.id, task.dependencies, normalizedTasks), tenantId: principal.tenantId, ownerId: task.ownerId ?? principal.userId },
          principal,
        );
      }
      return transactionStore.listTasks(principal);
    });
  }

  async start(id: string, principal: RequestPrincipal): Promise<{ success: boolean; task: StudioTask; runId: string }> {
    if (!this.executor) throw new ApiError(500, "RunExecutor not configured");
    const task = await this.get(id, principal);
    const canonical = toCanonicalStatus(task.status);
    if (canonical === "running" || canonical === "queued") {
      throw new ApiError(409, "Task is already executing");
    }
    if (canonical === "completed") {
      throw new ApiError(409, "Completed tasks cannot be started directly; use retry instead");
    }
    if (canonical === "failed" || canonical === "cancelled") {
      throw new ApiError(409, "Failed or cancelled tasks must be retried before starting");
    }

    const tenantTasks = await this.store.listTasks(principal);
    this.checkDependencyGating(task, "running", tenantTasks);

    let workflowToRun: WorkflowDefinition;
    let agentsToRun: AgentRecord[];
    const toolsToRun = await this.store.listTools(principal);
    const workspaceAgents = await this.store.listAgents(principal);

    if (task.workflowId) {
      const wf = await this.store.getWorkflow(task.workflowId, principal);
      if (!wf) throw new ApiError(400, `Workflow "${task.workflowId}" not found`);
      workflowToRun = wf;
      const referencedAgentIds = new Set(
        workflowToRun.nodes
          .filter((node) => node.type === "agent")
          .map((node) => (node.config as { agentId?: string | null }).agentId)
          .filter((agentId): agentId is string => Boolean(agentId)),
      );
      agentsToRun = workspaceAgents.filter((agent) => referencedAgentIds.has(agent.id));
      const referencedToolIds = new Set(
        workflowToRun.nodes
          .filter((node) => node.type === "tool")
          .map((node) => (node.config as { toolId?: string | null }).toolId)
          .filter((toolId): toolId is string => Boolean(toolId)),
      );
      // Pass only tools referenced by this workflow to the runtime.
      toolsToRun.splice(0, toolsToRun.length, ...toolsToRun.filter((tool) => referencedToolIds.has(tool.id)));
    } else {
      const agentIdentifier = task.assignedAgents?.[0] ?? task.assignedAgent;
      if (!agentIdentifier) {
        throw new ApiError(400, "Task must have an assigned agent or workflow to execute");
      }
      const agent = workspaceAgents.find(
        (a) => a.id === agentIdentifier || a.name === agentIdentifier,
      );
      if (!agent) {
        throw new ApiError(400, `Assigned agent "${agentIdentifier}" not found in workspace`);
      }
      workflowToRun = createSingleAgentWorkflow(agent, task.title);
      agentsToRun = [agent];
      toolsToRun.splice(0, toolsToRun.length);
    }

    let runId: string;
    try {
      runId = this.executor.start(
        {
          workflow: workflowToRun,
          agents: agentsToRun,
          tools: toolsToRun,
          input: { title: task.title, description: task.description, taskId: task.id },
          metadata: { ...task.metadata, taskId: task.id, taskTitle: task.title },
          taskId: task.id,
        },
        undefined,
        principal,
      );
    } catch (error) {
      throw new ApiError(400, error instanceof Error ? error.message : "Unable to start task run");
    }

    task.runId = runId;
    task.status = "running";
    task.startedAt = nowIso();
    task.completedAt = null;
    task.lastError = null;
    task.paused = false;
    task.updatedAt = nowIso();

    let saved: StudioTask;
    try {
      saved = await this.store.saveTask(task, principal);
    } catch (error) {
      this.executor.cancel(runId);
      throw error;
    }

    const unsubscribe = this.executor.getStore().subscribe(runId, async (event) => {
      if (event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") {
        unsubscribe();
        try {
          const fresh = await this.store.getTask(task.id, principal);
          if (fresh && fresh.runId === runId) {
            if (this.syncTaskWithRun(fresh)) {
              await this.store.saveTask(fresh, principal);
            }
          }
        } catch {
          // ignore background sync failure
        }
      }
    });

    // The run may have completed before the listener was registered. A direct
    // reconciliation closes that event-loss window and returns authoritative state.
    const reconciled = await this.get(id, principal);

    return { success: true, task: reconciled ?? saved, runId };
  }

  async cancel(id: string, principal: RequestPrincipal): Promise<{ success: boolean; task: StudioTask }> {
    const task = await this.get(id, principal);
    const canonical = toCanonicalStatus(task.status);
    if (canonical === "completed" || canonical === "failed") {
      throw new ApiError(409, "Completed or failed tasks cannot be cancelled");
    }
    if (canonical === "cancelled") return { success: true, task };
    if (task.runId && this.executor) {
      const run = this.executor.getStore().get(task.runId)?.run;
      if (run && ["queued", "running", "waiting_for_human"].includes(run.status)) {
        this.executor.cancel(task.runId);
        // RunExecutor.cancel handles waiting approvals itself; active runs are
        // finalized by the abort path. Do not rewrite terminal runs here.
        if (run.status !== "waiting_for_human") {
          this.executor.getStore().update(task.runId, { status: "cancelled", completedAt: nowIso() });
        }
      }
    }
    task.status = "cancelled";
    task.completedAt = nowIso();
    task.paused = false;
    task.updatedAt = nowIso();
    const updated = await this.store.saveTask(task, principal);
    return { success: true, task: updated };
  }

  async retry(id: string, principal: RequestPrincipal): Promise<{ success: boolean; task: StudioTask; runId?: string }> {
    const task = await this.get(id, principal);
    const canonical = toCanonicalStatus(task.status);
    if (canonical !== "failed" && canonical !== "cancelled") {
      throw new ApiError(409, "Only failed or cancelled tasks can be retried");
    }
    const tenantTasks = await this.store.listTasks(principal);
    this.checkDependencyGating(task, "ready", tenantTasks);

    task.retryCount = (task.retryCount ?? 0) + 1;
    task.output = null;
    task.lastError = null;
    task.completedAt = null;
    task.paused = false;
    task.status = "ready";
    task.updatedAt = nowIso();

    const hasExecutableTarget = task.workflowId || (task.assignedAgents && task.assignedAgents.length > 0) || task.assignedAgent;
    if (this.executor && hasExecutableTarget) {
      await this.store.saveTask(task, principal);
      return this.start(id, principal);
    }

    const updated = await this.store.saveTask(task, principal);
    return { success: true, task: updated };
  }

  async pause(id: string, principal: RequestPrincipal): Promise<{ success: boolean; task: StudioTask }> {
    const task = await this.get(id, principal);
    const canonical = toCanonicalStatus(task.status);
    if (canonical === "completed" || canonical === "failed" || canonical === "cancelled") {
      throw new ApiError(409, "Completed, failed, or cancelled tasks cannot be paused");
    }
    if (canonical === "running") {
      throw new ApiError(
        409,
        "Runtime only supports pausing at human approval checkpoints; arbitrary mid-stream thread pausing is not supported by the execution runtime",
      );
    }
    task.paused = true;
    task.updatedAt = nowIso();
    const updated = await this.store.saveTask(task, principal);
    return { success: true, task: updated };
  }

  async resume(id: string, principal: RequestPrincipal): Promise<{ success: boolean; task: StudioTask }> {
    const task = await this.get(id, principal);
    const canonical = toCanonicalStatus(task.status);
    if (canonical === "waiting_for_human") {
      throw new ApiError(
        409,
        "Task is waiting for human approval. Resolve the pending approval on the run to resume execution.",
      );
    }
    task.paused = false;
    task.updatedAt = nowIso();
    const updated = await this.store.saveTask(task, principal);
    return { success: true, task: updated };
  }

  private validateDependencies(
    taskId: string,
    dependencies: unknown,
    tenantTasks: StudioTask[],
  ): string[] {
    if (dependencies === undefined) return [];
    const unique = validateStringArray(dependencies, "dependencies", DEPENDENCY_MAX);
    for (const depId of unique) {
      if (depId === taskId) {
        throw new ApiError(400, "A task cannot depend on itself");
      }
      if (!tenantTasks.some((t) => t.id === depId)) {
        throw new ApiError(400, `Unknown dependency task: ${depId}`);
      }
    }
    if (hasDependencyCycle(tenantTasks, taskId, unique)) {
      throw new ApiError(400, "Dependency would create a circular chain");
    }
    return unique;
  }

  private validateParentTask(taskId: string, parentTaskId: string | null, tasks: StudioTask[]): void {
    if (!parentTaskId) return;
    if (parentTaskId === taskId) throw new ApiError(400, "A task cannot be its own parent");
    const byId = new Map(tasks.map((task) => [task.id, task]));
    let current: string | null = parentTaskId;
    const visited = new Set<string>();
    while (current) {
      if (current === taskId) throw new ApiError(400, "Parent task would create a circular hierarchy");
      if (visited.has(current)) throw new ApiError(400, "Parent task hierarchy contains a circular chain");
      visited.add(current);
      const parent = byId.get(current);
      if (!parent) throw new ApiError(400, `Unknown parent task: ${current}`);
      current = parent.parentTaskId ?? null;
    }
  }

  private checkDependencyGating(
    task: Pick<StudioTask, "id" | "title" | "dependencies">,
    targetStatus: TaskStatus,
    tenantTasks: StudioTask[],
  ): void {
    if (!isStatusDependencyGated(targetStatus)) return;
    const taskDeps = task.dependencies ?? [];
    if (taskDeps.length === 0) return;
    const blockers = taskDeps
      .map((id) => tenantTasks.find((t) => t.id === id))
      .filter((dep): dep is StudioTask => dep !== undefined && !isCompletedStatus(dep.status));
    if (blockers.length > 0) {
      throw new ApiError(
        409,
        `Blocked by ${blockers.length} unfinished dependent task${blockers.length > 1 ? "s" : ""}`,
      );
    }
  }

  private async validateAgentExistence(agentIdOrName: string | null | undefined, principal: RequestPrincipal): Promise<void> {
    if (!agentIdOrName) return;
    const agents = await this.store.listAgents(principal);
    const exists = agents.some((a) => a.id === agentIdOrName || a.name === agentIdOrName);
    if (!exists) {
      throw new ApiError(400, `Unknown agent: ${agentIdOrName}`);
    }
  }

  private async validateWorkflowExistence(workflowId: string | null | undefined, principal: RequestPrincipal): Promise<void> {
    if (!workflowId) return;
    const wf = await this.store.getWorkflow(workflowId, principal);
    if (!wf) {
      throw new ApiError(400, `Unknown workflow: ${workflowId}`);
    }
  }

  private validateStatusTransition(from: TaskStatus, to: TaskStatus): void {
    if (from === to) return;
    if (!canTransitionStatus(from, to)) {
      throw new ApiError(409, `Invalid transition: "${from}" → "${to}"`);
    }
  }

  private syncTaskWithRun(task: StudioTask): boolean {
    if (!task.runId || !this.executor) return false;
    const entry = this.executor.getStore().get(task.runId);
    if (!entry) return false;
    const run = entry.run;
    let changed = false;

    if (run.status === "completed" && task.status !== "completed" && task.status !== "done") {
      task.status = "completed";
      task.completedAt = run.completedAt ?? nowIso();
      changed = true;
    } else if (run.status === "failed" && task.status !== "failed") {
      task.status = "failed";
      task.completedAt = run.completedAt ?? nowIso();
      task.lastError = run.error ?? "Run failed";
      changed = true;
    } else if (run.status === "cancelled" && task.status !== "cancelled") {
      task.status = "cancelled";
      task.completedAt = run.completedAt ?? nowIso();
      changed = true;
    } else if (run.status === "running" && task.status !== "running" && task.status !== "in_progress") {
      task.status = "running";
      changed = true;
    } else if (run.status === "waiting_for_human" && task.status !== "waiting_for_human") {
      task.status = "waiting_for_human";
      changed = true;
    }

    if (run.error && task.lastError !== truncate(run.error, ERROR_MAX)) {
      task.lastError = truncate(run.error, ERROR_MAX);
      changed = true;
    }

    if (run.output && !task.output) {
      const serializedOutput = typeof run.output === "string" ? run.output : JSON.stringify(run.output, null, 2) ?? String(run.output);
      task.output = truncate(serializedOutput, OUTPUT_MAX);
      changed = true;
    }

    if (changed) task.updatedAt = nowIso();

    return changed;
  }
}

function truncate(value: string, max: number): string {
  return Buffer.from(value, "utf8").subarray(0, max).toString("utf8").replace(/\uFFFD$/u, "");
}
