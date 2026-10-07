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
import type { PgClient, PgPool } from "../../memory/infrastructure";
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

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function decodeSettings(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function decodeComment(row: Record<string, unknown>): TaskComment {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    taskId: String(row.task_id),
    authorId: String(row.author_id),
    authorType: row.author_type as TaskComment["authorType"],
    content: String(row.content),
    mentions: Array.isArray(row.mentions) ? (row.mentions as string[]) : [],
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {},
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function decodeTriggerEvent(row: Record<string, unknown>): TriggerEvent {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    eventType: row.event_type as TriggerEvent["eventType"],
    targetType: row.target_type as TriggerEvent["targetType"],
    targetId: String(row.target_id),
    idempotencyKey: String(row.idempotency_key),
    payload: row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {},
    status: row.status as TriggerEvent["status"],
    retryCount: Number(row.retry_count ?? 0),
    maxRetries: Number(row.max_retries ?? 3),
    nextRetryAt: row.next_retry_at ? asIso(row.next_retry_at) : null,
    lockedBy: (row.locked_by as string | null) ?? null,
    lockedUntil: row.locked_until ? asIso(row.locked_until) : null,
    lastError: (row.last_error as string | null) ?? null,
    dispatchedRunId: (row.dispatched_run_id as string | null) ?? null,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function decodeRoutine(row: Record<string, unknown>): RoutineRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    scheduleType: row.schedule_type as RoutineRecord["scheduleType"],
    scheduleExpr: String(row.schedule_expr),
    timezone: String(row.timezone ?? "UTC"),
    targetType: row.target_type as RoutineRecord["targetType"],
    targetId: String(row.target_id),
    inputPayload: row.input_payload && typeof row.input_payload === "object" && !Array.isArray(row.input_payload) ? (row.input_payload as Record<string, unknown>) : {},
    misfirePolicy: row.misfire_policy as RoutineRecord["misfirePolicy"],
    enabled: Boolean(row.enabled),
    nextRunAt: row.next_run_at ? asIso(row.next_run_at) : null,
    lastRunAt: row.last_run_at ? asIso(row.last_run_at) : null,
    lastStatus: (row.last_status as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    ownerId: String(row.owner_id),
  };
}

function decodeRoutineHistory(row: Record<string, unknown>): RoutineHistoryRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    routineId: String(row.routine_id),
    scheduledAt: asIso(row.scheduled_at),
    executedAt: asIso(row.executed_at),
    status: row.status as RoutineHistoryRecord["status"],
    runId: (row.run_id as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: asIso(row.created_at),
  };
}

function decodeWebhookTrigger(row: Record<string, unknown>): WebhookTriggerRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    secretHash: String(row.secret_hash),
    targetType: row.target_type as WebhookTriggerRecord["targetType"],
    targetId: String(row.target_id),
    enabled: Boolean(row.enabled),
    rateLimitPerMinute: Number(row.rate_limit_per_minute ?? 60),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    ownerId: String(row.owner_id),
  };
}

function decodeWebhookDelivery(row: Record<string, unknown>): WebhookDeliveryRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    triggerId: String(row.trigger_id),
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    deliveredAt: asIso(row.delivered_at),
    status: row.status as WebhookDeliveryRecord["status"],
    httpStatus: Number(row.http_status),
    errorReason: (row.error_reason as string | null) ?? null,
    runId: (row.run_id as string | null) ?? null,
    payloadSummary: row.payload_summary && typeof row.payload_summary === "object" && !Array.isArray(row.payload_summary) ? (row.payload_summary as Record<string, unknown>) : {},
    durationMs: Number(row.duration_ms ?? 0),
  };
}

function decodeAgentHeartbeat(row: Record<string, unknown>): AgentHeartbeatSettings {
  return {
    agentId: String(row.agent_id),
    tenantId: String(row.tenant_id),
    enabled: Boolean(row.enabled),
    intervalSeconds: Number(row.interval_seconds ?? 300),
    lastHeartbeatAt: row.last_heartbeat_at ? asIso(row.last_heartbeat_at) : null,
    nextHeartbeatAt: row.next_heartbeat_at ? asIso(row.next_heartbeat_at) : null,
    lockedBy: (row.locked_by as string | null) ?? null,
    lockedUntil: row.locked_until ? asIso(row.locked_until) : null,
  };
}

function decodeProject(row: Record<string, unknown>): StudioProject {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    status: row.status === "retired" ? "retired" : "active",
    settings: decodeSettings(row.settings),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    ownerId: String(row.owner_id),
  };
}

function decodeWorkspace(row: Record<string, unknown>): StudioWorkspace {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: String(row.description ?? ""),
    status: row.status === "retired" ? "retired" : "active",
    settings: decodeSettings(row.settings),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    ownerId: String(row.owner_id),
  };
}

function decodeTask(row: Record<string, unknown>, projectIds: string[] = []): StudioTask {
  const assignedAgents = Array.isArray(row.assigned_agents)
    ? (row.assigned_agents as string[])
    : row.assigned_agent
      ? [String(row.assigned_agent)]
      : [];
  const assignedAgent = (row.assigned_agent as string | null) ?? (assignedAgents[0] ?? null);

  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ""),
    priority: row.priority as StudioTask["priority"],
    status: row.status as StudioTask["status"],
    assignedAgent,
    assignedAgents,
    workflowId: (row.workflow_id as string | null) ?? null,
    startedAt: row.started_at ? asIso(row.started_at) : null,
    completedAt: row.completed_at ? asIso(row.completed_at) : null,
    parentTaskId: (row.parent_task_id as string | null) ?? null,
    dependencies: Array.isArray(row.dependencies) ? (row.dependencies as string[]) : [],
    runId: (row.run_id as string | null) ?? null,
    output: (row.output as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    retryCount: Number(row.retry_count ?? 0),
    paused: Boolean(row.paused),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {},
    ownerId: (row.owner_id as string | null) ?? undefined,
    tenantId: (row.tenant_id as string | null) ?? undefined,
    workspaceId: row.workspace_id ? String(row.workspace_id) : undefined,
    projectIds,
  };
}

export class PostgresStudioStore implements StudioStore {
  constructor(private readonly pool: PgPool, private readonly client?: PgClient) {}
  private query(text: string, values?: unknown[]) { return (this.client ?? this.pool).query(text, values); }

  async transaction<T>(operation: (store: StudioStore) => Promise<T>): Promise<T> {
    if (this.client) throw new Error("Nested Studio transactions are unsupported.");
    const client = await this.pool.connect();
    const transactionStore = new PostgresStudioStore(this.pool, client);
    try {
      await client.query("BEGIN");
      const result = await operation(transactionStore);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve the operation error. */ }
      throw error;
    } finally { client.release(); }
  }

  async listWorkflows(principal?: StudioPrincipal): Promise<WorkflowDefinition[]> {
    const result = principal
      ? await this.query(
          "SELECT definition FROM studio_workflows WHERE tenant_id = $1 AND (owner_id = $2 OR $2 LIKE 'system%' OR $2 LIKE 'internal:%') ORDER BY updated_at DESC, id",
          [principal.tenantId, principal.userId],
        )
      : await this.query("SELECT definition FROM studio_workflows ORDER BY updated_at DESC, id");
    return result.rows.map((row) => row.definition as WorkflowDefinition);
  }

  async getWorkflow(id: string, principal?: StudioPrincipal): Promise<WorkflowDefinition | null> {
    const result = principal
      ? await this.query(
          "SELECT definition FROM studio_workflows WHERE id = $1 AND tenant_id = $2 AND (owner_id = $3 OR $3 LIKE 'system%' OR $3 LIKE 'internal:%')",
          [id, principal.tenantId, principal.userId],
        )
      : await this.query("SELECT definition FROM studio_workflows WHERE id = $1", [id]);
    return result.rows[0]?.definition as WorkflowDefinition ?? null;
  }

  async saveWorkflow(definition: WorkflowDefinition, principal?: StudioPrincipal): Promise<WorkflowDefinition> {
    if (principal) {
      const existing = await this.query("SELECT tenant_id, owner_id FROM studio_workflows WHERE id = $1", [definition.id]);
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (!row.tenant_id || !row.owner_id || row.tenant_id !== principal.tenantId || row.owner_id !== principal.userId) {
          throw new Error("Access denied to workflow");
        }
      }
      definition = { ...definition, ownerId: principal.userId, tenantId: principal.tenantId };
      await this.query(
        `INSERT INTO studio_workflows (id, name, definition, created_at, updated_at, owner_id, tenant_id)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id`,
        [definition.id, definition.name, JSON.stringify(definition), definition.updatedAt, definition.updatedAt, principal.userId, principal.tenantId],
      );
    } else {
      await this.query(
        `INSERT INTO studio_workflows (id, name, definition, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at`,
        [definition.id, definition.name, JSON.stringify(definition), definition.updatedAt, definition.updatedAt],
      );
    }
    return definition;
  }

  async deleteWorkflow(id: string, principal?: StudioPrincipal): Promise<void> {
    if (principal) {
      await this.query("DELETE FROM studio_workflows WHERE id = $1 AND tenant_id = $2 AND owner_id = $3", [id, principal.tenantId, principal.userId]);
    } else {
      await this.query("DELETE FROM studio_workflows WHERE id = $1", [id]);
    }
  }

  async listAgents(principal?: StudioPrincipal): Promise<AgentRecord[]> {
    const result = principal
      ? await this.query(
          "SELECT record FROM studio_agents WHERE is_system = true OR (tenant_id = $1 AND (owner_id = $2 OR owner_id IS NULL OR $2 LIKE 'system%' OR $2 LIKE 'internal:%')) ORDER BY updated_at DESC, id",
          [principal.tenantId, principal.userId],
        )
      : await this.query("SELECT record FROM studio_agents ORDER BY updated_at DESC, id");
    return result.rows.map((row) => row.record as AgentRecord);
  }

  async getAgent(id: string, principal?: StudioPrincipal): Promise<AgentRecord | null> {
    const result = principal
      ? await this.query(
          "SELECT record FROM studio_agents WHERE id = $1 AND (is_system = true OR (tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL OR $3 LIKE 'system%' OR $3 LIKE 'internal:%')))",
          [id, principal.tenantId, principal.userId],
        )
      : await this.query("SELECT record FROM studio_agents WHERE id = $1", [id]);
    return result.rows[0]?.record as AgentRecord ?? null;
  }

  async saveAgent(agent: AgentRecord, principal?: StudioPrincipal): Promise<AgentRecord> {
    if (principal) {
      const existing = await this.query("SELECT is_system, tenant_id, owner_id FROM studio_agents WHERE id = $1", [agent.id]);
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (row.is_system) throw new Error("Cannot modify system agent");
        if (!row.tenant_id || row.tenant_id !== principal.tenantId || (row.owner_id && row.owner_id !== principal.userId)) {
          throw new Error("Access denied to agent");
        }
      }
      agent = { ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
      await this.query(
        `INSERT INTO studio_agents (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system`,
        [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt, principal.userId, principal.tenantId],
      );
    } else {
      await this.query(
        `INSERT INTO studio_agents (id, name, record, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
        [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt],
      );
    }
    return agent;
  }

  async deleteAgent(id: string, principal?: StudioPrincipal): Promise<void> {
    if (principal) {
      await this.query(
        "DELETE FROM studio_agents WHERE id = $1 AND is_system = false AND tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL)",
        [id, principal.tenantId, principal.userId],
      );
    } else {
      await this.query("DELETE FROM studio_agents WHERE id = $1", [id]);
    }
  }

  async listTools(principal?: StudioPrincipal): Promise<ToolRecord[]> {
    const result = principal
      ? await this.query(
          "SELECT record FROM studio_tools WHERE is_system = true OR (tenant_id = $1 AND (owner_id = $2 OR owner_id IS NULL)) ORDER BY updated_at DESC, id",
          [principal.tenantId, principal.userId],
        )
      : await this.query("SELECT record FROM studio_tools ORDER BY updated_at DESC, id");
    return result.rows.map((row) => row.record as ToolRecord);
  }

  async getTool(id: string, principal?: StudioPrincipal): Promise<ToolRecord | null> {
    const result = principal
      ? await this.query(
          "SELECT record FROM studio_tools WHERE id = $1 AND (is_system = true OR (tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL)))",
          [id, principal.tenantId, principal.userId],
        )
      : await this.query("SELECT record FROM studio_tools WHERE id = $1", [id]);
    return result.rows[0]?.record as ToolRecord ?? null;
  }

  async saveTool(tool: ToolRecord, principal?: StudioPrincipal): Promise<ToolRecord> {
    if (principal) {
      const existing = await this.query("SELECT is_system, tenant_id, owner_id FROM studio_tools WHERE id = $1", [tool.id]);
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (row.is_system) throw new Error("Cannot modify system tool");
        if (!row.tenant_id || row.tenant_id !== principal.tenantId || (row.owner_id && row.owner_id !== principal.userId)) {
          throw new Error("Access denied to tool");
        }
      }
      tool = { ...tool, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
      await this.query(
        `INSERT INTO studio_tools (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system`,
        [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt, principal.userId, principal.tenantId],
      );
    } else {
      await this.query(
        `INSERT INTO studio_tools (id, name, record, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
        [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt],
      );
    }
    return tool;
  }

  async deleteTool(id: string, principal?: StudioPrincipal): Promise<void> {
    if (principal) {
      await this.query(
        "DELETE FROM studio_tools WHERE id = $1 AND is_system = false AND tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL)",
        [id, principal.tenantId, principal.userId],
      );
    } else {
      await this.query("DELETE FROM studio_tools WHERE id = $1", [id]);
    }
  }

  private async loadProjectIdsByTask(taskIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (!taskIds.length) return map;
    const result = await this.query(
      "SELECT task_id, project_id FROM studio_task_projects WHERE task_id = ANY($1::text[]) ORDER BY project_id",
      [taskIds],
    );
    for (const row of result.rows) {
      const taskId = String(row.task_id);
      const list = map.get(taskId) ?? [];
      list.push(String(row.project_id));
      map.set(taskId, list);
    }
    return map;
  }

  private async replaceTaskProjects(taskId: string, tenantId: string, projectIds: string[]): Promise<void> {
    await this.query("DELETE FROM studio_task_projects WHERE task_id = $1", [taskId]);
    for (const projectId of projectIds) {
      await this.query(
        `INSERT INTO studio_task_projects (tenant_id, task_id, project_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (task_id, project_id) DO NOTHING`,
        [tenantId, taskId, projectId],
      );
    }
  }

  private statusClause(status: StudioEntityStatusFilter | undefined, startIndex: number): { sql: string; values: unknown[] } {
    if (!status || status === "active") return { sql: ` AND status = $${startIndex}`, values: ["active"] };
    if (status === "retired") return { sql: ` AND status = $${startIndex}`, values: ["retired"] };
    return { sql: "", values: [] };
  }

  async listTasks(principal?: StudioPrincipal): Promise<StudioTask[]> {
    const result = principal
      ? await this.query("SELECT * FROM studio_tasks WHERE tenant_id = $1 ORDER BY updated_at DESC, id", [principal.tenantId])
      : await this.query("SELECT * FROM studio_tasks ORDER BY updated_at DESC, id");
    const projectIds = await this.loadProjectIdsByTask(result.rows.map((row) => String(row.id)));
    return result.rows.map((row) => decodeTask(row, projectIds.get(String(row.id)) ?? []));
  }

  async getTask(id: string, principal?: StudioPrincipal): Promise<StudioTask | null> {
    const result = principal
      ? await this.query("SELECT * FROM studio_tasks WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId])
      : await this.query("SELECT * FROM studio_tasks WHERE id = $1", [id]);
    if (!result.rows[0]) return null;
    const projectIds = await this.loadProjectIdsByTask([id]);
    return decodeTask(result.rows[0], projectIds.get(id) ?? []);
  }

  async listTasksByWorkspace(workspaceId: string, principal?: StudioPrincipal): Promise<StudioTask[]> {
    const result = principal
      ? await this.query(
          "SELECT * FROM studio_tasks WHERE workspace_id = $1 AND tenant_id = $2 ORDER BY updated_at DESC, id",
          [workspaceId, principal.tenantId],
        )
      : await this.query(
          "SELECT * FROM studio_tasks WHERE workspace_id = $1 ORDER BY updated_at DESC, id",
          [workspaceId],
        );
    const projectIds = await this.loadProjectIdsByTask(result.rows.map((row) => String(row.id)));
    return result.rows.map((row) => decodeTask(row, projectIds.get(String(row.id)) ?? []));
  }

  async listTasksByProject(projectId: string, principal?: StudioPrincipal): Promise<StudioTask[]> {
    const result = principal
      ? await this.query(
          `SELECT t.* FROM studio_tasks t
           INNER JOIN studio_task_projects tp ON tp.task_id = t.id
           WHERE tp.project_id = $1 AND t.tenant_id = $2
           ORDER BY t.updated_at DESC, t.id`,
          [projectId, principal.tenantId],
        )
      : await this.query(
          `SELECT t.* FROM studio_tasks t
           INNER JOIN studio_task_projects tp ON tp.task_id = t.id
           WHERE tp.project_id = $1
           ORDER BY t.updated_at DESC, t.id`,
          [projectId],
        );
    const projectIds = await this.loadProjectIdsByTask(result.rows.map((row) => String(row.id)));
    return result.rows.map((row) => decodeTask(row, projectIds.get(String(row.id)) ?? []));
  }

  async saveTask(task: StudioTask, principal?: StudioPrincipal): Promise<StudioTask> {
    const assignedAgents = Array.isArray(task.assignedAgents)
      ? task.assignedAgents
      : task.assignedAgent
        ? [task.assignedAgent]
        : [];
    const assignedAgent = task.assignedAgent ?? (assignedAgents[0] ?? null);
    const workflowId = task.workflowId ?? null;
    const startedAt = task.startedAt ?? null;
    const completedAt = task.completedAt ?? null;
    const parentTaskId = task.parentTaskId ?? null;
    const runId = task.runId ?? null;
    const lastError = task.lastError ?? null;
    const metadata = task.metadata ?? {};
    const projectIds = Array.isArray(task.projectIds) ? [...new Set(task.projectIds.filter(Boolean))] : [];
    const workspaceId = task.workspaceId;
    if (!workspaceId) throw new Error("Task workspaceId is required");
    if (!projectIds.length) throw new Error("Task projectIds must include at least one project");

    if (principal) {
      const existing = await this.query("SELECT tenant_id FROM studio_tasks WHERE id = $1", [task.id]);
      if (existing.rows.length && existing.rows[0].tenant_id !== principal.tenantId) {
        throw new Error("Access denied to task");
      }
      const updatedAt = task.updatedAt ?? task.createdAt ?? nowIso();
      task = {
        ...task,
        assignedAgent,
        assignedAgents,
        workflowId,
        startedAt,
        completedAt,
        parentTaskId,
        runId,
        lastError,
        metadata,
        workspaceId,
        projectIds,
        tenantId: principal.tenantId,
        ownerId: task.ownerId ?? principal.userId,
        updatedAt,
      };
      await this.query(
        `INSERT INTO studio_tasks (
           id, title, description, priority, status, assigned_agent, dependencies, output,
           retry_count, paused, created_at, updated_at, owner_id, tenant_id,
           workflow_id, assigned_agents, started_at, completed_at, parent_task_id, run_id, last_error, metadata,
           workspace_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8,
           $9, $10, $11::timestamptz, $12::timestamptz, $13, $14,
           $15, $16::jsonb, $17::timestamptz, $18::timestamptz, $19, $20, $21, $22::jsonb,
           $23
         )
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description, priority = EXCLUDED.priority,
           status = EXCLUDED.status, assigned_agent = EXCLUDED.assigned_agent, dependencies = EXCLUDED.dependencies,
           output = EXCLUDED.output, retry_count = EXCLUDED.retry_count, paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id,
           workflow_id = EXCLUDED.workflow_id, assigned_agents = EXCLUDED.assigned_agents,
           started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at,
           parent_task_id = EXCLUDED.parent_task_id, run_id = EXCLUDED.run_id,
           last_error = EXCLUDED.last_error, metadata = EXCLUDED.metadata,
           workspace_id = EXCLUDED.workspace_id`,
        [
          task.id, task.title, task.description, task.priority, task.status, assignedAgent,
          JSON.stringify(task.dependencies ?? []), task.output, task.retryCount, task.paused,
          task.createdAt, updatedAt, task.ownerId, principal.tenantId,
          workflowId, JSON.stringify(assignedAgents), startedAt, completedAt,
          parentTaskId, runId, lastError, JSON.stringify(metadata),
          workspaceId,
        ],
      );
      await this.replaceTaskProjects(task.id, principal.tenantId, projectIds);
    } else {
      const updatedAt = task.updatedAt ?? task.createdAt ?? nowIso();
      const tenantId = task.tenantId ?? "_orphan";
      task = {
        ...task,
        assignedAgent,
        assignedAgents,
        workflowId,
        startedAt,
        completedAt,
        parentTaskId,
        runId,
        lastError,
        metadata,
        workspaceId,
        projectIds,
        updatedAt,
      };
      await this.query(
        `INSERT INTO studio_tasks (
           id, title, description, priority, status, assigned_agent, dependencies, output,
           retry_count, paused, created_at, updated_at,
           workflow_id, assigned_agents, started_at, completed_at, parent_task_id, run_id, last_error, metadata,
           workspace_id, tenant_id, owner_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8,
           $9, $10, $11::timestamptz, $12::timestamptz,
           $13, $14::jsonb, $15::timestamptz, $16::timestamptz, $17, $18, $19, $20::jsonb,
           $21, $22, $23
         )
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description, priority = EXCLUDED.priority,
           status = EXCLUDED.status, assigned_agent = EXCLUDED.assigned_agent, dependencies = EXCLUDED.dependencies,
           output = EXCLUDED.output, retry_count = EXCLUDED.retry_count, paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at,
           workflow_id = EXCLUDED.workflow_id, assigned_agents = EXCLUDED.assigned_agents,
           started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at,
           parent_task_id = EXCLUDED.parent_task_id, run_id = EXCLUDED.run_id,
           last_error = EXCLUDED.last_error, metadata = EXCLUDED.metadata,
           workspace_id = EXCLUDED.workspace_id`,
        [
          task.id, task.title, task.description, task.priority, task.status, assignedAgent,
          JSON.stringify(task.dependencies ?? []), task.output, task.retryCount, task.paused,
          task.createdAt, updatedAt,
          workflowId, JSON.stringify(assignedAgents), startedAt, completedAt,
          parentTaskId, runId, lastError, JSON.stringify(metadata),
          workspaceId, tenantId, task.ownerId ?? null,
        ],
      );
      await this.replaceTaskProjects(task.id, tenantId, projectIds);
    }
    return task;
  }

  async deleteTask(id: string, principal?: StudioPrincipal): Promise<void> {
    if (principal) {
      await this.query("DELETE FROM studio_tasks WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId]);
    } else {
      await this.query("DELETE FROM studio_tasks WHERE id = $1", [id]);
    }
  }

  async listProjects(principal?: StudioPrincipal, status: StudioEntityStatusFilter = "active"): Promise<StudioProject[]> {
    if (principal) {
      const filter = this.statusClause(status, 2);
      const result = await this.query(
        `SELECT * FROM studio_projects WHERE tenant_id = $1${filter.sql} ORDER BY updated_at DESC, id`,
        [principal.tenantId, ...filter.values],
      );
      return result.rows.map(decodeProject);
    }
    const filter = this.statusClause(status, 1);
    const result = await this.query(
      `SELECT * FROM studio_projects WHERE TRUE${filter.sql} ORDER BY updated_at DESC, id`,
      filter.values,
    );
    return result.rows.map(decodeProject);
  }

  async getProject(id: string, principal?: StudioPrincipal): Promise<StudioProject | null> {
    const result = principal
      ? await this.query("SELECT * FROM studio_projects WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId])
      : await this.query("SELECT * FROM studio_projects WHERE id = $1", [id]);
    return result.rows[0] ? decodeProject(result.rows[0]) : null;
  }

  async saveProject(project: StudioProject, principal?: StudioPrincipal): Promise<StudioProject> {
    if (principal) {
      const existing = await this.query("SELECT tenant_id FROM studio_projects WHERE id = $1", [project.id]);
      if (existing.rows.length && existing.rows[0].tenant_id !== principal.tenantId) {
        throw new Error("Access denied to project");
      }
      project = { ...project, tenantId: principal.tenantId, ownerId: project.ownerId || principal.userId };
    }
    await this.query(
      `INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz, $9)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id, name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status,
         settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at, owner_id = EXCLUDED.owner_id`,
      [
        project.id, project.tenantId, project.name, project.description, project.status,
        JSON.stringify(project.settings ?? {}), project.createdAt, project.updatedAt, project.ownerId,
      ],
    );
    return project;
  }

  async listWorkspaces(principal?: StudioPrincipal, status: StudioEntityStatusFilter = "active"): Promise<StudioWorkspace[]> {
    if (principal) {
      const filter = this.statusClause(status, 2);
      const result = await this.query(
        `SELECT * FROM studio_workspaces WHERE tenant_id = $1${filter.sql} ORDER BY updated_at DESC, id`,
        [principal.tenantId, ...filter.values],
      );
      return result.rows.map(decodeWorkspace);
    }
    const filter = this.statusClause(status, 1);
    const result = await this.query(
      `SELECT * FROM studio_workspaces WHERE TRUE${filter.sql} ORDER BY updated_at DESC, id`,
      filter.values,
    );
    return result.rows.map(decodeWorkspace);
  }

  async getWorkspace(id: string, principal?: StudioPrincipal): Promise<StudioWorkspace | null> {
    const result = principal
      ? await this.query("SELECT * FROM studio_workspaces WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId])
      : await this.query("SELECT * FROM studio_workspaces WHERE id = $1", [id]);
    return result.rows[0] ? decodeWorkspace(result.rows[0]) : null;
  }

  async saveWorkspace(workspace: StudioWorkspace, principal?: StudioPrincipal): Promise<StudioWorkspace> {
    if (principal) {
      const existing = await this.query("SELECT tenant_id FROM studio_workspaces WHERE id = $1", [workspace.id]);
      if (existing.rows.length && existing.rows[0].tenant_id !== principal.tenantId) {
        throw new Error("Access denied to workspace");
      }
      workspace = { ...workspace, tenantId: principal.tenantId, ownerId: workspace.ownerId || principal.userId };
    }
    await this.query(
      `INSERT INTO studio_workspaces (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz, $9)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id, name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status,
         settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at, owner_id = EXCLUDED.owner_id`,
      [
        workspace.id, workspace.tenantId, workspace.name, workspace.description, workspace.status,
        JSON.stringify(workspace.settings ?? {}), workspace.createdAt, workspace.updatedAt, workspace.ownerId,
      ],
    );
    return workspace;
  }

  async importWorkspace(workspace: StudioWorkspaceImport, principal?: StudioPrincipal): Promise<void> {
    if (!this.client) {
      return this.transaction((tx) => tx.importWorkspace(workspace, principal));
    }
    for (const workflow of workspace.workflows) {
      if (principal) {
        const stamped = { ...workflow, ownerId: principal.userId, tenantId: principal.tenantId };
        await this.query(
          `INSERT INTO studio_workflows (id, name, definition, created_at, updated_at, owner_id, tenant_id)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at,
             owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id`,
          [stamped.id, stamped.name, JSON.stringify(stamped), stamped.updatedAt, stamped.updatedAt, principal.userId, principal.tenantId],
        );
      } else {
        await this.query(
          `INSERT INTO studio_workflows (id, name, definition, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at`,
          [workflow.id, workflow.name, JSON.stringify(workflow), workflow.updatedAt, workflow.updatedAt],
        );
      }
    }
    for (const agent of workspace.agents) {
      if (principal) {
        const stamped = { ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
        await this.query(
          `INSERT INTO studio_agents (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
             owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system`,
          [stamped.id, stamped.name, JSON.stringify(stamped), stamped.createdAt, stamped.updatedAt, principal.userId, principal.tenantId],
        );
      } else {
        await this.query(
          `INSERT INTO studio_agents (id, name, record, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
          [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt],
        );
      }
    }
    for (const tool of workspace.tools) {
      if (principal) {
        const stamped = { ...tool, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
        await this.query(
          `INSERT INTO studio_tools (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
             owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system`,
          [stamped.id, stamped.name, JSON.stringify(stamped), stamped.createdAt, stamped.updatedAt, principal.userId, principal.tenantId],
        );
      } else {
        await this.query(
          `INSERT INTO studio_tools (id, name, record, created_at, updated_at)
           VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at`,
          [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt],
        );
      }
    }
  }

  // --- Task Comments ---

  async listComments(taskId: string, principal?: StudioPrincipal): Promise<TaskComment[]> {
    const result = principal
      ? await this.query(
          "SELECT * FROM studio_task_comments WHERE task_id = $1 AND tenant_id = $2 ORDER BY created_at ASC",
          [taskId, principal.tenantId],
        )
      : await this.query(
          "SELECT * FROM studio_task_comments WHERE task_id = $1 ORDER BY created_at ASC",
          [taskId],
        );
    return result.rows.map(decodeComment);
  }

  async getComment(id: string, principal?: StudioPrincipal): Promise<TaskComment | null> {
    const result = principal
      ? await this.query(
          "SELECT * FROM studio_task_comments WHERE id = $1 AND tenant_id = $2",
          [id, principal.tenantId],
        )
      : await this.query("SELECT * FROM studio_task_comments WHERE id = $1", [id]);
    return result.rows[0] ? decodeComment(result.rows[0]) : null;
  }

  async saveComment(comment: TaskComment, principal?: StudioPrincipal): Promise<TaskComment> {
    const tenantId = principal?.tenantId ?? comment.tenantId;
    const result = await this.query(
      `INSERT INTO studio_task_comments (
        id, tenant_id, task_id, author_id, author_type, content, mentions, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::timestamptz, $10::timestamptz)
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        mentions = EXCLUDED.mentions,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        comment.id,
        tenantId,
        comment.taskId,
        comment.authorId,
        comment.authorType,
        comment.content,
        JSON.stringify(comment.mentions ?? []),
        JSON.stringify(comment.metadata ?? {}),
        comment.createdAt,
        comment.updatedAt,
      ],
    );
    return decodeComment(result.rows[0]);
  }

  async deleteComment(id: string, principal?: StudioPrincipal): Promise<void> {
    if (principal) {
      await this.query("DELETE FROM studio_task_comments WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId]);
    } else {
      await this.query("DELETE FROM studio_task_comments WHERE id = $1", [id]);
    }
  }

  // --- Trigger Events (Outbox) ---

  async enqueueTriggerEvent(
    event: Omit<TriggerEvent, "id" | "createdAt" | "updatedAt" | "retryCount" | "status" | "maxRetries"> &
      Partial<Pick<TriggerEvent, "id" | "retryCount" | "status" | "maxRetries">>
  ): Promise<TriggerEvent> {
    const id = event.id || uid("trig");
    const stamp = nowIso();
    const result = await this.query(
      `INSERT INTO studio_trigger_events (
        id, tenant_id, event_type, target_type, target_id, idempotency_key, payload,
        status, retry_count, max_retries, next_retry_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11::timestamptz, $12::timestamptz, $13::timestamptz
      )
      ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET
        updated_at = studio_trigger_events.updated_at
      RETURNING *`,
      [
        id,
        event.tenantId,
        event.eventType,
        event.targetType,
        event.targetId,
        event.idempotencyKey,
        JSON.stringify(event.payload ?? {}),
        event.status ?? "pending",
        event.retryCount ?? 0,
        event.maxRetries ?? 3,
        event.nextRetryAt ?? null,
        stamp,
        stamp,
      ],
    );
    return decodeTriggerEvent(result.rows[0]);
  }

  async claimNextTriggerEvent(workerId: string, leaseDurationSeconds = 60): Promise<TriggerEvent | null> {
    const result = await this.query(
      `UPDATE studio_trigger_events
       SET status = 'processing',
           locked_by = $1,
           locked_until = now() + ($2 || ' seconds')::interval,
           updated_at = now()
       WHERE id = (
         SELECT id FROM studio_trigger_events
         WHERE (
           status IN ('pending', 'failed')
           OR (status = 'processing' AND locked_until IS NOT NULL AND locked_until <= now())
         )
           AND retry_count < max_retries
           AND (next_retry_at IS NULL OR next_retry_at <= now())
           AND (locked_until IS NULL OR locked_until <= now())
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [workerId, String(leaseDurationSeconds)],
    );
    return result.rows[0] ? decodeTriggerEvent(result.rows[0]) : null;
  }

  async updateTriggerEvent(id: string, patch: Partial<TriggerEvent>, expectedLockedBy?: string): Promise<TriggerEvent | null> {
    const setClauses: string[] = ["updated_at = now()"];
    const values: unknown[] = [id];
    let idx = 2;

    if (patch.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      values.push(patch.status);
    }
    if (patch.retryCount !== undefined) {
      setClauses.push(`retry_count = $${idx++}`);
      values.push(patch.retryCount);
    }
    if (patch.nextRetryAt !== undefined) {
      setClauses.push(`next_retry_at = $${idx++}::timestamptz`);
      values.push(patch.nextRetryAt);
    }
    if (patch.lockedBy !== undefined) {
      setClauses.push(`locked_by = $${idx++}`);
      values.push(patch.lockedBy);
    }
    if (patch.lockedUntil !== undefined) {
      setClauses.push(`locked_until = $${idx++}::timestamptz`);
      values.push(patch.lockedUntil);
    }
    if (patch.lastError !== undefined) {
      setClauses.push(`last_error = $${idx++}`);
      values.push(patch.lastError);
    }
    if (patch.dispatchedRunId !== undefined) {
      setClauses.push(`dispatched_run_id = $${idx++}`);
      values.push(patch.dispatchedRunId);
    }

    let whereClause = "WHERE id = $1";
    if (expectedLockedBy !== undefined) {
      whereClause += ` AND locked_by = $${idx++}`;
      values.push(expectedLockedBy);
    }

    const result = await this.query(
      `UPDATE studio_trigger_events SET ${setClauses.join(", ")} ${whereClause} RETURNING *`,
      values,
    );
    return result.rows[0] ? decodeTriggerEvent(result.rows[0]) : null;
  }

  async listTriggerEvents(filters?: { status?: TriggerEventStatus; tenantId?: string; limit?: number; idempotencyKey?: string }): Promise<TriggerEvent[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters?.status) {
      conditions.push(`status = $${idx++}`);
      values.push(filters.status);
    }
    if (filters?.tenantId) {
      conditions.push(`tenant_id = $${idx++}`);
      values.push(filters.tenantId);
    }
    if (filters?.idempotencyKey) {
      conditions.push(`idempotency_key = $${idx++}`);
      values.push(filters.idempotencyKey);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters?.limit ? `LIMIT ${Number(filters.limit)}` : "";
    const result = await this.query(
      `SELECT * FROM studio_trigger_events ${where} ORDER BY created_at ASC ${limit}`,
      values,
    );
    return result.rows.map(decodeTriggerEvent);
  }

  // --- Recurring Routines ---

  async listRoutines(principal?: StudioPrincipal): Promise<RoutineRecord[]> {
    const result = principal
      ? await this.query("SELECT * FROM studio_routines WHERE tenant_id = $1 ORDER BY updated_at DESC", [principal.tenantId])
      : await this.query("SELECT * FROM studio_routines ORDER BY updated_at DESC");
    return result.rows.map(decodeRoutine);
  }

  async getRoutine(id: string, principal?: StudioPrincipal): Promise<RoutineRecord | null> {
    const result = principal
      ? await this.query("SELECT * FROM studio_routines WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId])
      : await this.query("SELECT * FROM studio_routines WHERE id = $1", [id]);
    return result.rows[0] ? decodeRoutine(result.rows[0]) : null;
  }

  async saveRoutine(routine: RoutineRecord, principal?: StudioPrincipal): Promise<RoutineRecord> {
    const tenantId = principal?.tenantId ?? routine.tenantId;
    const ownerId = principal?.userId ?? routine.ownerId;
    const result = await this.query(
      `INSERT INTO studio_routines (
        id, tenant_id, name, description, schedule_type, schedule_expr, timezone,
        target_type, target_id, input_payload, misfire_policy, enabled,
        next_run_at, last_run_at, last_status, last_error, created_at, updated_at, owner_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12,
        $13::timestamptz, $14::timestamptz, $15, $16, $17::timestamptz, $18::timestamptz, $19
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        schedule_type = EXCLUDED.schedule_type,
        schedule_expr = EXCLUDED.schedule_expr,
        timezone = EXCLUDED.timezone,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        input_payload = EXCLUDED.input_payload,
        misfire_policy = EXCLUDED.misfire_policy,
        enabled = EXCLUDED.enabled,
        next_run_at = EXCLUDED.next_run_at,
        last_run_at = EXCLUDED.last_run_at,
        last_status = EXCLUDED.last_status,
        last_error = EXCLUDED.last_error,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        routine.id,
        tenantId,
        routine.name,
        routine.description,
        routine.scheduleType,
        routine.scheduleExpr,
        routine.timezone,
        routine.targetType,
        routine.targetId,
        JSON.stringify(routine.inputPayload ?? {}),
        routine.misfirePolicy,
        routine.enabled,
        routine.nextRunAt ?? null,
        routine.lastRunAt ?? null,
        routine.lastStatus ?? null,
        routine.lastError ?? null,
        routine.createdAt,
        routine.updatedAt,
        ownerId,
      ],
    );
    return decodeRoutine(result.rows[0]);
  }

  async deleteRoutine(id: string, principal?: StudioPrincipal): Promise<void> {
    if (principal) {
      await this.query("DELETE FROM studio_routines WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId]);
    } else {
      await this.query("DELETE FROM studio_routines WHERE id = $1", [id]);
    }
  }

  async claimDueRoutines(workerId: string, limit = 5): Promise<RoutineRecord[]> {
    const result = await this.query(
      `WITH due AS (
         SELECT id, next_run_at AS original_next_run_at
         FROM studio_routines
         WHERE enabled = true
           AND next_run_at IS NOT NULL
           AND next_run_at <= now()
         ORDER BY next_run_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       ),
       updated AS (
         UPDATE studio_routines r
         SET next_run_at = now() + interval '60 seconds',
             updated_at = now()
         FROM due
         WHERE r.id = due.id
         RETURNING r.*, due.original_next_run_at
       )
       SELECT * FROM updated ORDER BY original_next_run_at ASC`,
      [limit],
    );
    return result.rows.map((row) => {
      const routine = decodeRoutine(row);
      if (row.original_next_run_at) {
        routine.nextRunAt = asIso(row.original_next_run_at);
      }
      return routine;
    });
  }

  async recordRoutineHistory(history: RoutineHistoryRecord): Promise<RoutineHistoryRecord> {
    const result = await this.query(
      `INSERT INTO studio_routine_history (
        id, tenant_id, routine_id, scheduled_at, executed_at, status, run_id, error, created_at
      ) VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9::timestamptz)
      RETURNING *`,
      [
        history.id,
        history.tenantId,
        history.routineId,
        history.scheduledAt,
        history.executedAt,
        history.status,
        history.runId ?? null,
        history.error ?? null,
        history.createdAt,
      ],
    );
    return decodeRoutineHistory(result.rows[0]);
  }

  async listRoutineHistory(routineId: string, principal?: StudioPrincipal, limit = 50): Promise<RoutineHistoryRecord[]> {
    const result = principal
      ? await this.query(
          "SELECT * FROM studio_routine_history WHERE routine_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT $3",
          [routineId, principal.tenantId, limit],
        )
      : await this.query(
          "SELECT * FROM studio_routine_history WHERE routine_id = $1 ORDER BY created_at DESC LIMIT $2",
          [routineId, limit],
        );
    return result.rows.map(decodeRoutineHistory);
  }

  // --- Webhook Triggers ---

  async listWebhookTriggers(principal?: StudioPrincipal): Promise<WebhookTriggerRecord[]> {
    const result = principal
      ? await this.query("SELECT * FROM studio_webhook_triggers WHERE tenant_id = $1 ORDER BY created_at DESC", [principal.tenantId])
      : await this.query("SELECT * FROM studio_webhook_triggers ORDER BY created_at DESC");
    return result.rows.map(decodeWebhookTrigger);
  }

  async getWebhookTrigger(id: string, principal?: StudioPrincipal): Promise<WebhookTriggerRecord | null> {
    const result = principal
      ? await this.query("SELECT * FROM studio_webhook_triggers WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId])
      : await this.query("SELECT * FROM studio_webhook_triggers WHERE id = $1", [id]);
    return result.rows[0] ? decodeWebhookTrigger(result.rows[0]) : null;
  }

  async saveWebhookTrigger(trigger: WebhookTriggerRecord, principal?: StudioPrincipal): Promise<WebhookTriggerRecord> {
    const tenantId = principal?.tenantId ?? trigger.tenantId;
    const ownerId = principal?.userId ?? trigger.ownerId;
    const result = await this.query(
      `INSERT INTO studio_webhook_triggers (
        id, tenant_id, name, description, secret_hash, target_type, target_id, enabled,
        rate_limit_per_minute, created_at, updated_at, owner_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        secret_hash = EXCLUDED.secret_hash,
        target_type = EXCLUDED.target_type,
        target_id = EXCLUDED.target_id,
        enabled = EXCLUDED.enabled,
        rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
        updated_at = EXCLUDED.updated_at
      RETURNING *`,
      [
        trigger.id,
        tenantId,
        trigger.name,
        trigger.description,
        trigger.secretHash,
        trigger.targetType,
        trigger.targetId,
        trigger.enabled,
        trigger.rateLimitPerMinute,
        trigger.createdAt,
        trigger.updatedAt,
        ownerId,
      ],
    );
    return decodeWebhookTrigger(result.rows[0]);
  }

  async deleteWebhookTrigger(id: string, principal?: StudioPrincipal): Promise<void> {
    if (principal) {
      await this.query("DELETE FROM studio_webhook_triggers WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId]);
    } else {
      await this.query("DELETE FROM studio_webhook_triggers WHERE id = $1", [id]);
    }
  }

  async recordWebhookDelivery(delivery: WebhookDeliveryRecord): Promise<WebhookDeliveryRecord> {
    const result = await this.query(
      `INSERT INTO studio_webhook_deliveries (
        id, tenant_id, trigger_id, idempotency_key, delivered_at, status, http_status, error_reason, run_id, payload_summary, duration_ms
      ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, $8, $9, $10::jsonb, $11)
      RETURNING *`,
      [
        delivery.id,
        delivery.tenantId,
        delivery.triggerId,
        delivery.idempotencyKey ?? null,
        delivery.deliveredAt,
        delivery.status,
        delivery.httpStatus,
        delivery.errorReason ?? null,
        delivery.runId ?? null,
        JSON.stringify(delivery.payloadSummary ?? {}),
        delivery.durationMs,
      ],
    );
    return decodeWebhookDelivery(result.rows[0]);
  }

  async listWebhookDeliveries(triggerId: string, principal?: StudioPrincipal, limit = 50): Promise<WebhookDeliveryRecord[]> {
    const result = principal
      ? await this.query(
          "SELECT * FROM studio_webhook_deliveries WHERE trigger_id = $1 AND tenant_id = $2 ORDER BY delivered_at DESC LIMIT $3",
          [triggerId, principal.tenantId, limit],
        )
      : await this.query(
          "SELECT * FROM studio_webhook_deliveries WHERE trigger_id = $1 ORDER BY delivered_at DESC LIMIT $2",
          [triggerId, limit],
        );
    return result.rows.map(decodeWebhookDelivery);
  }

  async countRecentWebhookDeliveries(triggerId: string, windowSeconds: number): Promise<number> {
    const result = await this.query(
      `SELECT count(*)::int AS count FROM studio_webhook_deliveries
       WHERE trigger_id = $1 AND status = 'accepted' AND delivered_at >= now() - ($2 || ' seconds')::interval`,
      [triggerId, String(windowSeconds)],
    );
    return result.rows[0]?.count ?? 0;
  }

  async acceptWebhookDelivery(params: AcceptWebhookDeliveryParams): Promise<AcceptWebhookDeliveryResult> {
    return this.transaction(async (txStore) => {
      const tx = txStore as PostgresStudioStore;
      const deliveryId = params.deliveryId ?? uid("deliv");
      const stamp = nowIso();

      // 1. Lock the trigger row FOR UPDATE
      const triggerRes = await tx.query(
        "SELECT * FROM studio_webhook_triggers WHERE id = $1 FOR UPDATE",
        [params.triggerId]
      );
      if (triggerRes.rows.length === 0) {
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
        return {
          decision: "rejected",
          httpStatus: 404,
          delivery: dummyDelivery,
          error: dummyDelivery.errorReason ?? undefined,
        };
      }

      const trigger = decodeWebhookTrigger(triggerRes.rows[0]);
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
        await tx.recordWebhookDelivery(delivery);
        return {
          decision: "rejected",
          httpStatus: 400,
          delivery,
          error: delivery.errorReason ?? undefined,
        };
      }

      // 2. Replay check under row lock (must precede rate-limiting so replay returns 409)
      if (params.idempotencyKey) {
        const existingAcceptedRes = await tx.query(
          "SELECT * FROM studio_webhook_deliveries WHERE trigger_id = $1 AND idempotency_key = $2 AND status = 'accepted' LIMIT 1",
          [trigger.id, params.idempotencyKey]
        );
        if (existingAcceptedRes.rows.length > 0) {
          const existingDelivery = decodeWebhookDelivery(existingAcceptedRes.rows[0]);
          return {
            decision: "replay",
            httpStatus: 409,
            delivery: existingDelivery,
            error: "Duplicate delivery or replay detected",
          };
        }
      }

      // 3. Count recent accepted deliveries under row lock (rejected 429s must not extend lockout)
      const countRes = await tx.query(
        "SELECT count(*)::int AS count FROM studio_webhook_deliveries WHERE trigger_id = $1 AND status = 'accepted' AND delivered_at >= now() - interval '60 seconds'",
        [trigger.id]
      );
      const recentCount = countRes.rows[0]?.count ?? 0;
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
        await tx.recordWebhookDelivery(delivery);
        return {
          decision: "rejected",
          httpStatus: 429,
          delivery,
          error: delivery.errorReason ?? undefined,
        };
      }

      // 4. Accept delivery and enqueue outbox event atomically
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

      await tx.query("SAVEPOINT sp_webhook_delivery");
      try {
        await tx.recordWebhookDelivery(acceptedDelivery);
        await tx.query("RELEASE SAVEPOINT sp_webhook_delivery");
      } catch (err: any) {
        await tx.query("ROLLBACK TO SAVEPOINT sp_webhook_delivery");
        if (err?.code === "23505" && String(err?.constraint || err?.message).includes("accepted_replay")) {
          const existingAcceptedRes = await tx.query(
            "SELECT * FROM studio_webhook_deliveries WHERE trigger_id = $1 AND idempotency_key = $2 AND status = 'accepted' LIMIT 1",
            [trigger.id, params.idempotencyKey]
          );
          const existingDelivery = existingAcceptedRes.rows[0] ? decodeWebhookDelivery(existingAcceptedRes.rows[0]) : acceptedDelivery;
          return {
            decision: "replay",
            httpStatus: 409,
            delivery: existingDelivery,
            error: "Duplicate delivery or replay detected",
          };
        }
        throw err;
      }

      const outboxKey = params.idempotencyKey
        ? `wh:${trigger.id}:${params.idempotencyKey}`
        : `wh:${trigger.id}:${deliveryId}`;

      const outboxEvent = await tx.enqueueTriggerEvent({
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
    });
  }

  // --- Agent Heartbeats ---

  async getAgentHeartbeat(agentId: string, principal?: StudioPrincipal): Promise<AgentHeartbeatSettings | null> {
    const result = principal
      ? await this.query("SELECT * FROM studio_agent_heartbeats WHERE agent_id = $1 AND tenant_id = $2", [agentId, principal.tenantId])
      : await this.query("SELECT * FROM studio_agent_heartbeats WHERE agent_id = $1", [agentId]);
    return result.rows[0] ? decodeAgentHeartbeat(result.rows[0]) : null;
  }

  async saveAgentHeartbeat(settings: AgentHeartbeatSettings, principal?: StudioPrincipal): Promise<AgentHeartbeatSettings> {
    const tenantId = principal?.tenantId ?? settings.tenantId;
    const result = await this.query(
      `INSERT INTO studio_agent_heartbeats (
        agent_id, tenant_id, enabled, interval_seconds, last_heartbeat_at, next_heartbeat_at
      ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)
      ON CONFLICT (tenant_id, agent_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        interval_seconds = EXCLUDED.interval_seconds,
        last_heartbeat_at = EXCLUDED.last_heartbeat_at,
        next_heartbeat_at = EXCLUDED.next_heartbeat_at
      RETURNING *`,
      [
        settings.agentId,
        tenantId,
        settings.enabled,
        settings.intervalSeconds,
        settings.lastHeartbeatAt ?? null,
        settings.nextHeartbeatAt ?? null,
      ],
    );
    return decodeAgentHeartbeat(result.rows[0]);
  }

  async claimDueHeartbeats(workerId: string, limit = 10): Promise<AgentHeartbeatSettings[]> {
    const result = await this.query(
      `UPDATE studio_agent_heartbeats
       SET locked_by = $1,
           locked_until = now() + interval '60 seconds'
       WHERE (tenant_id, agent_id) IN (
         SELECT tenant_id, agent_id
         FROM studio_agent_heartbeats
         WHERE enabled = true
           AND next_heartbeat_at IS NOT NULL
           AND next_heartbeat_at <= now()
           AND (locked_until IS NULL OR locked_until <= now())
         ORDER BY next_heartbeat_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       RETURNING *`,
      [workerId, limit],
    );
    return result.rows.map(decodeAgentHeartbeat);
  }

  async isAgentBusy(agentId: string, tenantId: string): Promise<boolean> {
    const result = await this.query(
      `SELECT 1 FROM studio_runs
       WHERE tenant_id = $1
         AND status IN ('queued', 'running', 'waiting_for_human')
         AND (
           (agents_snapshot IS NOT NULL AND jsonb_path_exists(agents_snapshot, '$[*] ? (@.id == $agentId)', jsonb_build_object('agentId', $2::text)))
           OR metadata->>'targetAgentId' = $2
           OR metadata->>'agentId' = $2
         )
       LIMIT 1`,
      [tenantId, agentId],
    );
    return result.rows.length > 0;
  }
}
