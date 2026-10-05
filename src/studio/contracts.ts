import type {
  AgentRecord,
  ToolRecord,
  WorkflowDefinition,
  TaskPriority,
  TaskStatus,
  TaskComment,
  TriggerEvent,
  TriggerEventType,
  TriggerTargetType,
  TriggerEventStatus,
  RoutineRecord,
  RoutineScheduleType,
  RoutineMisfirePolicy,
  RoutineHistoryRecord,
  RoutineHistoryStatus,
  WebhookTriggerRecord,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  AgentHeartbeatSettings,
} from "@multi-agent/types";

export type {
  TaskPriority,
  TaskStatus,
  Phase2TaskStatus,
  LegacyTaskStatus,
  TaskRecord,
  TaskComment,
  TaskCommentAuthorType,
  TriggerEvent,
  TriggerEventType,
  TriggerTargetType,
  TriggerEventStatus,
  RoutineRecord,
  RoutineScheduleType,
  RoutineMisfirePolicy,
  RoutineHistoryRecord,
  RoutineHistoryStatus,
  WebhookTriggerRecord,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  AgentHeartbeatSettings,
} from "@multi-agent/types";

export type StudioEntityStatus = "active" | "retired";

/** First-class project entity (distinct from memory namespace "project"). */
export interface StudioProject {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: StudioEntityStatus;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
}

/** First-class workspace entity (distinct from StudioWorkspaceImport package). */
export interface StudioWorkspace {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: StudioEntityStatus;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
}

/** Task board record persisted by the Studio store (shared with the web task board model). */
export interface StudioTask {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  assignedAgent: string | null;
  assignedAgents?: string[];
  workflowId?: string | null;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  parentTaskId?: string | null;
  dependencies: string[];
  runId?: string | null;
  output: string | null;
  lastError?: string | null;
  retryCount: number;
  paused: boolean;
  metadata?: Record<string, unknown>;
  ownerId?: string;
  tenantId?: string;
  /** Exactly one workspace after association rules apply (filled by TaskService / migration). */
  workspaceId?: string;
  /** One or more project ids after association rules apply. */
  projectIds?: string[];
}

export interface StudioWorkspaceImport {
  workflows: WorkflowDefinition[];
  agents: AgentRecord[];
  tools: ToolRecord[];
}

export interface StudioPrincipal {
  userId: string;
  tenantId: string;
}

export type StudioEntityStatusFilter = "active" | "retired" | "all";

/**
 * Trusted backend boundary for durable Studio entities.
 * Adapters must not silently fall back between postgres and in-memory.
 */
export interface StudioStore {
  /** Execute related registry/workflow changes atomically. */
  transaction<T>(operation: (store: StudioStore) => Promise<T>): Promise<T>;
  listWorkflows(principal?: StudioPrincipal): Promise<WorkflowDefinition[]>;
  getWorkflow(id: string, principal?: StudioPrincipal): Promise<WorkflowDefinition | null>;
  saveWorkflow(definition: WorkflowDefinition, principal?: StudioPrincipal): Promise<WorkflowDefinition>;
  deleteWorkflow(id: string, principal?: StudioPrincipal): Promise<void>;

  listAgents(principal?: StudioPrincipal): Promise<AgentRecord[]>;
  getAgent(id: string, principal?: StudioPrincipal): Promise<AgentRecord | null>;
  saveAgent(agent: AgentRecord, principal?: StudioPrincipal): Promise<AgentRecord>;
  deleteAgent(id: string, principal?: StudioPrincipal): Promise<void>;

  listTools(principal?: StudioPrincipal): Promise<ToolRecord[]>;
  getTool(id: string, principal?: StudioPrincipal): Promise<ToolRecord | null>;
  saveTool(tool: ToolRecord, principal?: StudioPrincipal): Promise<ToolRecord>;
  deleteTool(id: string, principal?: StudioPrincipal): Promise<void>;

  listTasks(principal?: StudioPrincipal): Promise<StudioTask[]>;
  getTask(id: string, principal?: StudioPrincipal): Promise<StudioTask | null>;
  saveTask(task: StudioTask, principal?: StudioPrincipal): Promise<StudioTask>;
  deleteTask(id: string, principal?: StudioPrincipal): Promise<void>;
  listTasksByWorkspace(workspaceId: string, principal?: StudioPrincipal): Promise<StudioTask[]>;
  listTasksByProject(projectId: string, principal?: StudioPrincipal): Promise<StudioTask[]>;

  listProjects(principal?: StudioPrincipal, status?: StudioEntityStatusFilter): Promise<StudioProject[]>;
  getProject(id: string, principal?: StudioPrincipal): Promise<StudioProject | null>;
  saveProject(project: StudioProject, principal?: StudioPrincipal): Promise<StudioProject>;

  listWorkspaces(principal?: StudioPrincipal, status?: StudioEntityStatusFilter): Promise<StudioWorkspace[]>;
  getWorkspace(id: string, principal?: StudioPrincipal): Promise<StudioWorkspace | null>;
  saveWorkspace(workspace: StudioWorkspace, principal?: StudioPrincipal): Promise<StudioWorkspace>;

  /** Upsert entire workspace package (used by one-shot browser import). */
  importWorkspace(workspace: StudioWorkspaceImport, principal?: StudioPrincipal): Promise<void>;

  // --- Task Comments ---
  listComments(taskId: string, principal?: StudioPrincipal): Promise<TaskComment[]>;
  getComment(id: string, principal?: StudioPrincipal): Promise<TaskComment | null>;
  saveComment(comment: TaskComment, principal?: StudioPrincipal): Promise<TaskComment>;
  deleteComment(id: string, principal?: StudioPrincipal): Promise<void>;

  // --- Trigger Events (Outbox) ---
  enqueueTriggerEvent(
    event: Omit<TriggerEvent, "id" | "createdAt" | "updatedAt" | "retryCount" | "status" | "maxRetries"> &
      Partial<Pick<TriggerEvent, "id" | "retryCount" | "status" | "maxRetries">>
  ): Promise<TriggerEvent>;
  claimNextTriggerEvent(workerId: string, leaseDurationSeconds?: number): Promise<TriggerEvent | null>;
  updateTriggerEvent(id: string, patch: Partial<TriggerEvent>, expectedLockedBy?: string): Promise<TriggerEvent | null>;
  listTriggerEvents(filters?: { status?: TriggerEventStatus; tenantId?: string; limit?: number; idempotencyKey?: string }): Promise<TriggerEvent[]>;

  // --- Recurring Routines ---
  listRoutines(principal?: StudioPrincipal): Promise<RoutineRecord[]>;
  getRoutine(id: string, principal?: StudioPrincipal): Promise<RoutineRecord | null>;
  saveRoutine(routine: RoutineRecord, principal?: StudioPrincipal): Promise<RoutineRecord>;
  deleteRoutine(id: string, principal?: StudioPrincipal): Promise<void>;
  claimDueRoutines(workerId: string, limit?: number): Promise<RoutineRecord[]>;
  recordRoutineHistory(history: RoutineHistoryRecord): Promise<RoutineHistoryRecord>;
  listRoutineHistory(routineId: string, principal?: StudioPrincipal, limit?: number): Promise<RoutineHistoryRecord[]>;

  // --- Webhook Triggers ---
  listWebhookTriggers(principal?: StudioPrincipal): Promise<WebhookTriggerRecord[]>;
  getWebhookTrigger(id: string, principal?: StudioPrincipal): Promise<WebhookTriggerRecord | null>;
  saveWebhookTrigger(trigger: WebhookTriggerRecord, principal?: StudioPrincipal): Promise<WebhookTriggerRecord>;
  deleteWebhookTrigger(id: string, principal?: StudioPrincipal): Promise<void>;
  recordWebhookDelivery(delivery: WebhookDeliveryRecord): Promise<WebhookDeliveryRecord>;
  listWebhookDeliveries(triggerId: string, principal?: StudioPrincipal, limit?: number): Promise<WebhookDeliveryRecord[]>;
  countRecentWebhookDeliveries(triggerId: string, windowSeconds: number): Promise<number>;
  acceptWebhookDelivery(params: AcceptWebhookDeliveryParams): Promise<AcceptWebhookDeliveryResult>;

  // --- Agent Heartbeats ---
  getAgentHeartbeat(agentId: string, principal?: StudioPrincipal): Promise<AgentHeartbeatSettings | null>;
  saveAgentHeartbeat(settings: AgentHeartbeatSettings, principal?: StudioPrincipal): Promise<AgentHeartbeatSettings>;
  claimDueHeartbeats(workerId: string, limit?: number): Promise<AgentHeartbeatSettings[]>;
  isAgentBusy(agentId: string, tenantId: string): Promise<boolean>;
}

export interface AcceptWebhookDeliveryParams {
  triggerId: string;
  deliveryId?: string;
  idempotencyKey?: string | null;
  payload: Record<string, unknown>;
  payloadSummary?: Record<string, unknown>;
  durationMs?: number;
}

export interface AcceptWebhookDeliveryResult {
  decision: "accepted" | "rejected" | "replay";
  httpStatus: number;
  delivery: WebhookDeliveryRecord;
  error?: string;
  outboxEvent?: TriggerEvent;
}
