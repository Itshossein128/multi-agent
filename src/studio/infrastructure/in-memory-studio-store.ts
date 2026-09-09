import type { AgentRecord, ToolRecord, WorkflowDefinition } from "@multi-agent/types";
import type { StudioStore, StudioTask, StudioWorkspaceImport } from "../contracts";

export class InMemoryStudioStore implements StudioStore {
  private workflows = new Map<string, WorkflowDefinition>();
  private agents = new Map<string, AgentRecord>();
  private tools = new Map<string, ToolRecord>();
  private tasks = new Map<string, StudioTask>();

  async listWorkflows() { return [...this.workflows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async getWorkflow(id: string) { return structuredClone(this.workflows.get(id) ?? null); }
  async saveWorkflow(definition: WorkflowDefinition) { this.workflows.set(definition.id, structuredClone(definition)); return structuredClone(definition); }
  async deleteWorkflow(id: string) { this.workflows.delete(id); }

  async listAgents() { return [...this.agents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async getAgent(id: string) { return structuredClone(this.agents.get(id) ?? null); }
  async saveAgent(agent: AgentRecord) { this.agents.set(agent.id, structuredClone(agent)); return structuredClone(agent); }
  async deleteAgent(id: string) { this.agents.delete(id); }

  async listTools() { return [...this.tools.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async getTool(id: string) { return structuredClone(this.tools.get(id) ?? null); }
  async saveTool(tool: ToolRecord) { this.tools.set(tool.id, structuredClone(tool)); return structuredClone(tool); }
  async deleteTool(id: string) { this.tools.delete(id); }

  async listTasks() { return [...this.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async getTask(id: string) { return structuredClone(this.tasks.get(id) ?? null); }
  async saveTask(task: StudioTask) { this.tasks.set(task.id, structuredClone(task)); return structuredClone(task); }
  async deleteTask(id: string) { this.tasks.delete(id); }

  async importWorkspace(workspace: StudioWorkspaceImport) {
    for (const workflow of workspace.workflows) this.workflows.set(workflow.id, structuredClone(workflow));
    for (const agent of workspace.agents) this.agents.set(agent.id, structuredClone(agent));
    for (const tool of workspace.tools) this.tools.set(tool.id, structuredClone(tool));
  }
}
