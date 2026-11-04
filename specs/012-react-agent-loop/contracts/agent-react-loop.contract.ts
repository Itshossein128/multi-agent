/**
 * Contract: Autonomous ReAct Agent Loop (012)
 *
 * Documents the execution-time interfaces ApiAgentExecutor + compiler must honor.
 * This file is a specification aid for implementers/tests — not a runtime import requirement.
 */

import type { AgentRecord, ToolRecord } from "@multi-agent/types";

/** Effective settings after node → agent → default resolution. */
export type AgentExecutionMode = "single_turn" | "react";

export interface EffectiveReactSettings {
  mode: AgentExecutionMode;
  /** Clamped to [1, 10]. */
  maxToolSteps: number;
}

export function resolveEffectiveReactSettings(input: {
  agentTools: readonly string[];
  agentMode?: AgentExecutionMode;
  agentMaxToolSteps?: number;
  nodeMode?: AgentExecutionMode;
  nodeMaxToolSteps?: number;
}): EffectiveReactSettings {
  const mode =
    input.nodeMode ??
    input.agentMode ??
    (input.agentTools.length > 0 ? "react" : "single_turn");
  const raw = input.nodeMaxToolSteps ?? input.agentMaxToolSteps ?? 5;
  const maxToolSteps = Math.min(10, Math.max(1, Math.trunc(Number(raw)) || 5));
  return { mode, maxToolSteps };
}

/** Trusted server injection (never from client as authority). */
export interface AgentToolExecutionDeps {
  toolRuntime: {
    execute: (
      tool: ToolRecord,
      input: Record<string, unknown>,
      parentSignal?: AbortSignal,
      context?: {
        runId?: string;
        credentialPrincipal?: { tenantId: string; principalId: string };
        agentId?: string;
        authorizedToolIds?: readonly string[];
        idempotencyKey?: string;
        approvalGranted?: boolean;
      }
    ) => Promise<Record<string, unknown>>;
  };
  resolvedTools: ToolRecord[];
}

/** Model-facing tool call after bindTools invoke. */
export interface ModelToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Nested tool event payload shapes (sanitized before persistence). */
export interface ToolStartedPayload {
  toolId: string;
  name: string;
  arguments: Record<string, unknown>;
  iteration: number;
  toolCallId: string;
}

export interface ToolCompletedPayload {
  toolId: string;
  output: Record<string, unknown>;
  durationMs: number;
  toolCallId: string;
}

export interface ToolFailedPayload {
  toolId?: string;
  error: string;
  toolCallId: string;
  code?: string;
}

export interface AgentToolLimitExceededPayload {
  code: "AGENT_TOOL_LIMIT_EXCEEDED";
  maxToolSteps: number;
  iterationsCompleted: number;
}

/** Stable failure code for ceiling exhaustion. */
export const AGENT_TOOL_LIMIT_EXCEEDED = "AGENT_TOOL_LIMIT_EXCEEDED" as const;

/**
 * Loop guarantees (for contract tests):
 * 1. When mode=single_turn, toolRuntime.execute is never called from ApiAgentExecutor.
 * 2. When mode=react and resolvedTools non-empty, model.bindTools is invoked once before the loop.
 * 3. tool.* events always carry the parent agent nodeId.
 * 4. tool_call names not in authorized set never reach toolRuntime.execute.
 * 5. At most maxToolSteps model rounds that contain tool_calls occur.
 * 6. AbortSignal abort stops further iterations and in-flight execute respects parentSignal.
 */

export type AgentRecordReactFields = Pick<AgentRecord, "tools"> & {
  executionMode?: AgentExecutionMode;
  maxToolSteps?: number;
};
)
