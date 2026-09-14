import { assertNoCredentials, migrateAgentRecord, validateAgent, type AgentTestRequest, type RunCreateRequest, type RunStatus } from "@multi-agent/types";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { MemoryAccessResolver } from "../../memory/access";
import type { PrincipalResolver, RequestPrincipal } from "../../auth/principal";
import type { RunExecutor } from "../../runtime/runExecutor";
import { redact } from "../../adapters/langGraphEventAdapter";
import { ApiError } from "../shared/http";

export interface RunListQuery {
  agentId?: string;
  workflowId?: string;
  taskId?: string;
  status?: RunStatus;
  from?: string;
  to?: string;
}

export class RunApiService {
  constructor(
    private readonly executor: RunExecutor,
    private readonly resolveMemoryAccess: MemoryAccessResolver,
    private readonly studioStore: StudioStore | undefined,
    private readonly resolvePrincipal: PrincipalResolver,
  ) {}

  get store() { return this.executor.getStore(); }

  async principalFor(request: Request): Promise<RequestPrincipal | null> {
    const principal = await this.resolvePrincipal(request);
    if (principal) return principal;
    const access = await this.resolveMemoryAccess(request);
    return access?.principalId && access.tenantId ? { userId: access.principalId, tenantId: access.tenantId } : null;
  }

  canAccess(principal: RequestPrincipal | undefined, runId: string): boolean {
    if (!principal) return false;
    const entry = this.store.get(runId);
    if (!entry) return false;
    const ownerId = entry.run.ownerId ?? entry.memoryOwner?.principalId;
    const tenantId = entry.run.tenantId ?? entry.memoryOwner?.tenantId;
    return Boolean(ownerId && tenantId && ownerId === principal.userId && tenantId === principal.tenantId);
  }

  list(query: RunListQuery, principal?: RequestPrincipal) {
    if (!principal) return [];
    return this.store.list(query, principal).map((run) => ({ ...run, input: undefined, output: undefined, error: redact(run.error), metadata: redact(run.metadata) }));
  }

  async startAgentTest(body: AgentTestRequest, request: Request, principal?: RequestPrincipal) {
    if (!principal) throw new ApiError(401, "Authentication required.");
    if (!body.agent || !body.input || typeof body.input !== "object" || Array.isArray(body.input)) throw new ApiError(400, "agent and sample input object are required");
    assertNoCredentials(body.agent);
    const errors = validateAgent(body.agent);
    if (errors.length) throw new ApiError(400, errors.join(" "));
    await this.ensureAgentAccess(body.agent.id, principal);
    const needsMemory = this.hasLongTermMemory([body.agent]);
    const access = needsMemory ? await this.resolveMemoryAccess(request) : null;
    if (needsMemory && !access) throw new ApiError(401, "Authenticated memory access is required for this agent.");
    return this.executor.startAgentTest({ agent: migrateAgentRecord(body.agent), input: body.input }, access ?? undefined, principal);
  }

  async startRun(body: Partial<RunCreateRequest>, request: Request, principal?: RequestPrincipal) {
    if (!principal) throw new ApiError(401, "Authentication required.");
    if (!body.workflow || !Array.isArray(body.workflow.nodes) || !Array.isArray(body.workflow.edges) || !Array.isArray(body.agents)) {
      throw new ApiError(400, "workflow, agents, nodes, and edges are required");
    }
    await this.ensureWorkflowAccess(body.workflow.id, principal);
    const agents = body.agents.map(migrateAgentRecord);
    assertNoCredentials({ workflow: body.workflow, agents: body.agents, tools: body.tools ?? [] });
    for (const agent of agents) await this.ensureAgentAccess(agent.id, principal);
    const needsMemory = this.hasLongTermMemory(agents);
    const access = needsMemory ? await this.resolveMemoryAccess(request) : null;
    if (needsMemory && !access) throw new ApiError(401, "Authenticated memory access is required for this workflow.");
    const tools = this.studioStore ? await this.studioStore.listTools(principal) : (body.tools ?? []);
    return this.executor.start({ ...(body as RunCreateRequest), agents, tools }, access ?? undefined, principal);
  }

  definition(runId: string) {
    const entry = this.requireRun(runId);
    const workflow = this.store.getWorkflowSnapshot?.(runId) ?? entry.workflowSnapshot;
    if (!workflow) throw new ApiError(404, "Run definition snapshot not available");
    return { workflow, agents: entry.agentsSnapshot ?? [], tools: entry.toolsSnapshot ?? [] };
  }

  approvals(runId: string) { this.requireRun(runId); return this.store.listApprovals(runId); }

  resolveApproval(runId: string, approvalId: string, body: { decision?: string; response?: string }) {
    this.requireRun(runId);
    if (body.decision !== "approved" && body.decision !== "rejected") throw new ApiError(400, "decision must be 'approved' or 'rejected'");
    this.executor.resolveApproval(runId, approvalId, { decision: body.decision, response: body.response });
  }

  history(runId: string, agentId?: string) {
    this.requireRun(runId);
    const events = this.store.events(runId);
    const nodes = new Set(events.filter((event) => event.agentId === agentId).map((event) => event.nodeId).filter(Boolean));
    return events.filter((event) => !agentId || event.agentId === agentId || (!event.agentId && event.nodeId && nodes.has(event.nodeId)));
  }

  get(runId: string) { return redact(this.requireRun(runId).run); }

  cancel(runId: string) {
    this.requireRun(runId);
    this.executor.cancel(runId);
    return { runId, status: "cancelling" };
  }

  async retry(runId: string, request: Request, principal?: RequestPrincipal) {
    if (!principal) throw new ApiError(401, "Authentication required.");
    const entry = this.requireRun(runId);
    if (entry.run.status !== "failed" && entry.run.status !== "cancelled") {
      throw new ApiError(409, "Only failed or cancelled runs can be retried.");
    }
    const agents = this.store.getAgentSnapshot?.(runId) ?? entry.agentsSnapshot ?? [];
    const needsMemory = this.hasLongTermMemory(agents);
    const access = needsMemory ? await this.resolveMemoryAccess(request) : null;
    if (needsMemory && !access) throw new ApiError(401, "Authenticated memory access is required to retry this run.");
    try {
      return { runId: this.executor.retry(runId, access ?? undefined) };
    } catch (error) {
      throw new ApiError(409, error instanceof Error ? error.message : "Unable to retry run");
    }
  }

  private requireRun(runId: string) {
    const entry = this.store.get(runId);
    if (!entry) throw new ApiError(404, "Run not found");
    return entry;
  }

  private hasLongTermMemory(agents: RunCreateRequest["agents"]) {
    return agents.some((agent) => agent.memory?.enabled && agent.memory.longTerm?.enabled);
  }

  private async ensureAgentAccess(id: string | undefined, principal: RequestPrincipal) {
    if (!id || !this.studioStore) return;
    const stored = await this.studioStore.getAgent(id);
    if (stored && !stored.isSystem && (stored.tenantId !== principal.tenantId || (stored.ownerId && stored.ownerId !== principal.userId))) {
      throw new ApiError(404, "Access denied to agent.");
    }
  }

  private async ensureWorkflowAccess(id: string | undefined, principal: RequestPrincipal) {
    if (!id || !this.studioStore) return;
    const stored = await this.studioStore.getWorkflow(id);
    if (stored && (stored.ownerId !== principal.userId || stored.tenantId !== principal.tenantId)) throw new ApiError(404, "Access denied to workflow.");
  }
}
