import { assertNoCredentials, deserializeWorkflowDefinition, migrateAgentRecord, migrateToolRecord, type AgentRecord, type ToolRecord, type WorkflowDefinition } from "@multi-agent/types";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { RequestPrincipal } from "../../auth/principal";
import { ApiError } from "../shared/http";
import { requireCredentialMutationPermission } from "../../auth/credentialResourcePermissions";

export interface WorkspaceImport { workflows?: WorkflowDefinition[]; agents?: AgentRecord[]; tools?: ToolRecord[] }

export class WorkspaceService {
  constructor(private readonly store: StudioStore) {}
  async import(body: WorkspaceImport, principal: RequestPrincipal) {
    assertNoCredentials(body);
    let workflows: WorkflowDefinition[];
    try { workflows = (body.workflows ?? []).map(deserializeWorkflowDefinition); }
    catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Invalid workflow definition"); }
    const agents = (body.agents ?? []).map(migrateAgentRecord), tools = (body.tools ?? []).map(migrateToolRecord);
    // Validate the complete batch before invoking the transactional writer.
    for (const agent of agents) requireCredentialMutationPermission(principal, agent, await this.store.getAgent(agent.id, principal));
    for (const tool of tools) requireCredentialMutationPermission(principal, tool, await this.store.getTool(tool.id, principal));
    await this.store.importWorkspace({ workflows, agents, tools }, principal);
  }
  async export(principal: RequestPrincipal) {
    const [workflows, agents, tools] = await Promise.all([this.store.listWorkflows(principal), this.store.listAgents(principal), this.store.listTools(principal)]);
    return { version: 3 as const, workflows, agents, tools };
  }
}
