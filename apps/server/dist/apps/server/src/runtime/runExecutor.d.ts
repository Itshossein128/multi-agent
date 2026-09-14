import { type BaseCheckpointSaver } from "@langchain/langgraph";
import { type AgentRecord, type AgentTestRequest, type ApprovalDecisionRequest, type RunCreateRequest, type WorkflowDefinition } from "@multi-agent/types";
import { type CompileOptions } from "../compiler/workflowCompiler";
import { type RunStoreContract } from "./runStore";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import { AgentRuntime } from "../../../../src/agents/runtime";
import { ToolRuntime } from "../../../../src/tools";
import { ExecutionTelemetry } from "../../../../src/observability/telemetry";
import { type RuntimeGuardrails } from "./guardrails";
import type { RequestPrincipal } from "../auth/principal";
interface PausedContext {
    workflow: WorkflowDefinition;
    agents: AgentRecord[];
    tools?: import("@multi-agent/types").ToolRecord[];
    memoryAccess?: MemoryAccessContext;
}
export declare class RunExecutor {
    private readonly store;
    private readonly agentRuntime;
    private readonly checkpointer?;
    private readonly telemetry;
    private readonly guardrails;
    private readonly toolRuntime?;
    private checkpointers;
    private pausedContext;
    constructor(store?: RunStoreContract, agentRuntime?: Pick<AgentRuntime, "execute">, checkpointer?: CompileOptions["checkpointer"], telemetry?: ExecutionTelemetry, guardrails?: RuntimeGuardrails, toolRuntime?: Pick<ToolRuntime, "execute"> | undefined);
    getStore(): RunStoreContract;
    private appendAgentEvent;
    /** Restore in-memory pause maps after a durable hydrate so waiting runs can resume. */
    restorePausedRun(runId: string, context: PausedContext, checkpointer: BaseCheckpointSaver): void;
    startAgentTest(request: AgentTestRequest, memoryAccess?: MemoryAccessContext, principal?: RequestPrincipal): string;
    private executeAgentTest;
    start(request: RunCreateRequest, memoryAccess?: MemoryAccessContext, principal?: RequestPrincipal): string;
    retry(runId: string, memoryAccess?: MemoryAccessContext): string;
    cancel(runId: string): boolean;
    resolveApproval(runId: string, approvalId: string, decision: ApprovalDecisionRequest): void;
    private continueAfterApproval;
    private execute;
    private executeWorkflow;
    private runGraph;
    private handleApprovalRequested;
    /** Re-arm timeout approvals after process restart when remaining time can be computed. */
    rearmApprovalTimers(runId: string): void;
    private fail;
}
export {};
