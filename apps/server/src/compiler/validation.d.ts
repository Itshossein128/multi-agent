import type { AgentRecord, WorkflowDefinition, WorkflowNode } from "@multi-agent/types";
export interface WorkflowIssue {
    id: string;
    severity: "error" | "warning";
    message: string;
    nodeId?: string;
    edgeId?: string;
}
export declare function validateWorkflow(definition: WorkflowDefinition, agents: AgentRecord[]): WorkflowIssue[];
export declare function nodeLabel(node: WorkflowNode, agents: AgentRecord[]): string;
