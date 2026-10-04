import { assertNoCredentials, migrateAgentRecord, nowIso, validateAgent, type AgentRecord, type AgentTestRequest, type RunCreateRequest, type RunStatus, type WorkflowDefinition } from "@multi-agent/types";
import type { StudioStore } from "../../../../../src/studio/contracts";
import type { MemoryAccessResolver } from "../../memory/access";
import type { RequestPrincipal } from "../../auth/principal";
import type { PrincipalResolver } from "../../auth/authorization";
import type { RunExecutor } from "../../runtime/runExecutor";
import { replayRunEvents } from "../../runtime/replay";
import { redact } from "../../adapters/langGraphEventAdapter";
import { ApiError } from "../shared/http";
import { buildClarificationPackage, fingerprintAnswers, validateClarificationAnswers } from "../clarification";

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
    const authoritativeAgent = await this.authoritativeAgent(body.agent.id, principal) ?? migrateAgentRecord(body.agent);
    const needsMemory = this.hasLongTermMemory([authoritativeAgent]);
    const access = needsMemory ? await this.resolveMemoryAccess(request) : null;
    if (needsMemory && !access) throw new ApiError(401, "Authenticated memory access is required for this agent.");
    return this.executor.startAgentTest({ agent: authoritativeAgent, input: body.input }, access ?? undefined, principal);
  }

  async startRun(body: Partial<RunCreateRequest>, request: Request, principal?: RequestPrincipal) {
    if (!principal) throw new ApiError(401, "Authentication required.");
    if (!body.workflow || !Array.isArray(body.workflow.nodes) || !Array.isArray(body.workflow.edges) || !Array.isArray(body.agents)) {
      throw new ApiError(400, "workflow, agents, nodes, and edges are required");
    }
    const workflow = await this.authoritativeWorkflow(body.workflow.id, principal) ?? body.workflow;
    const requestedAgents = this.studioStore
      ? [...new Set(workflow.nodes
          .filter((node) => node.type === "agent")
          .map((node) => (node.config as { agentId?: string | null }).agentId)
          .filter((id): id is string => Boolean(id)))]
      : body.agents.map((agent) => agent.id);
    const agents = this.studioStore
      ? await Promise.all(requestedAgents.map(async (id) => (await this.authoritativeAgent(id, principal))!))
      : body.agents.map(migrateAgentRecord);
    assertNoCredentials({ workflow: body.workflow, agents: body.agents, tools: body.tools ?? [] });
    const needsMemory = this.hasLongTermMemory(agents);
    const access = needsMemory ? await this.resolveMemoryAccess(request) : null;
    if (needsMemory && !access) throw new ApiError(401, "Authenticated memory access is required for this workflow.");
    const tools = this.studioStore ? await this.studioStore.listTools(principal) : (body.tools ?? []);
    return this.executor.start({ ...(body as RunCreateRequest), workflow, agents, tools }, access ?? undefined, principal);
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

  replay(runId: string) {
    this.requireRun(runId);
    return replayRunEvents(runId, this.store.events(runId));
  }

  get(runId: string) { return redact(this.requireRun(runId).run); }

  cancel(runId: string) {
    this.requireRun(runId);
    this.executor.cancel(runId);
    return { runId, status: "cancelling" };
  }

  cancelBranch(runId: string, branchKey: string) {
    this.requireRun(runId);
    if (!branchKey.trim() || branchKey.length > 128 || /[\r\n\0]/.test(branchKey)) {
      throw new ApiError(400, "Invalid branch key.");
    }
    if (!this.executor.cancelBranch(runId, branchKey)) {
      throw new ApiError(409, "Branch is not active or was already cancelled.");
    }
    return { runId, branchKey, status: "cancelling" };
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
      const retriedRunId = this.executor.retry(runId, access ?? undefined);
      try {
        if (this.studioStore && entry.run.taskId) {
          const task = await this.studioStore.getTask(entry.run.taskId, principal);
          if (task && task.runId === runId) {
            await this.studioStore.saveTask({
              ...task,
              runId: retriedRunId,
              status: "running",
              retryCount: (task.retryCount ?? 0) + 1,
              output: null,
              lastError: null,
              completedAt: null,
              startedAt: nowIso(),
              paused: false,
              updatedAt: nowIso(),
            }, principal);
          }
        }
      } catch (error) {
        this.executor.cancel(retriedRunId);
        throw error;
      }
      return { runId: retriedRunId };
    } catch (error) {
      throw new ApiError(409, error instanceof Error ? error.message : "Unable to retry run");
    }
  }

  getClarification(runId: string) {
    const entry = this.requireRun(runId);
    return buildClarificationPackage({
      run: entry.run,
      approvals: this.store.listApprovals(runId),
      taskId: entry.run.taskId,
    });
  }

  submitClarification(
    runId: string,
    body: { answers?: unknown },
    options: { principal?: RequestPrincipal; idempotencyKey?: string } = {},
  ) {
    const entry = this.requireRun(runId);
    const pkg = buildClarificationPackage({
      run: entry.run,
      approvals: this.store.listApprovals(runId),
      taskId: entry.run.taskId,
    });

    if (!pkg.canSubmit) {
      // Idempotent replay when already answered with same fingerprint.
      if (pkg.answers?.length && Array.isArray(body.answers)) {
        try {
          const normalized = validateClarificationAnswers(pkg.questions.length ? pkg.questions : pkg.answers.map((a) => ({
            id: a.questionId,
            prompt: a.questionId,
            required: true,
          })), body.answers);
          const fp = fingerprintAnswers(normalized);
          const prior = this.store.listApprovals(runId)
            .map((a) => (a.metadata as { answerFingerprint?: string } | undefined)?.answerFingerprint)
            .find(Boolean);
          if (prior && prior === fp) {
            return {
              ok: true,
              package: buildClarificationPackage({
                run: this.requireRun(runId).run,
                approvals: this.store.listApprovals(runId),
                taskId: entry.run.taskId,
              }),
              idempotentReplay: true,
              followUpRunId: null,
            };
          }
        } catch {
          // fall through to conflict
        }
      }
      throw new ApiError(409, "Clarification is not currently submittable for this run");
    }

    if (pkg.continuation === "follow_up") {
      throw new ApiError(
        409,
        "This completed clarification run requires a task-scoped follow-up submit. Use POST /studio/tasks/:taskId/clarification.",
      );
    }

    if (!pkg.approvalId) throw new ApiError(409, "No pending clarification approval found");
    const answers = validateClarificationAnswers(pkg.questions, body.answers);
    const actorId = options.principal?.userId;
    const stamped = answers.map((a) => ({
      ...a,
      answeredAt: nowIso(),
      ...(actorId ? { actorId } : {}),
    }));

    if (!this.executor.isRunResumable(runId)) {
      const approval = this.store.getApproval(runId, pkg.approvalId);
      if (approval) {
        this.store.updateApproval(runId, pkg.approvalId, {
          metadata: {
            ...(approval.metadata ?? {}),
            clarificationAnswers: stamped,
            answerFingerprint: fingerprintAnswers(stamped),
            resumeError: "Run is not resumable; answers were stored without continuing execution.",
          },
          response: `Clarification answers submitted (${stamped.length}) — resume unavailable`,
        });
      }
      return {
        ok: false,
        package: buildClarificationPackage({
          run: this.requireRun(runId).run,
          approvals: this.store.listApprovals(runId),
          taskId: entry.run.taskId,
        }),
        idempotentReplay: false,
        followUpRunId: null,
        errorVisible: true,
      };
    }

    let idempotentReplay = false;
    try {
      const result = this.executor.resolveApproval(runId, pkg.approvalId, {
        decision: "approved",
        clarificationAnswers: stamped,
        response: options.idempotencyKey ? `idempotency:${options.idempotencyKey}` : undefined,
      });
      idempotentReplay = Boolean(result?.idempotentReplay);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to resume after clarification";
      if (/already been resolved/i.test(message)) {
        throw new ApiError(409, message);
      }
      // Answers may have been partially stored; surface failure without marking Done.
      return {
        ok: false,
        package: buildClarificationPackage({
          run: this.requireRun(runId).run,
          approvals: this.store.listApprovals(runId),
          taskId: entry.run.taskId,
        }),
        idempotentReplay: false,
        followUpRunId: null,
        errorVisible: true,
      };
    }

    return {
      ok: true,
      package: buildClarificationPackage({
        run: this.requireRun(runId).run,
        approvals: this.store.listApprovals(runId),
        taskId: entry.run.taskId,
      }),
      idempotentReplay,
      followUpRunId: null,
    };
  }

  private requireRun(runId: string) {
    const entry = this.store.get(runId);
    if (!entry) throw new ApiError(404, "Run not found");
    return entry;
  }

  private hasLongTermMemory(agents: RunCreateRequest["agents"]) {
    return agents.some((agent) => agent.memory?.enabled && agent.memory.longTerm?.enabled);
  }

  private async authoritativeAgent(id: string | undefined, principal: RequestPrincipal): Promise<AgentRecord | undefined> {
    if (!id || !this.studioStore) return undefined;
    const stored = await this.studioStore.getAgent(id, principal);
    if (!stored) throw new ApiError(404, "Agent not found.");
    return stored;
  }

  private async authoritativeWorkflow(id: string | undefined, principal: RequestPrincipal): Promise<WorkflowDefinition | undefined> {
    if (!id || !this.studioStore) return undefined;
    const stored = await this.studioStore.getWorkflow(id, principal);
    if (!stored) throw new ApiError(404, "Workflow not found.");
    return stored;
  }
}
