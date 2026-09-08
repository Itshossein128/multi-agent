import { type AgentRecord, type RunEvent, type WorkflowDefinition } from "@multi-agent/types";
export declare class LangGraphEventAdapter {
    adapt(raw: unknown, runId: string, workflow: WorkflowDefinition, agents: AgentRecord[]): RunEvent[];
}
