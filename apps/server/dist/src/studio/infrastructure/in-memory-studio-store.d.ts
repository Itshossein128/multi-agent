import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import type { StudioPrincipal, StudioStore, StudioTask, StudioWorkspaceImport } from "../contracts";
export declare class InMemoryStudioStore implements StudioStore {
    private workflows;
    private agents;
    private tools;
    private tasks;
    transaction<T>(operation: (store: StudioStore) => Promise<T>): Promise<T>;
    listWorkflows(principal?: StudioPrincipal): Promise<WorkflowDefinition[]>;
    getWorkflow(id: string, principal?: StudioPrincipal): Promise<WorkflowDefinition | null>;
    saveWorkflow(definition: WorkflowDefinition, principal?: StudioPrincipal): Promise<WorkflowDefinition>;
    deleteWorkflow(id: string, principal?: StudioPrincipal): Promise<void>;
    listAgents(principal?: StudioPrincipal): Promise<AgentRecord[]>;
    getAgent(id: string, principal?: StudioPrincipal): Promise<AgentRecord | null>;
    saveAgent(agent: AgentRecord, principal?: StudioPrincipal): Promise<AgentRecord>;
    deleteAgent(id: string, principal?: StudioPrincipal): Promise<void>;
    listTools(principal?: StudioPrincipal): Promise<ToolRecord[]>;
    getTool(id: string, principal?: StudioPrincipal): Promise<ToolRecord | null>;
    saveTool(tool: ToolRecord, principal?: StudioPrincipal): Promise<ToolRecord>;
    deleteTool(id: string, principal?: StudioPrincipal): Promise<void>;
    listTasks(principal?: StudioPrincipal): Promise<StudioTask[]>;
    getTask(id: string, principal?: StudioPrincipal): Promise<StudioTask | null>;
    saveTask(task: StudioTask, principal?: StudioPrincipal): Promise<StudioTask>;
    deleteTask(id: string, principal?: StudioPrincipal): Promise<void>;
    importWorkspace(workspace: StudioWorkspaceImport, principal?: StudioPrincipal): Promise<void>;
}
