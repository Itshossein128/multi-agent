import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { AgentRecord, WorkflowDefinition, WorkflowNode } from "@multi-agent/types";
import { validateWorkflow } from "./validation";

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
  branch?: string;
  lastValue?: unknown;
}

const State = Annotation.Root({
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
  /** @deprecated Prefer AgentRuntime via the default path; kept for tests/overrides. */
  agentRunner?: (
    agent: AgentRecord,
    state: RuntimeState,
    meta: { runId: string; nodeId: string }
  ) => Promise<unknown>;
  runId?: string;
  workflowId?: string;
  onAgentEvent?: (event: AgentExecutionEvent) => void;
}

export function compileWorkflow(
  definition: WorkflowDefinition,
  agents: AgentRecord[],
  options: CompileOptions = {}
) {
  const issues = validateWorkflow(definition, agents);
  if (issues.some((issue) => issue.severity === "error")) {
    throw new Error(issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("; "));
  }
  const graph = new StateGraph(State);
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const runId = options.runId ?? "run-local";

  for (const node of definition.nodes) {
    graph.addNode(node.id, async (state: RuntimeState) => {
      if (node.type === "tool" || node.type === "approval") throw new UnsupportedPhase4NodeError(node.id, node);
      if (node.type === "input") return { input: state.input, lastValue: state.input };
      if (node.type === "output") {
        return {
          output:
            state.lastValue && typeof state.lastValue === "object"
              ? (state.lastValue as Record<string, unknown>)
              : state.input,
        };
      }
      if (node.type === "memory") {
        const config = node.config as { mode: string; key: string };
        if (config.mode === "read") return { lastValue: state.memory[config.key] };
        const value = state.lastValue ?? state.input;
        return { memory: { [config.key]: value }, lastValue: value };
      }
      if (node.type === "condition") {
        const config = node.config as { branches: { key: string }[] };
        const requested = state.input.branch ?? state.input.condition ?? state.input["branchKey"];
        const branch =
          typeof requested === "string" && config.branches.some((item) => item.key === requested)
            ? requested
            : config.branches[0]?.key;
        return { branch, lastValue: state.lastValue };
      }

      const config = node.config as { agentId?: string | null };
      const agent = config.agentId ? agentById.get(config.agentId) : undefined;
      if (!agent) throw new Error(`Agent node "${node.id}" has no linked agent`);

      const value = options.agentRunner
        ? await options.agentRunner(agent, state, { runId, nodeId: node.id })
        : await runAgentThroughRuntime(agent, state, {
          runId,
          nodeId: node.id,
          workflowId: options.workflowId ?? definition.id,
          onAgentEvent: options.onAgentEvent,
        });
      return { lastValue: value };
    });
  }

  for (const edge of definition.edges) {
    const source = nodesById.get(edge.source);
    if (source?.type === "condition" || edge.kind === "conditional") continue;
    // Dynamic workflow node ids are not in the static StateGraph type map.
    (graph as { addEdge: (a: string, b: string) => void }).addEdge(edge.source, edge.target);
  }
  for (const node of definition.nodes.filter((candidate) => candidate.type === "condition")) {
    const outgoing = definition.edges.filter((edge) => edge.source === node.id && edge.kind === "conditional");
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
  return {
    graph: graph.compile(),
    agentByNode: new Map(
      definition.nodes
        .filter((node) => node.type === "agent")
        .map((node) => [node.id, agentById.get((node.config as { agentId?: string | null }).agentId ?? "")])
    ),
    issues,
  };
}

async function runAgentThroughRuntime(
  agent: AgentRecord,
  state: RuntimeState,
  meta: {
    runId: string;
    nodeId: string;
    workflowId: string;
    onAgentEvent?: (event: AgentExecutionEvent) => void;
  }
): Promise<unknown> {
  // LangGraph nodes delegate to the shared AgentRuntime — no provider SDK here.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AgentRuntime, AgentExecutionFailedError, UnsupportedBackendError } = require("../../../../src/agents/runtime") as {
    AgentRuntime: new () => {
      execute: (input: {
        agent: AgentRecord;
        input: unknown;
        runId: string;
        nodeId: string;
        workflowId?: string;
        context?: Record<string, unknown>;
      }) => AsyncIterable<AgentExecutionEvent>;
    };
    AgentExecutionFailedError: new (message: string) => Error;
    UnsupportedBackendError: new (...args: unknown[]) => Error;
  };

  const runtime = new AgentRuntime();
  let lastContent: unknown;
  try {
    for await (const event of runtime.execute({
      agent,
      input: state.lastValue ?? state.input,
      runId: meta.runId,
      nodeId: meta.nodeId,
      workflowId: meta.workflowId,
      context: { memory: state.memory, branch: state.branch },
    })) {
      meta.onAgentEvent?.(event);
      if (event.type === "agent.completed" || event.type === "agent.output") {
        const payload = event.payload as { content?: unknown } | undefined;
        if (payload && "content" in payload) lastContent = payload.content;
        else lastContent = event.payload;
      }
      if (event.type === "agent.failed") {
        const payload = event.payload as { error?: string } | undefined;
        throw new AgentExecutionFailedError(payload?.error ?? "Agent execution failed");
      }
    }
  } catch (error) {
    if (error instanceof UnsupportedBackendError || error instanceof AgentExecutionFailedError) {
      throw error;
    }
    throw error;
  }
  return lastContent;
}
