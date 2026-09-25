import type { ToolRecord } from "@multi-agent/types";

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
