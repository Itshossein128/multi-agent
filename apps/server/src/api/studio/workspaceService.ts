import { assertNoCredentials, deserializeWorkflowDefinition, migrateAgentRecord, migrateToolRecord, type AgentRecord, type ToolRecord, type WorkflowDefinition } from "@multi-agent/types";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";

export interface WorkspaceImport { workflows?: WorkflowDefinition[]; agents?: AgentRecord[]; tools?: ToolRecord[] }

export class WorkspaceService {
  constructor(private readonly store: StudioStore) {}
  async import(body: WorkspaceImport, principal: RequestPrincipal) {
    assertNoCredentials(body);
    let workflows: WorkflowDefinition[];
    try { workflows = (body.workflows ?? []).map(deserializeWorkflowDefinition); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid workflow definition"); }
    await this.store.importWorkspace({ workflows, agents: (body.agents ?? []).map(migrateAgentRecord), tools: (body.tools ?? []).map(migrateToolRecord) }, principal);
  }
  async export(principal: RequestPrincipal) {
    const [workflows, agents, tools] = await Promise.all([this.store.listWorkflows(principal), this.store.listAgents(principal), this.store.listTools(principal)]);
    return { version: 3 as const, workflows, agents, tools };
  }
}
