import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import type {
  StudioEntityStatusFilter,
  StudioPrincipal,
  StudioProject,
  StudioStore,
  StudioTask,
  StudioWorkspace,
  StudioWorkspaceImport,
} from "../contracts";

function matchesStatus(status: StudioProject["status"], filter: StudioEntityStatusFilter = "active"): boolean {
  if (filter === "all") return true;
  return status === filter;
}

export class InMemoryStudioStore implements StudioStore {
  private workflows = new Map<string, WorkflowDefinition>();
  private agents = new Map<string, AgentRecord>();
  private tools = new Map<string, ToolRecord>();
  private tasks = new Map<string, StudioTask>();
  private projects = new Map<string, StudioProject>();
  private workspaces = new Map<string, StudioWorkspace>();

  async transaction<T>(operation: (store: StudioStore) => Promise<T>): Promise<T> {
    const snapshot = {
      workflows: new Map(structuredClone([...this.workflows])),
      agents: new Map(structuredClone([...this.agents])),
      tools: new Map(structuredClone([...this.tools])),
      tasks: new Map(structuredClone([...this.tasks])),
      projects: new Map(structuredClone([...this.projects])),
      workspaces: new Map(structuredClone([...this.workspaces])),
    };
    try {
      return await operation(this);
    } catch (error) {
      this.workflows = snapshot.workflows;
      this.agents = snapshot.agents;
      this.tools = snapshot.tools;
      this.tasks = snapshot.tasks;
      this.projects = snapshot.projects;
      this.workspaces = snapshot.workspaces;
      throw error;
    }
  }

  async listWorkflows(principal?: StudioPrincipal) {
    return [...this.workflows.values()]
      .filter((wf) => {
        if (!principal) return true;
        return Boolean(wf.tenantId && wf.ownerId && wf.tenantId === principal.tenantId && wf.ownerId === principal.userId);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getWorkflow(id: string, principal?: StudioPrincipal) {
    const wf = this.workflows.get(id);
    if (!wf) return null;
    if (principal && (!wf.tenantId || !wf.ownerId || wf.tenantId !== principal.tenantId || wf.ownerId !== principal.userId)) {
      return null;
    }
    return structuredClone(wf);
  }

  async saveWorkflow(definition: WorkflowDefinition, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.workflows.get(definition.id);
      if (existing && (!existing.tenantId || !existing.ownerId || existing.tenantId !== principal.tenantId || existing.ownerId !== principal.userId)) {
        throw new Error("Access denied to workflow");
      }
      definition = { ...definition, ownerId: principal.userId, tenantId: principal.tenantId };
    }
    this.workflows.set(definition.id, structuredClone(definition));
    return structuredClone(definition);
  }

  async deleteWorkflow(id: string, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.workflows.get(id);
      if (existing && (!existing.tenantId || !existing.ownerId || existing.tenantId !== principal.tenantId || existing.ownerId !== principal.userId)) {
        throw new Error("Access denied to workflow");
      }
    }
    this.workflows.delete(id);
  }

  async listAgents(principal?: StudioPrincipal) {
    return [...this.agents.values()]
      .filter((agent) => {
        if (!principal) return true;
        if (agent.isSystem) return true;
        return Boolean(agent.tenantId && agent.tenantId === principal.tenantId && (!agent.ownerId || agent.ownerId === principal.userId));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getAgent(id: string, principal?: StudioPrincipal) {
    const agent = this.agents.get(id);
    if (!agent) return null;
    if (principal) {
      if (agent.isSystem) return structuredClone(agent);
      if (!agent.tenantId || agent.tenantId !== principal.tenantId) return null;
      if (agent.ownerId && agent.ownerId !== principal.userId) return null;
    }
    return structuredClone(agent);
  }

  async saveAgent(agent: AgentRecord, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.agents.get(agent.id);
      if (existing) {
        if (existing.isSystem) throw new Error("Cannot modify system agent");
        if (!existing.tenantId || existing.tenantId !== principal.tenantId || (existing.ownerId && existing.ownerId !== principal.userId)) {
          throw new Error("Access denied to agent");
        }
      }
      agent = { ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
    }
    this.agents.set(agent.id, structuredClone(agent));
    return structuredClone(agent);
  }

  async deleteAgent(id: string, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.agents.get(id);
      if (existing) {
        if (existing.isSystem) throw new Error("Cannot delete system agent");
        if (!existing.tenantId || existing.tenantId !== principal.tenantId || (existing.ownerId && existing.ownerId !== principal.userId)) {
          throw new Error("Access denied to agent");
        }
      }
    }
    this.agents.delete(id);
  }

  async listTools(principal?: StudioPrincipal) {
    return [...this.tools.values()]
      .filter((tool) => {
        if (!principal) return true;
        if (tool.isSystem) return true;
        return Boolean(tool.tenantId && tool.tenantId === principal.tenantId && (!tool.ownerId || tool.ownerId === principal.userId));
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getTool(id: string, principal?: StudioPrincipal) {
    const tool = this.tools.get(id);
    if (!tool) return null;
    if (principal) {
      if (tool.isSystem) return structuredClone(tool);
      if (!tool.tenantId || tool.tenantId !== principal.tenantId) return null;
      if (tool.ownerId && tool.ownerId !== principal.userId) return null;
    }
    return structuredClone(tool);
  }

  async saveTool(tool: ToolRecord, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.tools.get(tool.id);
      if (existing) {
        if (existing.isSystem) throw new Error("Cannot modify system tool");
        if (!existing.tenantId || existing.tenantId !== principal.tenantId || (existing.ownerId && existing.ownerId !== principal.userId)) {
          throw new Error("Access denied to tool");
        }
      }
      tool = { ...tool, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false };
    }
    this.tools.set(tool.id, structuredClone(tool));
    return structuredClone(tool);
  }

  async deleteTool(id: string, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.tools.get(id);
      if (existing) {
        if (existing.isSystem) throw new Error("Cannot delete system tool");
        if (!existing.tenantId || existing.tenantId !== principal.tenantId || (existing.ownerId && existing.ownerId !== principal.userId)) {
          throw new Error("Access denied to tool");
        }
      }
    }
    this.tools.delete(id);
  }

  async listTasks(principal?: StudioPrincipal) {
    return [...this.tasks.values()]
      .filter((task) => {
        if (!principal) return true;
        return Boolean(task.tenantId && task.tenantId === principal.tenantId);
      })
      .sort((a, b) => ((b.updatedAt ?? b.createdAt) || "").localeCompare((a.updatedAt ?? a.createdAt) || ""))
      .map((task) => structuredClone(task));
  }

  async getTask(id: string, principal?: StudioPrincipal) {
    const task = this.tasks.get(id);
    if (!task) return null;
    if (principal && (!task.tenantId || task.tenantId !== principal.tenantId)) {
      return null;
    }
    return structuredClone(task);
  }

  async listTasksByWorkspace(workspaceId: string, principal?: StudioPrincipal) {
    return (await this.listTasks(principal)).filter((task) => task.workspaceId === workspaceId);
  }

  async listTasksByProject(projectId: string, principal?: StudioPrincipal) {
    return (await this.listTasks(principal)).filter((task) => (task.projectIds ?? []).includes(projectId));
  }

  async saveTask(task: StudioTask, principal?: StudioPrincipal) {
    const assignedAgents = Array.isArray(task.assignedAgents)
      ? task.assignedAgents
      : task.assignedAgent
        ? [task.assignedAgent]
        : [];
    const assignedAgent = task.assignedAgent ?? (assignedAgents[0] ?? null);
    const updatedAt = task.updatedAt ?? task.createdAt ?? new Date().toISOString();
    const projectIds = Array.isArray(task.projectIds) ? [...new Set(task.projectIds.filter(Boolean))] : [];
    const workspaceId = task.workspaceId;
    if (!workspaceId) throw new Error("Task workspaceId is required");
    if (!projectIds.length) throw new Error("Task projectIds must include at least one project");
    let record: StudioTask = {
      ...task,
      assignedAgent,
      assignedAgents,
      workflowId: task.workflowId ?? null,
      startedAt: task.startedAt ?? null,
      completedAt: task.completedAt ?? null,
      parentTaskId: task.parentTaskId ?? null,
      runId: task.runId ?? null,
      lastError: task.lastError ?? null,
      metadata: task.metadata ?? {},
      workspaceId,
      projectIds,
      updatedAt,
    };
    if (principal) {
      const existing = this.tasks.get(task.id);
      if (existing && (!existing.tenantId || existing.tenantId !== principal.tenantId)) {
        throw new Error("Access denied to task");
      }
      record = { ...record, tenantId: principal.tenantId, ownerId: task.ownerId ?? principal.userId };
    }
    this.tasks.set(task.id, structuredClone(record));
    return structuredClone(record);
  }

  async deleteTask(id: string, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.tasks.get(id);
      if (existing && (!existing.tenantId || existing.tenantId !== principal.tenantId)) {
        throw new Error("Access denied to task");
      }
    }
    this.tasks.delete(id);
  }

  async listProjects(principal?: StudioPrincipal, status: StudioEntityStatusFilter = "active") {
    return [...this.projects.values()]
      .filter((project) => {
        if (principal && project.tenantId !== principal.tenantId) return false;
        return matchesStatus(project.status, status);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((project) => structuredClone(project));
  }

  async getProject(id: string, principal?: StudioPrincipal) {
    const project = this.projects.get(id);
    if (!project) return null;
    if (principal && project.tenantId !== principal.tenantId) return null;
    return structuredClone(project);
  }

  async saveProject(project: StudioProject, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.projects.get(project.id);
      if (existing && existing.tenantId !== principal.tenantId) throw new Error("Access denied to project");
      project = { ...project, tenantId: principal.tenantId, ownerId: project.ownerId || principal.userId };
    }
    this.projects.set(project.id, structuredClone(project));
    return structuredClone(project);
  }

  async listWorkspaces(principal?: StudioPrincipal, status: StudioEntityStatusFilter = "active") {
    return [...this.workspaces.values()]
      .filter((workspace) => {
        if (principal && workspace.tenantId !== principal.tenantId) return false;
        return matchesStatus(workspace.status, status);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((workspace) => structuredClone(workspace));
  }

  async getWorkspace(id: string, principal?: StudioPrincipal) {
    const workspace = this.workspaces.get(id);
    if (!workspace) return null;
    if (principal && workspace.tenantId !== principal.tenantId) return null;
    return structuredClone(workspace);
  }

  async saveWorkspace(workspace: StudioWorkspace, principal?: StudioPrincipal) {
    if (principal) {
      const existing = this.workspaces.get(workspace.id);
      if (existing && existing.tenantId !== principal.tenantId) throw new Error("Access denied to workspace");
      workspace = { ...workspace, tenantId: principal.tenantId, ownerId: workspace.ownerId || principal.userId };
    }
    this.workspaces.set(workspace.id, structuredClone(workspace));
    return structuredClone(workspace);
  }

  async importWorkspace(workspace: StudioWorkspaceImport, principal?: StudioPrincipal) {
    for (const workflow of workspace.workflows) {
      const definition = principal
        ? { ...workflow, ownerId: principal.userId, tenantId: principal.tenantId }
        : workflow;
      this.workflows.set(definition.id, structuredClone(definition));
    }
    for (const agent of workspace.agents) {
      const record = principal
        ? { ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false }
        : agent;
      this.agents.set(record.id, structuredClone(record));
    }
    for (const tool of workspace.tools) {
      const record = principal
        ? { ...tool, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false }
        : tool;
      this.tools.set(record.id, structuredClone(record));
    }
  }
}
