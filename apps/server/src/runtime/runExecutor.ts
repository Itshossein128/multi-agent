import { Command, type BaseCheckpointSaver, MemorySaver } from "@langchain/langgraph";
import { nowIso, uid, validateAgent, type AgentRecord, type AgentTestRequest, type ApprovalDecisionRequest, type ApprovalRequest, type Run, type RunCreateRequest, type RunEvent, type WorkflowDefinition } from "@multi-agent/types";
import { LangGraphEventAdapter } from "../adapters/langGraphEventAdapter";
import { compileWorkflow, UnsupportedPhase4NodeError, type AgentExecutionEvent, type CompileOptions } from "../compiler/workflowCompiler";

type CompiledGraph = ReturnType<typeof compileWorkflow>;
import { InMemoryRunStore, type RunStoreContract } from "./runStore";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import { AgentRuntime, mapAgentExecutionEvent, type TrustedCredentialPrincipal } from "../../../../src/agents/runtime";
import { ToolRuntime } from "../../../../src/tools";
import { ExecutionTelemetry } from "../../../../src/observability/telemetry";
import { validateWorkflow } from "../compiler/validation";
import { runtimeGuardrailsFromEnvironment, type RuntimeGuardrails } from "./guardrails";
import { log } from "../logging";
import type { RequestPrincipal } from "../auth/principal";

function mapAgentEvents(event: AgentExecutionEvent, runId: string): RunEvent[] {
  return mapAgentExecutionEvent(event as Parameters<typeof mapAgentExecutionEvent>[0], runId);
}

function asCredentialPrincipal(principal?: RequestPrincipal): TrustedCredentialPrincipal | undefined {
  return principal ? { tenantId: principal.tenantId, principalId: principal.userId } : undefined;
}

interface PausedContext {
  workflow: WorkflowDefinition;
  agents: AgentRecord[];
  tools?: import("@multi-agent/types").ToolRecord[];
  memoryAccess?: MemoryAccessContext;
  stepBudget?: { count: number };
}

export class RunExecutor {
  private checkpointers = new Map<string, BaseCheckpointSaver>();
  private pausedContext = new Map<string, PausedContext>();
  private branchControllers = new Map<string, Map<string, AbortController>>();

  constructor(
    private readonly store: RunStoreContract = new InMemoryRunStore(),
    private readonly agentRuntime: Pick<AgentRuntime, "execute"> = new AgentRuntime(),
    private readonly checkpointer?: CompileOptions["checkpointer"],
    private readonly telemetry: ExecutionTelemetry = ExecutionTelemetry.disabled(),
    private readonly guardrails: RuntimeGuardrails = runtimeGuardrailsFromEnvironment(),
    private readonly toolRuntime?: Pick<ToolRuntime, "execute">,
  ) { }
  getStore() { return this.store; }
  private credentialPrincipalForRun(runId: string): TrustedCredentialPrincipal | undefined {
    const run = this.store.get(runId)?.run;
    return run?.tenantId && run.ownerId ? { tenantId: run.tenantId, principalId: run.ownerId } : undefined;
  }
  private appendAgentEvent(runId: string, event: AgentExecutionEvent) {
    for (const runEvent of mapAgentEvents(event, runId)) {
      if (runEvent.nodeId && (runEvent.type === "node.started" || runEvent.type === "agent.started" || runEvent.type === "tool.started")) {
        this.store.update(runId, { currentNodeId: runEvent.nodeId });
      }
      this.store.append(runId, runEvent);
    }
  }
  /** Restore in-memory pause maps after a durable hydrate so waiting runs can resume. */
  restorePausedRun(runId: string, context: PausedContext, checkpointer: BaseCheckpointSaver) {
    this.pausedContext.set(runId, context);
    this.checkpointers.set(runId, checkpointer);
  }
  startAgentTest(request: AgentTestRequest, memoryAccess?: MemoryAccessContext, principal?: RequestPrincipal) {
    const errors = validateAgent(request.agent);
    if (request.agent.enabled === false) errors.push("Agent is disabled. Enable it before execution.");
    if (errors.length) throw new Error(errors.join(" "));
    const id = uid("run");
    const stamp = nowIso();
    const ownerId = principal?.userId;
    const tenantId = principal?.tenantId;
    this.store.create(
      { id, workflowId: `agent-test:${request.agent.id}`, status: "running", startedAt: stamp, input: request.input, metadata: { kind: "agent-test" }, ownerId, tenantId },
      memoryAccess,
      undefined,
      principal,
    );
    this.store.append(id, { id: uid("event"), runId: id, agentId: request.agent.id, type: "run.created", timestamp: stamp, sequence: 0, payload: {} });
    this.store.append(id, { id: uid("event"), runId: id, agentId: request.agent.id, type: "run.started", timestamp: stamp, sequence: 0, payload: {} });
    void this.executeAgentTest(id, request, memoryAccess, principal);
    return id;
  }
  private async executeAgentTest(runId: string, request: AgentTestRequest, memoryAccess?: MemoryAccessContext, principal?: RequestPrincipal) {
    try {
      let output: Record<string, unknown> = {};
      for await (const event of this.agentRuntime.execute({ agent: request.agent, input: request.input, runId, nodeId: `test:${request.agent.id}`, signal: this.store.signal(runId), memoryStore: new Map(), memoryAccess, credentialPrincipal: asCredentialPrincipal(principal), onBackgroundEvent: event => { this.appendAgentEvent(runId, event); } })) {
        this.appendAgentEvent(runId, event);
        if (event.type === "agent.completed") output = { content: (event.payload as { content?: unknown })?.content };
        if (event.type === "agent.failed") throw new Error((event.payload as { error?: string })?.error ?? "Agent failed");
      }
      this.store.signal(runId)?.throwIfAborted();
      this.store.update(runId, { status: "completed", completedAt: nowIso(), output });
      this.store.append(runId, { id: uid("event"), runId, type: "run.completed", timestamp: nowIso(), sequence: 0, payload: { output } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = Boolean(this.store.signal(runId)?.aborted);
      this.store.update(runId, { status: cancelled ? "cancelled" : "failed", completedAt: nowIso(), error: message });
      this.store.append(runId, { id: uid("event"), runId, type: cancelled ? "run.cancelled" : "run.failed", timestamp: nowIso(), sequence: 0, payload: { error: message, ...(cancelled ? { cancelled: true } : {}) } });
    }
  }
  start(request: RunCreateRequest, memoryAccess?: MemoryAccessContext, principal?: RequestPrincipal) {
    const issues = validateWorkflow(request.workflow, request.agents, this.guardrails, request.tools);
    const errors = issues.filter(issue => issue.level === "error");
    if (errors.length) throw new Error(errors.map(issue => `${issue.code}: ${issue.message}`).join(" "));
    const id = uid("run"); const stamp = nowIso();
    const ownerId = principal?.userId;
    const tenantId = principal?.tenantId;
    const run: Run = { id, workflowId: request.workflow.id, taskId: request.taskId, status: "queued", startedAt: stamp, input: request.input ?? {}, metadata: request.metadata ?? {}, ownerId, tenantId };
    this.store.create(run, memoryAccess, { workflow: request.workflow, agents: request.agents, tools: request.tools }, principal);
    log.info("run.started", { runId: id, workflowId: request.workflow.id, taskId: request.taskId });
    this.store.append(id, { id: uid("event"), runId: id, type: "run.created", timestamp: stamp, sequence: 0, payload: { workflowId: request.workflow.id } });
    this.store.append(id, { id: uid("event"), runId: id, type: "run.started", timestamp: stamp, sequence: 0, payload: { workflowId: request.workflow.id } });
    this.branchControllers.set(id, new Map());
    void this.execute(id, request, memoryAccess, principal);
    return id;
  }
  retry(runId: string, memoryAccess?: MemoryAccessContext) {
    const entry = this.store.get(runId);
    if (!entry) throw new Error("Run not found");
    if (entry.run.status !== "failed" && entry.run.status !== "cancelled") {
      throw new Error("Only failed or cancelled runs can be retried");
    }
    const workflow = this.store.getWorkflowSnapshot?.(runId) ?? entry.workflowSnapshot;
    const agents = this.store.getAgentSnapshot?.(runId) ?? entry.agentsSnapshot;
    const tools = this.store.getToolSnapshot?.(runId) ?? entry.toolsSnapshot;
    if (!workflow || !agents?.length) throw new Error("Run definition snapshot is not available for retry");
    return this.start({
      workflow,
      agents,
      tools,
      input: entry.run.input ?? {},
      metadata: { ...entry.run.metadata, retriedFromRunId: runId },
      taskId: entry.run.taskId,
    }, memoryAccess, entry.run.ownerId && entry.run.tenantId ? { userId: entry.run.ownerId, tenantId: entry.run.tenantId } : undefined);
  }
  cancel(runId: string) {
    const entry = this.store.get(runId);
    if (!entry) return false;
    if (["completed", "failed", "cancelled"].includes(entry.run.status)) return false;
    if (entry.run.status === "waiting_for_human") {
      // No in-flight promise is awaiting the abort signal — the stream already
      // returned when the graph paused. Finalize cancellation directly.
      for (const approval of this.store.listApprovals(runId)) {
        if (approval.status === "requested") {
          this.store.clearApprovalTimer(runId, approval.id);
          this.store.updateApproval(runId, approval.id, { status: "cancelled", resolvedAt: nowIso() });
        }
      }
      this.pausedContext.delete(runId);
      this.checkpointers.delete(runId);
      this.branchControllers.delete(runId);
      this.store.setPausedContext?.(runId, null);
      this.store.update(runId, { status: "cancelled", completedAt: nowIso() });
      this.store.append(runId, { id: uid("event"), runId, type: "run.cancelled", timestamp: nowIso(), sequence: 0, payload: { cancelled: true } });
      return true;
    }
    return this.store.cancel(runId);
  }

  /** Cancel one named conditional branch without aborting the whole run. */
  cancelBranch(runId: string, branchKey: string): boolean {
    const normalized = branchKey.trim();
    if (!normalized || normalized.length > 128 || /[\r\n\0]/.test(normalized)) return false;
    const entry = this.store.get(runId);
    if (!entry || ["completed", "failed", "cancelled"].includes(entry.run.status)) return false;
    const workflow = this.store.getWorkflowSnapshot?.(runId) ?? entry.workflowSnapshot;
    const configuredBranches = (workflow?.nodes ?? [])
      .filter(node => node.type === "condition")
      .flatMap(node => {
        const branches = (node.config as { branches?: unknown }).branches;
        return Array.isArray(branches) ? branches : [];
      })
      .map(branch => branch && typeof branch === "object" ? (branch as { key?: unknown }).key : undefined)
      .filter((key): key is string => typeof key === "string" && Boolean(key.trim()));
    const edgeBranches = (workflow?.edges ?? [])
      .filter(edge => edge.kind === "conditional")
      .map(edge => edge.branchKey)
      .filter((key): key is string => typeof key === "string" && Boolean(key.trim()));
    // A branch is declared either by a condition node's branch configuration
    // or by a validated conditional edge. This also keeps cancellation useful
    // while a branch has not yet reached its outgoing edge.
    const knownBranches = new Set([...configuredBranches, ...edgeBranches].map(key => key.trim()));
    if (!knownBranches.has(normalized)) return false;
    let controllers = this.branchControllers.get(runId);
    if (!controllers) {
      controllers = new Map();
      this.branchControllers.set(runId, controllers);
    }
    let controller = controllers.get(normalized);
    if (!controller) {
      controller = new AbortController();
      controllers.set(normalized, controller);
    }
    if (controller.signal.aborted) return false;
    controller.abort();
    this.store.append(runId, {
      id: uid("event"), runId, type: "branch.cancelled", timestamp: nowIso(), sequence: 0,
      payload: { branchKey: normalized },
    });
    return true;
  }

  resolveApproval(runId: string, approvalId: string, decision: ApprovalDecisionRequest) {
    const approval = this.store.getApproval(runId, approvalId);
    if (!approval) throw new Error("Approval not found");
    if (approval.status !== "requested") throw new Error("Approval has already been resolved.");
    this.store.clearApprovalTimer(runId, approvalId);
    const stamp = nowIso();
    this.store.updateApproval(runId, approvalId, { status: decision.decision, resolvedAt: stamp, response: decision.response });
    this.store.append(runId, { id: uid("event"), runId, type: decision.decision === "approved" ? "human_approval.approved" : "human_approval.rejected", nodeId: approval.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId, decision: decision.decision, response: decision.response } });
    this.store.append(runId, { id: uid("event"), runId, type: "human_approval.resolved", nodeId: approval.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId, decision: decision.decision, response: decision.response } });
    this.store.append(runId, { id: uid("event"), runId, type: "run.resumed", nodeId: approval.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId } });
    this.store.update(runId, { status: "running" });
    void this.continueAfterApproval(runId, decision);
  }

  private async continueAfterApproval(runId: string, decision: ApprovalDecisionRequest) {
    const context = this.pausedContext.get(runId);
    const checkpointer = this.checkpointers.get(runId);
    if (!context || !checkpointer) { this.fail(runId, new Error("Run is not resumable.")); return; }
    this.pausedContext.delete(runId);
    try {
      const compiled = compileWorkflow(context.workflow, context.agents, {
        runId,
        runtime: this.agentRuntime,
        toolRuntime: this.toolRuntime,
        checkpointer,
        memoryAccess: context.memoryAccess,
        credentialPrincipal: this.credentialPrincipalForRun(runId),
        signal: this.store.signal(runId),
        workflowId: context.workflow.id,
        tools: context.tools,
        stepBudget: context.stepBudget,
        guardrails: this.guardrails,
        branchSignals: this.branchControllers.get(runId),
        onAgentEvent: (event) => { this.appendAgentEvent(runId, event); },
      });
      await this.runGraph(runId, compiled, new Command({ resume: decision }), context.workflow, context.agents, context.memoryAccess, context.tools, context.stepBudget);
    } catch (error) { this.fail(runId, error); }
  }

  private async execute(runId: string, request: RunCreateRequest, memoryAccess?: MemoryAccessContext, principal?: RequestPrincipal) {
    if (this.telemetry.enabled) {
      const traceId = await this.telemetry.traceIdForRun(runId);
      this.store.update(runId, { metadata: { ...(this.store.get(runId)?.run.metadata ?? {}), observability: { provider: "langfuse", traceId } } });
    }
    return this.telemetry.withWorkflow({ runId, workflowId: request.workflow.id, taskId: request.taskId, input: request.input }, () => this.executeWorkflow(runId, request, memoryAccess, principal));
  }
  private async executeWorkflow(runId: string, request: RunCreateRequest, memoryAccess?: MemoryAccessContext, principal?: RequestPrincipal) {
    this.store.update(runId, { status: "running" });
    const timeout = setTimeout(() => this.store.cancel(runId), this.guardrails.maxRunDurationMs);
    // Approvals require checkpointing to pause/resume — a per-run MemorySaver is
    // retained across the initial run and any resume, unlike the ad-hoc default
    // compileWorkflow would otherwise create fresh on every call.
    const checkpointer = typeof this.checkpointer === "object" ? this.checkpointer : new MemorySaver();
    const stepBudget = { count: 0 };
    this.checkpointers.set(runId, checkpointer);
    if (!this.branchControllers.has(runId)) this.branchControllers.set(runId, new Map());
    try {
      const compiled = compileWorkflow(request.workflow, request.agents, {
        runId,
        runtime: this.agentRuntime,
        toolRuntime: this.toolRuntime,
        checkpointer,
        memoryAccess,
        credentialPrincipal: asCredentialPrincipal(principal),
        signal: this.store.signal(runId),
        workflowId: request.workflow.id,
        tools: request.tools,
        stepBudget,
        guardrails: this.guardrails,
        branchSignals: this.branchControllers.get(runId),
        onAgentEvent: (event) => {
          this.appendAgentEvent(runId, event);
        },
      });
      await this.runGraph(runId, compiled, { input: request.input ?? {}, output: {}, memory: {} }, request.workflow, request.agents, memoryAccess, request.tools, stepBudget);
    } catch (error) { this.fail(runId, error); } finally { clearTimeout(timeout); }
  }

  private async runGraph(runId: string, compiled: CompiledGraph, input: unknown, workflow: WorkflowDefinition, agents: AgentRecord[], memoryAccess?: MemoryAccessContext, tools?: import("@multi-agent/types").ToolRecord[], stepBudget?: { count: number }) {
    const adapter = new LangGraphEventAdapter();
    const stream = await compiled.graph.streamEvents(input as never, { version: "v3", streamMode: ["tasks", "updates", "values", "messages"], signal: this.store.signal(runId), recursionLimit: this.guardrails.recursionLimit, configurable: { thread_id: runId } } as never);
    let output: Record<string, unknown> | undefined;
    for await (const raw of stream as AsyncIterable<unknown>) {
      const rawRecord = raw as { method?: string; params?: { data?: unknown; node?: string } };
      if (rawRecord.method === "updates" && rawRecord.params?.node === "__interrupt__") {
        const values = (rawRecord.params.data as { values?: { id: string; value: unknown }[] } | undefined)?.values ?? [];
        for (const item of values) this.handleApprovalRequested(runId, item);
        continue;
      }
      if (rawRecord.method === "values" && rawRecord.params?.data && typeof rawRecord.params.data === "object") {
        const values = rawRecord.params.data as { output?: Record<string, unknown> };
        if (values.output) output = values.output;
      }
      // Agent lifecycle comes from AgentRuntime exactly once, not the graph task adapter.
      for (const event of adapter.adapt(raw, runId, workflow, agents)) {
        if (!event.type.startsWith("agent.")) this.store.append(runId, event);
      }
    }
    this.store.signal(runId)?.throwIfAborted();
    const state = await compiled.graph.getState({ configurable: { thread_id: runId } } as never);
    if ((state as { next: string[] }).next.length > 0) {
      // Paused at a human approval node — leave status as waiting_for_human and
      // retain enough context to recompile and resume once it is resolved.
      const context = { workflow, agents, tools, memoryAccess, stepBudget };
      this.pausedContext.set(runId, context);
      this.store.setPausedContext?.(runId, context);
      return;
    }
    this.pausedContext.delete(runId);
    this.checkpointers.delete(runId);
    this.branchControllers.delete(runId);
    this.store.setPausedContext?.(runId, null);
    this.store.update(runId, { status: "completed", completedAt: nowIso(), output });
    this.store.append(runId, { id: uid("event"), runId, type: "run.completed", timestamp: nowIso(), sequence: 0, payload: { output } });
  }

  private handleApprovalRequested(runId: string, item: { id: string; value: unknown }) {
    const value = item.value as { nodeId: string; message: string; approvalType: "manual" | "timeout"; timeoutSeconds: number; context?: unknown };
    const stamp = nowIso();
    const request: ApprovalRequest = {
      id: item.id,
      runId,
      nodeId: value.nodeId,
      status: "requested",
      message: value.message,
      requestedAt: stamp,
      context: value.context && typeof value.context === "object" ? value.context as Record<string, unknown> : undefined,
      metadata: {},
    };
    this.store.addApproval(runId, request, value.timeoutSeconds);
    this.store.update(runId, { status: "waiting_for_human", currentNodeId: value.nodeId });
    this.store.append(runId, { id: uid("event"), runId, type: "run.paused", nodeId: value.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId: item.id } });
    this.store.append(runId, { id: uid("event"), runId, type: "human_approval.requested", nodeId: value.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId: item.id, message: value.message, approvalType: value.approvalType, timeoutSeconds: value.timeoutSeconds } });
    if (value.approvalType === "timeout" && value.timeoutSeconds > 0) {
      const timer = setTimeout(() => {
        try { this.resolveApproval(runId, item.id, { decision: "approved" }); } catch { /* already resolved by a human in the meantime */ }
      }, value.timeoutSeconds * 1000);
      this.store.setApprovalTimer(runId, item.id, timer);
    }
  }

  /** Re-arm timeout approvals after process restart when remaining time can be computed. */
  rearmApprovalTimers(runId: string) {
    for (const approval of this.store.listApprovals(runId)) {
      if (approval.status !== "requested") continue;
      const timeoutSeconds = Number((approval.metadata as { timeoutSeconds?: number })?.timeoutSeconds
        ?? this.store.get(runId)?.events.find((event) => event.type === "human_approval.requested" && (event.payload as { approvalId?: string }).approvalId === approval.id)?.payload?.timeoutSeconds);
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) continue;
      const elapsedMs = Date.now() - Date.parse(approval.requestedAt);
      const remaining = Math.max(0, timeoutSeconds * 1000 - elapsedMs);
      const timer = setTimeout(() => {
        try { this.resolveApproval(runId, approval.id, { decision: "approved" }); } catch { /* already resolved */ }
      }, remaining);
      this.store.setApprovalTimer(runId, approval.id, timer);
    }
  }

  private fail(runId: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const unsupported = error instanceof UnsupportedPhase4NodeError;
    if (unsupported) this.store.append(runId, { id: uid("event"), runId, type: "node.failed", timestamp: nowIso(), nodeId: error.nodeId, sequence: 0, payload: { error: message } });
    this.pausedContext.delete(runId);
    this.checkpointers.delete(runId);
    this.branchControllers.delete(runId);
    this.store.setPausedContext?.(runId, null);
    const cancelled = Boolean(this.store.signal(runId)?.aborted);
    this.store.update(runId, { status: cancelled ? "cancelled" : "failed", completedAt: nowIso(), error: message });
    this.store.append(runId, { id: uid("event"), runId, type: cancelled ? "run.cancelled" : "run.failed", timestamp: nowIso(), sequence: 0, payload: { error: message, ...(cancelled ? { cancelled: true } : {}) } });
    const logPayload = { runId, workflowId: this.store.get(runId)?.run.workflowId, taskId: this.store.get(runId)?.run.taskId, error: message };
    if (cancelled) log.info("run.cancelled", logPayload);
    else log.error("run.failed", logPayload);
  }
}
