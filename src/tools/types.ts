import type { TaskStatus, ToolRecord } from "@multi-agent/types";

export interface ToolExecutionInput {
  tool: ToolRecord;
  input: Record<string, unknown>;
  signal?: AbortSignal;
  runId?: string;
  credentialPrincipal?: { tenantId: string; principalId: string };
  idempotencyKey?: string;
  approvalGranted?: boolean;
}

/** Backend-agnostic tool execution contract. Category-specific engines implement this. */
export interface ToolExecutor {
  execute(input: ToolExecutionInput): Promise<Record<string, unknown>>;
}

export type StudioTaskToolAction =
  | "query_tasks"
  | "update_task_status"
  | "assign_task"
  | "add_task_comment";

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
  | { action: "update_task_status"; params: StudioTaskUpdateStatusInput }
  | { action: "assign_task"; params: StudioTaskAssignInput }
  | { action: "add_task_comment"; params: StudioTaskAddCommentInput };

export type StudioTaskToolErrorCode =
  | "TASK_NOT_FOUND"
  | "INVALID_STATUS_TRANSITION"
  | "TENANT_ISOLATION_VIOLATION"
  | "INVALID_INPUT"
  | "DEPENDENCY_BLOCKED";

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
