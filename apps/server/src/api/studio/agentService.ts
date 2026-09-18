import { assertNoCredentials, createAgentRecord, migrateAgentRecord, nowIso, removeAgentNodes, uid, type AgentRecord } from "@multi-agent/types";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";
import { requireResource } from "./resource";

export class AgentService {
  constructor(private readonly store: StudioStore) {}
  list(principal: RequestPrincipal) { return this.store.listAgents(principal); }
  async get(id: string, principal: RequestPrincipal) { return requireResource(await this.store.getAgent(id, principal), "Agent"); }
  async create(body: Partial<AgentRecord> & { name?: string }, principal: RequestPrincipal) {
    assertNoCredentials(body);
    const agent = body.id ? migrateAgentRecord(body as AgentRecord) : createAgentRecord(body);
    return this.store.saveAgent({ ...agent, ownerId: principal.userId, tenantId: principal.tenantId, isSystem: false }, principal);
  }
  async duplicate(id: string, principal: RequestPrincipal) {
    const original = await this.get(id, principal); const stamp = nowIso();
    return this.store.saveAgent({ ...structuredClone(original), id: uid("agent"), name: `${original.name} (copy)`, ownerId: principal.userId,
      tenantId: principal.tenantId, isSystem: false, createdAt: stamp, updatedAt: stamp }, principal);
  }
  async update(id: string, patch: Partial<Omit<AgentRecord, "id" | "createdAt">>, principal: RequestPrincipal) {
    assertNoCredentials(patch); const original = await this.get(id, principal);
    if (original.isSystem) throw new ApiError(403, "Cannot modify system agent");
    return this.store.saveAgent({ ...migrateAgentRecord({ ...original, ...patch }), ...patch, id: original.id, ownerId: original.ownerId,
      tenantId: original.tenantId, isSystem: false, createdAt: original.createdAt, updatedAt: nowIso() }, principal);
  }
  async delete(id: string, removeReferences: boolean, principal: RequestPrincipal) {
    const original = await this.get(id, principal);
    if (original.isSystem) throw new ApiError(403, "Cannot delete system agent");
    const referencing = (await this.store.listWorkflows(principal)).filter((workflow) => workflow.nodes.some((node) => node.type === "agent" && (node.config as { agentId?: string }).agentId === id));
    if (referencing.length && !removeReferences) throw new ApiError(409, "Remove this agent’s nodes in the Graph Editor and save the workflows before deleting the agent.");
    if (!removeReferences) return this.store.deleteAgent(id, principal);
    try {
      await this.store.transaction(async (transaction) => {
        for (const workflow of referencing) await transaction.saveWorkflow({ ...removeAgentNodes(workflow, id), updatedAt: nowIso() }, principal);
        await transaction.deleteAgent(id, principal);
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, error instanceof Error ? error.message : String(error));
    }
  }
}
