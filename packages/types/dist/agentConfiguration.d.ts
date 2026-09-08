import type { AgentBackend, AgentModelSettings, AgentRecord, WorkflowDefinition } from "./index";
interface SettingSchema {
    key: keyof AgentModelSettings;
    label: string;
    min: number;
    max: number;
    step: number;
}
/** Shared UI/runtime capability registry. Omitted settings use provider/model defaults. */
export declare const API_PROVIDER_SCHEMAS: Record<string, SettingSchema[]>;
export declare function modelSettingsSchema(backend: AgentBackend): SettingSchema[];
export declare function credentialIssues(value: unknown): string[];
export declare function assertNoCredentials(value: unknown): void;
export declare function validateAgent(agent: AgentRecord): string[];
/** Remove only this agent's node instances and their incident edges. */
export declare function removeAgentNodes(workflow: WorkflowDefinition, agentId: string): WorkflowDefinition;
export {};
