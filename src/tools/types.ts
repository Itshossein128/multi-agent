import type { TaskStatus, ToolRecord } from "@multi-agent/types";

export interface ToolExecutionInput {
  tool: ToolRecord;
  input: Record<string, unknown>;
  signal?: AbortSignal;
  runId?: string;
  credentialPrincipal?: { tenantId: string; principalId: string };
  /** Calling agent id used for studio_task_tool action authorization. */
  agentId?: string;
  /** Tool ids the calling agent is allowed to invoke. */
  authorizedToolIds?: readonly string[];
  idempotencyKey?: string;
  approvalGranted?: boolean;
}

/** Backend-agnostic tool execution contract. Category-specific engines implement this. */
export interface ToolExecutor {
  execute(input: ToolExecutionInput): Promise<Record<string, unknown>>;
}

export type StudioTaskToolAction =
  | "query_tasks"
  | "get_task"
  | "create_task"
  | "bulk_create_tasks"
  | "update_task_status"
  | "assign_task"
  | "add_task_comment";

export interface StudioTaskGetInput {
  taskId: string;
  includeComments?: boolean;
}

export interface StudioTaskCreateInput {
  id?: string;
  taskId?: string;
  title: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  status?: TaskStatus;
  projectId?: string;
  workspaceId?: string;
  parentTaskId?: string | null;
  dependencies?: string[];
  assignedAgent?: string | null;
  assignedAgents?: string[];
  workflowId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StudioTaskBulkCreateInput {
  tasks: StudioTaskCreateInput[];
}

export interface StudioTaskQueryInput {
  status?: TaskStatus;
  projectId?: string;
  workspaceId?: string;
  assignedAgent?: string;
  limit?: number; // min 1, max 100, default 20
  offset?: number; // min 0, default 0
}

export interface StudioTaskUpdateStatusInput {
  taskId: string;
  newStatus: TaskStatus;
  reason?: string; // maxLength 500
}

export interface StudioTaskAssignInput {
  taskId: string;
  assignedAgent: string;
  assignedAgents?: string[];
}

export interface StudioTaskAddCommentInput {
  taskId: string;
  content: string; // maxLength 4000
  authorRole?: "agent" | "system" | "user"; // default "agent"
  authorAgentId?: string;
  metadata?: {
    completenessScore?: number;
    gapsCount?: number;
    iteration?: number;
    reportRef?: string;
    [key: string]: unknown;
  };
}

export type StudioTaskToolInput =
  | { action: "query_tasks"; params?: StudioTaskQueryInput }
  | { action: "get_task"; params: StudioTaskGetInput }
  | { action: "create_task"; params: StudioTaskCreateInput }
  | { action: "bulk_create_tasks"; params: StudioTaskBulkCreateInput }
  | { action: "update_task_status"; params: StudioTaskUpdateStatusInput }
  | { action: "assign_task"; params: StudioTaskAssignInput }
  | { action: "add_task_comment"; params: StudioTaskAddCommentInput };

export type StudioTaskToolErrorCode =
  | "TASK_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "TENANT_ISOLATION_VIOLATION"
  | "INVALID_INPUT"
  | "DEPENDENCY_BLOCKED"
  | "BOARD_CONFLICT"
  | "UNAUTHORIZED_ACTION";

export interface StudioTaskToolSuccessResponse<T = unknown> {
  [key: string]: unknown;
  success: true;
  action: StudioTaskToolAction;
  data: T;
  timestamp: string;
}

export interface StudioTaskToolErrorResponse {
  [key: string]: unknown;
  success: false;
  action: StudioTaskToolAction;
  error: {
    code: StudioTaskToolErrorCode;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export type StudioTaskToolOutput = StudioTaskToolSuccessResponse | StudioTaskToolErrorResponse;
