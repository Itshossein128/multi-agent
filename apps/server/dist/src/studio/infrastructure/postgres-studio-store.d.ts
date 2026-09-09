import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import type { PgPool } from "../../memory/infrastructure";
import type { StudioStore, StudioTask, StudioWorkspaceImport } from "../contracts";
export declare class PostgresStudioStore implements StudioStore {
    private readonly pool;
    constructor(pool: PgPool);
    listWorkflows(): Promise<WorkflowDefinition[]>;
    getWorkflow(id: string): Promise<WorkflowDefinition | null>;
    saveWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition>;
    deleteWorkflow(id: string): Promise<void>;
    listAgents(): Promise<AgentRecord[]>;
    getAgent(id: string): Promise<AgentRecord | null>;
    saveAgent(agent: AgentRecord): Promise<AgentRecord>;
    deleteAgent(id: string): Promise<void>;
    listTools(): Promise<ToolRecord[]>;
    getTool(id: string): Promise<ToolRecord | null>;
    saveTool(tool: ToolRecord): Promise<ToolRecord>;
    deleteTool(id: string): Promise<void>;
    listTasks(): Promise<StudioTask[]>;
    getTask(id: string): Promise<StudioTask | null>;
    saveTask(task: StudioTask): Promise<StudioTask>;
    deleteTask(id: string): Promise<void>;
    importWorkspace(workspace: StudioWorkspaceImport): Promise<void>;
}
