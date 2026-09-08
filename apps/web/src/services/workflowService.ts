/** Browser persistence boundary. A single versioned document makes registry/graph changes atomic. */
import { assertNoCredentials, createAgentRecord, createEmptyDefinition, migrateAgentRecord, nowIso, removeAgentNodes, uid, type AgentRecord, type WorkflowDefinition } from "@multi-agent/types";
import { publicAgent } from "../lib/publicAgent";

const WORKSPACE_KEY = "agent-studio.workspace.v2";
const LEGACY_WORKFLOW_KEY = "agent-studio.workflow.v1";
const LEGACY_AGENTS_KEY = "agent-studio.agents.v1";
interface Workspace { version: 2; activeWorkflowId: string | null; workflows: WorkflowDefinition[]; agents: AgentRecord[] }

function readWorkspace(): Workspace {
  if (typeof window === "undefined") throw new Error("Studio storage is available only in the browser.");
  const raw = window.localStorage.getItem(WORKSPACE_KEY);
  if (raw) {
    const workspace = JSON.parse(raw) as Workspace;
    if (workspace.version !== 2 || !Array.isArray(workspace.agents) || !Array.isArray(workspace.workflows)) throw new Error("Studio storage has an unsupported format.");
    assertNoCredentials(workspace);
    return workspace;
  }
  const oldWorkflow = window.localStorage.getItem(LEGACY_WORKFLOW_KEY);
  const oldAgents = window.localStorage.getItem(LEGACY_AGENTS_KEY);
  const workflow = oldWorkflow ? JSON.parse(oldWorkflow) as WorkflowDefinition : null;
  const agents = oldAgents ? (JSON.parse(oldAgents) as unknown[]).map(publicAgent) : [];
  const workspace: Workspace = { version: 2, activeWorkflowId: workflow?.id ?? null, workflows: workflow ? [workflow] : [], agents };
  // Do not silently discard unsafe legacy workflow configuration. Keep it recoverable.
  writeWorkspace(workspace);
  window.localStorage.removeItem(LEGACY_WORKFLOW_KEY);
  window.localStorage.removeItem(LEGACY_AGENTS_KEY);
  return workspace;
}

function writeWorkspace(workspace: Workspace): void {
  assertNoCredentials(workspace);
  window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
}

export interface CreateAgentInput { name?: string; model?: string; provider?: string; backend?: AgentRecord["backend"] }

export const workflowService = {
  async getAgent(agentId: string): Promise<AgentRecord | null> {
    return readWorkspace().agents.map(publicAgent).find((agent) => agent.id === agentId) ?? null;
  },
  async listAgents(): Promise<AgentRecord[]> { return readWorkspace().agents.map(publicAgent); },
  async listWorkflows(): Promise<WorkflowDefinition[]> { return readWorkspace().workflows; },
  async getWorkflow(workflowId?: string): Promise<WorkflowDefinition | null> {
    const workspace = readWorkspace();
    return workspace.workflows.find((workflow) => workflow.id === (workflowId ?? workspace.activeWorkflowId)) ?? null;
  },
  async saveWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    assertNoCredentials(definition);
    const workspace = readWorkspace();
    const stamped = { ...definition, updatedAt: nowIso() };
    workspace.workflows = [...workspace.workflows.filter((workflow) => workflow.id !== stamped.id), stamped];
    workspace.activeWorkflowId = stamped.id;
    writeWorkspace(workspace);
    return stamped;
  },
  async createWorkflow(name = "Untitled Workflow"): Promise<WorkflowDefinition> {
    return this.saveWorkflow(createEmptyDefinition(name));
  },
  async createAgent(input?: CreateAgentInput): Promise<AgentRecord> {
    assertNoCredentials(input);
    const workspace = readWorkspace();
    const agent = createAgentRecord(input);
    workspace.agents.push(agent);
    writeWorkspace(workspace);
    return agent;
  },
  async duplicateAgent(agentId: string): Promise<AgentRecord> {
    const workspace = readWorkspace();
    const original = workspace.agents.find((agent) => agent.id === agentId);
    if (!original) throw new Error("Agent not found.");
    const copy = { ...structuredClone(original), id: uid("agent"), name: `${original.name} (copy)`, createdAt: nowIso(), updatedAt: nowIso() };
    workspace.agents.push(copy);
    writeWorkspace(workspace);
    return copy;
  },
  async updateAgent(agentId: string, patch: Partial<Omit<AgentRecord, "id" | "createdAt">>): Promise<AgentRecord> {
    // Allow incomplete drafts, but never credentials, through the graph's immediate-save path.
    assertNoCredentials(patch);
    const workspace = readWorkspace();
    const index = workspace.agents.findIndex((agent) => agent.id === agentId);
    if (index === -1) throw new Error(`Agent ${agentId} not found`);
    const original = workspace.agents[index];
    const updated = { ...migrateAgentRecord({ ...original, ...patch }), ...patch, id: original.id, createdAt: original.createdAt, updatedAt: nowIso() };
    workspace.agents[index] = updated;
    writeWorkspace(workspace);
    return updated;
  },
  async deleteAgent(agentId: string, options?: { removeReferences?: boolean }): Promise<void> {
    const workspace = readWorkspace();
    const referenced = workspace.workflows.some((workflow) => workflow.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === agentId));
    if (referenced && !options?.removeReferences) throw new Error("Remove this agent’s nodes in the Graph Editor and save the workflows before deleting the agent.");
    if (options?.removeReferences) workspace.workflows = workspace.workflows.map((workflow) => ({ ...removeAgentNodes(workflow, agentId), updatedAt: nowIso() }));
    workspace.agents = workspace.agents.filter((agent) => agent.id !== agentId);
    writeWorkspace(workspace);
  },
};

export function findUnreferencedAgentIds(definition: WorkflowDefinition, agents: AgentRecord[]): string[] {
  const referenced = new Set(definition.nodes.filter((node) => node.type === "agent").map((node) => (node.config as { agentId?: string }).agentId));
  return agents.filter((agent) => !referenced.has(agent.id)).map((agent) => agent.id);
}
export { uid as generateId };
