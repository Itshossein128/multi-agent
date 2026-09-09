import type { AgentRecord, WorkflowDefinition, WorkflowNode } from "@multi-agent/types";
export interface WorkflowIssue {
    id: string;
    /** Stable machine-readable reason suitable for API/UI handling. */
    code: string;
    /** Preferred structured severity; `severity` remains for existing consumers. */
    level: "error" | "warning";
    severity: "error" | "warning";
    message: string;
    nodeId?: string;
    edgeId?: string;
}
export interface WorkflowValidationLimits {
    maxNodes?: number;
    maxEdges?: number;
    maxBranches?: number;
}
export declare function validateWorkflow(definition: WorkflowDefinition, agents: AgentRecord[], limits?: WorkflowValidationLimits): WorkflowIssue[];
export declare function nodeLabel(node: WorkflowNode, agents: AgentRecord[]): string;
