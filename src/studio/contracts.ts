import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";

/** Task board record persisted by the Studio store (shared with the web task board model). */
export interface StudioTask {
  id: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  status: "todo" | "planning" | "in_progress" | "waiting_tool" | "review" | "done" | "failed";
  assignedAgent: string | null;
  dependencies: string[];
  output: string | null;
  retryCount: number;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudioWorkspaceImport {
  workflows: WorkflowDefinition[];
  agents: AgentRecord[];
  tools: ToolRecord[];
}

/**
 * Trusted backend boundary for durable Studio entities.
 * Adapters must not silently fall back between postgres and in-memory.
 */
export interface StudioStore {
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

  /** Upsert entire workspace (used by one-shot browser import). */
  importWorkspace(workspace: StudioWorkspaceImport): Promise<void>;
}
