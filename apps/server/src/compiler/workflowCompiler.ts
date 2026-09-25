import { Annotation, END, START, StateGraph, MemorySaver, interrupt, type BaseCheckpointSaver } from "@langchain/langgraph";
import {
  nowIso,
  validateAgent,
  BRANCH_ROUTING_ERROR_CODE,
  ContractViolationError,
  createResultEnvelope,
  diagnosticsFromValidation,
  enforcePayloadBound,
  enforceSchema,
  migrateNodeContract,
  parseResultEnvelope,
  resolveBranchRoute,
  validateAgainstSchema,
  type AgentRecord,
  type ApprovalNodeConfig,
  type BranchRouteReason,
  type NodeContract,
  type NodeResultEnvelope,
  type NodeRetryPolicy,
  type ToolRecord,
  type WorkflowDefinition,
  type WorkflowNode,
} from "@multi-agent/types";
import { AgentRuntime, AgentExecutionFailedError, type TrustedCredentialPrincipal } from "../../../../src/agents/runtime";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import { mergeHistories, type ShortTermHistories } from "../../../../src/agents/runtime/shortTermMemory";
import { buildHandoff, type AgentHandoff } from "../../../../src/agents/runtime/handoff";
import {
  ALLOW_WORKFLOW_SCOPE,
  applyWorkingMemoryUpdates,
  mergeWorkingMemory,
  type WorkingMemoryEntries,
  type WorkingMemoryScopePolicy,
} from "../../../../src/agents/runtime/workingMemory";
import { validateWorkflow } from "./validation";
import { ToolRuntime } from "../../../../src/tools";
import { AbortableSemaphore } from "../runtime/semaphore";
import { abortableDelay, abortError, coerceBranchCarrier, combineSignals, isGraphInterrupt, retryDelay, asToolInput } from "../runtime/execUtils";

export class UnsupportedPhase4NodeError extends Error {
  constructor(public readonly nodeId: string, node: WorkflowNode) {
    super(`Node "${nodeId}" type "${node.type}" is not supported in Phase 4`);
    this.name = "UnsupportedPhase4NodeError";
  }
}

export interface RuntimeState {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  memory: Record<string, unknown>;
  shortTermHistories?: ShortTermHistories;
  handoffs?: Record<string, AgentHandoff>;
  /** Run-scoped structured knowledge; distinct from `memory` (workflow state). */
  workingMemory?: WorkingMemoryEntries;
  branch?: string;
  lastValue?: unknown;
  /** Structured result envelope produced by the most recently executed node. */
  lastOutcome?: NodeResultEnvelope;
  /** Structured result envelope per executed node, keyed by node id. */
  nodeOutcomes?: Record<string, NodeResultEnvelope>;
  nodeResults?: Record<string, unknown>;
}

const State = Annotation.Root({
  shortTermHistories: Annotation<ShortTermHistories>({ reducer: mergeHistories, default: () => ({}) }),
  input: Annotation<Record<string, unknown>>({ reducer: (_, next) => next, default: () => ({}) }),
  output: Annotation<Record<string, unknown>>({ reducer: (_, next) => next, default: () => ({}) }),
  memory: Annotation<Record<string, unknown>>({
    reducer: (current, next) => ({ ...current, ...next }),
    default: () => ({}),
  }),
  branch: Annotation<string | undefined>({ reducer: (_, next) => next, default: () => undefined }),
  lastValue: Annotation<unknown>({ reducer: (_, next) => next, default: () => undefined }),
  lastOutcome: Annotation<NodeResultEnvelope | undefined>({ reducer: (_, next) => next, default: () => undefined }),
  nodeOutcomes: Annotation<Record<string, NodeResultEnvelope>>({
    reducer: (current, next) => ({ ...current, ...next }),
    default: () => ({}),
  }),
  nodeResults: Annotation<Record<string, unknown>>({
    reducer: (current, next) => ({ ...current, ...next }),
    default: () => ({}),
  }),
  handoffs: Annotation<Record<string, AgentHandoff>>({
    reducer: (current, next) => ({ ...current, ...next }),
    default: () => ({}),
  }),
  // Append/update keyed by stable entry id, so parallel branches merge instead of
  // overwriting each other.
  workingMemory: Annotation<WorkingMemoryEntries>({
    reducer: mergeWorkingMemory,
    default: () => ({}),
  }),
});

export type CompiledWorkflow = ReturnType<StateGraph<typeof State["State"], typeof State["Node"]>["compile"]>;

export interface AgentExecutionEvent {
  type: string;
  timestamp: string;
  payload?: unknown;
  agentId?: string;
  nodeId?: string;
  runId?: string;
}

export interface CompileOptions {
  signal?: AbortSignal;
  runtime?: Pick<AgentRuntime, "execute">;
  memoryAccess?: MemoryAccessContext;
  /** Server-authenticated identity only; never populate from workflow/agent fields. */
  credentialPrincipal?: TrustedCredentialPrincipal;
  /** A stable run identity enables checkpoints; anonymous compilation stays stateless. */
  checkpointer?: BaseCheckpointSaver | false;
  /** @deprecated Prefer AgentRuntime via the default path; kept for tests/overrides. */
  agentRunner?: (
    agent: AgentRecord,
    state: RuntimeState,
    meta: { runId: string; nodeId: string; signal?: AbortSignal }
  ) => Promise<unknown>;
  runId?: string;
  workflowId?: string;
  onAgentEvent?: (event: AgentExecutionEvent) => void;
  tools?: ToolRecord[];
  toolRuntime?: Pick<ToolRuntime, "execute">;
  /** Mutable per-run counter retained when an approval resumes with a newly compiled graph. */
  stepBudget?: { count: number };
  /** Per-conditional-branch signals owned by the server scheduler. */
  branchSignals?: ReadonlyMap<string, AbortSignal | AbortController>;
  guardrails?: {
    maxWorkflowSteps: number;
    maxConcurrentBranches: number;
    maxNodeRetryAttempts: number;
    maxNodeRetryBackoffMs: number;
  };
  /**
   * Server-owned authorization for workflow-shared working memory. Model output
   * can never widen its own scope; the runtime decides here.
   */
  workingMemoryScopePolicy?: WorkingMemoryScopePolicy;
  /** Durable proposal retained while a structured agent result awaits approval. */
  pendingHuman?: { nodeId: string; envelope: NodeResultEnvelope };
}

export function compileWorkflow(
  definition: WorkflowDefinition,
  agents: AgentRecord[],
  options: CompileOptions = {}
) {
  const issues = validateWorkflow(definition, agents, {}, options.tools);
  if (issues.some((issue) => issue.severity === "error")) {
    throw new Error(issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("; "));
  }
  const graph = new StateGraph(State);
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const runId = options.runId ?? "run-local";
  const runtime = options.runtime ?? new AgentRuntime();
  const toolsById = new Map((options.tools ?? []).map(tool => [tool.id, tool]));
  const toolRuntime = options.toolRuntime ?? new ToolRuntime();
  const guardrails = options.guardrails ?? {
    maxWorkflowSteps: 1_000,
    maxConcurrentBranches: 8,
    maxNodeRetryAttempts: 3,
    maxNodeRetryBackoffMs: 30_000,
  };
  const executionSlots = new AbortableSemaphore(guardrails.maxConcurrentBranches);
  const stepBudget = options.stepBudget ?? { count: 0 };

  for (const node of definition.nodes) {
    // Author-declared contract for this node; legacy nodes carry none.
    const contract: NodeContract | undefined = migrateNodeContract(node.contract);
    graph.addNode(node.id, async (state: RuntimeState) => {
      const emit = (type: string, payload: unknown = {}) => options.onAgentEvent?.({ type, timestamp: nowIso(), runId, nodeId: node.id, payload });
      const retry = resolveRetryPolicy(node, agentById, toolsById, guardrails);
      const nodeInput = valueForNode(node, state, definition);
      const executionState = { ...state, lastValue: nodeInput };
      const branchKey = state.branch;
      const branchEntry = branchKey ? options.branchSignals?.get(branchKey) : undefined;
      const branchSignal = branchEntry instanceof AbortController ? branchEntry.signal : branchEntry;
      if (branchSignal?.aborted) {
        emit("branch.skipped", { branchKey, nodeType: node.type, reason: "branch_cancelled" });
        return { lastValue: state.lastValue, nodeResults: { [node.id]: state.lastValue } };
      }
      for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
        const signal = combineSignals(options.signal, branchSignal);
        const release = await executionSlots.acquire(signal);
        stepBudget.count += 1;
        const step = stepBudget.count;
        if (step > guardrails.maxWorkflowSteps) {
          release();
          throw new WorkflowStepLimitError(guardrails.maxWorkflowSteps);
        }
        emit("node.started", { nodeType: node.type, attempt, maxAttempts: retry.maxAttempts, step });
        try {
          // Boundary 1: validate the node's input before it executes.
          enforceNodeInput(node, contract, node.type === "input" ? state.input : nodeInput);
          let result: Partial<RuntimeState>;
          let outcome: NodeResultEnvelope | undefined;
          if (node.type === "tool") {
            const tool = toolsById.get((node.config as { toolId?: string | null }).toolId ?? "");
            if (!tool) throw new UnsupportedPhase4NodeError(node.id, node);
            emit("tool.started", { toolId: tool.id, name: tool.name, impact: tool.impact });
            try {
              const value = await toolRuntime.execute(tool, asToolInput(nodeInput ?? state.input), signal, { runId, credentialPrincipal: options.credentialPrincipal, idempotencyKey: `${runId}:${node.id}` });
              // Boundary 2: validate and bound the tool's output before it
              // enters workflow state or any event stream.
              if (contract?.outputSchema) {
                enforceSchema(contract.outputSchema, value, { code: "TOOL_OUTPUT_INVALID", phase: "node output", nodeId: node.id });
              }
              enforcePayloadBound(value, contract?.maxPayloadBytes, { nodeId: node.id, phase: "tool output" });
              emit("tool.completed", { toolId: tool.id, output: value });
              result = { lastValue: value };
              outcome = createResultEnvelope("success", {
                value,
                ...(contract?.captureEvidence ? { evidence: { source: "tool", producedAt: nowIso(), detail: tool.name, runId, nodeId: node.id, producerId: tool.id } } : {}),
              });
            } catch (error) {
              emit("tool.failed", { toolId: tool.id, error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000), ...(error instanceof ContractViolationError ? { code: error.code } : {}) });
              throw error;
            }
          } else if (node.type === "approval") {
            if (state.branch === "approved" || state.branch === "rejected") {
              result = { branch: state.branch, lastValue: state.lastValue };
            } else {
              const config = node.config as ApprovalNodeConfig;
              // interrupt() throws a graph-control exception on the first pass. It is
              // intentionally allowed through without becoming a node failure.
              const resume = interrupt({
                nodeId: node.id,
                message: config.message,
                approvalType: config.approvalType,
                timeoutSeconds: config.timeoutSeconds,
                context: nodeInput ?? state.input,
              }) as { decision?: string; response?: string } | undefined;
              result = { branch: resume?.decision, lastValue: { decision: resume?.decision, response: resume?.response } };
            }
          } else if (node.type === "input") {
            result = { input: state.input, lastValue: state.input };
          } else if (node.type === "output") {
            result = {
              output:
                nodeInput && typeof nodeInput === "object"
                  ? (nodeInput as Record<string, unknown>)
                  : nodeInput === undefined ? state.input : { content: nodeInput },
            };
          } else if (node.type === "memory") {
            const config = node.config as { mode: string; key: string };
            if (config.mode === "read") result = { lastValue: state.memory[config.key] };
            else {
              const value = nodeInput ?? state.input;
              result = { memory: { [config.key]: value }, lastValue: value };
            }
            emit(config.mode === "read" ? "memory.read" : "memory.write", { key: config.key, mode: config.mode });
          } else if (node.type === "condition") {
            const config = node.config as { branches: { key: string }[]; valueSource?: "input" | "last_value"; valueField?: string; unknownRoute?: string; errorRoute?: string };
            // CLI agents often return JSON text; coerce so branch keys transfer through workflow state.
            const routedValue = coerceBranchCarrier(state.lastValue);
            const carrier = routedValue && typeof routedValue === "object" && !Array.isArray(routedValue)
              ? routedValue as Record<string, unknown>
              : undefined;
            // The producing node's declared envelope branch is the most
            // structured carrier signal; raw carrier fields remain supported
            // for legacy input-based routing.
            const outcomeBranch = typeof state.lastOutcome?.branch === "string" && state.lastOutcome.branch.trim()
              ? state.lastOutcome.branch
              : undefined;
            const fieldOrOutcome = (field?: string): unknown => {
              if (field) return carrier ? carrier[field] : undefined;
              if (outcomeBranch !== undefined) return outcomeBranch;
              return carrier ? branchCarrierField(carrier) : undefined;
            };
            const requested = config.valueSource === "last_value"
              ? fieldOrOutcome(config.valueField)
              : state.input.branch ?? state.input.condition ?? state.input["branchKey"] ?? fieldOrOutcome(config.valueField);
            // Boundary 3: resolve the branch carrier fail-closed. An
            // unresolved route never falls through to the first branch.
            const resolution = resolveBranchRoute(config, requested);
            if (resolution.status === "unknown") {
              throw new BranchRoutingError(node.id, resolution);
            }
            result = { branch: resolution.branch, lastValue: routedValue ?? state.lastValue };
            emit("state.updated", {
              branch: resolution.branch,
              routeReason: resolution.reason,
              ...(resolution.viaUnknownRoute ? { viaUnknownRoute: true } : {}),
            });
          } else {
            const config = node.config as { agentId?: string | null };
            const agent = config.agentId ? agentById.get(config.agentId) : undefined;
            if (!agent) throw new Error(`Agent node "${node.id}" has no linked agent`);
            if (agent.enabled === false) throw new Error(`Agent "${agent.name}" is disabled`);
            const agentErrors = validateAgent(agent);
            if (agentErrors.length) throw new Error(agentErrors.join(" "));

            let shortTermHistories: ShortTermHistories = {};
            let workingMemoryCandidates: unknown[] = [];
            let agentFailed = false;
            let agentError: string | undefined;
            let value: unknown;
            const pendingHuman = options.pendingHuman?.nodeId === node.id ? options.pendingHuman : undefined;
            if (pendingHuman) {
              // LangGraph re-enters the node after resume. Replaying the provider
              // call would duplicate an external side effect, so replay the same
              // interrupt and consume only the human decision.
              const decision = interrupt({
                nodeId: node.id,
                message: pendingHuman.envelope.needsHuman?.reason ?? "Human approval required",
                approvalType: "manual",
                timeoutSeconds: 0,
                context: { kind: "agent_needs_human", envelope: pendingHuman.envelope },
              }) as { decision?: string } | string;
              const approved = typeof decision === "string" ? decision === "approved" : decision?.decision === "approved";
              if (!approved) {
                throw new NodeOutcomeError(createResultEnvelope("blocked", {
                  error: { code: "HUMAN_REJECTED", message: "Human rejected the agent proposal.", retryable: false },
                }), node.id);
              }
              value = "value" in pendingHuman.envelope ? pendingHuman.envelope.value : pendingHuman.envelope;
              outcome = createResultEnvelope("success", {
                value,
                ...(pendingHuman.envelope.branch ? { branch: pendingHuman.envelope.branch } : {}),
                ...(contract?.captureEvidence && !pendingHuman.envelope.evidence
                  ? { evidence: { source: "agent", producedAt: nowIso(), detail: agent.id, runId, nodeId: node.id, producerId: agent.id } }
                  : pendingHuman.envelope.evidence ? { evidence: pendingHuman.envelope.evidence } : {}),
              });
              options.pendingHuman = undefined;
            } else {
              value = options.agentRunner
                ? await options.agentRunner(agent, executionState, { runId, nodeId: node.id, signal })
                : await runAgentThroughRuntime(agent, executionState, {
                  runId,
                  nodeId: node.id,
                  workflowId: options.workflowId ?? definition.id,
                  onAgentEvent: options.onAgentEvent,
                  runtime,
                  memoryAccess: options.memoryAccess,
                  credentialPrincipal: options.credentialPrincipal,
                  onShortTermUpdate: update => { shortTermHistories = mergeHistories(shortTermHistories, update); },
                  onWorkingMemoryUpdate: updates => { workingMemoryCandidates = updates; },
                  signal,
                  onError: (err) => { agentFailed = true; agentError = err; },
                });
            }

            // Deterministic result model: parse a structured result envelope
            // instead of inferring decisions from free-form model text.
            const parsedResult = parseResultEnvelope(value);
            if (parsedResult.kind === "malformed") {
              throw new ContractViolationError("AGENT_RESULT_MALFORMED", "Agent produced a malformed structured result", {
                nodeId: node.id,
                diagnostics: parsedResult.diagnostics,
              });
            }
            let agentValue = value;
            if (parsedResult.kind === "valid") {
              const envelope = parsedResult.envelope;
              if (contract?.outputSchema && "value" in envelope) {
                enforceSchema(contract.outputSchema, envelope.value, { code: "AGENT_OUTPUT_INVALID", phase: "node output", nodeId: node.id });
              }
              enforcePayloadBound("value" in envelope ? envelope.value : envelope, contract?.maxPayloadBytes, { nodeId: node.id, phase: "agent result" });
              // Invalid, policy-rejected, unknown, and blocked outcomes are
              // terminal. A needs-human result pauses here and resumes with
              // the exact bounded proposal, without replaying the agent call.
              if (envelope.status === "needs_human") {
                options.pendingHuman = { nodeId: node.id, envelope };
                interrupt({
                  nodeId: node.id,
                  message: envelope.needsHuman?.reason ?? "Human approval required",
                  approvalType: "manual",
                  timeoutSeconds: 0,
                  context: { kind: "agent_needs_human", envelope },
                });
                throw new NodeOutcomeError(envelope, node.id);
              }
              // A typed `failed` result must carry an explicit branch to route.
              if (envelope.status !== "success" && envelope.status !== "failed") {
                throw new NodeOutcomeError(envelope, node.id);
              }
              if (envelope.status === "failed" && !(typeof envelope.branch === "string" && envelope.branch.trim())) {
                throw new NodeOutcomeError(envelope, node.id);
              }
              outcome = contract?.captureEvidence && !envelope.evidence
                ? { ...envelope, evidence: { source: "agent", producedAt: nowIso(), detail: agent.id, runId, nodeId: node.id, producerId: agent.id } }
                : envelope;
              agentValue = "value" in envelope ? envelope.value : envelope;
            } else {
              if (contract?.outputSchema) {
                enforceSchema(contract.outputSchema, value, { code: "AGENT_OUTPUT_INVALID", phase: "node output", nodeId: node.id });
              }
              enforcePayloadBound(value, contract?.maxPayloadBytes, { nodeId: node.id, phase: "agent result" });
              outcome = createResultEnvelope("success", {
                value,
                ...(contract?.captureEvidence ? { evidence: { source: "agent", producedAt: nowIso(), detail: agent.id, runId, nodeId: node.id, producerId: agent.id } } : {}),
              });
            }

            const workflowId = options.workflowId ?? definition.id;
            // Build structured handoff from agent output
            const handoff = buildHandoff({
              runId,
              workflowId,
              sourceNodeId: node.id,
              sourceAgentId: agent.id,
              rawOutput: value,
              succeeded: !agentFailed,
              error: agentError,
            });
            // Working memory is deliberately a separate channel from handoff and from
            // `state.memory` (workflow state). Model output is untrusted: updates are
            // validated against server-owned scope policy and only accepted entries
            // reach graph state. Malformed optional updates never fail this node.
            // Candidates are untrusted; the runtime already stripped the channel from
            // `value`, so nothing here can leak it into handoff, history or node values.
            const workingMemoryWrite = applyWorkingMemoryUpdates(state.workingMemory ?? {}, workingMemoryCandidates, {
              runId,
              workflowId,
              nodeId: node.id,
              agentId: agent.id,
              handoffId: handoff.id,
              scopePolicy: options.workingMemoryScopePolicy ?? ALLOW_WORKFLOW_SCOPE,
            });
            if (workingMemoryWrite.diagnostics.received > 0) {
              // Counts and rejection reasons only; entry contents are never logged.
              emit("log", { kind: "working_memory.updated", agentId: agent.id, ...workingMemoryWrite.diagnostics });
            }
            const handoffs = { [node.id]: handoff };
            result = {
              lastValue: agentValue,
              shortTermHistories,
              handoffs,
              workingMemory: workingMemoryWrite.entries,
            };
          }
          if (branchSignal?.aborted && !options.signal?.aborted) {
            emit("branch.skipped", { branchKey, nodeType: node.type, reason: "branch_cancelled" });
            return { lastValue: state.lastValue, nodeResults: { [node.id]: state.lastValue } };
          }
          const nodeValue = result.output ?? result.lastValue;
          // Boundary 4: validate and bound the node's structured result before
          // it enters workflow state, events, or persistence. Tool and agent
          // nodes validated their outputs with their own stable codes above.
          if (node.type !== "agent" && node.type !== "tool") {
            if (contract?.outputSchema) {
              enforceSchema(contract.outputSchema, nodeValue, { code: "NODE_OUTPUT_INVALID", phase: "node output", nodeId: node.id });
            }
            enforcePayloadBound(nodeValue, contract?.maxPayloadBytes, { nodeId: node.id, phase: "node output" });
          }
          outcome ??= createResultEnvelope("success", {
            value: nodeValue,
            ...(result.branch ? { branch: result.branch } : {}),
            ...(contract?.captureEvidence ? { evidence: { source: node.type, producedAt: nowIso(), runId, nodeId: node.id } } : {}),
          });
          result.lastOutcome = outcome;
          result.nodeOutcomes = { [node.id]: outcome };
          result.nodeResults = { [node.id]: nodeValue };
          emit("node.completed", { nodeType: node.type, attempt, maxAttempts: retry.maxAttempts, step });
          const branch = result.branch;
          for (const edge of definition.edges.filter((candidate) => candidate.source === node.id)) {
            if (edge.kind === "conditional" && edge.branchKey !== branch) continue;
            emit("edge.traversed", { edgeId: edge.id, source: edge.source, target: edge.target, branchKey: edge.branchKey });
          }
          return result;
        } catch (error) {
          if (isGraphInterrupt(error)) throw error;
          if (branchSignal?.aborted && !options.signal?.aborted) {
            emit("branch.skipped", { branchKey, nodeType: node.type, reason: "branch_cancelled" });
            return { lastValue: state.lastValue, nodeResults: { [node.id]: state.lastValue } };
          }
          const terminalContractFailure = error instanceof ContractViolationError || error instanceof BranchRoutingError || error instanceof NodeOutcomeError;
          const terminal = terminalContractFailure || attempt >= retry.maxAttempts || Boolean(signal?.aborted);
          // Diagnostics stay machine-readable, bounded, and value-free.
          const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
          const failureCode = terminalContractFailure ? (error as { code?: string }).code : undefined;
          const failureDiagnostics = terminalContractFailure ? (error as { diagnostics?: unknown[] }).diagnostics : undefined;
          emit("node.failed", {
            nodeType: node.type,
            error: message,
            attempt,
            maxAttempts: retry.maxAttempts,
            terminal,
            step,
            ...(failureCode ? { code: failureCode } : {}),
            ...(Array.isArray(failureDiagnostics) && failureDiagnostics.length ? { diagnostics: failureDiagnostics } : {}),
          });
          if (terminal) throw error;
          const delayMs = retryDelay(retry, attempt, guardrails.maxNodeRetryBackoffMs);
          emit("node.retrying", { nodeType: node.type, attempt, nextAttempt: attempt + 1, maxAttempts: retry.maxAttempts, delayMs, reason: message });
          release();
          await abortableDelay(delayMs, signal);
        } finally {
          release();
        }
      }
      throw new Error(`Node "${node.id}" exhausted its retry budget`);
    });
  }

  for (const edge of definition.edges) {
    const source = nodesById.get(edge.source);
    if (source?.type === "condition" || edge.kind === "conditional") continue;
    // Dynamic workflow node ids are not in the static StateGraph type map.
    (graph as { addEdge: (a: string, b: string) => void }).addEdge(edge.source, edge.target);
  }
  for (const node of definition.nodes.filter((candidate) => candidate.type === "condition" || candidate.type === "approval")) {
    const outgoing = definition.edges.filter((edge) => edge.source === node.id && edge.kind === "conditional");
    // A plain (non-conditional) edge out of an approval node already routes via the addEdge loop above.
    if (!outgoing.length) continue;
    const destinations: Record<string, string> = {};
    for (const edge of outgoing) destinations[edge.branchKey] = edge.target;
    (graph as { addConditionalEdges: (...args: unknown[]) => void }).addConditionalEdges(
      node.id,
      (state: RuntimeState) => state.branch ?? "__end__",
      { ...destinations, __end__: END }
    );
  }
  const input = definition.nodes.find((node) => node.type === "input");
  const output = definition.nodes.find((node) => node.type === "output");
  if (input) (graph as { addEdge: (a: string, b: string) => void }).addEdge(START, input.id);
  if (output) (graph as { addEdge: (a: string, b: string) => void }).addEdge(output.id, END);
  const compiled = graph.compile({ checkpointer: options.runId ? (options.checkpointer ?? new MemorySaver()) : undefined });
  return {
    graph: options.runId ? compiled.withConfig({ configurable: { thread_id: runId } }) : compiled,
    agentByNode: new Map(
      definition.nodes
        .filter((node) => node.type === "agent")
        .map((node) => [node.id, agentById.get((node.config as { agentId?: string | null }).agentId ?? "")])
    ),
    issues,
  };
}

export class WorkflowStepLimitError extends Error {
  constructor(public readonly limit: number) {
    super(`Workflow exceeded the server-owned ${limit}-step execution limit`);
    this.name = "WorkflowStepLimitError";
  }
}

/**
 * Fail-closed condition routing failure. Raised whenever the requested branch
 * is missing, malformed, not declared, incorrectly typed, ambiguous, or
 * otherwise unresolvable and no unknown/error route was declared. The runtime
 * never substitutes the first configured branch.
 */
export class BranchRoutingError extends Error {
  readonly code = BRANCH_ROUTING_ERROR_CODE;
  readonly nodeId: string;
  readonly reason: BranchRouteReason;
  readonly diagnostics: { code: string; message: string; path?: string }[];
  readonly envelope: NodeResultEnvelope;

  constructor(nodeId: string, resolution: { reason: BranchRouteReason }) {
    // Never include the requested value: it may carry model output or secrets.
    super(`${BRANCH_ROUTING_ERROR_CODE}: node "${nodeId}" could not resolve a declared branch (reason: ${resolution.reason})`);
    this.name = "BranchRoutingError";
    this.nodeId = nodeId;
    this.reason = resolution.reason;
    this.diagnostics = [{ code: BRANCH_ROUTING_ERROR_CODE, message: `branch resolution failed: ${resolution.reason}`, path: "$.branch" }];
    this.envelope = createResultEnvelope("unknown", {
      error: { code: BRANCH_ROUTING_ERROR_CODE, message: `Branch resolution failed (${resolution.reason})`, retryable: false },
      diagnostics: this.diagnostics,
    });
  }
}

/**
 * A node produced a deterministic structured outcome that terminates the run:
 * blocked execution, needs-human approval without an approval node, a typed
 * failure with no explicit route, or an invalid/policy/unknown envelope.
 * The envelope is preserved as the run's structured result.
 */
export class NodeOutcomeError extends Error {
  readonly code: string;
  readonly nodeId: string;
  readonly envelope: NodeResultEnvelope;
  readonly diagnostics: { code: string; message: string; path?: string }[];

  constructor(envelope: NodeResultEnvelope, nodeId: string) {
    const fallbackByStatus: Record<string, string> = {
      blocked: "NODE_BLOCKED",
      needs_human: "NEEDS_HUMAN",
      failed: "NODE_FAILED",
      validation_failed: "RESULT_VALIDATION_FAILED",
      policy_rejected: "RESULT_POLICY_REJECTED",
      unknown: "RESULT_UNKNOWN",
    };
    const code = envelope.error?.code ?? fallbackByStatus[envelope.status] ?? "NODE_FAILED";
    const message = envelope.error?.message ?? envelope.needsHuman?.reason ?? `Node "${nodeId}" produced a ${envelope.status} structured result`;
    super(`${code}: ${message}`.slice(0, 1_000));
    this.name = "NodeOutcomeError";
    this.code = code;
    this.nodeId = nodeId;
    // Preserve the producer's envelope; only attach a machine-readable error
    // code when the producer did not declare one.
    this.envelope = envelope.error ? envelope : { ...envelope, error: { code, message, retryable: false } };
    this.diagnostics = envelope.diagnostics ?? [{ code, message: `structured result status: ${envelope.status}`, path: "$.status" }];
  }
}

/** Enforce a node's declared input contract before execution. */
function enforceNodeInput(node: WorkflowNode, contract: NodeContract | undefined, carrier: unknown): void {
  if (!contract) return;
  if (contract.inputSchema) {
    const code = node.type === "tool" ? "TOOL_INPUT_INVALID" : node.type === "agent" ? "AGENT_INPUT_INVALID" : "NODE_INPUT_INVALID";
    enforceSchema(contract.inputSchema, carrier, { code, phase: "node input", nodeId: node.id });
  }
  enforcePayloadBound(carrier, contract.maxPayloadBytes, { nodeId: node.id, phase: "node input" });
}

/** Raw branch-carrier field lookup (no prose inference; strings only upstream). */
function branchCarrierField(value: Record<string, unknown>): unknown {
  return value.branch ?? value.branchKey ?? value.verdict ?? value.status;
}

export { coerceBranchCarrier } from "../runtime/execUtils";

function valueForNode(node: WorkflowNode, state: RuntimeState, definition: WorkflowDefinition): unknown {
  // Routers in a loop must observe the immediately preceding value. Join nodes,
  // however, receive every completed predecessor keyed by stable node id.
  if (node.type === "condition" || node.type === "input") return state.lastValue;
  const incomingEdges = definition.edges.filter((edge) => edge.target === node.id);
  // Output nodes can explicitly select the active route. This is needed for
  // workflows where gate nodes also point to the output, while ordinary output
  // nodes retain join semantics for parallel fan-in.
  if (node.type === "output" && (node.config as { inputMode?: string }).inputMode === "last_value") return state.lastValue;
  const incoming = incomingEdges.map((edge) => edge.source);
  if (incoming.length < 2) return state.lastValue;
  const results = state.nodeResults ?? {};
  const branches = Object.fromEntries(
    incoming.filter((source) => Object.prototype.hasOwnProperty.call(results, source)).map((source) => [source, results[source]]),
  );
  return Object.keys(branches).length > 1 ? { branches } : state.lastValue;
}

function resolveRetryPolicy(
  node: WorkflowNode,
  agents: Map<string, AgentRecord>,
  tools: Map<string, ToolRecord>,
  limits: CompileOptions["guardrails"] extends infer T ? NonNullable<T> : never,
): Required<NodeRetryPolicy> {
  const requested = node.retryPolicy;
  let eligible = false;
  if (node.type === "agent") {
    const agentId = (node.config as { agentId?: string | null }).agentId ?? "";
    const agent = agents.get(agentId);
    eligible = Boolean(agent && agent.backend.type !== "cli" && Array.isArray(agent.tools) && agent.tools.length === 0);
  } else if (node.type === "tool") {
    const toolId = (node.config as { toolId?: string | null }).toolId ?? "";
    const tool = tools.get(toolId);
    eligible = Boolean(tool && tool.impact === "read-only" && tool.metadata?.idempotent === true);
  }
  if (!requested || !eligible) return { maxAttempts: 1, backoffMs: 0, backoffMultiplier: 1 };
  return {
    maxAttempts: Math.max(1, Math.min(limits.maxNodeRetryAttempts, Math.floor(requested.maxAttempts))),
    backoffMs: Math.max(0, Math.min(limits.maxNodeRetryBackoffMs, Math.floor(requested.backoffMs))),
    backoffMultiplier: Math.max(1, Math.min(4, requested.backoffMultiplier ?? 2)),
  };
}

async function runAgentThroughRuntime(
  agent: AgentRecord,
  state: RuntimeState,
  meta: {
    runId: string;
    nodeId: string;
    workflowId: string;
    signal?: AbortSignal;
    runtime: Pick<AgentRuntime, "execute">;
    memoryAccess?: MemoryAccessContext;
    credentialPrincipal?: TrustedCredentialPrincipal;
    onShortTermUpdate: (update: ShortTermHistories) => void;
    onWorkingMemoryUpdate?: (updates: unknown[]) => void;
    onAgentEvent?: (event: AgentExecutionEvent) => void;
    onError?: (error: string) => void;
  }
): Promise<unknown> {
  let lastContent: unknown;
  for await (const event of meta.runtime.execute({
    agent,
    input: state.lastValue ?? state.input,
    runId: meta.runId,
    nodeId: meta.nodeId,
    workflowId: meta.workflowId,
    signal: meta.signal,
    memoryAccess: meta.memoryAccess,
    credentialPrincipal: meta.credentialPrincipal,
    shortTermHistories: state.shortTermHistories ?? {},
    onShortTermUpdate: meta.onShortTermUpdate,
    onWorkingMemoryUpdate: meta.onWorkingMemoryUpdate,
    onBackgroundEvent: meta.onAgentEvent,
    context: { memory: state.memory, branch: state.branch, previousOutput: state.lastValue },
    handoffs: state.handoffs,
    workingMemory: state.workingMemory ?? {},
  })) {
    meta.onAgentEvent?.(event);
    if (event.type === "agent.completed" || event.type === "agent.output") {
      const payload = event.payload as { content?: unknown } | undefined;
      lastContent = payload && "content" in payload ? payload.content : event.payload;
    }
    if (event.type === "agent.failed") {
      const errorMsg = (event.payload as { error?: string })?.error ?? "Agent execution failed";
      meta.onError?.(errorMsg);
      throw new AgentExecutionFailedError(errorMsg);
    }
  }
  return lastContent;
}
