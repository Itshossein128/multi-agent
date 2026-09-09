export type ApprovalStatus = "requested" | "approved" | "rejected" | "expired" | "cancelled";
export type ApprovalDecision = "approved" | "rejected";
export interface ApprovalRequest {
    id: string;
    runId: string;
    nodeId: string;
    status: ApprovalStatus;
    message: string;
    requestedAt: string;
    resolvedAt?: string;
    context?: Record<string, unknown>;
    response?: string;
    metadata: Record<string, unknown>;
}
export interface ApprovalDecisionRequest {
    decision: ApprovalDecision;
    response?: string;
}
