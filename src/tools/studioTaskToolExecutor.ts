import {
  canTransitionStatus,
  isCompletedStatus,
  toCanonicalStatus,
  uid,
  type TaskComment,
  type TaskCommentAuthorType,
  type TaskStatus,
} from "@multi-agent/types";
import { asyncLocalOrganizationScopeRunner, type OrganizationScopeRunner } from "../studio/infrastructure/organizationJobScope";
import type { StudioPrincipal, StudioStore, StudioTask } from "../studio/contracts";
import { InMemoryStudioStore } from "../studio/infrastructure/in-memory-studio-store";
import type {
  StudioTaskAddCommentInput,
  StudioTaskAssignInput,
  StudioTaskBulkCreateInput,
  StudioTaskCreateInput,
  StudioTaskGetInput,
  StudioTaskQueryInput,
  StudioTaskToolAction,
  StudioTaskToolErrorCode,
  StudioTaskToolErrorResponse,
  StudioTaskToolInput,
  StudioTaskToolOutput,
  StudioTaskToolSuccessResponse,
  StudioTaskUpdateStatusInput,
  ToolExecutionInput,
  ToolExecutor,
} from "./types";

export class StudioTaskToolError extends Error {
  constructor(
    public readonly code: StudioTaskToolErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "StudioTaskToolError";
  }
}

export class TenantIsolationViolationError extends StudioTaskToolError {
  constructor(message = "Tenant isolation violation: cross-tenant access denied", details?: unknown) {
    super("TENANT_ISOLATION_VIOLATION", message, details);
    this.name = "TenantIsolationViolationError";
  }
}

export class TaskNotFoundError extends StudioTaskToolError {
  constructor(taskId: string, details?: unknown) {
    super("TASK_NOT_FOUND", `Task "${taskId}" not found`, details);
    this.name = "TaskNotFoundError";
  }
}

export class InvalidStatusTransitionError extends StudioTaskToolError {
  constructor(from: string, to: string, details?: unknown) {
    super("INVALID_STATUS_TRANSITION", `Invalid status transition from "${from}" to "${to}"`, details);
    this.name = "InvalidStatusTransitionError";
  }
}

/**
 * Programmatic tool executor exposing Studio Task Kanban board operations
 * to the Lead Orchestrator and supervisor agents under strict tenant isolation.
 */
export const STUDIO_TASK_TOOL_NAME = "studio_task_tool";
export const DEFAULT_STUDIO_TASK_TOOL_AUTHORIZED_AGENT_IDS: readonly string[] = [
  "agent-lead-orchestrator",
  "spec-delivery-lead-orchestrator",
  "agent-delivery-plan-orchestrator",
  "agent-phase-subphase-architect",
];

export interface StudioTaskToolAuthorizationOptions {
  /** Explicit allow-list of agent/principal ids permitted to call the tool. */
  allowedAgentIds?: readonly string[];
  /** When true (default), callers must be authorized via allow-list or agent tool grants. */
  enforceAuthorization?: boolean;
}

export class StudioTaskToolExecutor implements ToolExecutor {
  private static defaultStore: StudioStore | null = null;

  constructor(
    private readonly store?: StudioStore | (() => StudioStore),
    private readonly scope: OrganizationScopeRunner = asyncLocalOrganizationScopeRunner,
    private readonly authorization: StudioTaskToolAuthorizationOptions = {},
  ) {}

  public static setDefaultStore(store: StudioStore | null): void {
    StudioTaskToolExecutor.defaultStore = store;
  }

  private getStore(): StudioStore {
    if (typeof this.store === "function") {
      return this.store();
    }
    if (this.store) {
      return this.store;
    }
    if (!StudioTaskToolExecutor.defaultStore) {
      StudioTaskToolExecutor.defaultStore = new InMemoryStudioStore();
    }
    return StudioTaskToolExecutor.defaultStore;
  }

  private authorizeCaller(
    action: StudioTaskToolAction,
    callerId: string,
    authorizedToolIds?: readonly string[],
  ): { code: StudioTaskToolErrorCode; message: string; details?: unknown } | null {
    const enforce = this.authorization.enforceAuthorization === true
      || Array.isArray(authorizedToolIds)
      || Array.isArray(this.authorization.allowedAgentIds);
    if (!enforce) {
      return null;
    }

    const allowedAgentIds = this.authorization.allowedAgentIds ?? DEFAULT_STUDIO_TASK_TOOL_AUTHORIZED_AGENT_IDS;
    const grantedByTools = Array.isArray(authorizedToolIds)
      && authorizedToolIds.some((id) => id === STUDIO_TASK_TOOL_NAME);
    const grantedByAllowList = Boolean(callerId) && allowedAgentIds.includes(callerId);

    if (grantedByTools || grantedByAllowList) {
      return null;
    }

    return {
      code: "UNAUTHORIZED_ACTION",
      message: `Agent "${callerId || "unknown"}" is not authorized to invoke studio_task_tool action "${action}".`,
      details: { action, callerId: callerId || null, allowedAgentIds },
    };
  }

  async execute(executionInput: ToolExecutionInput): Promise<StudioTaskToolOutput> {
    const rawInput = (executionInput.input ?? {}) as Record<string, unknown>;
    const action = (rawInput.action ?? (rawInput.params as any)?.action) as StudioTaskToolAction;
    const now = new Date().toISOString();

    const validActions: StudioTaskToolAction[] = [
      "query_tasks",
      "get_task",
      "create_task",
      "bulk_create_tasks",
      "update_task_status",
      "assign_task",
      "add_task_comment",
    ];

    if (!action || !validActions.includes(action)) {
      return {
        success: false,
        action: action || ("query_tasks" as StudioTaskToolAction),
        error: {
          code: "INVALID_INPUT",
          message: `Unknown or missing action: "${action}". Valid actions are: ${validActions.join(", ")}`,
        },
        timestamp: now,
      };
    }

    const tenantId = executionInput.credentialPrincipal?.tenantId?.trim();
    if (!tenantId) {
      return {
        success: false,
        action,
        error: {
          code: "TENANT_ISOLATION_VIOLATION",
          message: "Tenant isolation violation: authenticated credentialPrincipal.tenantId is required",
        },
        timestamp: now,
      };
    }

    const callerId = (executionInput.agentId ?? executionInput.credentialPrincipal?.principalId ?? "").trim();
    const authError = this.authorizeCaller(action, callerId, executionInput.authorizedToolIds);
    if (authError) {
      return {
        success: false,
        action,
        error: authError,
        timestamp: now,
      };
    }

    const principal: StudioPrincipal = {
      tenantId,
      userId: callerId || "system",
      principalKind: "service",
    };

    const store = this.getStore();
    const params = (
      rawInput.params && typeof rawInput.params === "object"
        ? rawInput.params
        : rawInput
    ) as Record<string, unknown>;

    try {
      return await this.scope({ organizationId: tenantId, source: "studio_task_tool" }, async (): Promise<StudioTaskToolOutput> => {
        switch (action) {
          case "query_tasks":
            return await this.handleQueryTasks(params as StudioTaskQueryInput, principal, store, now);
          case "get_task":
            return await this.handleGetTask(params as unknown as StudioTaskGetInput, principal, store, now);
          case "create_task":
            return await this.handleCreateTask(params as unknown as StudioTaskCreateInput, principal, store, now);
          case "bulk_create_tasks":
            return await this.handleBulkCreateTasks(params as unknown as StudioTaskBulkCreateInput, principal, store, now);
          case "update_task_status":
            return await this.handleUpdateTaskStatus(params as unknown as StudioTaskUpdateStatusInput, principal, store, now);
          case "assign_task":
            return await this.handleAssignTask(params as unknown as StudioTaskAssignInput, principal, store, now);
          case "add_task_comment":
            return await this.handleAddTaskComment(params as unknown as StudioTaskAddCommentInput, principal, store, now);
          default:
            return {
              success: false,
              action,
              error: {
                code: "INVALID_INPUT",
                message: `Unsupported action: "${action}"`,
              },
              timestamp: now,
            };
        }
      });
    } catch (err: unknown) {
      if (err instanceof StudioTaskToolError) {
        return {
          success: false,
          action,
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
          timestamp: new Date().toISOString(),
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        action,
        error: {
          code: "INVALID_INPUT",
          message,
        },
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async handleQueryTasks(
    params: StudioTaskQueryInput,
    principal: StudioPrincipal,
    store: StudioStore,
    timestamp: string,
  ): Promise<StudioTaskToolOutput> {
    const allTenantTasks = await store.listTasks(principal);
    const tenantTasks = allTenantTasks.filter((t) => t.tenantId === principal.tenantId);

    let filtered = tenantTasks;

    if (params.status) {
      const canonicalTarget = toCanonicalStatus(params.status);
      filtered = filtered.filter(
        (t) => t.status === params.status || toCanonicalStatus(t.status) === canonicalTarget,
      );
    }

    if (params.projectId) {
      filtered = filtered.filter((t) => t.projectId === params.projectId);
    }

    if (params.workspaceId) {
      filtered = filtered.filter((t) => t.workspaceId === params.workspaceId);
    }

    if (params.assignedAgent) {
      filtered = filtered.filter(
        (t) =>
          t.assignedAgent === params.assignedAgent ||
          (Array.isArray(t.assignedAgents) && t.assignedAgents.includes(params.assignedAgent!)),
      );
    }

    const limit = Math.min(100, Math.max(1, typeof params.limit === "number" ? params.limit : 20));
    const offset = Math.max(0, typeof params.offset === "number" ? params.offset : 0);

    const paginated = filtered.slice(offset, offset + limit);

    return {
      success: true,
      action: "query_tasks",
      data: {
        tasks: paginated,
        total: filtered.length,
      },
      timestamp,
    };
  }

  private async handleUpdateTaskStatus(
    params: StudioTaskUpdateStatusInput,
    principal: StudioPrincipal,
    store: StudioStore,
    timestamp: string,
  ): Promise<StudioTaskToolOutput> {
    if (!params.taskId || typeof params.taskId !== "string") {
      return {
        success: false,
        action: "update_task_status",
        error: {
          code: "INVALID_INPUT",
          message: "taskId is required and must be a string",
        },
        timestamp,
      };
    }

    if (!params.newStatus || typeof params.newStatus !== "string") {
      return {
        success: false,
        action: "update_task_status",
        error: {
          code: "INVALID_INPUT",
          message: "newStatus is required and must be a valid task status",
        },
        timestamp,
      };
    }

    if (params.reason && (typeof params.reason !== "string" || params.reason.length > 500)) {
      return {
        success: false,
        action: "update_task_status",
        error: {
          code: "INVALID_INPUT",
          message: "reason must be at most 500 characters",
        },
        timestamp,
      };
    }

    // Tenant Isolation: Fetch task without filter to detect foreign-tenant access
    const existing = await store.getTask(params.taskId);
    if (!existing) {
      return {
        success: false,
        action: "update_task_status",
        error: {
          code: "TASK_NOT_FOUND",
          message: `Task "${params.taskId}" not found`,
        },
        timestamp,
      };
    }

    if (existing.tenantId && existing.tenantId !== principal.tenantId) {
      return {
        success: false,
        action: "update_task_status",
        error: {
          code: "TENANT_ISOLATION_VIOLATION",
          message: `Tenant isolation violation: Task "${params.taskId}" does not belong to tenant "${principal.tenantId}"`,
        },
        timestamp,
      };
    }

    const currentStatus = existing.status;
    if (!canTransitionStatus(currentStatus, params.newStatus)) {
      return {
        success: false,
        action: "update_task_status",
        error: {
          code: "INVALID_STATUS_TRANSITION",
          message: `Invalid status transition from "${currentStatus}" to "${params.newStatus}"`,
        },
        timestamp,
      };
    }

    // Dependency check for running/in_progress
    if (toCanonicalStatus(params.newStatus) === "running" && existing.dependencies?.length) {
      for (const depId of existing.dependencies) {
        const depTask = await store.getTask(depId);
        if (depTask && !isCompletedStatus(depTask.status)) {
          return {
            success: false,
            action: "update_task_status",
            error: {
              code: "DEPENDENCY_BLOCKED",
              message: `Cannot transition task "${params.taskId}" to "${params.newStatus}": dependency "${depId}" is not completed (${depTask.status})`,
            },
            timestamp,
          };
        }
      }
    }

    const latest = await store.getTask(params.taskId);
    if (!latest || latest.updatedAt !== existing.updatedAt) {
      return {
        success: false,
        action: "update_task_status",
        error: {
          code: "BOARD_CONFLICT",
          message: `Task "${params.taskId}" changed on the board. The supervisor will not overwrite the latest status or notes.`,
        },
        timestamp,
      };
    }

    const updatedAt = new Date().toISOString();
    const updated: StudioTask = {
      ...latest,
      description: latest.description,
      status: params.newStatus,
      paused: params.newStatus === "paused" ? true : latest.paused && params.newStatus === "in_progress" ? false : latest.paused,
      startedAt: toCanonicalStatus(params.newStatus) === "running" && !latest.startedAt ? updatedAt : latest.startedAt,
      completedAt: toCanonicalStatus(params.newStatus) === "completed" && !latest.completedAt ? updatedAt : latest.completedAt,
      updatedAt,
      metadata: {
        ...(latest.metadata ?? {}),
        ...(params.reason ? { statusChangeReason: params.reason } : {}),
      },
    };

    let saved: StudioTask;
    try {
      saved = await store.saveTask(updated, principal, { expectedUpdatedAt: latest.updatedAt });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "BOARD_CONFLICT") {
        return {
          success: false,
          action: "update_task_status",
          error: {
            code: "BOARD_CONFLICT",
            message: `Task "${params.taskId}" changed on the board. The supervisor will not overwrite the latest status or notes.`,
          },
          timestamp,
        };
      }
      throw err;
    }

    return {
      success: true,
      action: "update_task_status",
      data: {
        task: saved,
      },
      timestamp,
    };
  }

  private async handleAssignTask(
    params: StudioTaskAssignInput,
    principal: StudioPrincipal,
    store: StudioStore,
    timestamp: string,
  ): Promise<StudioTaskToolOutput> {
    if (!params.taskId || typeof params.taskId !== "string") {
      return {
        success: false,
        action: "assign_task",
        error: {
          code: "INVALID_INPUT",
          message: "taskId is required and must be a string",
        },
        timestamp,
      };
    }

    if (!params.assignedAgent || typeof params.assignedAgent !== "string") {
      return {
        success: false,
        action: "assign_task",
        error: {
          code: "INVALID_INPUT",
          message: "assignedAgent is required and must be a string",
        },
        timestamp,
      };
    }

    const existing = await store.getTask(params.taskId);
    if (!existing) {
      return {
        success: false,
        action: "assign_task",
        error: {
          code: "TASK_NOT_FOUND",
          message: `Task "${params.taskId}" not found`,
        },
        timestamp,
      };
    }

    if (existing.tenantId && existing.tenantId !== principal.tenantId) {
      return {
        success: false,
        action: "assign_task",
        error: {
          code: "TENANT_ISOLATION_VIOLATION",
          message: `Tenant isolation violation: Task "${params.taskId}" does not belong to tenant "${principal.tenantId}"`,
        },
        timestamp,
      };
    }

    const assignedAgents = Array.isArray(params.assignedAgents) && params.assignedAgents.length > 0
      ? [...new Set([params.assignedAgent, ...params.assignedAgents])]
      : [params.assignedAgent];

    const updatedAt = new Date().toISOString();
    const updated: StudioTask = {
      ...existing,
      assignedAgent: params.assignedAgent,
      assignedAgents,
      updatedAt,
    };

    const saved = await store.saveTask(updated, principal);

    return {
      success: true,
      action: "assign_task",
      data: {
        task: saved,
      },
      timestamp,
    };
  }

  private async handleAddTaskComment(
    params: StudioTaskAddCommentInput,
    principal: StudioPrincipal,
    store: StudioStore,
    timestamp: string,
  ): Promise<StudioTaskToolOutput> {
    if (!params.taskId || typeof params.taskId !== "string") {
      return {
        success: false,
        action: "add_task_comment",
        error: {
          code: "INVALID_INPUT",
          message: "taskId is required and must be a string",
        },
        timestamp,
      };
    }

    if (!params.content || typeof params.content !== "string") {
      return {
        success: false,
        action: "add_task_comment",
        error: {
          code: "INVALID_INPUT",
          message: "content is required and must be a string",
        },
        timestamp,
      };
    }

    if (params.content.length > 4000) {
      return {
        success: false,
        action: "add_task_comment",
        error: {
          code: "INVALID_INPUT",
          message: "content must be at most 4000 characters",
        },
        timestamp,
      };
    }

    const authorRole = params.authorRole ?? "agent";
    if (!["agent", "system", "user"].includes(authorRole)) {
      return {
        success: false,
        action: "add_task_comment",
        error: {
          code: "INVALID_INPUT",
          message: 'authorRole must be one of: "agent", "system", "user"',
        },
        timestamp,
      };
    }

    const existing = await store.getTask(params.taskId);
    if (!existing) {
      return {
        success: false,
        action: "add_task_comment",
        error: {
          code: "TASK_NOT_FOUND",
          message: `Task "${params.taskId}" not found`,
        },
        timestamp,
      };
    }

    if (existing.tenantId && existing.tenantId !== principal.tenantId) {
      return {
        success: false,
        action: "add_task_comment",
        error: {
          code: "TENANT_ISOLATION_VIOLATION",
          message: `Tenant isolation violation: Task "${params.taskId}" does not belong to tenant "${principal.tenantId}"`,
        },
        timestamp,
      };
    }

    const commentId = uid("comm");
    const commentRecord: TaskComment = {
      id: commentId,
      tenantId: principal.tenantId,
      taskId: params.taskId,
      authorId: params.authorAgentId || principal.userId || "agent",
      authorType: authorRole as TaskCommentAuthorType,
      content: params.content,
      mentions: [],
      metadata: params.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const savedComment = await store.saveComment(commentRecord, principal);

    return {
      success: true,
      action: "add_task_comment",
      data: {
        comment: savedComment,
      },
      timestamp,
    };
  }

  private async handleGetTask(
    params: StudioTaskGetInput,
    principal: StudioPrincipal,
    store: StudioStore,
    timestamp: string,
  ): Promise<StudioTaskToolOutput> {
    if (!params.taskId || typeof params.taskId !== "string") {
      return {
        success: false,
        action: "get_task",
        error: {
          code: "INVALID_INPUT",
          message: "taskId is required",
        },
        timestamp,
      };
    }

    const task = await store.getTask(params.taskId);
    if (!task) {
      return {
        success: false,
        action: "get_task",
        error: {
          code: "TASK_NOT_FOUND",
          message: `Task "${params.taskId}" not found`,
        },
        timestamp,
      };
    }

    if (task.tenantId && task.tenantId !== principal.tenantId) {
      return {
        success: false,
        action: "get_task",
        error: {
          code: "TENANT_ISOLATION_VIOLATION",
          message: `Tenant isolation violation: Task "${params.taskId}" does not belong to tenant "${principal.tenantId}"`,
        },
        timestamp,
      };
    }

    const comments = params.includeComments !== false ? await store.listComments(params.taskId) : undefined;
    return {
      success: true,
      action: "get_task",
      data: {
        task,
        ...(comments !== undefined ? { comments } : {}),
      },
      timestamp,
    };
  }

  private async upsertSingleTask(
    params: StudioTaskCreateInput,
    principal: StudioPrincipal,
    store: StudioStore,
    timestamp: string,
  ): Promise<StudioTask> {
    const title = typeof params.title === "string" ? params.title.trim() : "";
    if (!title) {
      throw new StudioTaskToolError("INVALID_INPUT", "Task title is required");
    }
    const id = typeof params.id === "string" && params.id.trim()
      ? params.id.trim()
      : typeof params.taskId === "string" && params.taskId.trim()
        ? params.taskId.trim()
        : uid("task");
    const existing = await store.getTask(id);
    if (existing && existing.tenantId && existing.tenantId !== principal.tenantId) {
      throw new TenantIsolationViolationError(
        `Tenant isolation violation: Task "${id}" belongs to a different tenant`,
      );
    }

    const assignedAgent =
      params.assignedAgent !== undefined
        ? params.assignedAgent
        : existing?.assignedAgent ?? null;
    const assignedAgents = Array.isArray(params.assignedAgents)
      ? params.assignedAgents.filter((a): a is string => typeof a === "string" && Boolean(a.trim()))
      : assignedAgent
        ? [assignedAgent]
        : existing?.assignedAgents ?? [];

    let effectiveProjectId = params.projectId ?? existing?.projectId;
    if (!effectiveProjectId) {
      try {
        const projects = await store.listProjects(principal);
        effectiveProjectId = projects[0]?.id;
      } catch {
        // ignore
      }
    }
    if (!effectiveProjectId) {
      effectiveProjectId = `project-${principal.tenantId}`;
    }

    const taskRecord: StudioTask = {
      id,
      tenantId: principal.tenantId,
      ownerId: existing?.ownerId ?? principal.userId,
      projectId: effectiveProjectId,
      workspaceId: params.workspaceId ?? existing?.workspaceId,
      parentTaskId: params.parentTaskId !== undefined ? params.parentTaskId : existing?.parentTaskId ?? null,
      title,
      description: typeof params.description === "string" ? params.description : existing?.description ?? "",
      priority:
        params.priority === "high" || params.priority === "medium" || params.priority === "low"
          ? params.priority
          : existing?.priority ?? "medium",
      status: params.status ?? existing?.status ?? "queued",
      assignedAgent,
      assignedAgents,
      workflowId: params.workflowId !== undefined ? params.workflowId : existing?.workflowId ?? null,
      dependencies: Array.isArray(params.dependencies)
        ? params.dependencies.filter((d): d is string => typeof d === "string" && Boolean(d.trim()))
        : existing?.dependencies ?? [],
      retryCount: existing?.retryCount ?? 0,
      paused: existing?.paused ?? false,
      output: existing?.output ?? null,
      metadata: {
        ...(existing?.metadata ?? {}),
        ...(params.metadata && typeof params.metadata === "object" ? params.metadata : {}),
      },
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    return await store.saveTask(taskRecord, principal);
  }

  private async handleCreateTask(
    params: StudioTaskCreateInput,
    principal: StudioPrincipal,
    store: StudioStore,
    timestamp: string,
  ): Promise<StudioTaskToolOutput> {
    const saved = await this.upsertSingleTask(params, principal, store, timestamp);
    return {
      success: true,
      action: "create_task",
      data: {
        task: saved,
      },
      timestamp,
    };
  }

  private async handleBulkCreateTasks(
    params: StudioTaskBulkCreateInput,
    principal: StudioPrincipal,
    store: StudioStore,
    timestamp: string,
  ): Promise<StudioTaskToolOutput> {
    if (!Array.isArray(params.tasks) || params.tasks.length === 0 || params.tasks.length > 100) {
      return {
        success: false,
        action: "bulk_create_tasks",
        error: {
          code: "INVALID_INPUT",
          message: "tasks must be an array of 1 to 100 task definitions",
        },
        timestamp,
      };
    }

    const created: StudioTask[] = [];
    for (const item of params.tasks) {
      const saved = await this.upsertSingleTask(item, principal, store, timestamp);
      created.push(saved);
    }

    return {
      success: true,
      action: "bulk_create_tasks",
      data: {
        tasks: created,
        count: created.length,
        createdCount: created.length,
      },
      timestamp,
    };
  }
}
