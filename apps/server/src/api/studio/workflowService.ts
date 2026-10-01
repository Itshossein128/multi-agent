import { assertNoCredentials, createEmptyDefinition, deserializeWorkflowDefinition, nowIso, type WorkflowDefinition } from "@multi-agent/types";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError, isOwnershipError } from "../shared/http";
import { requireResource } from "./resource";
import { SAVE_BLOCKING_ISSUE_CODES, validateWorkflow } from "../../compiler/validation";
import { runtimeGuardrailsFromEnvironment } from "../../runtime/guardrails";

/**
 * Workflow CRUD. The server is authoritative for validation: structural
 * integrity, node contracts, allowed branch values, and retry safety are
 * re-checked here on every save — client-side validation only assists
 * authoring and never substitutes for this gate.
 */
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
    await this.assertSaveable(definition, principal);
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
    await this.assertSaveable(definition, principal);
    return this.store.saveWorkflow({ ...definition, ownerId: principal.userId, tenantId: principal.tenantId }, principal);
  }
  async delete(id: string, principal: RequestPrincipal) { await this.get(id, principal); await this.store.deleteWorkflow(id, principal); }

  /**
   * Reject definitions that fail definition-integrity or policy validation.
   * Draft-completeness issues (missing entry/exit nodes, unlinked agents)
   * remain saveable and are enforced authoritatively when a run starts.
   */
  private async assertSaveable(definition: WorkflowDefinition, principal: RequestPrincipal) {
    const [agents, tools] = await Promise.all([
      this.store.listAgents(principal),
      this.store.listTools(principal),
    ]);
    const issues = validateWorkflow(definition, agents, runtimeGuardrailsFromEnvironment(), tools);
    const blocking = issues.filter((issue) => issue.level === "error" && SAVE_BLOCKING_ISSUE_CODES.has(issue.code));
    if (blocking.length) {
      throw new ApiError(
        400,
        `Workflow failed server validation: ${blocking.slice(0, 3).map((issue) => issue.code).join(", ")}${blocking.length > 3 ? "…" : ""}`,
        { issues: blocking.slice(0, 50) },
      );
    }
  }
}
