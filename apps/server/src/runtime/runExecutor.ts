import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import {
  nowIso,
  uid,
  validateAgent,
  ContractViolationError,
  createResultEnvelope,
  diagnosticsFromValidation,
  migrateNodeContract,
  validateAgainstSchema,
  type AgentRecord,
  type AgentTestRequest,
  type ApprovalDecisionRequest,
  type NodeResultEnvelope,
  type Run,
  type RunCreateRequest,
  type RunEvent,
  type WorkflowDefinition,
} from "@multi-agent/types";
import {
  BranchRoutingError,
  NodeOutcomeError,
  WorkflowStepLimitError,
  compileWorkflow,
  UnsupportedPhase4NodeError,
  type AgentExecutionEvent,
  type CompileOptions,
} from "../compiler/workflowCompiler";
import { InMemoryRunStore, type RunStoreContract } from "./runStore";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import { AgentRuntime, AgentExecutionFailedError, mapAgentExecutionEvent, type TrustedCredentialPrincipal } from "../../../../src/agents/runtime";
import { ToolPolicyError, ToolRuntime } from "../../../../src/tools";
import { ExecutionTelemetry } from "../../../../src/observability/telemetry";
import { validateWorkflow } from "../compiler/validation";
import { runtimeGuardrailsFromEnvironment, type RuntimeGuardrails } from "./guardrails";
import { log } from "../logging";
import type { RequestPrincipal } from "../auth/principal";
import { ApprovalManager, type PausedContext } from "./approvalManager";
import { GraphRunner } from "./graphRunner";

function mapAgentEvents(event: AgentExecutionEvent, runId: string): RunEvent[] {
  return mapAgentExecutionEvent(event as Parameters<typeof mapAgentExecutionEvent>[0], runId);
}

function asCredentialPrincipal(principal?: RequestPrincipal): TrustedCredentialPrincipal | undefined {
  return principal ? { tenantId: principal.tenantId, principalId: principal.userId } : undefined;
}

/**
 * Orchestrates run lifecycle: creation, execution, cancellation, retry,
 * and agent testing. Delegates approval handling to ApprovalManager and
 * graph streaming to GraphRunner.
 */
export class RunExecutor {
  private checkpointers = new Map<string, BaseCheckpointSaver>();
  private pausedContext = new Map<string, PausedContext>();
  private branchControllers = new Map<string, Map<string, AbortController>>();
  private approvalManager: ApprovalManager;
  private graphRunner: GraphRunner;

  constructor(
    private readonly store: RunStoreContract = new InMemoryRunStore(),
    private readonly agentRuntime: Pick<AgentRuntime, "execute"> = new AgentRuntime(),
    private readonly checkpointer?: CompileOptions["checkpointer"],
    private readonly telemetry: ExecutionTelemetry = ExecutionTelemetry.disabled(),
    private readonly guardrails: RuntimeGuardrails = runtimeGuardrailsFromEnvironment(),
    private readonly toolRuntime?: Pick<ToolRuntime, "execute">,
  ) {
    // Wire up the extracted managers with shared state.
    this.graphRunner = new GraphRunner(this.store, this.pausedContext, this.checkpointers);
    this.approvalManager = new ApprovalManager({
      store: this.store,
      checkpointers: this.checkpointers,
      pausedContext: this.pausedContext,
      branchControllers: this.branchControllers,
      agentRuntime: this.agentRuntime,
      toolRuntime: this.toolRuntime,
      guardrails: this.guardrails,
      credentialPrincipalForRun: (runId) => this.credentialPrincipalForRun(runId),
      appendAgentEvent: (runId, event) => this.appendAgentEvent(runId, event),
      runGraph: (runId, compiled, input, workflow, agents, memoryAccess, tools, stepBudget) =>
        this.graphRunner.runGraph(runId, compiled, input, workflow, agents, this.approvalManager, memoryAccess, tools, stepBudget, this.store.signal(runId), this.branchControllers.get(runId), this.guardrails.recursionLimit),
      signal: (runId) => this.store.signal(runId),
      fail: (runId, error) => this.fail(runId, error),
    });
  }

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
      this.store.update(runId, { status: "completed", completedAt: nowIso(), output, result: createResultEnvelope("success", { value: output }) });
      this.store.append(runId, { id: uid("event"), runId, type: "run.completed", timestamp: nowIso(), sequence: 0, payload: { output } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = Boolean(this.store.signal(runId)?.aborted);
      const result = cancelled
        ? createResultEnvelope("blocked", { error: { code: "RUN_CANCELLED", message: "Agent test was cancelled.", retryable: false } })
        : classifyRunFailure(error);
      this.store.update(runId, { status: cancelled ? "cancelled" : "failed", completedAt: nowIso(), error: message, result });
      this.store.append(runId, { id: uid("event"), runId, type: cancelled ? "run.cancelled" : "run.failed", timestamp: nowIso(), sequence: 0, payload: { error: message, ...(cancelled ? { cancelled: true } : {}) } });
    }
  }

  start(request: RunCreateRequest, memoryAccess?: MemoryAccessContext, principal?: RequestPrincipal) {
    const issues = validateWorkflow(request.workflow, request.agents, this.guardrails, request.tools);
    const errors = issues.filter(issue => issue.level === "error");
    if (errors.length) throw new Error(errors.map(issue => `${issue.code}: ${issue.message}`).join(" "));
    this.assertRunInputContract(request);
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
      this.store.update(runId, {
        status: "cancelled",
        completedAt: nowIso(),
        result: createResultEnvelope("blocked", { error: { code: "RUN_CANCELLED", message: "Run was cancelled while waiting for a human.", retryable: false } }),
      });
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

  /** Delegate approval resolution to ApprovalManager. */
  resolveApproval(runId: string, approvalId: string, decision: ApprovalDecisionRequest) {
    this.approvalManager.resolveApproval(runId, approvalId, decision);
  }

  /** Delegate approval timer rearming to ApprovalManager. */
  rearmApprovalTimers(runId: string) {
    this.approvalManager.rearmApprovalTimers(runId);
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
      // `memory` is workflow/shared execution state; `workingMemory` is the
      // separate run-scoped knowledge channel. Both start empty for a new run.
      await this.graphRunner.runGraph(runId, compiled, { input: request.input ?? {}, output: {}, memory: {}, workingMemory: {} }, request.workflow, request.agents, this.approvalManager, memoryAccess, request.tools, stepBudget, this.store.signal(runId), this.branchControllers.get(runId), this.guardrails.recursionLimit);
    } catch (error) { this.fail(runId, error); } finally { clearTimeout(timeout); }
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
    const result = cancelled
      ? createResultEnvelope("blocked", { error: { code: "RUN_CANCELLED", message: "Run was cancelled.", retryable: false } })
      : classifyRunFailure(error);
    this.store.update(runId, { status: cancelled ? "cancelled" : "failed", completedAt: nowIso(), error: message, result });
    this.store.append(runId, {
      id: uid("event"), runId, type: cancelled ? "run.cancelled" : "run.failed", timestamp: nowIso(), sequence: 0,
      payload: {
        error: message,
        ...(cancelled ? { cancelled: true } : {}),
        resultStatus: result.status,
        ...(result.error ? { code: result.error.code } : {}),
      },
    });
    const logPayload = { runId, workflowId: this.store.get(runId)?.run.workflowId, taskId: this.store.get(runId)?.run.taskId, error: message, resultStatus: result.status, ...(result.error ? { code: result.error.code } : {}) };
    if (cancelled) log.info("run.cancelled", logPayload);
    else log.error("run.failed", logPayload);
  }

  /**
   * Server-authoritative run input contract: schema + payload bounds are
   * enforced before any execution happens, regardless of what the client
   * validated in the browser.
   */
  private assertRunInputContract(request: RunCreateRequest) {
    const inputNode = request.workflow.nodes.find((node) => node.type === "input");
    const contract = migrateNodeContract(inputNode?.contract);
    if (!contract) return;
    const input = request.input ?? {};
    if (contract.inputSchema) {
      const validation = validateAgainstSchema(contract.inputSchema, input);
      if (!validation.valid) {
        throw new ContractViolationError("INPUT_CONTRACT_VIOLATION", "Run input does not match the workflow input contract", {
          nodeId: inputNode?.id,
          diagnostics: diagnosticsFromValidation(validation),
        });
      }
    }
    if (contract.maxPayloadBytes !== undefined) {
      const bytes = Buffer.byteLength(JSON.stringify(input) ?? "", "utf8");
      if (bytes > contract.maxPayloadBytes) {
        throw new ContractViolationError("PAYLOAD_TOO_LARGE", `Run input of ${bytes} bytes exceeds the declared ${contract.maxPayloadBytes}-byte bound`, {
          nodeId: inputNode?.id,
          diagnostics: [{ code: "PAYLOAD_TOO_LARGE", message: "Run input exceeded declared byte bound", path: "$" }],
        });
      }
    }
  }
}

/**
 * Map an execution error to the deterministic result taxonomy so validation
 * failures, operational failures, policy rejections, blocked execution, and
 * unknown/ambiguous outcomes stay distinguishable in persisted run state.
 */
export function classifyRunFailure(error: unknown): NodeResultEnvelope {
  if (error instanceof NodeOutcomeError) return error.envelope;
  if (error instanceof ContractViolationError) return error.envelope;
  if (error instanceof BranchRoutingError) return error.envelope;
  if (error instanceof ToolPolicyError) {
    return createResultEnvelope("policy_rejected", {
      error: { code: "TOOL_POLICY_REJECTED", message: (error.message || "Tool execution was rejected by server policy").slice(0, 300), retryable: false },
    });
  }
  if (error instanceof WorkflowStepLimitError) {
    return createResultEnvelope("blocked", {
      error: { code: "WORKFLOW_STEP_LIMIT", message: `Workflow exceeded the server-owned ${error.limit}-step execution limit`, retryable: false },
    });
  }
  if (error instanceof AgentExecutionFailedError) {
    return createResultEnvelope("failed", {
      error: { code: "AGENT_EXECUTION_FAILED", message: (error.message || "Agent execution failed").slice(0, 300), retryable: true },
    });
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "AbortError") {
    return createResultEnvelope("blocked", { error: { code: "RUN_CANCELLED", message: "Execution was cancelled.", retryable: false } });
  }
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  return createResultEnvelope("failed", { error: { code: "RUN_EXECUTION_FAILED", message: message || "Run execution failed", retryable: true } });
}
