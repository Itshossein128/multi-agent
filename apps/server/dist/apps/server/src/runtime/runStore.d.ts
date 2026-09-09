import type { AgentRecord, ApprovalRequest, Run, RunEvent, RunStatus, WorkflowDefinition } from "@multi-agent/types";
import type { PgPool } from "../../../../src/memory/infrastructure";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
type Listener = (event: RunEvent) => void;
export interface MemoryOwner {
    principalId: string;
    tenantId: string;
}
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
    pausedContext?: {
        workflow: WorkflowDefinition;
        agents: AgentRecord[];
        memoryAccess?: MemoryAccessContext;
    };
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
    create(run: Run, memoryOwner?: MemoryOwner, snapshots?: {
        workflow?: WorkflowDefinition;
        agents?: AgentRecord[];
    }): Run;
    getMemoryOwner(runId: string): MemoryOwner | undefined;
    get(runId: string): RunEntry | undefined;
    list(filters?: string | RunListFilters): Run[];
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
    hydrate?(): Promise<void>;
}
/** In-process run store. Used directly in tests and as the hot cache for durable adapters. */
export declare class InMemoryRunStore implements RunStoreContract {
    private entries;
    create(run: Run, memoryOwner?: MemoryOwner, snapshots?: {
        workflow?: WorkflowDefinition;
        agents?: AgentRecord[];
    }): Run;
    getMemoryOwner(runId: string): MemoryOwner | undefined;
    get(runId: string): RunEntry | undefined;
    list(filters?: string | RunListFilters): Run[];
    append(runId: string, event: RunEvent): {
        payload: RunEvent["payload"];
        sequence: number;
        id: string;
        runId: string;
        type: import("@multi-agent/types").RunEventType;
        timestamp: string;
        nodeId?: string;
        agentId?: string;
        toolId?: string;
        parentEventId?: string;
    } | undefined;
    update(runId: string, patch: Partial<Run>): Run | undefined;
    events(runId: string, after?: number): RunEvent[];
    subscribe(runId: string, listener: Listener): () => void;
    cancel(runId: string): boolean;
    signal(runId: string): AbortSignal | undefined;
    addApproval(runId: string, approval: ApprovalRequest): void;
    getApproval(runId: string, approvalId: string): ApprovalRequest | undefined;
    listApprovals(runId: string): ApprovalRequest[];
    updateApproval(runId: string, approvalId: string, patch: Partial<ApprovalRequest>): ApprovalRequest | undefined;
    setApprovalTimer(runId: string, approvalId: string, timer: NodeJS.Timeout): void;
    clearApprovalTimer(runId: string, approvalId: string): void;
    setPausedContext(runId: string, context: RunEntry["pausedContext"] | null): void;
    getPausedContext(runId: string): {
        workflow: WorkflowDefinition;
        agents: AgentRecord[];
        memoryAccess?: MemoryAccessContext;
    } | undefined;
    getWorkflowSnapshot(runId: string): WorkflowDefinition | undefined;
}
/** Back-compat alias for existing imports/tests. */
export declare class RunStore extends InMemoryRunStore {
}
/**
 * Write-through durable store: hot path stays in-memory (SSE/listeners/abort),
 * mutations are persisted to Postgres. hydrate() rebuilds the cache after restart.
 */
export declare class PostgresRunStore implements RunStoreContract {
    private readonly pool;
    private readonly memory;
    private writeChain;
    constructor(pool: PgPool);
    private enqueue;
    hydrate(): Promise<void>;
    create(run: Run, memoryOwner?: MemoryOwner, snapshots?: {
        workflow?: WorkflowDefinition;
        agents?: AgentRecord[];
    }): Run;
    getMemoryOwner(runId: string): MemoryOwner | undefined;
    get(runId: string): RunEntry | undefined;
    list(filters?: string | RunListFilters): Run[];
    append(runId: string, event: RunEvent): {
        payload: RunEvent["payload"];
        sequence: number;
        id: string;
        runId: string;
        type: import("@multi-agent/types").RunEventType;
        timestamp: string;
        nodeId?: string;
        agentId?: string;
        toolId?: string;
        parentEventId?: string;
    } | undefined;
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
    setPausedContext(runId: string, context: RunEntry["pausedContext"] | null): void;
    getPausedContext(runId: string): {
        workflow: WorkflowDefinition;
        agents: AgentRecord[];
        memoryAccess?: MemoryAccessContext;
    } | undefined;
    getWorkflowSnapshot(runId: string): WorkflowDefinition | undefined;
}
export {};
