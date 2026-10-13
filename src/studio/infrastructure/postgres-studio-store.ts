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
import { randomUUID } from "node:crypto";
import type { PgClient, PgPool } from "../../memory/infrastructure";
import { withOrganization, scopedDbClient, type PrincipalKind } from "./withOrganization";

import type {
  AcceptWebhookDeliveryParams,
  AcceptWebhookDeliveryResult,
  OrganizationProfile,
  OrganizationStatus,
  ProjectRepository,
  UpdateOrganizationProfileInput,
  StudioEntityStatusFilter,
  StudioNameSource,
  StudioPrincipal,
  StudioProject,
  StudioStore,
  StudioTask,
  StudioWorkspace,
  StudioWorkspaceImport,
  WorkspaceRepositoryMembership,
  WorkspaceRepositoryState,
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

function decodeNameSource(value: unknown): StudioNameSource {
  if (value === "placeholder" || value === "derived" || value === "manual") return value;
  return "manual";
}

function decodeOrganizationStatus(value: unknown): OrganizationProfile["status"] {
  if (value === "suspended" || value === "deleting" || value === "active") return value;
  return "active";
}

function decodeOrganization(row: Record<string, unknown>): OrganizationProfile {
  const id = String(row.id);
  const slugRaw = row.slug != null ? String(row.slug) : id;
  return {
    id,
    name: String(row.name),
    description: String(row.description ?? ""),
    config: decodeSettings(row.config),
    ownerId: String(row.owner_id),
    status: decodeOrganizationStatus(row.status),
    slug: slugRaw.toLowerCase(),
    createdBy: row.created_by != null ? String(row.created_by) : null,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function decodeMembership(row: Record<string, unknown>): import("../contracts").OrganizationMembership {
  return {
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    role: row.role as import("../contracts").OrganizationMembershipRole,
    status: row.status as import("../contracts").OrganizationMembershipStatus,
    invitedBy: row.invited_by != null ? String(row.invited_by) : null,
    version: Number(row.version ?? 1),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    removedAt: row.removed_at != null ? asIso(row.removed_at) : null,
  };
}

function slugifyOrganizationName(name: string, fallbackId: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (base) return base;
  return fallbackId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "org";
}

function decodeProject(row: Record<string, unknown>): StudioProject {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    nameSource: decodeNameSource(row.name_source),
    description: String(row.description ?? ""),
    status: row.status === "retired" ? "retired" : "active",
    settings: decodeSettings(row.settings),
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    ownerId: String(row.owner_id),
  };
}

function decodeWorkspace(row: Record<string, unknown>): StudioWorkspace {
  const settings = decodeSettings(row.settings);
  const settingsOverrides = decodeSettings(row.settings_overrides);
  const overriddenKeys = Object.keys(settingsOverrides);
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    projectId: String(row.project_id),
    name: String(row.name),
    nameSource: decodeNameSource(row.name_source),
    description: String(row.description ?? ""),
    status: row.status === "retired" ? "retired" : "active",
    settings,
    settingsOverrides,
    effectiveSettings: { ...settings, ...settingsOverrides },
    overriddenKeys,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    ownerId: String(row.owner_id),
  };
}

function decodeProjectRepository(row: Record<string, unknown>): ProjectRepository {
  const status = row.status === "unavailable" || row.status === "removed" ? row.status : "active";
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    projectId: String(row.project_id),
    name: String(row.name),
    source: String(row.source),
    defaultBranch: String(row.default_branch),
    status,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function decodeWorkspaceRepoState(row: Record<string, unknown>): WorkspaceRepositoryState {
  const availability =
    row.availability === "unavailable" || row.availability === "branch_missing" ? row.availability : "ready";
  return {
    tenantId: String(row.tenant_id),
    projectId: String(row.project_id),
    workspaceId: row.workspace_id == null ? null : String(row.workspace_id),
    projectRepositoryId: String(row.project_repository_id),
    branch: String(row.branch),
    storagePath: String(row.storage_path),
    hasUncommittedChanges: Boolean(row.has_uncommitted_changes),
    availability,
    updatedAt: asIso(row.updated_at),
  };
}

function decodeTask(row: Record<string, unknown>): StudioTask {
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
    projectId: String(row.project_id),
    workspaceId: row.workspace_id == null || row.workspace_id === "" ? null : String(row.workspace_id),
  };
}

export class PostgresStudioStore implements StudioStore {
  constructor(private readonly pool: PgPool, private readonly client?: PgClient) {}

  getPool(): PgPool {
    return this.pool;
  }

  private query(text: string, values?: unknown[]) {
    // Statements issued while an organization scope owns a transaction
    // for this pool run on that connection, so `app.tenant_id`
    // (RLS prerequisite) applies to request and background handler work.
    return (this.client ?? scopedDbClient(this.pool) ?? this.pool).query(text, values);
  }

  private scopedExecution<T>(
    tenantId: string | undefined,
    principalKind: PrincipalKind | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (this.client || scopedDbClient(this.pool) || !tenantId?.trim()) {
      return fn();
    }
    return withOrganization(this.pool, tenantId.trim(), principalKind ?? "user", () => fn());
  }

  async transaction<T>(operation: (store: StudioStore) => Promise<T>): Promise<T> {
    if (this.client) throw new Error("Nested Studio transactions are unsupported.");
    const scoped = scopedDbClient(this.pool);
    if (scoped) {
      const sp = `studio_tx_${randomUUID().replace(/-/g, "")}`;
      await scoped.query(`SAVEPOINT ${sp}`);
      try {
        const result = await operation(this);
        await scoped.query(`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (err) {
        try { await scoped.query(`ROLLBACK TO SAVEPOINT ${sp}`); } catch { /* ignore */ }
        throw err;
      }
    }
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
          "SELECT definition FROM studio_workflows WHERE tenant_id = $1 AND (owner_id = $2 OR $3::boolean) ORDER BY updated_at DESC, id",
          [principal.tenantId, principal.userId, principal.principalKind === "service" && principal.allowOwnershipBypass !== false],
        )
      : await this.query("SELECT definition FROM studio_workflows ORDER BY updated_at DESC, id");
    return result.rows.map((row) => row.definition as WorkflowDefinition);
  }

  async getWorkflow(id: string, principal?: StudioPrincipal): Promise<WorkflowDefinition | null> {
    const result = principal
      ? await this.query(
          "SELECT definition FROM studio_workflows WHERE id = $1 AND tenant_id = $2 AND (owner_id = $3 OR $4::boolean)",
          [id, principal.tenantId, principal.userId, principal.principalKind === "service" && principal.allowOwnershipBypass !== false],
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
      const written = await this.query(
        `INSERT INTO studio_workflows (id, name, definition, created_at, updated_at, owner_id, tenant_id)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id
         WHERE studio_workflows.tenant_id = EXCLUDED.tenant_id AND studio_workflows.owner_id = EXCLUDED.owner_id
         RETURNING id`,
        [definition.id, definition.name, JSON.stringify(definition), definition.updatedAt, definition.updatedAt, principal.userId, principal.tenantId],
      );
      if (!written.rowCount) throw new Error("Access denied to workflow");
    } else {
      const written = await this.query(
        `INSERT INTO studio_workflows (id, name, definition, created_at, updated_at, owner_id, tenant_id)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at
         WHERE studio_workflows.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id AND studio_workflows.owner_id IS NOT DISTINCT FROM EXCLUDED.owner_id
         RETURNING id`,
        [definition.id, definition.name, JSON.stringify(definition), definition.updatedAt, definition.updatedAt, definition.ownerId ?? null, definition.tenantId ?? null],
      );
      if (!written.rowCount) throw new Error("Access denied to resource");
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
          "SELECT record FROM studio_agents WHERE is_system = true OR (tenant_id = $1 AND (owner_id = $2 OR owner_id IS NULL OR $3::boolean)) ORDER BY updated_at DESC, id",
          [principal.tenantId, principal.userId, principal.principalKind === "service" && principal.allowOwnershipBypass !== false],
        )
      : await this.query("SELECT record FROM studio_agents ORDER BY updated_at DESC, id");
    return result.rows.map((row) => row.record as AgentRecord);
  }

  async getAgent(id: string, principal?: StudioPrincipal): Promise<AgentRecord | null> {
    const result = principal
      ? await this.query(
          "SELECT record FROM studio_agents WHERE id = $1 AND (is_system = true OR (tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL OR $4::boolean)))",
          [id, principal.tenantId, principal.userId, principal.principalKind === "service" && principal.allowOwnershipBypass !== false],
        )
      : await this.query("SELECT record FROM studio_agents WHERE id = $1", [id]);
    return result.rows[0]?.record as AgentRecord ?? null;
  }

  async saveAgent(agent: AgentRecord, principal?: StudioPrincipal): Promise<AgentRecord> {
    if (principal) {
      const existing = await this.query("SELECT is_system, tenant_id, owner_id FROM studio_agents WHERE id = $1", [agent.id]);
      let targetOwnerId: string | null = principal.userId;
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (row.is_system) throw new Error("Cannot modify system agent");
        if (!row.tenant_id || row.tenant_id !== principal.tenantId || (row.owner_id && row.owner_id !== principal.userId)) {
          throw new Error("Access denied to agent");
        }
        targetOwnerId = row.owner_id ? String(row.owner_id) : null;
      }
      agent = { ...agent, ownerId: targetOwnerId ?? undefined, tenantId: principal.tenantId, isSystem: false };
      const written = await this.query(
        `INSERT INTO studio_agents (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system
         WHERE studio_agents.tenant_id = EXCLUDED.tenant_id AND NOT studio_agents.is_system AND (studio_agents.owner_id IS NULL OR studio_agents.owner_id = EXCLUDED.owner_id)
         RETURNING id`,
        [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt, targetOwnerId, principal.tenantId],
      );
      if (!written.rowCount) throw new Error("Access denied to agent");
    } else {
      const written = await this.query(
        `INSERT INTO studio_agents (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at
         WHERE studio_agents.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id AND studio_agents.owner_id IS NOT DISTINCT FROM EXCLUDED.owner_id AND studio_agents.is_system = EXCLUDED.is_system
         RETURNING id`,
        [agent.id, agent.name, JSON.stringify(agent), agent.createdAt, agent.updatedAt, agent.ownerId ?? null, agent.tenantId ?? null, agent.isSystem ?? false],
      );
      if (!written.rowCount) throw new Error("Access denied to resource");
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
          "SELECT record FROM studio_tools WHERE is_system = true OR (tenant_id = $1 AND (owner_id = $2 OR owner_id IS NULL OR $3::boolean)) ORDER BY updated_at DESC, id",
          [principal.tenantId, principal.userId, principal.principalKind === "service" && principal.allowOwnershipBypass !== false],
        )
      : await this.query("SELECT record FROM studio_tools ORDER BY updated_at DESC, id");
    return result.rows.map((row) => row.record as ToolRecord);
  }

  async getTool(id: string, principal?: StudioPrincipal): Promise<ToolRecord | null> {
    const result = principal
      ? await this.query(
          "SELECT record FROM studio_tools WHERE id = $1 AND (is_system = true OR (tenant_id = $2 AND (owner_id = $3 OR owner_id IS NULL OR $4::boolean)))",
          [id, principal.tenantId, principal.userId, principal.principalKind === "service" && principal.allowOwnershipBypass !== false],
        )
      : await this.query("SELECT record FROM studio_tools WHERE id = $1", [id]);
    return result.rows[0]?.record as ToolRecord ?? null;
  }

  async saveTool(tool: ToolRecord, principal?: StudioPrincipal): Promise<ToolRecord> {
    if (principal) {
      const existing = await this.query("SELECT is_system, tenant_id, owner_id FROM studio_tools WHERE id = $1", [tool.id]);
      let targetOwnerId: string | null = principal.userId;
      if (existing.rows.length) {
        const row = existing.rows[0];
        if (row.is_system) throw new Error("Cannot modify system tool");
        if (!row.tenant_id || row.tenant_id !== principal.tenantId || (row.owner_id && row.owner_id !== principal.userId)) {
          throw new Error("Access denied to tool");
        }
        targetOwnerId = row.owner_id ? String(row.owner_id) : null;
      }
      tool = { ...tool, ownerId: targetOwnerId ?? undefined, tenantId: principal.tenantId, isSystem: false };
      const written = await this.query(
        `INSERT INTO studio_tools (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, false)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at,
           owner_id = EXCLUDED.owner_id, tenant_id = EXCLUDED.tenant_id, is_system = EXCLUDED.is_system
         WHERE studio_tools.tenant_id = EXCLUDED.tenant_id AND NOT studio_tools.is_system AND (studio_tools.owner_id IS NULL OR studio_tools.owner_id = EXCLUDED.owner_id)
         RETURNING id`,
        [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt, targetOwnerId, principal.tenantId],
      );
      if (!written.rowCount) throw new Error("Access denied to tool");
    } else {
      const written = await this.query(
        `INSERT INTO studio_tools (id, name, record, created_at, updated_at, owner_id, tenant_id, is_system)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, record = EXCLUDED.record, updated_at = EXCLUDED.updated_at
         WHERE studio_tools.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id AND studio_tools.owner_id IS NOT DISTINCT FROM EXCLUDED.owner_id AND studio_tools.is_system = EXCLUDED.is_system
         RETURNING id`,
        [tool.id, tool.name, JSON.stringify(tool), tool.createdAt, tool.updatedAt, tool.ownerId ?? null, tool.tenantId ?? null, tool.isSystem ?? false],
      );
      if (!written.rowCount) throw new Error("Access denied to resource");
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

  private statusClause(status: StudioEntityStatusFilter | undefined, startIndex: number): { sql: string; values: unknown[] } {
    if (!status || status === "active") return { sql: ` AND status = $${startIndex}`, values: ["active"] };
    if (status === "retired") return { sql: ` AND status = $${startIndex}`, values: ["retired"] };
    return { sql: "", values: [] };
  }

  async listTasks(principal?: StudioPrincipal): Promise<StudioTask[]> {
    const result = principal
      ? await this.query("SELECT * FROM studio_tasks WHERE tenant_id = $1 ORDER BY updated_at DESC, id", [principal.tenantId])
      : await this.query("SELECT * FROM studio_tasks ORDER BY updated_at DESC, id");
    return result.rows.map((row) => decodeTask(row));
  }

  async getTask(id: string, principal?: StudioPrincipal): Promise<StudioTask | null> {
    const result = principal
      ? await this.query("SELECT * FROM studio_tasks WHERE id = $1 AND tenant_id = $2", [id, principal.tenantId])
      : await this.query("SELECT * FROM studio_tasks WHERE id = $1", [id]);
    if (!result.rows[0]) return null;
    return decodeTask(result.rows[0]);
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
    return result.rows.map((row) => decodeTask(row));
  }

  async listTasksByProject(projectId: string, principal?: StudioPrincipal): Promise<StudioTask[]> {
    const result = principal
      ? await this.query(
          `SELECT * FROM studio_tasks
           WHERE project_id = $1 AND tenant_id = $2
           ORDER BY updated_at DESC, id`,
          [projectId, principal.tenantId],
        )
      : await this.query(
          `SELECT * FROM studio_tasks
           WHERE project_id = $1
           ORDER BY updated_at DESC, id`,
          [projectId],
        );
    return result.rows.map((row) => decodeTask(row));
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
    const projectId = task.projectId?.trim();
    if (!projectId) throw new Error("Task projectId is required");
    const workspaceId = task.workspaceId === undefined || task.workspaceId === "" ? null : task.workspaceId;

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
        projectId,
        workspaceId,
        tenantId: principal.tenantId,
        ownerId: task.ownerId ?? principal.userId,
        updatedAt,
      };
      const written = await this.query(
        `INSERT INTO studio_tasks (
           id, title, description, priority, status, assigned_agent, dependencies, output,
           retry_count, paused, created_at, updated_at, owner_id, tenant_id,
           workflow_id, assigned_agents, started_at, completed_at, parent_task_id, run_id, last_error, metadata,
           workspace_id, project_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8,
           $9, $10, $11::timestamptz, $12::timestamptz, $13, $14,
           $15, $16::jsonb, $17::timestamptz, $18::timestamptz, $19, $20, $21, $22::jsonb,
           $23, $24
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
           workspace_id = EXCLUDED.workspace_id, project_id = EXCLUDED.project_id
         WHERE studio_tasks.tenant_id = EXCLUDED.tenant_id
         RETURNING id`,
        [
          task.id, task.title, task.description, task.priority, task.status, assignedAgent,
          JSON.stringify(task.dependencies ?? []), task.output, task.retryCount, task.paused,
          task.createdAt, updatedAt, task.ownerId, principal.tenantId,
          workflowId, JSON.stringify(assignedAgents), startedAt, completedAt,
          parentTaskId, runId, lastError, JSON.stringify(metadata),
          workspaceId, projectId,
        ],
      );
      if (!written.rowCount) throw new Error("Access denied to task");
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
        projectId,
        workspaceId,
        updatedAt,
      };
      const written = await this.query(
        `INSERT INTO studio_tasks (
           id, title, description, priority, status, assigned_agent, dependencies, output,
           retry_count, paused, created_at, updated_at,
           workflow_id, assigned_agents, started_at, completed_at, parent_task_id, run_id, last_error, metadata,
           workspace_id, project_id, tenant_id, owner_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8,
           $9, $10, $11::timestamptz, $12::timestamptz,
           $13, $14::jsonb, $15::timestamptz, $16::timestamptz, $17, $18, $19, $20::jsonb,
           $21, $22, $23, $24
         )
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title, description = EXCLUDED.description, priority = EXCLUDED.priority,
           status = EXCLUDED.status, assigned_agent = EXCLUDED.assigned_agent, dependencies = EXCLUDED.dependencies,
           output = EXCLUDED.output, retry_count = EXCLUDED.retry_count, paused = EXCLUDED.paused, updated_at = EXCLUDED.updated_at,
           workflow_id = EXCLUDED.workflow_id, assigned_agents = EXCLUDED.assigned_agents,
           started_at = EXCLUDED.started_at, completed_at = EXCLUDED.completed_at,
           parent_task_id = EXCLUDED.parent_task_id, run_id = EXCLUDED.run_id,
           last_error = EXCLUDED.last_error, metadata = EXCLUDED.metadata,
           workspace_id = EXCLUDED.workspace_id, project_id = EXCLUDED.project_id
         WHERE studio_tasks.tenant_id = EXCLUDED.tenant_id
         RETURNING id`,
        [
          task.id, task.title, task.description, task.priority, task.status, assignedAgent,
          JSON.stringify(task.dependencies ?? []), task.output, task.retryCount, task.paused,
          task.createdAt, updatedAt,
          workflowId, JSON.stringify(assignedAgents), startedAt, completedAt,
          parentTaskId, runId, lastError, JSON.stringify(metadata),
          workspaceId, projectId, tenantId, task.ownerId ?? null,
        ],
      );
      if (!written.rowCount) throw new Error("Access denied to task");
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
    const nameSource = project.nameSource ?? "manual";
    project = { ...project, nameSource };
    const written = await this.query(
      `INSERT INTO studio_projects (id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id, name_source)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id, name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status,
         settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at, owner_id = EXCLUDED.owner_id,
         name_source = EXCLUDED.name_source
         WHERE studio_projects.tenant_id = EXCLUDED.tenant_id
         RETURNING id`,
      [
        project.id, project.tenantId, project.name, project.description, project.status,
        JSON.stringify(project.settings ?? {}), project.createdAt, project.updatedAt, project.ownerId,
        nameSource,
      ],
    );
    if (!written.rowCount) throw new Error("Access denied to project");
    return project;
  }

  async claimPlaceholderProjectName(
    projectId: string,
    name: string,
    principal?: StudioPrincipal,
  ): Promise<boolean> {
    const result = principal
      ? await this.query(
          `UPDATE studio_projects
           SET name = $1, name_source = 'derived', updated_at = NOW()
           WHERE id = $2 AND tenant_id = $3 AND name_source = 'placeholder'`,
          [name, projectId, principal.tenantId],
        )
      : await this.query(
          `UPDATE studio_projects
           SET name = $1, name_source = 'derived', updated_at = NOW()
           WHERE id = $2 AND name_source = 'placeholder'`,
          [name, projectId],
        );
    return (result.rowCount ?? 0) > 0;
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

  async listWorkspacesByProject(
    projectId: string,
    principal?: StudioPrincipal,
    status: StudioEntityStatusFilter = "active",
  ): Promise<StudioWorkspace[]> {
    if (principal) {
      const filter = this.statusClause(status, 3);
      const result = await this.query(
        `SELECT * FROM studio_workspaces WHERE project_id = $1 AND tenant_id = $2${filter.sql} ORDER BY updated_at DESC, id`,
        [projectId, principal.tenantId, ...filter.values],
      );
      return result.rows.map(decodeWorkspace);
    }
    const filter = this.statusClause(status, 2);
    const result = await this.query(
      `SELECT * FROM studio_workspaces WHERE project_id = $1${filter.sql} ORDER BY updated_at DESC, id`,
      [projectId, ...filter.values],
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
    if (!workspace.projectId?.trim()) throw new Error("Workspace projectId is required");
    if (principal) {
      const existing = await this.query("SELECT tenant_id FROM studio_workspaces WHERE id = $1", [workspace.id]);
      if (existing.rows.length && existing.rows[0].tenant_id !== principal.tenantId) {
        throw new Error("Access denied to workspace");
      }
      workspace = { ...workspace, tenantId: principal.tenantId, ownerId: workspace.ownerId || principal.userId };
    }
    const nameSource = workspace.nameSource ?? "manual";
    const settingsOverrides = workspace.settingsOverrides ?? {};
    const overriddenKeys = Object.keys(settingsOverrides);
    workspace = {
      ...workspace,
      nameSource,
      settingsOverrides,
      overriddenKeys,
      effectiveSettings: workspace.effectiveSettings ?? { ...(workspace.settings ?? {}), ...settingsOverrides },
      settings: workspace.settings ?? {},
    };
    const written = await this.query(
      `INSERT INTO studio_workspaces (
         id, tenant_id, name, description, status, settings, created_at, updated_at, owner_id,
         project_id, name_source, settings_overrides
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz, $9, $10, $11, $12::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id, name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status,
         settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at, owner_id = EXCLUDED.owner_id,
         project_id = EXCLUDED.project_id, name_source = EXCLUDED.name_source,
         settings_overrides = EXCLUDED.settings_overrides
         WHERE studio_workspaces.tenant_id = EXCLUDED.tenant_id
         RETURNING id`,
      [
        workspace.id, workspace.tenantId, workspace.name, workspace.description, workspace.status,
        JSON.stringify(workspace.settings ?? {}), workspace.createdAt, workspace.updatedAt, workspace.ownerId,
        workspace.projectId, nameSource, JSON.stringify(settingsOverrides),
      ],
    );
    if (!written.rowCount) throw new Error("Access denied to workspace");
    return workspace;
  }

  async claimPlaceholderWorkspaceName(
    workspaceId: string,
    name: string,
    principal?: StudioPrincipal,
  ): Promise<boolean> {
    const result = principal
      ? await this.query(
          `UPDATE studio_workspaces
           SET name = $1, name_source = 'derived', updated_at = NOW()
           WHERE id = $2 AND tenant_id = $3 AND name_source = 'placeholder'`,
          [name, workspaceId, principal.tenantId],
        )
      : await this.query(
          `UPDATE studio_workspaces
           SET name = $1, name_source = 'derived', updated_at = NOW()
           WHERE id = $2 AND name_source = 'placeholder'`,
          [name, workspaceId],
        );
    return (result.rowCount ?? 0) > 0;
  }

  async getOrganizationProfile(principal: StudioPrincipal): Promise<OrganizationProfile | null> {
    const result = await this.query("SELECT * FROM studio_organizations WHERE id = $1", [principal.tenantId]);
    return result.rows[0] ? decodeOrganization(result.rows[0]) : null;
  }

  async getOrganizationBySlug(slug: string): Promise<OrganizationProfile | null> {
    const result = await this.query("SELECT * FROM studio_organizations WHERE slug = $1", [
      slug.trim().toLowerCase(),
    ]);
    return result.rows[0] ? decodeOrganization(result.rows[0]) : null;
  }

  async createOrganizationProfile(
    profile: OrganizationProfile,
    principal: StudioPrincipal,
  ): Promise<OrganizationProfile> {
    if (profile.id !== principal.tenantId) {
      throw new Error("Organization profile id must equal tenant id");
    }
    if (this.client) {
      return this.createOrganizationProfileInTx(profile, principal);
    }
    return this.transaction((store) =>
      (store as PostgresStudioStore).createOrganizationProfileInTx(profile, principal),
    );
  }

  private async createOrganizationProfileInTx(
    profile: OrganizationProfile,
    principal: StudioPrincipal,
  ): Promise<OrganizationProfile> {
    const existing = await this.getOrganizationProfile(principal);
    if (existing) throw new Error("Organization already exists for this tenant");
    const stamp = profile.createdAt;
    const record: OrganizationProfile = {
      ...profile,
      id: principal.tenantId,
      ownerId: profile.ownerId || principal.userId,
      description: profile.description ?? "",
      config: profile.config ?? {},
      status: profile.status ?? "active",
      slug: profile.slug?.trim()
        ? profile.slug.trim().toLowerCase()
        : slugifyOrganizationName(profile.name, principal.tenantId),
      createdBy: profile.createdBy ?? principal.userId,
    };
    await this.query(
      `INSERT INTO studio_organizations
         (id, name, description, config, owner_id, status, slug, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)`,
      [
        record.id, record.name, record.description, JSON.stringify(record.config),
        record.ownerId, record.status, record.slug, record.createdBy,
        stamp, record.updatedAt,
      ],
    );
    await this.saveMembership({
      organizationId: record.id,
      userId: principal.userId,
      role: "owner",
      status: "active",
      invitedBy: principal.userId,
      version: 1,
      createdAt: stamp,
      updatedAt: stamp,
      removedAt: null,
    });
    await this.appendOrganizationAudit({
      organizationId: record.id,
      actorUserId: principal.userId,
      action: "organization.created",
      targetUserId: principal.userId,
      details: { role: "owner", slug: record.slug },
      createdAt: stamp,
    });
    await this.setUserLastOrganization(principal.userId, record.id);
    return record;
  }

  async updateOrganizationProfile(
    updates: UpdateOrganizationProfileInput,
    principal: StudioPrincipal,
  ): Promise<OrganizationProfile> {
    if (!principal?.tenantId?.trim()) {
      throw new Error("Organization profile requires tenant context");
    }
    const existing = await this.getOrganizationProfile(principal);
    if (!existing) throw new Error("Organization not found");

    let slug = existing.slug;
    if (updates.slug !== undefined) {
      const candidate = updates.slug.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate) || candidate.length > 80) {
        throw new Error("slug must be lowercase URL-safe (a-z, 0-9, hyphen) and at most 80 characters");
      }
      slug = candidate;
    }

    const name = updates.name !== undefined ? updates.name : existing.name;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const config = updates.config !== undefined ? updates.config : existing.config;
    const updatedAt = nowIso();

    try {
      const result = await this.query(
        `UPDATE studio_organizations
         SET name = $1, description = $2, config = $3::jsonb, slug = $4, updated_at = $5::timestamptz
         WHERE id = $6
         RETURNING *`,
        [name, description, JSON.stringify(config), slug, updatedAt, principal.tenantId],
      );
      if (!result.rows[0]) throw new Error("Organization not found");
      return decodeOrganization(result.rows[0]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("studio_organizations_slug") || message.toLowerCase().includes("duplicate key")) {
        throw new Error("Organization slug already in use");
      }
      throw error;
    }
  }

  async listOrganizationsForUser(userId: string): Promise<OrganizationProfile[]> {
    const result = await this.query(
      `SELECT o.* FROM studio_organizations o
         INNER JOIN studio_organization_memberships m
           ON m.organization_id = o.id
        WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'
        ORDER BY o.name ASC, o.id ASC`,
      [userId],
    );
    return result.rows.map(decodeOrganization);
  }

  async updateOrganizationStatus(organizationId: string, status: OrganizationStatus): Promise<void> {
    const result = await this.query(
      "UPDATE studio_organizations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [status, organizationId],
    );
    if ((result.rowCount ?? 0) === 0) throw new Error("Organization not found");
  }

  async purgeOrganizationData(organizationId: string): Promise<void> {
    const client = this.client ?? await this.pool.connect();
    const ownsClient = !this.client;
    try {
      if (ownsClient) await client.query("BEGIN");
      await client.query("DELETE FROM studio_organization_audit WHERE organization_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_organization_memberships WHERE organization_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_workspace_repo_states WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_workspace_repositories WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_project_repositories WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_task_comments WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_trigger_events WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_routine_history WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_routines WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_webhook_deliveries WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_webhook_triggers WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_agent_heartbeats WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_approvals WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_run_events WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_runs WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_tasks WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_workspaces WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_projects WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_organization_goals WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_agent_reporting WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_budget_alerts WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_budget_reservations WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_budgets WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_workflows WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_agents WHERE tenant_id = $1 AND NOT is_system", [organizationId]);
      await client.query("DELETE FROM studio_tools WHERE tenant_id = $1 AND NOT is_system", [organizationId]);
      await client.query("UPDATE studio_users SET tenant_id = NULL WHERE tenant_id = $1", [organizationId]);
      await client.query("DELETE FROM studio_organizations WHERE id = $1", [organizationId]);
      if (ownsClient) await client.query("COMMIT");
    } catch (err) {
      if (ownsClient) await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      if (ownsClient) client.release();
    }
  }

  async organizationTransaction<T>(organizationId: string, operation: (store: StudioStore) => Promise<T>): Promise<T> {
    return this.transaction(async store => {
      const tx = store as PostgresStudioStore;
      await tx.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.principal_kind', 'user', true)", [organizationId]);
      // Lock the authoritative parent before membership/owner reads. All membership writers use this lock.
      await tx.query("SELECT id FROM studio_organizations WHERE id = $1 FOR UPDATE", [organizationId]);
      return operation(store);
    });
  }

  async listOrganizationAudit(organizationId: string) {
    const result = await this.query("SELECT * FROM studio_organization_audit WHERE organization_id = $1 ORDER BY created_at, id", [organizationId]);
    return result.rows.map(row => ({ id: String(row.id), organizationId: String(row.organization_id), actorUserId: row.actor_user_id as string | null, targetUserId: row.target_user_id as string | null, action: String(row.action), details: row.details as Record<string, unknown>, createdAt: asIso(row.created_at) }));
  }

  async listInvitationsForUser(userId: string) {
    const result = await this.query("SELECT m.* FROM studio_organization_memberships m JOIN studio_organizations o ON o.id = m.organization_id WHERE m.user_id = $1 AND m.status = 'invited' AND o.status = 'active' ORDER BY m.created_at", [userId]);
    return result.rows.map(decodeMembership);
  }

  async findOrganizationUser(identifier: { userId?: string; email?: string }): Promise<string | null> {
    const result = identifier.userId
      ? await this.query("SELECT id FROM studio_users WHERE id = $1 AND status = 'active'", [identifier.userId])
      : await this.query("SELECT id FROM studio_users WHERE lower(email) = lower($1) AND status = 'active'", [identifier.email]);
    return result.rows[0] ? String(result.rows[0].id) : null;
  }

  async isOrganizationUserActive(userId: string): Promise<boolean> {
    const result = await this.query("SELECT id FROM studio_users WHERE id = $1 AND status = 'active'", [userId]);
    return result.rows.length > 0;
  }

  async getMembership(organizationId: string, userId: string) {
    const result = await this.query(
      `SELECT * FROM studio_organization_memberships
        WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId],
    );
    return result.rows[0] ? decodeMembership(result.rows[0]) : null;
  }

  async listMemberships(organizationId: string) {
    const result = await this.query(
      `SELECT * FROM studio_organization_memberships
        WHERE organization_id = $1
        ORDER BY created_at ASC, user_id ASC`,
      [organizationId],
    );
    return result.rows.map(decodeMembership);
  }

  async saveMembership(membership: import("../contracts").OrganizationMembership) {
    await this.query(
      `INSERT INTO studio_organization_memberships (
         organization_id, user_id, role, status, invited_by, version, created_at, updated_at, removed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::timestamptz)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET
         role = EXCLUDED.role,
         status = EXCLUDED.status,
         invited_by = EXCLUDED.invited_by,
         version = EXCLUDED.version,
         updated_at = EXCLUDED.updated_at,
         removed_at = EXCLUDED.removed_at`,
      [
        membership.organizationId,
        membership.userId,
        membership.role,
        membership.status,
        membership.invitedBy ?? null,
        membership.version,
        membership.createdAt,
        membership.updatedAt,
        membership.removedAt ?? null,
      ],
    );
    return membership;
  }

  async appendOrganizationAudit(entry: import("../contracts").OrganizationAuditEntry): Promise<void> {
    await this.query(
      `INSERT INTO studio_organization_audit
         (organization_id, actor_user_id, action, target_user_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, now()))`,
      [
        entry.organizationId,
        entry.actorUserId ?? null,
        entry.action,
        entry.targetUserId ?? null,
        JSON.stringify(entry.details ?? {}),
        entry.createdAt ?? null,
      ],
    );
  }

  async setUserLastOrganization(userId: string, organizationId: string | null): Promise<void> {
    await this.query(`UPDATE studio_users SET tenant_id = $2, updated_at = now() WHERE id = $1`, [
      userId,
      organizationId,
    ]);
  }

  async listProjectRepositories(projectId: string, principal?: StudioPrincipal): Promise<ProjectRepository[]> {
    const result = principal
      ? await this.query(
          `SELECT * FROM studio_project_repositories
           WHERE project_id = $1 AND tenant_id = $2
           ORDER BY updated_at DESC, id`,
          [projectId, principal.tenantId],
        )
      : await this.query(
          `SELECT * FROM studio_project_repositories WHERE project_id = $1 ORDER BY updated_at DESC, id`,
          [projectId],
        );
    return result.rows.map(decodeProjectRepository);
  }

  async getProjectRepository(id: string, principal?: StudioPrincipal): Promise<ProjectRepository | null> {
    const result = principal
      ? await this.query(
          "SELECT * FROM studio_project_repositories WHERE id = $1 AND tenant_id = $2",
          [id, principal.tenantId],
        )
      : await this.query("SELECT * FROM studio_project_repositories WHERE id = $1", [id]);
    return result.rows[0] ? decodeProjectRepository(result.rows[0]) : null;
  }

  async saveProjectRepository(repo: ProjectRepository, principal?: StudioPrincipal): Promise<ProjectRepository> {
    if (principal) {
      const existing = await this.query("SELECT tenant_id FROM studio_project_repositories WHERE id = $1", [repo.id]);
      if (existing.rows.length && existing.rows[0].tenant_id !== principal.tenantId) {
        throw new Error("Access denied to project repository");
      }
      repo = { ...repo, tenantId: principal.tenantId };
    }
    const written = await this.query(
      `INSERT INTO studio_project_repositories (
         id, tenant_id, project_id, name, source, default_branch, status, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id, project_id = EXCLUDED.project_id, name = EXCLUDED.name,
         source = EXCLUDED.source, default_branch = EXCLUDED.default_branch, status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at
         WHERE studio_project_repositories.tenant_id = EXCLUDED.tenant_id
         RETURNING id`,
      [
        repo.id, repo.tenantId, repo.projectId, repo.name, repo.source, repo.defaultBranch,
        repo.status, repo.createdAt, repo.updatedAt,
      ],
    );
    if (!written.rowCount) throw new Error("Access denied to projectrepository");
    return repo;
  }

  async deleteProjectRepository(id: string, principal?: StudioPrincipal): Promise<void> {
    if (principal) {
      await this.query(
        "DELETE FROM studio_project_repositories WHERE id = $1 AND tenant_id = $2",
        [id, principal.tenantId],
      );
    } else {
      await this.query("DELETE FROM studio_project_repositories WHERE id = $1", [id]);
    }
  }

  async listWorkspaceRepositories(
    workspaceId: string,
    principal?: StudioPrincipal,
  ): Promise<WorkspaceRepositoryMembership[]> {
    if (principal) {
      const workspace = await this.getWorkspace(workspaceId, principal);
      if (!workspace) return [];
    }
    const result = await this.query(
      `SELECT * FROM studio_workspace_repositories WHERE workspace_id = $1 ORDER BY project_repository_id`,
      [workspaceId],
    );
    return result.rows.map((row) => ({
      tenantId: row.tenant_id ? String(row.tenant_id) : undefined,
      workspaceId: String(row.workspace_id),
      projectRepositoryId: String(row.project_repository_id),
      branch: String(row.branch),
      createdAt: asIso(row.created_at),
      updatedAt: asIso(row.updated_at),
    }));
  }

  async replaceWorkspaceRepositories(
    workspaceId: string,
    memberships: WorkspaceRepositoryMembership[],
    principal?: StudioPrincipal,
  ): Promise<WorkspaceRepositoryMembership[]> {
    let tenantId = principal?.tenantId ?? memberships.find((m) => m.tenantId)?.tenantId;
    if (principal) {
      const workspace = await this.getWorkspace(workspaceId, principal);
      if (!workspace) throw new Error("Access denied to workspace");
      tenantId = workspace.tenantId;
    }
    if (!tenantId) {
      const ws = await this.query("SELECT tenant_id FROM studio_workspaces WHERE id = $1", [workspaceId]);
      tenantId = ws.rows[0]?.tenant_id ? String(ws.rows[0].tenant_id) : undefined;
    }
    await this.query("DELETE FROM studio_workspace_repositories WHERE workspace_id = $1", [workspaceId]);
    const stamp = nowIso();
    const saved: WorkspaceRepositoryMembership[] = [];
    for (const membership of memberships) {
      const record: WorkspaceRepositoryMembership = {
        tenantId: tenantId ?? membership.tenantId,
        workspaceId,
        projectRepositoryId: membership.projectRepositoryId,
        branch: membership.branch,
        createdAt: membership.createdAt ?? stamp,
        updatedAt: stamp,
      };
      await this.query(
        `INSERT INTO studio_workspace_repositories (tenant_id, workspace_id, project_repository_id, branch, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
        [record.tenantId, record.workspaceId, record.projectRepositoryId, record.branch, record.createdAt, record.updatedAt],
      );
      saved.push(record);
    }
    return saved;
  }

  async listWorkspaceRepoStates(params: {
    tenantId: string;
    projectId: string;
    workspaceId?: string | null;
    projectRepositoryId?: string;
  }): Promise<WorkspaceRepositoryState[]> {
    const values: unknown[] = [params.tenantId, params.projectId];
    let sql =
      `SELECT * FROM studio_workspace_repo_states
       WHERE tenant_id = $1 AND project_id = $2`;
    if (params.workspaceId === null) {
      sql += " AND workspace_id IS NULL";
    } else if (params.workspaceId !== undefined) {
      values.push(params.workspaceId);
      sql += ` AND workspace_id = $${values.length}`;
    }
    if (params.projectRepositoryId) {
      values.push(params.projectRepositoryId);
      sql += ` AND project_repository_id = $${values.length}`;
    }
    sql += " ORDER BY updated_at DESC";
    const result = await this.query(sql, values);
    return result.rows.map(decodeWorkspaceRepoState);
  }

  async saveWorkspaceRepoState(state: WorkspaceRepositoryState): Promise<WorkspaceRepositoryState> {
    const workspaceKey = state.workspaceId ?? "";
    await this.query(
      `INSERT INTO studio_workspace_repo_states (
         tenant_id, project_id, workspace_id, workspace_key, project_repository_id, branch, storage_path,
         has_uncommitted_changes, availability, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
       ON CONFLICT (tenant_id, project_id, project_repository_id, workspace_key)
       DO UPDATE SET
         branch = EXCLUDED.branch,
         storage_path = EXCLUDED.storage_path,
         has_uncommitted_changes = EXCLUDED.has_uncommitted_changes,
         availability = EXCLUDED.availability,
         updated_at = EXCLUDED.updated_at,
         workspace_id = EXCLUDED.workspace_id`,
      [
        state.tenantId, state.projectId, state.workspaceId, workspaceKey, state.projectRepositoryId,
        state.branch, state.storagePath, state.hasUncommittedChanges, state.availability, state.updatedAt,
      ],
    );
    return state;
  }

  async rekeyWorkspaceRepoStates(params: {
    tenantId: string;
    projectId: string;
    fromWorkspaceId: string | null;
    toWorkspaceId: string;
  }): Promise<number> {
    const fromKey = params.fromWorkspaceId ?? "";
    const result = await this.query(
      `UPDATE studio_workspace_repo_states
       SET workspace_id = $4, workspace_key = $4, updated_at = now()
       WHERE tenant_id = $1 AND project_id = $2 AND workspace_key = $3
         AND NOT EXISTS (
           SELECT 1 FROM studio_workspace_repo_states existing
           WHERE existing.tenant_id = $1 AND existing.project_id = $2
             AND existing.project_repository_id = studio_workspace_repo_states.project_repository_id
             AND existing.workspace_key = $4
         )`,
      [params.tenantId, params.projectId, fromKey, params.toWorkspaceId],
    );
    await this.query(
      `DELETE FROM studio_workspace_repo_states
       WHERE tenant_id = $1 AND project_id = $2 AND workspace_key = $3`,
      [params.tenantId, params.projectId, fromKey],
    );
    return result.rowCount ?? 0;
  }

  async importWorkspace(workspace: StudioWorkspaceImport, principal?: StudioPrincipal): Promise<void> {
    if (!this.client) return this.transaction(tx => tx.importWorkspace(workspace, principal));
    // Validate all collisions before the first write; the transaction also rolls back races.
    for (const [records, read] of [
      [workspace.workflows, this.getWorkflow.bind(this)],
      [workspace.agents, this.getAgent.bind(this)],
      [workspace.tools, this.getTool.bind(this)],
    ] as const) {
      for (const record of records) {
        const existing = await read(record.id);
        if (principal && existing && (existing.tenantId !== principal.tenantId || existing.ownerId !== principal.userId || ('isSystem' in existing && existing.isSystem))) {
          throw new Error('Access denied to imported resource');
        }
      }
    }
    for (const workflow of workspace.workflows) await this.saveWorkflow(workflow, principal);
    for (const agent of workspace.agents) await this.saveAgent(agent, principal);
    for (const tool of workspace.tools) await this.saveTool(tool, principal);
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
      WHERE studio_task_comments.tenant_id = EXCLUDED.tenant_id
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
    if (!result.rowCount) throw new Error("Access denied to resource");
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
    const inline = async (): Promise<TriggerEvent | null> => {
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
    };
    // US3/T052: claim through the SECURITY DEFINER worker function so a
    // least-privileged role can claim across organizations under future RLS.
    try {
      const result = await this.query(
        "SELECT * FROM studio_claim_trigger_events($1, $2, $3)",
        [1, workerId, leaseDurationSeconds],
      );
      return result.rows[0] ? decodeTriggerEvent(result.rows[0]) : null;
    } catch (err: any) {
      if (err?.code === "42883" || err?.code === "42P01") return inline();
      throw err;
    }
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
      WHERE studio_routines.tenant_id = EXCLUDED.tenant_id
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
    if (!result.rowCount) throw new Error("Access denied to resource");
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
    try {
      const result = await this.query("SELECT * FROM studio_claim_routines($1, $2)", [limit, workerId]);
      return result.rows.map(decodeRoutine);
    } catch (err: any) {
      if (err?.code !== "42883" && err?.code !== "42P01") throw err;
    }
    const result = await this.query(
      `SELECT * FROM studio_routines
       WHERE enabled = true
         AND next_run_at IS NOT NULL
         AND next_run_at <= now()
       ORDER BY next_run_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(decodeRoutine);
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
      WHERE studio_webhook_triggers.tenant_id = EXCLUDED.tenant_id
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
    if (!result.rowCount) throw new Error("Access denied to resource");
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
    const inline = async (): Promise<AgentHeartbeatSettings[]> => {
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
    };
    try {
      const result = await this.query("SELECT * FROM studio_claim_heartbeats($1, $2)", [limit, workerId]);
      return result.rows.map(decodeAgentHeartbeat);
    } catch (err: any) {
      if (err?.code === "42883" || err?.code === "42P01") return inline();
      throw err;
    }
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
