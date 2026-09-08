/**
 * Persistence / API layer for the workflow editor.
 *
 * This is the ONLY place that knows where workflows and agents are stored.
 * The current implementation is a browser-localStorage mock so the editor
 * works before the backend exists; swap `workflowService` for a real HTTP
 * implementation (same interface) when the backend API is available:
 *
 *   getWorkflow()                      → GET    /api/workflow
 *   saveWorkflow(workflow)             → PUT    /api/workflow
 *   listAgents()                       → GET    /api/agents
 *   createAgent(agent)                 → POST   /api/agents
 *   updateAgent(agentId, patch)        → PATCH  /api/agents/:id
 *   deleteAgent(agentId)               → DELETE /api/agents/:id
 */

import {
  AgentRecord,
  WorkflowDefinition,
  createAgentRecord,
  migrateAgentRecord,
  nowIso,
  uid,
} from "@/lib/workflow/types";
import { publicAgent } from "@/lib/publicAgent";

const WORKFLOW_KEY = "agent-studio.workflow.v1";
const AGENTS_KEY = "agent-studio.agents.v1";

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    throw new Error("Could not read Studio storage. Check browser storage access and retry.");
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("Could not save to Studio storage. Check storage access or available space.");
  }
}

export interface CreateAgentInput {
  name?: string;
  model?: string;
  provider?: string;
  backend?: import("@multi-agent/types").AgentBackend;
}

export const workflowService = {
  async getAgent(agentId: string): Promise<AgentRecord | null> {
    return (await this.listAgents()).find((agent) => agent.id === agentId) ?? null;
  },

  async listWorkflows(): Promise<WorkflowDefinition[]> {
    const workflow = await this.getWorkflow();
    return workflow ? [workflow] : [];
  },
  async getWorkflow(): Promise<WorkflowDefinition | null> {
    return readJson<WorkflowDefinition>(WORKFLOW_KEY);
  },

  async saveWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
    const stamped: WorkflowDefinition = { ...definition, updatedAt: nowIso() };
    writeJson(WORKFLOW_KEY, stamped);
    return stamped;
  },

  async listAgents(): Promise<AgentRecord[]> {
    const raw = readJson<unknown[]>(AGENTS_KEY) ?? [];
    const agents = raw.map(publicAgent);
    const needsMigration = raw.some(
      (item) => !item || typeof item !== "object" || !("backend" in (item as object))
    );
    if (needsMigration && agents.length > 0) writeJson(AGENTS_KEY, agents);
    return agents;
  },

  async createAgent(input?: CreateAgentInput): Promise<AgentRecord> {
    const agent = createAgentRecord(input);
    const agents = (await this.listAgents()).concat(agent);
    writeJson(AGENTS_KEY, agents);
    return agent;
  },

  async updateAgent(
    agentId: string,
    patch: Partial<Omit<AgentRecord, "id" | "createdAt">>
  ): Promise<AgentRecord> {
    const agents = await this.listAgents();
    const index = agents.findIndex((a) => a.id === agentId);
    if (index === -1) {
      throw new Error(`Agent ${agentId} not found`);
    }
    const updated = migrateAgentRecord({
      ...agents[index],
      ...patch,
      updatedAt: nowIso(),
    });
    agents[index] = updated;
    writeJson(AGENTS_KEY, agents);
    return updated;
  },

  async deleteAgent(agentId: string): Promise<void> {
    const agents = await this.listAgents();
    writeJson(
      AGENTS_KEY,
      agents.filter((a) => a.id !== agentId)
    );
  },
};

/** Dangling-reference guard used by the editor when cleaning up agents. */
export function findUnreferencedAgentIds(
  definition: WorkflowDefinition,
  agents: AgentRecord[]
): string[] {
  const referenced = new Set(
    definition.nodes
      .filter((n) => n.type === "agent")
      .map((n) => (n.config as { agentId?: string | null }).agentId)
      .filter((id): id is string => Boolean(id))
  );
  return agents.filter((a) => !referenced.has(a.id)).map((a) => a.id);
}

// Re-exported so the swap-to-backend layer has stable id generation too.
export { uid as generateId };
