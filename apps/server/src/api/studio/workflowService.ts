import { assertNoCredentials, createEmptyDefinition, deserializeWorkflowDefinition, nowIso, type WorkflowDefinition } from "@multi-agent/types";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError, isOwnershipError } from "../shared/http";
import { requireResource } from "./resource";

export class WorkflowService {
  constructor(private readonly store: StudioStore) {}
  list(principal: RequestPrincipal) { return this.store.listWorkflows(principal); }
  async get(id: string, principal: RequestPrincipal) { return requireResource(await this.store.getWorkflow(id, principal), "Workflow"); }
  async save(id: string, body: WorkflowDefinition, principal: RequestPrincipal) {
    let definition: WorkflowDefinition;
    try { definition = deserializeWorkflowDefinition(body); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid workflow definition"); }
    if (definition.id !== id) throw new ApiError(400, "Workflow id mismatch");
    assertNoCredentials(definition);
    try {
      return await this.store.saveWorkflow({ ...definition, id, ownerId: principal.userId, tenantId: principal.tenantId, updatedAt: definition.updatedAt ?? nowIso() }, principal);
    } catch (error) {
      if (isOwnershipError(error)) throw new ApiError(404, "Workflow not found");
      throw error;
    }
  }
  async create(body: { name?: string; workflow?: WorkflowDefinition }, principal: RequestPrincipal) {
    let definition: WorkflowDefinition;
    try { definition = body.workflow ? deserializeWorkflowDefinition(body.workflow) : createEmptyDefinition(body.name ?? "Untitled Workflow"); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid workflow definition"); }
    assertNoCredentials(definition);
    return this.store.saveWorkflow({ ...definition, ownerId: principal.userId, tenantId: principal.tenantId }, principal);
  }
  async delete(id: string, principal: RequestPrincipal) { await this.get(id, principal); await this.store.deleteWorkflow(id, principal); }
}
