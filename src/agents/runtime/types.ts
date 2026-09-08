import type { AgentRecord } from "@multi-agent/types";

export type AgentExecutionEventType =
  | "agent.started"
  | "agent.output"
  | "agent.completed"
  | "agent.failed"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "memory.read"
  | "memory.write"
  | "log";

export interface AgentExecutionEvent {
  type: AgentExecutionEventType;
  timestamp: string;
  payload?: unknown;
  agentId?: string;
  nodeId?: string;
  runId?: string;
}

export interface AgentExecutionInput {
  agent: AgentRecord;
  input: unknown;
  runId: string;
  nodeId: string;
  workflowId?: string;
  context?: Record<string, unknown>;
  signal?: AbortSignal;
  memoryStore?: Map<string, { input: unknown; output: unknown }[]>;
}

/**
 * Backend-agnostic agent execution contract.
 * LangGraph nodes delegate here; provider/CLI details stay behind implementations.
 */
export interface AgentExecutor {
  execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
