import { assertNoCredentials, createEmptyDefinition, nowIso, type WorkflowDefinition } from "@multi-agent/types";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError, isOwnershipError } from "../shared/http";
import { requireResource } from "./resource";

export class WorkflowService {
  constructor(private readonly store: StudioStore) {}
  list(principal: RequestPrincipal) { return this.store.listWorkflows(principal); }
  async get(id: string, principal: RequestPrincipal) { return requireResource(await this.store.getWorkflow(id, principal), "Workflow"); }
  async save(id: string, body: WorkflowDefinition, principal: RequestPrincipal) {
    if (body.id !== id) throw new ApiError(400, "Workflow id mismatch");
    assertNoCredentials(body);
    try {
      return await this.store.saveWorkflow({ ...body, id, ownerId: principal.userId, tenantId: principal.tenantId, updatedAt: body.updatedAt ?? nowIso() }, principal);
    } catch (error) {
      if (isOwnershipError(error)) throw new ApiError(404, "Workflow not found");
      throw error;
    }
  }
  async create(body: { name?: string; workflow?: WorkflowDefinition }, principal: RequestPrincipal) {
    const definition = body.workflow ?? createEmptyDefinition(body.name ?? "Untitled Workflow");
    assertNoCredentials(definition);
    return this.store.saveWorkflow({ ...definition, ownerId: principal.userId, tenantId: principal.tenantId }, principal);
  }
  async delete(id: string, principal: RequestPrincipal) { await this.get(id, principal); await this.store.deleteWorkflow(id, principal); }
}
