import { Annotation, END, START, StateGraph, MemorySaver, interrupt, type BaseCheckpointSaver } from "@langchain/langgraph";
import { nowIso, validateAgent, type AgentRecord, type ApprovalNodeConfig, type NodeRetryPolicy, type ToolRecord, type WorkflowDefinition, type WorkflowNode } from "@multi-agent/types";
import { AgentRuntime, AgentExecutionFailedError, type TrustedCredentialPrincipal } from "../../../../src/agents/runtime";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import { mergeHistories, type ShortTermHistories } from "../../../../src/agents/runtime/shortTermMemory";
import { buildHandoff, type AgentHandoff } from "../../../../src/agents/runtime/handoff";
import { validateWorkflow } from "./validation";
import { ToolRuntime } from "../../../../src/tools";
import { AbortableSemaphore } from "../runtime/semaphore";
import { abortableDelay, abortError, branchValue, coerceBranchCarrier, combineSignals, isGraphInterrupt, retryDelay, asToolInput } from "../runtime/execUtils";

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
  branch?: string;
  lastValue?: unknown;
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
  nodeResults: Annotation<Record<string, unknown>>({
    reducer: (current, next) => ({ ...current, ...next }),
    default: () => ({}),
  }),
  handoffs: Annotation<Record<string, AgentHandoff>>({
    reducer: (current, next) => ({ ...current, ...next }),
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
          let result: Partial<RuntimeState>;
          if (node.type === "tool") {
            const tool = toolsById.get((node.config as { toolId?: string | null }).toolId ?? "");
            if (!tool) throw new UnsupportedPhase4NodeError(node.id, node);
            emit("tool.started", { toolId: tool.id, name: tool.name, impact: tool.impact });
            try {
              const value = await toolRuntime.execute(tool, asToolInput(nodeInput ?? state.input), signal, { runId, credentialPrincipal: options.credentialPrincipal });
              emit("tool.completed", { toolId: tool.id, output: value });
              result = { lastValue: value };
            } catch (error) {
              emit("tool.failed", { toolId: tool.id, error: error instanceof Error ? error.message : String(error) });
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
            const config = node.config as { branches: { key: string }[]; valueSource?: "input" | "last_value"; valueField?: string };
            // CLI agents often return JSON text; coerce so branch keys transfer through workflow state.
            const routedValue = coerceBranchCarrier(state.lastValue);
            const lastValueBranch = routedValue && typeof routedValue === "object"
              ? branchValue(routedValue as Record<string, unknown>, config.valueField)
              : undefined;
            const requested = config.valueSource === "last_value"
              ? lastValueBranch
              : state.input.branch ?? state.input.condition ?? state.input["branchKey"] ?? lastValueBranch;
            const branch =
              typeof requested === "string" && config.branches.some((item) => item.key === requested)
                ? requested
                : typeof requested === "string" && config.branches.some((item) => item.key === requested.toLowerCase())
                  ? requested.toLowerCase()
                : config.branches[0]?.key;
            result = { branch, lastValue: routedValue ?? state.lastValue };
            emit("state.updated", { branch });
          } else {
            const config = node.config as { agentId?: string | null };
            const agent = config.agentId ? agentById.get(config.agentId) : undefined;
            if (!agent) throw new Error(`Agent node "${node.id}" has no linked agent`);
            if (agent.enabled === false) throw new Error(`Agent "${agent.name}" is disabled`);
            const agentErrors = validateAgent(agent);
            if (agentErrors.length) throw new Error(agentErrors.join(" "));

            let shortTermHistories: ShortTermHistories = {};
            let agentFailed = false;
            let agentError: string | undefined;
            const value = options.agentRunner
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
                signal,
                onError: (err) => { agentFailed = true; agentError = err; },
              });

            // Build structured handoff from agent output
            const handoff = buildHandoff({
              runId,
              workflowId: options.workflowId ?? definition.id,
              sourceNodeId: node.id,
              sourceAgentId: agent.id,
              rawOutput: value,
              succeeded: !agentFailed,
              error: agentError,
            });
            const handoffs = { [node.id]: handoff };
            result = { lastValue: value, shortTermHistories, handoffs };
          }
          if (branchSignal?.aborted && !options.signal?.aborted) {
            emit("branch.skipped", { branchKey, nodeType: node.type, reason: "branch_cancelled" });
            return { lastValue: state.lastValue, nodeResults: { [node.id]: state.lastValue } };
          }
          const nodeValue = result.output ?? result.lastValue;
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
          const terminal = attempt >= retry.maxAttempts || Boolean(signal?.aborted);
          const message = error instanceof Error ? error.message : String(error);
          emit("node.failed", { nodeType: node.type, error: message, attempt, maxAttempts: retry.maxAttempts, terminal, step });
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
    onBackgroundEvent: meta.onAgentEvent,
    context: { memory: state.memory, branch: state.branch, previousOutput: state.lastValue },
    handoffs: state.handoffs,
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
