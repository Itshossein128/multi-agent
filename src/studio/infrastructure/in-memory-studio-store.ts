import {
  nowIso,
  uid,
  type AgentRecord,
  type ToolRecord,
  type WorkflowDefinition,
  type TaskComment,
  type TriggerEvent,
  type TriggerEventStatus,
  type RoutineRecord,
  type RoutineHistoryRecord,
  type WebhookTriggerRecord,
  type WebhookDeliveryRecord,
  type AgentHeartbeatSettings,
} from "@multi-agent/types";
import type {
  AcceptWebhookDeliveryParams,
  AcceptWebhookDeliveryResult,
  StudioEntityStatusFilter,
  StudioPrincipal,
  StudioProject,
  StudioStore,
  StudioTask,
  StudioWorkspace,
  StudioWorkspaceImport,
} from "../contracts";

function matchesStatus(status: StudioProject["status"], filter: StudioEntityStatusFilter = "active"): boolean {
  if (filter === "all") return true;
  return status === filter;
}

export class InMemoryStudioStore implements StudioStore {
  private workflows = new Map<string, WorkflowDefinition>();
  private agents = new Map<string, AgentRecord>();
  private tools = new Map<string, ToolRecord>();
  private tasks = new Map<string, StudioTask>();
  private projects = new Map<string, StudioProject>();
  private workspaces = new Map<string, StudioWorkspace>();

  // Feature 005 stores
  private comments = new Map<string, TaskComment>();
  private triggerEvents = new Map<string, TriggerEvent>();
  private routines = new Map<string, RoutineRecord>();
  private routineHistory = new Map<string, RoutineHistoryRecord>();
  private webhookTriggers = new Map<string, WebhookTriggerRecord>();
  private webhookDeliveries = new Map<string, WebhookDeliveryRecord>();
  private heartbeats = new Map<string, AgentHeartbeatSettings>(); // key: `${tenantId}:${agentId}`
  private busyAgents = new Set<string>(); // key: `${tenantId}:${agentId}`

  async transaction<T>(operation: (store: StudioStore) => Promise<T>): Promise<T> {
    const snapshot = {
      workflows: new Map(structuredClone([...this.workflows])),
      agents: new Map(structuredClone([...this.agents])),
      tools: new Map(structuredClone([...this.tools])),
      tasks: new Map(structuredClone([...this.tasks])),
      projects: new Map(structuredClone([...this.projects])),
      workspaces: new Map(structuredClone([...this.workspaces])),
      comments: new Map(structuredClone([...this.comments])),
      triggerEvents: new Map(structuredClone([...this.triggerEvents])),
      routines: new Map(structuredClone([...this.routines])),
      routineHistory: new Map(structuredClone([...this.routineHistory])),
      webhookTriggers: new Map(structuredClone([...this.webhookTriggers])),
      webhookDeliveries: new Map(structuredClone([...this.webhookDeliveries])),
      heartbeats: new Map(structuredClone([...this.heartbeats])),
      busyAgents: new Set(this.busyAgents),
    };
    try {
      return await operation(this);
    } catch (error) {
      this.workflows = snapshot.workflows;
      this.agents = snapshot.agents;
      this.tools = snapshot.tools;
      this.tasks = snapshot.tasks;
      this.projects = snapshot.projects;
      this.workspaces = snapshot.workspaces;
      this.comments = snapshot.comments;
      this.triggerEvents = snapshot.triggerEvents;
      this.routines = snapshot.routines;
      this.routineHistory = snapshot.routineHistory;
      this.webhookTriggers = snapshot.webhookTriggers;
      this.webhookDeliveries = snapshot.webhookDeliveries;
      this.heartbeats = snapshot.heartbeats;
      this.busyAgents = snapshot.busyAgents;
      throw error;
    }
  }

  async listWorkflows(principal?: StudioPrincipal) {
    return [...this.workflows.values()]
      .filter((wf) => {
        if (!principal) return true;
        const isSystem = principal.userId.startsWith("system") || principal.userId.startsWith("internal:");
        return Boolean(wf.tenantId && wf.tenantId === principal.tenantId && (isSystem || !wf.ownerId || wf.ownerId === principal.userId));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getWorkflow(id: string, principal?: StudioPrincipal) {
    const wf = this.workflows.get(id);
    if (!wf) return null;
    if (principal) {
      const isSystem = principal.userId.startsWith("system") || principal.userId.startsWith("internal:");
      if (!wf.tenantId || wf.tenantId !== principal.tenantId) return null;
      if (!isSystem && wf.ownerId && wf.ownerId !== principal.userId) return null;
    }
    return structuredClone(wf);
  }

  async saveWorkflow(definition: WorkflowDefinition, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.workflows.get(definition.id);
      if (existing && (!existing.tenantId || !existing.ownerId || existing.tenantId !== principal.tenantId || existing.ownerId !== principal.userId)) {
        throw new Error("Access denied to workflow");
      }
      definition = { ...definition, ownerId: principal.userId, tenantId: principal.tenantId };
    }
    this.workflows.set(definition.id, structuredClone(definition));
    return structuredClone(definition);
  }

  async deleteWorkflow(id: string, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.workflows.get(id);
      if (existing && (!existing.tenantId || !existing.ownerId || existing.tenantId !== principal.tenantId || existing.ownerId !== principal.userId)) {
        throw new Error("Access denied to workflow");
      }
    }
    this.workflows.delete(id);
  }

  async listAgents(principal?: StudioPrincipal) {
    return [...this.agents.values()]
      .filter((agent) => {
        if (!principal) return true;
        if (agent.isSystem) return true;
        const isSystem = principal.userId.startsWith("system") || principal.userId.startsWith("internal:");
        return Boolean(agent.tenantId && agent.tenantId === principal.tenantId && (isSystem || !agent.ownerId || agent.ownerId === principal.userId));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getAgent(id: string, principal?: StudioPrincipal) {
    const agent = this.agents.get(id);
    if (!agent) return null;
    if (principal) {
      if (agent.isSystem) return structuredClone(agent);
      if (!agent.tenantId || agent.tenantId !== principal.tenantId) return null;
      const isSystem = principal.userId.startsWith("system") || principal.userId.startsWith("internal:");
      if (!isSystem && agent.ownerId && agent.ownerId !== principal.userId) return null;
    }
    return structuredClone(agent);
  }

  async saveAgent(agent: AgentRecord, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.agents.get(agent.id);
      if (existing) {
        if (existing.isSystem) throw new Error("Cannot modify system agent");
        if (!existing.tenantId || existing.tenantId !== principal.tenantId || (existing.ownerId && existing.ownerId !== principal.userId)) {
          throw new Error("Access denied to agent");
        }
      }
      agent = { ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
    }
    this.agents.set(agent.id, structuredClone(agent));
    return structuredClone(agent);
  }

  async deleteAgent(id: string, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.agents.get(id);
      if (existing) {
        if (existing.isSystem) throw new Error("Cannot delete system agent");
        if (!existing.tenantId || existing.tenantId !== principal.tenantId || (existing.ownerId && existing.ownerId !== principal.userId)) {
          throw new Error("Access denied to agent");
        }
      }
    }
    this.agents.delete(id);
  }

  async listTools(principal?: StudioPrincipal) {
    return [...this.tools.values()]
      .filter((tool) => {
        if (!principal) return true;
        if (tool.isSystem) return true;
        return Boolean(tool.tenantId && tool.tenantId === principal.tenantId && (!tool.ownerId || tool.ownerId === principal.userId));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getTool(id: string, principal?: StudioPrincipal) {
    const tool = this.tools.get(id);
    if (!tool) return null;
    if (principal) {
      if (tool.isSystem) return structuredClone(tool);
      if (!tool.tenantId || tool.tenantId !== principal.tenantId) return null;
      if (tool.ownerId && tool.ownerId !== principal.userId) return null;
    }
    return structuredClone(tool);
  }

  async saveTool(tool: ToolRecord, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.tools.get(tool.id);
      if (existing) {
        if (existing.isSystem) throw new Error("Cannot modify system tool");
        if (!existing.tenantId || existing.tenantId !== principal.tenantId || (existing.ownerId && existing.ownerId !== principal.userId)) {
          throw new Error("Access denied to tool");
        }
      }
      tool = { ...tool, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
    }
    this.tools.set(tool.id, structuredClone(tool));
    return structuredClone(tool);
  }

  async deleteTool(id: string, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.tools.get(id);
      if (existing) {
        if (existing.isSystem) throw new Error("Cannot delete system tool");
        if (!existing.tenantId || existing.tenantId !== principal.tenantId || (existing.ownerId && existing.ownerId !== principal.userId)) {
          throw new Error("Access denied to tool");
        }
      }
    }
    this.tools.delete(id);
  }

  async listTasks(principal?: StudioPrincipal) {
    return [...this.tasks.values()]
      .filter((task) => {
        if (!principal) return true;
        return Boolean(task.tenantId && task.tenantId === principal.tenantId);
      })
      .sort((a, b) => ((b.updatedAt ?? b.createdAt) || "").localeCompare((a.updatedAt ?? a.createdAt) || ""))
      .map((task) => structuredClone(task));
  }

  async getTask(id: string, principal?: StudioPrincipal) {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (principal && (!task.tenantId || task.tenantId !== principal.tenantId)) {
      return null;
    }
    return structuredClone(task);
  }

  async listTasksByWorkspace(workspaceId: string, principal?: StudioPrincipal) {
    return (await this.listTasks(principal)).filter((task) => task.workspaceId === workspaceId);
  }

  async listTasksByProject(projectId: string, principal?: StudioPrincipal) {
    return (await this.listTasks(principal)).filter((task) => (task.projectIds ?? []).includes(projectId));
  }

  async saveTask(task: StudioTask, principal?: StudioPrincipal) {
    const assignedAgents = Array.isArray(task.assignedAgents)
      ? task.assignedAgents
      : task.assignedAgent
        ? [task.assignedAgent]
        : [];
    const assignedAgent = task.assignedAgent ?? (assignedAgents[0] ?? null);
    const updatedAt = task.updatedAt ?? task.createdAt ?? new Date().toISOString();
    const projectIds = Array.isArray(task.projectIds) ? [...new Set(task.projectIds.filter(Boolean))] : [];
    const workspaceId = task.workspaceId;
    if (!workspaceId) throw new Error("Task workspaceId is required");
    if (!projectIds.length) throw new Error("Task projectIds must include at least one project");
    let record: StudioTask = {
      ...task,
      assignedAgent,
      assignedAgents,
      workflowId: task.workflowId ?? null,
      startedAt: task.startedAt ?? null,
      completedAt: task.completedAt ?? null,
      parentTaskId: task.parentTaskId ?? null,
      runId: task.runId ?? null,
      lastError: task.lastError ?? null,
      metadata: task.metadata ?? {},
      workspaceId,
      projectIds,
      updatedAt,
    };
    if (principal) {
      const existing = this.tasks.get(task.id);
      if (existing && (!existing.tenantId || existing.tenantId !== principal.tenantId)) {
        throw new Error("Access denied to task");
      }
      record = { ...record, tenantId: principal.tenantId, ownerId: task.ownerId ?? principal.userId };
    }
    this.tasks.set(task.id, structuredClone(record));
    return structuredClone(record);
  }

  async deleteTask(id: string, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.tasks.get(id);
      if (existing && (!existing.tenantId || existing.tenantId !== principal.tenantId)) {
        throw new Error("Access denied to task");
      }
    }
    this.tasks.delete(id);
  }

  async listProjects(principal?: StudioPrincipal, status: StudioEntityStatusFilter = "active") {
    return [...this.projects.values()]
      .filter((project) => {
        if (principal && project.tenantId !== principal.tenantId) return false;
        return matchesStatus(project.status, status);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((project) => structuredClone(project));
  }

  async getProject(id: string, principal?: StudioPrincipal) {
    const project = this.projects.get(id);
    if (!project) return null;
    if (principal && project.tenantId !== principal.tenantId) return null;
    return structuredClone(project);
  }

  async saveProject(project: StudioProject, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.projects.get(project.id);
      if (existing && existing.tenantId !== principal.tenantId) throw new Error("Access denied to project");
      project = { ...project, tenantId: principal.tenantId, ownerId: project.ownerId || principal.userId };
    }
    this.projects.set(project.id, structuredClone(project));
    return structuredClone(project);
  }

  async listWorkspaces(principal?: StudioPrincipal, status: StudioEntityStatusFilter = "active") {
    return [...this.workspaces.values()]
      .filter((workspace) => {
        if (principal && workspace.tenantId !== principal.tenantId) return false;
        return matchesStatus(workspace.status, status);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((workspace) => structuredClone(workspace));
  }

  async getWorkspace(id: string, principal?: StudioPrincipal) {
    const workspace = this.workspaces.get(id);
    if (!workspace) return null;
    if (principal && workspace.tenantId !== principal.tenantId) return null;
    return structuredClone(workspace);
  }

  async saveWorkspace(workspace: StudioWorkspace, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.workspaces.get(workspace.id);
      if (existing && existing.tenantId !== principal.tenantId) throw new Error("Access denied to workspace");
      workspace = { ...workspace, tenantId: principal.tenantId, ownerId: workspace.ownerId || principal.userId };
    }
    this.workspaces.set(workspace.id, structuredClone(workspace));
    return structuredClone(workspace);
  }

  async importWorkspace(workspace: StudioWorkspaceImport, principal?: StudioPrincipal) {
    for (const workflow of workspace.workflows) {
      const definition = principal
        ? { ...workflow, ownerId: principal.userId, tenantId: principal.tenantId }
        : workflow;
      this.workflows.set(definition.id, structuredClone(definition));
    }
    for (const agent of workspace.agents) {
      const record = principal
        ? { ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false }
        : agent;
      this.agents.set(record.id, structuredClone(record));
    }
    for (const tool of workspace.tools) {
      const record = principal
        ? { ...tool, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false }
        : tool;
      this.tools.set(record.id, structuredClone(record));
    }
  }

  // --- Task Comments ---

  async listComments(taskId: string, principal?: StudioPrincipal): Promise<TaskComment[]> {
    return [...this.comments.values()]
      .filter((c) => c.taskId === taskId && (!principal || c.tenantId === principal.tenantId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((c) => structuredClone(c));
  }

  async getComment(id: string, principal?: StudioPrincipal): Promise<TaskComment | null> {
    const comment = this.comments.get(id);
    if (!comment) return null;
    if (principal && comment.tenantId !== principal.tenantId) return null;
    return structuredClone(comment);
  }

  async saveComment(comment: TaskComment, principal?: StudioPrincipal): Promise<TaskComment> {
    if (principal) {
      const existing = this.comments.get(comment.id);
      if (existing && existing.tenantId !== principal.tenantId) throw new Error("Access denied to task comment");
      comment = { ...comment, tenantId: principal.tenantId };
    }
    this.comments.set(comment.id, structuredClone(comment));
    return structuredClone(comment);
  }

  async deleteComment(id: string, principal?: StudioPrincipal): Promise<void> {
    const comment = this.comments.get(id);
    if (!comment) return;
    if (principal && comment.tenantId !== principal.tenantId) throw new Error("Access denied to task comment");
    this.comments.delete(id);
  }

  // --- Trigger Events (Outbox) ---

  async enqueueTriggerEvent(
    event: Omit<TriggerEvent, "id" | "createdAt" | "updatedAt" | "retryCount" | "status" | "maxRetries"> &
      Partial<Pick<TriggerEvent, "id" | "retryCount" | "status" | "maxRetries">>
  ): Promise<TriggerEvent> {
    // Idempotency check: unique (tenant_id, idempotency_key)
    for (const existing of this.triggerEvents.values()) {
      if (existing.tenantId === event.tenantId && existing.idempotencyKey === event.idempotencyKey) {
        return structuredClone(existing);
      }
    }

    const id = event.id || uid("trig");
    const record: TriggerEvent = {
      id,
      tenantId: event.tenantId,
      eventType: event.eventType,
      targetType: event.targetType,
      targetId: event.targetId,
      idempotencyKey: event.idempotencyKey,
      payload: event.payload ?? {},
      status: event.status ?? "pending",
      retryCount: event.retryCount ?? 0,
      maxRetries: event.maxRetries ?? 3,
      nextRetryAt: event.nextRetryAt ?? null,
      lockedBy: null,
      lockedUntil: null,
      lastError: null,
      dispatchedRunId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.triggerEvents.set(id, structuredClone(record));
    return structuredClone(record);
  }

  async claimNextTriggerEvent(workerId: string, leaseDurationSeconds = 60): Promise<TriggerEvent | null> {
    const now = Date.now();
    const candidates = [...this.triggerEvents.values()]
      .filter((e) => {
        const isDueStatus =
          e.status === "pending" ||
          e.status === "failed" ||
          (e.status === "processing" && Boolean(e.lockedUntil && Date.parse(e.lockedUntil) <= now));
        if (!isDueStatus) return false;
        if (e.retryCount >= e.maxRetries) return false;
        if (e.nextRetryAt && Date.parse(e.nextRetryAt) > now) return false;
        if (e.lockedUntil && Date.parse(e.lockedUntil) > now) return false;
        return true;
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    if (!candidates.length) return null;
    const claimed = candidates[0];
    claimed.status = "processing";
    claimed.lockedBy = workerId;
    claimed.lockedUntil = new Date(now + leaseDurationSeconds * 1000).toISOString();
    claimed.updatedAt = nowIso();
    this.triggerEvents.set(claimed.id, claimed);
    return structuredClone(claimed);
  }

  async updateTriggerEvent(id: string, patch: Partial<TriggerEvent>, expectedLockedBy?: string): Promise<TriggerEvent | null> {
    const existing = this.triggerEvents.get(id);
    if (!existing) return null;
    if (expectedLockedBy !== undefined && existing.lockedBy !== expectedLockedBy) {
      return null; // CAS failure: lease ownership mismatch!
    }
    const updated: TriggerEvent = {
      ...existing,
      ...patch,
      updatedAt: nowIso(),
    };
    this.triggerEvents.set(id, updated);
    return structuredClone(updated);
  }

  async listTriggerEvents(filters?: { status?: TriggerEventStatus; tenantId?: string; limit?: number; idempotencyKey?: string }): Promise<TriggerEvent[]> {
    let items = [...this.triggerEvents.values()];
    if (filters?.status) items = items.filter((e) => e.status === filters.status);
    if (filters?.tenantId) items = items.filter((e) => e.tenantId === filters.tenantId);
    if (filters?.idempotencyKey) items = items.filter((e) => e.idempotencyKey === filters.idempotencyKey);
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (filters?.limit) items = items.slice(0, filters.limit);
    return items.map((e) => structuredClone(e));
  }

  // --- Recurring Routines ---

  async listRoutines(principal?: StudioPrincipal): Promise<RoutineRecord[]> {
    return [...this.routines.values()]
      .filter((r) => !principal || r.tenantId === principal.tenantId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((r) => structuredClone(r));
  }

  async getRoutine(id: string, principal?: StudioPrincipal): Promise<RoutineRecord | null> {
    const routine = this.routines.get(id);
    if (!routine) return null;
    if (principal && routine.tenantId !== principal.tenantId) return null;
    return structuredClone(routine);
  }

  async saveRoutine(routine: RoutineRecord, principal?: StudioPrincipal): Promise<RoutineRecord> {
    if (principal) {
      const existing = this.routines.get(routine.id);
      if (existing && existing.tenantId !== principal.tenantId) throw new Error("Access denied to routine");
      routine = { ...routine, tenantId: principal.tenantId, ownerId: routine.ownerId || principal.userId };
    }
    this.routines.set(routine.id, structuredClone(routine));
    return structuredClone(routine);
  }

  async deleteRoutine(id: string, principal?: StudioPrincipal): Promise<void> {
    const routine = this.routines.get(id);
    if (!routine) return;
    if (principal && routine.tenantId !== principal.tenantId) throw new Error("Access denied to routine");
    this.routines.delete(id);
  }

  async claimDueRoutines(workerId: string, limit = 5): Promise<RoutineRecord[]> {
    const now = Date.now();
    const leaseUntil = new Date(now + 60_000).toISOString();
    const due: RoutineRecord[] = [];
    for (const r of this.routines.values()) {
      if (r.enabled && r.nextRunAt && Date.parse(r.nextRunAt) <= now) {
        const originalNextRunAt = r.nextRunAt;
        r.nextRunAt = leaseUntil;
        r.updatedAt = nowIso();
        const copy = structuredClone(r);
        copy.nextRunAt = originalNextRunAt;
        due.push(copy);
        if (due.length >= limit) break;
      }
    }
    return due;
  }

  async recordRoutineHistory(history: RoutineHistoryRecord): Promise<RoutineHistoryRecord> {
    this.routineHistory.set(history.id, structuredClone(history));
    return structuredClone(history);
  }

  async listRoutineHistory(routineId: string, principal?: StudioPrincipal, limit = 50): Promise<RoutineHistoryRecord[]> {
    return [...this.routineHistory.values()]
      .filter((h) => h.routineId === routineId && (!principal || h.tenantId === principal.tenantId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((h) => structuredClone(h));
  }

  // --- Webhook Triggers ---

  async listWebhookTriggers(principal?: StudioPrincipal): Promise<WebhookTriggerRecord[]> {
    return [...this.webhookTriggers.values()]
      .filter((w) => !principal || w.tenantId === principal.tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((w) => structuredClone(w));
  }

  async getWebhookTrigger(id: string, principal?: StudioPrincipal): Promise<WebhookTriggerRecord | null> {
    const trigger = this.webhookTriggers.get(id);
    if (!trigger) return null;
    if (principal && trigger.tenantId !== principal.tenantId) return null;
    return structuredClone(trigger);
  }

  async saveWebhookTrigger(trigger: WebhookTriggerRecord, principal?: StudioPrincipal): Promise<WebhookTriggerRecord> {
    if (principal) {
      const existing = this.webhookTriggers.get(trigger.id);
      if (existing && existing.tenantId !== principal.tenantId) throw new Error("Access denied to webhook trigger");
      trigger = { ...trigger, tenantId: principal.tenantId, ownerId: trigger.ownerId || principal.userId };
    }
    this.webhookTriggers.set(trigger.id, structuredClone(trigger));
    return structuredClone(trigger);
  }

  async deleteWebhookTrigger(id: string, principal?: StudioPrincipal): Promise<void> {
    const trigger = this.webhookTriggers.get(id);
    if (!trigger) return;
    if (principal && trigger.tenantId !== principal.tenantId) throw new Error("Access denied to webhook trigger");
    this.webhookTriggers.delete(id);
  }

  async recordWebhookDelivery(delivery: WebhookDeliveryRecord): Promise<WebhookDeliveryRecord> {
    this.webhookDeliveries.set(delivery.id, structuredClone(delivery));
    return structuredClone(delivery);
  }

  async listWebhookDeliveries(triggerId: string, principal?: StudioPrincipal, limit = 50): Promise<WebhookDeliveryRecord[]> {
    return [...this.webhookDeliveries.values()]
      .filter((d) => d.triggerId === triggerId && (!principal || d.tenantId === principal.tenantId))
      .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt))
      .slice(0, limit)
      .map((d) => structuredClone(d));
  }

  async countRecentWebhookDeliveries(triggerId: string, windowSeconds: number): Promise<number> {
    const threshold = Date.now() - windowSeconds * 1000;
    let count = 0;
    for (const d of this.webhookDeliveries.values()) {
      if (d.triggerId === triggerId && d.status === "accepted" && Date.parse(d.deliveredAt) >= threshold) {
        count++;
      }
    }
    return count;
  }

  async acceptWebhookDelivery(params: AcceptWebhookDeliveryParams): Promise<AcceptWebhookDeliveryResult> {
    const trigger = this.webhookTriggers.get(params.triggerId);
    const deliveryId = params.deliveryId ?? uid("deliv");
    const stamp = nowIso();

    if (!trigger) {
      const dummyDelivery: WebhookDeliveryRecord = {
        id: deliveryId,
        tenantId: "unknown",
        triggerId: params.triggerId,
        deliveredAt: stamp,
        status: "rejected",
        httpStatus: 404,
        errorReason: `Webhook trigger "${params.triggerId}" not found`,
        payloadSummary: params.payloadSummary ?? {},
        durationMs: params.durationMs ?? 0,
      };
      return { decision: "rejected", httpStatus: 404, delivery: dummyDelivery, error: dummyDelivery.errorReason ?? undefined };
    }

    if (!trigger.enabled) {
      const delivery: WebhookDeliveryRecord = {
        id: deliveryId,
        tenantId: trigger.tenantId,
        triggerId: trigger.id,
        idempotencyKey: params.idempotencyKey ?? null,
        deliveredAt: stamp,
        status: "rejected",
        httpStatus: 400,
        errorReason: "Webhook trigger is disabled",
        payloadSummary: params.payloadSummary ?? {},
        durationMs: params.durationMs ?? 0,
      };
      await this.recordWebhookDelivery(delivery);
      return { decision: "rejected", httpStatus: 400, delivery, error: delivery.errorReason ?? undefined };
    }

    // Replay check (must precede rate-limiting so replay returns 409)
    if (params.idempotencyKey) {
      const existingAccepted = [...this.webhookDeliveries.values()].find(
        (d) => d.triggerId === trigger.id && d.idempotencyKey === params.idempotencyKey && d.status === "accepted"
      );
      if (existingAccepted) {
        return {
          decision: "replay",
          httpStatus: 409,
          delivery: existingAccepted,
          error: "Duplicate delivery or replay detected",
        };
      }
    }

    // Rate limit check (rejected 429s must not extend lockout)
    const recentCount = await this.countRecentWebhookDeliveries(trigger.id, 60);
    if (recentCount >= trigger.rateLimitPerMinute) {
      const delivery: WebhookDeliveryRecord = {
        id: deliveryId,
        tenantId: trigger.tenantId,
        triggerId: trigger.id,
        idempotencyKey: params.idempotencyKey ?? null,
        deliveredAt: stamp,
        status: "rejected",
        httpStatus: 429,
        errorReason: `Rate limit of ${trigger.rateLimitPerMinute}/min exceeded (${recentCount} deliveries in last 60s)`,
        payloadSummary: params.payloadSummary ?? {},
        durationMs: params.durationMs ?? 0,
      };
      await this.recordWebhookDelivery(delivery);
      return { decision: "rejected", httpStatus: 429, delivery, error: delivery.errorReason ?? undefined };
    }

    // Accept delivery and enqueue outbox event atomically
    const acceptedDelivery: WebhookDeliveryRecord = {
      id: deliveryId,
      tenantId: trigger.tenantId,
      triggerId: trigger.id,
      idempotencyKey: params.idempotencyKey ?? null,
      deliveredAt: stamp,
      status: "accepted",
      httpStatus: 202,
      payloadSummary: params.payloadSummary ?? {},
      durationMs: params.durationMs ?? 0,
    };
    await this.recordWebhookDelivery(acceptedDelivery);

    const outboxKey = params.idempotencyKey
      ? `wh:${trigger.id}:${params.idempotencyKey}`
      : `wh:${trigger.id}:${deliveryId}`;

    const outboxEvent = await this.enqueueTriggerEvent({
      tenantId: trigger.tenantId,
      eventType: "webhook_inbound",
      targetType: trigger.targetType,
      targetId: trigger.targetId,
      idempotencyKey: outboxKey,
      payload: {
        triggerId: trigger.id,
        triggerName: trigger.name,
        deliveryId,
        payload: params.payload,
      },
    });

    return {
      decision: "accepted",
      httpStatus: 202,
      delivery: acceptedDelivery,
      outboxEvent,
    };
  }

  // --- Agent Heartbeats ---

  async getAgentHeartbeat(agentId: string, principal?: StudioPrincipal): Promise<AgentHeartbeatSettings | null> {
    for (const [key, hb] of this.heartbeats.entries()) {
      if (hb.agentId === agentId) {
        if (!principal || hb.tenantId === principal.tenantId) {
          return structuredClone(hb);
        }
      }
    }
    return null;
  }

  async saveAgentHeartbeat(settings: AgentHeartbeatSettings, principal?: StudioPrincipal): Promise<AgentHeartbeatSettings> {
    if (principal) {
      settings = { ...settings, tenantId: principal.tenantId };
    }
    const key = `${settings.tenantId}:${settings.agentId}`;
    this.heartbeats.set(key, structuredClone(settings));
    return structuredClone(settings);
  }

  async claimDueHeartbeats(workerId: string, limit = 10): Promise<AgentHeartbeatSettings[]> {
    const now = Date.now();
    const due: AgentHeartbeatSettings[] = [];
    for (const [key, hb] of this.heartbeats.entries()) {
      if (
        hb.enabled &&
        hb.nextHeartbeatAt &&
        Date.parse(hb.nextHeartbeatAt) <= now &&
        (!hb.lockedUntil || Date.parse(hb.lockedUntil) <= now)
      ) {
        hb.lockedBy = workerId;
        hb.lockedUntil = new Date(now + 60_000).toISOString();
        due.push(structuredClone(hb));
        if (due.length >= limit) break;
      }
    }
    return due;
  }

  setAgentBusy(agentId: string, tenantId: string, busy: boolean): void {
    const key = `${tenantId}:${agentId}`;
    if (busy) this.busyAgents.add(key);
    else this.busyAgents.delete(key);
  }

  async isAgentBusy(agentId: string, tenantId: string): Promise<boolean> {
    return this.busyAgents.has(`${tenantId}:${agentId}`);
  }
}
