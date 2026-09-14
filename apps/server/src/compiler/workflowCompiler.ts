import { Annotation, END, START, StateGraph, MemorySaver, interrupt, type BaseCheckpointSaver } from "@langchain/langgraph";
import { nowIso, validateAgent, type AgentRecord, type ApprovalNodeConfig, type ToolRecord, type WorkflowDefinition, type WorkflowNode } from "@multi-agent/types";
import { AgentRuntime, AgentExecutionFailedError } from "../../../../src/agents/runtime";
import type { MemoryAccessContext } from "../../../../src/memory/contracts";
import { mergeHistories, type ShortTermHistories } from "../../../../src/agents/runtime/shortTermMemory";
import { validateWorkflow } from "./validation";
import { ToolRuntime } from "../../../../src/tools";

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
  branch?: string;
  lastValue?: unknown;
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
  /** A stable run identity enables checkpoints; anonymous compilation stays stateless. */
  checkpointer?: BaseCheckpointSaver | false;
  /** @deprecated Prefer AgentRuntime via the default path; kept for tests/overrides. */
  agentRunner?: (
    agent: AgentRecord,
    state: RuntimeState,
    meta: { runId: string; nodeId: string }
  ) => Promise<unknown>;
  runId?: string;
  workflowId?: string;
  onAgentEvent?: (event: AgentExecutionEvent) => void;
  tools?: ToolRecord[];
  toolRuntime?: Pick<ToolRuntime, "execute">;
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

  for (const node of definition.nodes) {
    graph.addNode(node.id, async (state: RuntimeState) => {
      const emit = (type: string, payload: unknown = {}) => options.onAgentEvent?.({ type, timestamp: nowIso(), runId, nodeId: node.id, payload });
      emit("node.started", { nodeType: node.type });
      try {
        let result: Partial<RuntimeState>;
        if (node.type === "tool") {
          const tool = toolsById.get((node.config as { toolId?: string | null }).toolId ?? "");
          if (!tool) throw new UnsupportedPhase4NodeError(node.id, node);
          emit("tool.started", { toolId: tool.id, name: tool.name, impact: tool.impact });
          try {
            const value = await toolRuntime.execute(tool, asToolInput(state.lastValue ?? state.input), options.signal);
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
              context: state.lastValue ?? state.input,
            }) as { decision?: string; response?: string } | undefined;
            result = { branch: resume?.decision, lastValue: { decision: resume?.decision, response: resume?.response } };
          }
        } else if (node.type === "input") {
          result = { input: state.input, lastValue: state.input };
        } else if (node.type === "output") {
          result = {
            output:
              state.lastValue && typeof state.lastValue === "object"
                ? (state.lastValue as Record<string, unknown>)
                : state.lastValue === undefined ? state.input : { content: state.lastValue },
          };
        } else if (node.type === "memory") {
          const config = node.config as { mode: string; key: string };
          if (config.mode === "read") result = { lastValue: state.memory[config.key] };
          else {
            const value = state.lastValue ?? state.input;
            result = { memory: { [config.key]: value }, lastValue: value };
          }
          emit(config.mode === "read" ? "memory.read" : "memory.write", { key: config.key, mode: config.mode });
        } else if (node.type === "condition") {
          const config = node.config as { branches: { key: string }[] };
          const lastValueBranch = state.lastValue && typeof state.lastValue === "object"
            ? (state.lastValue as { branch?: unknown; branchKey?: unknown }).branch ?? (state.lastValue as { branchKey?: unknown }).branchKey
            : undefined;
          const requested = state.input.branch ?? state.input.condition ?? state.input["branchKey"] ?? lastValueBranch;
          const branch =
            typeof requested === "string" && config.branches.some((item) => item.key === requested)
              ? requested
              : config.branches[0]?.key;
          result = { branch, lastValue: state.lastValue };
          emit("state.updated", { branch });
        } else {
          const config = node.config as { agentId?: string | null };
          const agent = config.agentId ? agentById.get(config.agentId) : undefined;
          if (!agent) throw new Error(`Agent node "${node.id}" has no linked agent`);
          if (agent.enabled === false) throw new Error(`Agent "${agent.name}" is disabled`);
          const agentErrors = validateAgent(agent);
          if (agentErrors.length) throw new Error(agentErrors.join(" "));

          let shortTermHistories: ShortTermHistories = {};
          const value = options.agentRunner
            ? await options.agentRunner(agent, state, { runId, nodeId: node.id })
            : await runAgentThroughRuntime(agent, state, {
              runId,
              nodeId: node.id,
              workflowId: options.workflowId ?? definition.id,
              onAgentEvent: options.onAgentEvent,
              runtime,
              memoryAccess: options.memoryAccess,
              onShortTermUpdate: update => { shortTermHistories = mergeHistories(shortTermHistories, update); },
              signal: options.signal,
            });
          result = { lastValue: value, shortTermHistories };
        }
        emit("node.completed", { nodeType: node.type });
        const branch = result.branch;
        for (const edge of definition.edges.filter((candidate) => candidate.source === node.id)) {
          if (edge.kind === "conditional" && edge.branchKey !== branch) continue;
          emit("edge.traversed", { edgeId: edge.id, source: edge.source, target: edge.target, branchKey: edge.branchKey });
        }
        return result;
      } catch (error) {
        if (!isGraphInterrupt(error)) emit("node.failed", { nodeType: node.type, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
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

function asToolInput(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value }; }

function isGraphInterrupt(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name) : "";
  return name === "GraphInterrupt" || name === "GraphBubbleUp" || String(error).includes("GraphInterrupt");
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
    onShortTermUpdate: (update: ShortTermHistories) => void;
    onAgentEvent?: (event: AgentExecutionEvent) => void;
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
    shortTermHistories: state.shortTermHistories ?? {},
    onShortTermUpdate: meta.onShortTermUpdate,
    onBackgroundEvent: meta.onAgentEvent,
    context: { memory: state.memory, branch: state.branch },
  })) {
    meta.onAgentEvent?.(event);
    if (event.type === "agent.completed" || event.type === "agent.output") {
      const payload = event.payload as { content?: unknown } | undefined;
      lastContent = payload && "content" in payload ? payload.content : event.payload;
    }
    if (event.type === "agent.failed") {
      throw new AgentExecutionFailedError((event.payload as { error?: string })?.error ?? "Agent execution failed");
    }
  }
  return lastContent;
}
