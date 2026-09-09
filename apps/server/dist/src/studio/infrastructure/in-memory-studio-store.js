"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryStudioStore = void 0;
class InMemoryStudioStore {
    workflows = new Map();
    agents = new Map();
    tools = new Map();
    tasks = new Map();
    async listWorkflows() { return [...this.workflows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
    async getWorkflow(id) { return structuredClone(this.workflows.get(id) ?? null); }
    async saveWorkflow(definition) { this.workflows.set(definition.id, structuredClone(definition)); return structuredClone(definition); }
    async deleteWorkflow(id) { this.workflows.delete(id); }
    async listAgents() { return [...this.agents.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
    async getAgent(id) { return structuredClone(this.agents.get(id) ?? null); }
    async saveAgent(agent) { this.agents.set(agent.id, structuredClone(agent)); return structuredClone(agent); }
    async deleteAgent(id) { this.agents.delete(id); }
    async listTools() { return [...this.tools.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
    async getTool(id) { return structuredClone(this.tools.get(id) ?? null); }
    async saveTool(tool) { this.tools.set(tool.id, structuredClone(tool)); return structuredClone(tool); }
    async deleteTool(id) { this.tools.delete(id); }
    async listTasks() { return [...this.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
    async getTask(id) { return structuredClone(this.tasks.get(id) ?? null); }
    async saveTask(task) { this.tasks.set(task.id, structuredClone(task)); return structuredClone(task); }
    async deleteTask(id) { this.tasks.delete(id); }
    async importWorkspace(workspace) {
        for (const workflow of workspace.workflows)
            this.workflows.set(workflow.id, structuredClone(workflow));
        for (const agent of workspace.agents)
            this.agents.set(agent.id, structuredClone(agent));
        for (const tool of workspace.tools)
            this.tools.set(tool.id, structuredClone(tool));
    }
}
exports.InMemoryStudioStore = InMemoryStudioStore;
//# sourceMappingURL=in-memory-studio-store.js.map