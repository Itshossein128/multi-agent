/** Studio persistence client. Entities live on the execution server; activeWorkflowId stays local. */
import { assertNoCredentials, createAgentRecord, createEmptyDefinition, createToolRecord, deserializeWorkflowDefinition, migrateAgentRecord, migrateToolRecord, migrateWorkflowToolNodes, nowIso, removeAgentNodes, removeToolNodes, serializeWorkflowDefinition, uid, type AgentDiagnostics, type AgentRecord, type ToolRecord, type WorkflowDefinition } from "@multi-agent/types";
import { publicAgent } from "../lib/publicAgent";

const API_URL = "/api/execution";
const ACTIVE_WORKFLOW_KEY = "agent-studio.active-workflow.v1";
const WORKSPACE_KEY = "agent-studio.workspace.v3";
const LEGACY_WORKSPACE_V2_KEY = "agent-studio.workspace.v2";
const LEGACY_WORKFLOW_KEY = "agent-studio.workflow.v1";
const LEGACY_AGENTS_KEY = "agent-studio.agents.v1";
const IMPORT_FLAG_KEY = "agent-studio.workspace-imported.v1";

interface Workspace { version: 3; activeWorkflowId: string | null; workflows: WorkflowDefinition[]; agents: AgentRecord[]; tools: ToolRecord[] }
interface WorkspaceV2 { version: 2; activeWorkflowId: string | null; workflows: WorkflowDefinition[]; agents: AgentRecord[] }

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface WorkflowServiceDependencies {
  /** Injectable only to make browser-client contract tests hermetic. */
  fetch?: typeof fetch;
  storage?: BrowserStorage;
  apiUrl?: string;
}

function upgradeFromV2(v2: WorkspaceV2): Workspace {
  const tools: ToolRecord[] = [];
  const workflows = v2.workflows.map((workflow) => {
    const { definition, newTools } = migrateWorkflowToolNodes(workflow, tools);
    tools.push(...newTools);
    return definition;
  });
  return { version: 3, activeWorkflowId: v2.activeWorkflowId, workflows, agents: v2.agents, tools };
}

function readLegacyWorkspace(storage: BrowserStorage | undefined): Workspace | null {
  if (!storage) return null;
  const raw = storage.getItem(WORKSPACE_KEY);
  if (raw) {
    const workspace = JSON.parse(raw) as Workspace;
    if (workspace.version !== 3 || !Array.isArray(workspace.agents) || !Array.isArray(workspace.workflows) || !Array.isArray(workspace.tools)) return null;
    assertNoCredentials(workspace);
    return workspace;
  }
  const rawV2 = storage.getItem(LEGACY_WORKSPACE_V2_KEY);
  if (rawV2) return upgradeFromV2(JSON.parse(rawV2) as WorkspaceV2);
  const oldWorkflow = storage.getItem(LEGACY_WORKFLOW_KEY);
  const oldAgents = storage.getItem(LEGACY_AGENTS_KEY);
  if (!oldWorkflow && !oldAgents) return null;
  const workflow = oldWorkflow ? JSON.parse(oldWorkflow) as WorkflowDefinition : null;
  const agents = oldAgents ? (JSON.parse(oldAgents) as unknown[]).map(publicAgent) : [];
  const tools: ToolRecord[] = [];
  const migratedWorkflow = workflow ? migrateWorkflowToolNodes(workflow, tools) : null;
  if (migratedWorkflow) tools.push(...migratedWorkflow.newTools);
  return { version: 3, activeWorkflowId: migratedWorkflow?.definition.id ?? null, workflows: migratedWorkflow ? [migratedWorkflow.definition] : [], agents, tools };
}

export interface CreateAgentInput { name?: string; model?: string; provider?: string; backend?: AgentRecord["backend"] }

/**
 * Creates a Studio client. The application uses the default instance below;
 * injected transports/storage let tests exercise the exact HTTP contract with
 * an isolated in-memory router rather than a process running on localhost.
 */
export function createWorkflowService(dependencies: WorkflowServiceDependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const apiUrl = dependencies.apiUrl ?? API_URL;
  const storage = () => dependencies.storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  let importPromise: Promise<void> | null = null;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(`${apiUrl}/studio${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `Studio request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async function ensureImported(): Promise<void> {
    const currentStorage = storage();
    if (!currentStorage || currentStorage.getItem(IMPORT_FLAG_KEY) === "1") return;
    if (!importPromise) {
      importPromise = (async () => {
        const legacy = readLegacyWorkspace(currentStorage);
        if (legacy && (legacy.workflows.length || legacy.agents.length || legacy.tools.length)) {
          await request("/workspace/import", { method: "POST", body: JSON.stringify({ workflows: legacy.workflows, agents: legacy.agents, tools: legacy.tools }) });
          if (legacy.activeWorkflowId) currentStorage.setItem(ACTIVE_WORKFLOW_KEY, legacy.activeWorkflowId);
        }
        currentStorage.setItem(IMPORT_FLAG_KEY, "1");
        currentStorage.removeItem(WORKSPACE_KEY);
        currentStorage.removeItem(LEGACY_WORKSPACE_V2_KEY);
        currentStorage.removeItem(LEGACY_WORKFLOW_KEY);
        currentStorage.removeItem(LEGACY_AGENTS_KEY);
      })().catch((error) => { importPromise = null; throw error; });
    }
    await importPromise;
  }

  const getActiveWorkflowId = () => storage()?.getItem(ACTIVE_WORKFLOW_KEY) ?? null;
  const setActiveWorkflowId = (id: string | null) => {
    const currentStorage = storage();
    if (!currentStorage) return;
    if (id) currentStorage.setItem(ACTIVE_WORKFLOW_KEY, id); else currentStorage.removeItem(ACTIVE_WORKFLOW_KEY);
  };

  return {
    async getAgent(agentId: string): Promise<AgentRecord | null> {
      await ensureImported();
      try {
        const agent = await request<AgentRecord>(`/agents/${encodeURIComponent(agentId)}`);
        return publicAgent(agent);
      } catch {
        return null;
      }
    },
    async listAgents(): Promise<AgentRecord[]> {
      await ensureImported();
      return (await request<AgentRecord[]>("/agents")).map(publicAgent);
    },
    async getAgentDiagnostics(agentId: string): Promise<AgentDiagnostics> {
      await ensureImported();
      return request<AgentDiagnostics>(`/agents/${encodeURIComponent(agentId)}/diagnostics`);
    },
    async listWorkflows(): Promise<WorkflowDefinition[]> {
      await ensureImported();
      const workflows = await request<unknown[]>("/workflows");
      return workflows.map(deserializeWorkflowDefinition);
    },
    async getWorkflow(workflowId?: string): Promise<WorkflowDefinition | null> {
      await ensureImported();
      const id = workflowId ?? getActiveWorkflowId();
      if (!id) {
        const workflows = await request<WorkflowDefinition[]>("/workflows");
        return workflows[0] ?? null;
      }
      try {
        return deserializeWorkflowDefinition(await request(`/workflows/${encodeURIComponent(id)}`));
      } catch {
        return null;
      }
    },
    async saveWorkflow(definition: WorkflowDefinition): Promise<WorkflowDefinition> {
      await ensureImported();
      assertNoCredentials(definition);
      const stamped = { ...definition, updatedAt: nowIso() };
      const saved = deserializeWorkflowDefinition(await request<unknown>(`/workflows/${encodeURIComponent(stamped.id)}`, { method: "PUT", body: JSON.stringify(serializeWorkflowDefinition(stamped)) }));
      setActiveWorkflowId(saved.id);
      return saved;
    },
    async createWorkflow(name = "Untitled Workflow"): Promise<WorkflowDefinition> {
      await ensureImported();
      const created = await request<WorkflowDefinition>("/workflows", { method: "POST", body: JSON.stringify({ name }) });
      setActiveWorkflowId(created.id);
      return created;
    },
    async createAgent(input?: CreateAgentInput): Promise<AgentRecord> {
      await ensureImported();
      assertNoCredentials(input);
      return publicAgent(await request<AgentRecord>("/agents", { method: "POST", body: JSON.stringify(input ?? {}) }));
    },
    async duplicateAgent(agentId: string): Promise<AgentRecord> {
      await ensureImported();
      return publicAgent(await request<AgentRecord>(`/agents/${encodeURIComponent(agentId)}/duplicate`, { method: "POST", body: "{}" }));
    },
    async updateAgent(agentId: string, patch: Partial<Omit<AgentRecord, "id" | "createdAt">>): Promise<AgentRecord> {
      await ensureImported();
      assertNoCredentials(patch);
      return publicAgent(await request<AgentRecord>(`/agents/${encodeURIComponent(agentId)}`, { method: "PATCH", body: JSON.stringify(patch) }));
    },
    async deleteAgent(agentId: string, options?: { removeReferences?: boolean }): Promise<void> {
      await ensureImported();
      const query = options?.removeReferences ? "?removeReferences=true" : "";
      await request(`/agents/${encodeURIComponent(agentId)}${query}`, { method: "DELETE" });
    },

    async getTool(toolId: string): Promise<ToolRecord | null> {
      await ensureImported();
      try { return await request(`/tools/${encodeURIComponent(toolId)}`); } catch { return null; }
    },
    async listTools(): Promise<ToolRecord[]> {
      await ensureImported();
      return request("/tools");
    },
    async createTool(input?: Parameters<typeof createToolRecord>[0]): Promise<ToolRecord> {
      await ensureImported();
      assertNoCredentials(input);
      return request("/tools", { method: "POST", body: JSON.stringify(input ?? {}) });
    },
    async duplicateTool(toolId: string): Promise<ToolRecord> {
      await ensureImported();
      return request(`/tools/${encodeURIComponent(toolId)}/duplicate`, { method: "POST", body: "{}" });
    },
    async updateTool(toolId: string, patch: Partial<Omit<ToolRecord, "id" | "createdAt">>): Promise<ToolRecord> {
      await ensureImported();
      assertNoCredentials(patch);
      return request(`/tools/${encodeURIComponent(toolId)}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    async deleteTool(toolId: string, options?: { removeReferences?: boolean }): Promise<void> {
      await ensureImported();
      const query = options?.removeReferences ? "?removeReferences=true" : "";
      await request(`/tools/${encodeURIComponent(toolId)}${query}`, { method: "DELETE" });
    },
    async importWorkspace(workspace: { workflows?: WorkflowDefinition[]; agents?: AgentRecord[]; tools?: ToolRecord[] }): Promise<void> {
      await ensureImported();
      assertNoCredentials(workspace);
      await request("/workspace/import", {
        method: "POST",
        body: JSON.stringify({
          workflows: (workspace.workflows ?? []).map(serializeWorkflowDefinition),
          agents: workspace.agents ?? [],
          tools: workspace.tools ?? [],
        }),
      });
      const firstWorkflowId = workspace.workflows?.[0]?.id;
      if (firstWorkflowId) setActiveWorkflowId(firstWorkflowId);
    },
  };
}

export const workflowService = createWorkflowService();

export function findUnreferencedAgentIds(definition: WorkflowDefinition, agents: AgentRecord[]): string[] {
  const referenced = new Set(definition.nodes.filter((node) => node.type === "agent").map((node) => (node.config as { agentId?: string }).agentId));
  return agents.filter((agent) => !referenced.has(agent.id)).map((agent) => agent.id);
}

export function findToolUsages(toolId: string, agents: AgentRecord[], workflows: WorkflowDefinition[]) {
  const assignedAgents = agents.filter((agent) => agent.tools.includes(toolId));
  const nodeUsages = workflows.flatMap((workflow) =>
    workflow.nodes
      .filter((node) => node.type === "tool" && (node.config as { toolId?: string | null }).toolId === toolId)
      .map((node) => ({ workflow, node }))
  );
  return { assignedAgents, nodeUsages };
}

export { uid as generateId, createAgentRecord, createEmptyDefinition, createToolRecord, migrateAgentRecord, migrateToolRecord, removeAgentNodes, removeToolNodes };
