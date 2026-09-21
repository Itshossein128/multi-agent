import { Command, type BaseCheckpointSaver } from "@langchain/langgraph";
import { nowIso, uid, type ApprovalDecisionRequest, type ApprovalRequest, type AgentRecord, type WorkflowDefinition } from "@multi-agent/types";
import type { RunStoreContract, RunEntry } from "./store/contracts";
import type { RuntimeGuardrails } from "./guardrails";
import { compileWorkflow, type CompileOptions, type AgentExecutionEvent } from "../compiler/workflowCompiler";
import type { RuntimeState } from "../compiler/workflowCompiler";

export interface ApprovalManagerDependencies {
  store: RunStoreContract;
  checkpointers: Map<string, BaseCheckpointSaver>;
  pausedContext: Map<string, PausedContext>;
  branchControllers: Map<string, Map<string, AbortController>>;
  agentRuntime: Pick<import("../../../../src/agents/runtime").AgentRuntime, "execute">;
  toolRuntime?: Pick<import("../../../../src/tools").ToolRuntime, "execute">;
  guardrails: RuntimeGuardrails;
  credentialPrincipalForRun: (runId: string) => import("../../../../src/agents/runtime").TrustedCredentialPrincipal | undefined;
  appendAgentEvent: (runId: string, event: AgentExecutionEvent) => void;
  runGraph: (
    runId: string,
    compiled: ReturnType<typeof compileWorkflow>,
    input: unknown,
    workflow: WorkflowDefinition,
    agents: AgentRecord[],
    memoryAccess?: import("../../../../src/memory/contracts").MemoryAccessContext,
    tools?: import("@multi-agent/types").ToolRecord[],
    stepBudget?: { count: number },
  ) => Promise<void>;
  signal: (runId: string) => AbortSignal | undefined;
  fail: (runId: string, error: unknown) => void;
}

export interface PausedContext {
  workflow: WorkflowDefinition;
  agents: AgentRecord[];
  tools?: import("@multi-agent/types").ToolRecord[];
  memoryAccess?: import("../../../../src/memory/contracts").MemoryAccessContext;
  stepBudget?: { count: number };
}

/**
 * Manages human approval lifecycle: recording requests, resolving decisions,
 * resuming paused workflows, and rearming timeout timers.
 */
export class ApprovalManager {
  constructor(private readonly deps: ApprovalManagerDependencies) {}

  /** Record an interrupt item as a pending approval request. */
  handleApprovalRequested(runId: string, item: { id: string; value: unknown }) {
    const value = item.value as { nodeId: string; message: string; approvalType: "manual" | "timeout"; timeoutSeconds: number; context?: unknown };
    const stamp = nowIso();
    const request: ApprovalRequest = {
      id: item.id,
      runId,
      nodeId: value.nodeId,
      status: "requested",
      message: value.message,
      requestedAt: stamp,
      context: value.context && typeof value.context === "object" ? value.context as Record<string, unknown> : undefined,
      metadata: {},
    };
    this.deps.store.addApproval(runId, request, value.timeoutSeconds);
    this.deps.store.update(runId, { status: "waiting_for_human", currentNodeId: value.nodeId });
    this.deps.store.append(runId, { id: uid("event"), runId, type: "run.paused", nodeId: value.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId: item.id } });
    this.deps.store.append(runId, { id: uid("event"), runId, type: "human_approval.requested", nodeId: value.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId: item.id, message: value.message, approvalType: value.approvalType, timeoutSeconds: value.timeoutSeconds } });
    if (value.approvalType === "timeout" && value.timeoutSeconds > 0) {
      const timer = setTimeout(() => {
        try { this.resolveApproval(runId, item.id, { decision: "approved" }); } catch { /* already resolved by a human in the meantime */ }
      }, value.timeoutSeconds * 1000);
      this.deps.store.setApprovalTimer(runId, item.id, timer);
    }
  }

  /** Resolve a pending approval and resume the workflow graph. */
  resolveApproval(runId: string, approvalId: string, decision: ApprovalDecisionRequest) {
    const approval = this.deps.store.getApproval(runId, approvalId);
    if (!approval) throw new Error("Approval not found");
    if (approval.status !== "requested") throw new Error("Approval has already been resolved.");
    this.deps.store.clearApprovalTimer(runId, approvalId);
    const stamp = nowIso();
    this.deps.store.updateApproval(runId, approvalId, { status: decision.decision, resolvedAt: stamp, response: decision.response });
    this.deps.store.append(runId, { id: uid("event"), runId, type: decision.decision === "approved" ? "human_approval.approved" : "human_approval.rejected", nodeId: approval.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId, decision: decision.decision, response: decision.response } });
    this.deps.store.append(runId, { id: uid("event"), runId, type: "human_approval.resolved", nodeId: approval.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId, decision: decision.decision, response: decision.response } });
    this.deps.store.append(runId, { id: uid("event"), runId, type: "run.resumed", nodeId: approval.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId } });
    this.deps.store.update(runId, { status: "running" });
    void this.continueAfterApproval(runId, decision);
  }

  /** Re-arm timeout approvals after process restart when remaining time can be computed. */
  rearmApprovalTimers(runId: string) {
    for (const approval of this.deps.store.listApprovals(runId)) {
      if (approval.status !== "requested") continue;
      const timeoutSeconds = Number((approval.metadata as { timeoutSeconds?: number })?.timeoutSeconds
        ?? this.deps.store.get(runId)?.events.find((event) => event.type === "human_approval.requested" && (event.payload as { approvalId?: string }).approvalId === approval.id)?.payload?.timeoutSeconds);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) continue;
      const elapsedMs = Date.now() - Date.parse(approval.requestedAt);
      const remaining = Math.max(0, timeoutSeconds * 1000 - elapsedMs);
      const timer = setTimeout(() => {
        try { this.resolveApproval(runId, approval.id, { decision: "approved" }); } catch { /* already resolved */ }
      }, remaining);
      this.deps.store.setApprovalTimer(runId, approval.id, timer);
    }
  }

  /** Re-compile and resume the workflow after an approval is resolved. */
  private async continueAfterApproval(runId: string, decision: ApprovalDecisionRequest) {
    const context = this.deps.pausedContext.get(runId);
    const checkpointer = this.deps.checkpointers.get(runId);
    if (!context || !checkpointer) { this.deps.fail(runId, new Error("Run is not resumable.")); return; }
    this.deps.pausedContext.delete(runId);
    try {
      const compiled = compileWorkflow(context.workflow, context.agents, {
        runId,
        runtime: this.deps.agentRuntime,
        toolRuntime: this.deps.toolRuntime,
        checkpointer,
        memoryAccess: context.memoryAccess,
        credentialPrincipal: this.deps.credentialPrincipalForRun(runId),
        signal: this.deps.signal(runId),
        workflowId: context.workflow.id,
        tools: context.tools,
        stepBudget: context.stepBudget,
        guardrails: this.deps.guardrails,
        branchSignals: this.deps.branchControllers.get(runId),
        onAgentEvent: (event) => { this.deps.appendAgentEvent(runId, event); },
      });
      await this.deps.runGraph(runId, compiled, new Command({ resume: decision }), context.workflow, context.agents, context.memoryAccess, context.tools, context.stepBudget);
    } catch (error) { this.deps.fail(runId, error); }
  }
}
