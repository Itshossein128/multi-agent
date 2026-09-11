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
  updatedAt?: string;
  ownerId?: string;
  tenantId?: string;
}

export interface StudioWorkspaceImport {
  workflows: WorkflowDefinition[];
  agents: AgentRecord[];
  tools: ToolRecord[];
}

export interface StudioPrincipal {
  userId: string;
  tenantId: string;
}

/**
 * Trusted backend boundary for durable Studio entities.
 * Adapters must not silently fall back between postgres and in-memory.
 */
export interface StudioStore {
  /** Execute related registry/workflow changes atomically. */
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

  /** Upsert entire workspace (used by one-shot browser import). */
  importWorkspace(workspace: StudioWorkspaceImport, principal?: StudioPrincipal): Promise<void>;
}
