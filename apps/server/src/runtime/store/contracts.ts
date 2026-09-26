import type { AgentRecord, ApprovalRequest, NodeResultEnvelope, Run, RunEvent, RunStatus, WorkflowDefinition } from "@multi-agent/types";
import type { MemoryAccessContext } from "../../../../../src/memory/contracts";
import type { RequestPrincipal } from "../../auth/principal";

type Listener = (event: RunEvent) => void;

export interface MemoryOwner { principalId: string; tenantId: string }

export interface RunEntry {
  run: Run;
  events: RunEvent[];
  listeners: Set<Listener>;
  abort: AbortController;
  memoryOwner?: MemoryOwner;
  approvals: ApprovalRequest[];
  approvalTimers: Map<string, NodeJS.Timeout>;
  workflowSnapshot?: WorkflowDefinition;
  agentsSnapshot?: AgentRecord[];
  toolsSnapshot?: import("@multi-agent/types").ToolRecord[];
  pausedContext?: { workflow: WorkflowDefinition; agents: AgentRecord[]; tools?: import("@multi-agent/types").ToolRecord[]; memoryAccess?: MemoryAccessContext; stepBudget?: { count: number }; pendingHuman?: { nodeId: string; envelope: NodeResultEnvelope } };
}

export interface RunListFilters {
  agentId?: string;
  workflowId?: string;
  taskId?: string;
  status?: RunStatus;
  from?: string;
  to?: string;
}

export interface RunStoreContract {
  create(
    run: Run,
    memoryOwner?: MemoryOwner,
    snapshots?: { workflow?: WorkflowDefinition; agents?: AgentRecord[]; tools?: import("@multi-agent/types").ToolRecord[] },
    principal?: RequestPrincipal,
  ): Run;
  getMemoryOwner(runId: string): MemoryOwner | undefined;
  get(runId: string): RunEntry | undefined;
  list(filters?: string | RunListFilters, principal?: RequestPrincipal): Run[];
  append(runId: string, event: RunEvent): RunEvent | undefined;
  update(runId: string, patch: Partial<Run>): Run | undefined;
  events(runId: string, after?: number): RunEvent[];
  subscribe(runId: string, listener: Listener): () => void;
  cancel(runId: string): boolean;
  signal(runId: string): AbortSignal | undefined;
  addApproval(runId: string, approval: ApprovalRequest, timeoutSeconds?: number): void;
  getApproval(runId: string, approvalId: string): ApprovalRequest | undefined;
  listApprovals(runId: string): ApprovalRequest[];
  updateApproval(runId: string, approvalId: string, patch: Partial<ApprovalRequest>): ApprovalRequest | undefined;
  setApprovalTimer(runId: string, approvalId: string, timer: NodeJS.Timeout): void;
  clearApprovalTimer(runId: string, approvalId: string): void;
  setPausedContext?(runId: string, context: RunEntry["pausedContext"] | null): void;
  getPausedContext?(runId: string): RunEntry["pausedContext"] | undefined;
  getWorkflowSnapshot?(runId: string): WorkflowDefinition | undefined;
  getAgentSnapshot?(runId: string): AgentRecord[] | undefined;
  getToolSnapshot?(runId: string): import("@multi-agent/types").ToolRecord[] | undefined;
  /** Throws when a durable adapter has entered a persistence-failure state. */
  assertHealthy?(): void;
  hydrate?(): Promise<void>;
  flush?(): Promise<void>;
}
