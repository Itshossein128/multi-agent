import { assertNoCredentials, createToolRecord, migrateToolRecord, nowIso, removeToolNodes, uid, type ToolRecord } from "@multi-agent/types";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";
import { requireResource } from "./resource";

export class StudioToolService {
  constructor(private readonly store: StudioStore) {}
  list(principal: RequestPrincipal) { return this.store.listTools(principal); }
  async get(id: string, principal: RequestPrincipal) { return requireResource(await this.store.getTool(id, principal), "Tool"); }
  async create(body: Parameters<typeof createToolRecord>[0], principal: RequestPrincipal) {
    assertNoCredentials(body); const tool = createToolRecord(body);
    return this.store.saveTool({ ...tool, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false }, principal);
  }
  async duplicate(id: string, principal: RequestPrincipal) {
    const original = await this.get(id, principal); const stamp = nowIso();
    return this.store.saveTool({ ...structuredClone(original), id: uid("tool"), name: `${original.name} (copy)`, ownerId: principal.userId,
      tenantId: principal.tenantId, isSystem: false, createdAt: stamp, updatedAt: stamp }, principal);
  }
  async update(id: string, patch: Partial<Omit<ToolRecord, "id" | "createdAt">>, principal: RequestPrincipal) {
    assertNoCredentials(patch); const original = await this.get(id, principal);
    if (original.isSystem) throw new ApiError(403, "Cannot modify system tool");
    return this.store.saveTool({ ...migrateToolRecord({ ...original, ...patch }), ...patch, id: original.id, ownerId: original.ownerId,
      tenantId: original.tenantId, isSystem: false, createdAt: original.createdAt, updatedAt: nowIso() }, principal);
  }
  async delete(id: string, removeReferences: boolean, principal: RequestPrincipal) {
    const original = await this.get(id, principal);
    if (original.isSystem) throw new ApiError(403, "Cannot delete system tool");
    const [workflows, agents] = await Promise.all([this.store.listWorkflows(principal), this.store.listAgents(principal)]);
    const referencingWorkflows = workflows.filter((workflow) => workflow.nodes.some((node) => node.type === "tool" && (node.config as { toolId?: string | null }).toolId === id));
    const referencingAgents = agents.filter((agent) => agent.tools.includes(id));
    if ((referencingWorkflows.length || referencingAgents.length) && !removeReferences) throw new ApiError(409, "Remove this tool’s nodes in the Graph Editor and agent assignments before deleting the tool.");
    if (!removeReferences) return this.store.deleteTool(id, principal);
    await this.store.transaction(async (transaction) => {
      for (const workflow of referencingWorkflows) await transaction.saveWorkflow({ ...removeToolNodes(workflow, id), updatedAt: nowIso() }, principal);
      for (const agent of referencingAgents) await transaction.saveAgent({ ...agent, tools: agent.tools.filter((toolId) => toolId !== id), updatedAt: nowIso() }, principal);
      await transaction.deleteTool(id, principal);
    });
  }
}
