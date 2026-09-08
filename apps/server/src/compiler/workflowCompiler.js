"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsupportedPhase4NodeError = void 0;
exports.compileWorkflow = compileWorkflow;
const langgraph_1 = require("@langchain/langgraph");
const validation_1 = require("./validation");
const runtime_1 = require("../../../../src/agents/runtime");
class UnsupportedPhase4NodeError extends Error {
    nodeId;
    constructor(nodeId, node) {
        super(`Node "${nodeId}" type "${node.type}" is not supported in Phase 4`);
        this.nodeId = nodeId;
        this.name = "UnsupportedPhase4NodeError";
    }
}
exports.UnsupportedPhase4NodeError = UnsupportedPhase4NodeError;
const State = langgraph_1.Annotation.Root({
    input: (0, langgraph_1.Annotation)({ reducer: (_, next) => next, default: () => ({}) }),
    output: (0, langgraph_1.Annotation)({ reducer: (_, next) => next, default: () => ({}) }),
    memory: (0, langgraph_1.Annotation)({
        reducer: (current, next) => ({ ...current, ...next }),
        default: () => ({}),
    }),
    branch: (0, langgraph_1.Annotation)({ reducer: (_, next) => next, default: () => undefined }),
    lastValue: (0, langgraph_1.Annotation)({ reducer: (_, next) => next, default: () => undefined }),
});
function compileWorkflow(definition, agents, options = {}) {
    const issues = (0, validation_1.validateWorkflow)(definition, agents);
    if (issues.some((issue) => issue.severity === "error")) {
        throw new Error(issues.filter((issue) => issue.severity === "error").map((issue) => issue.message).join("; "));
    }
    const graph = new langgraph_1.StateGraph(State);
    const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const runtime = options.agentRuntime ?? new runtime_1.AgentRuntime();
    const runId = options.runId ?? "run-local";
    for (const node of definition.nodes) {
        graph.addNode(node.id, async (state) => {
            if (node.type === "tool" || node.type === "approval")
                throw new UnsupportedPhase4NodeError(node.id, node);
            if (node.type === "input")
                return { input: state.input, lastValue: state.input };
            if (node.type === "output") {
                return {
                    output: state.lastValue && typeof state.lastValue === "object"
                        ? state.lastValue
                        : state.input,
                };
            }
            if (node.type === "memory") {
                const config = node.config;
                if (config.mode === "read")
                    return { lastValue: state.memory[config.key] };
                const value = state.lastValue ?? state.input;
                return { memory: { [config.key]: value }, lastValue: value };
            }
            if (node.type === "condition") {
                const config = node.config;
                const requested = state.input.branch ?? state.input.condition ?? state.input["branchKey"];
                const branch = typeof requested === "string" && config.branches.some((item) => item.key === requested)
                    ? requested
                    : config.branches[0]?.key;
                return { branch, lastValue: state.lastValue };
            }
            const config = node.config;
            const agent = config.agentId ? agentById.get(config.agentId) : undefined;
            if (!agent)
                throw new Error(`Agent node "${node.id}" has no linked agent`);
            const value = options.agentRunner
                ? await options.agentRunner(agent, state, { runId, nodeId: node.id })
                : await runAgentThroughRuntime(runtime, agent, state, {
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
        if (source?.type === "condition" || edge.kind === "conditional")
            continue;
        graph.addEdge(edge.source, edge.target);
    }
    for (const node of definition.nodes.filter((candidate) => candidate.type === "condition")) {
        const outgoing = definition.edges.filter((edge) => edge.source === node.id && edge.kind === "conditional");
        const destinations = {};
        for (const edge of outgoing)
            destinations[edge.branchKey] = edge.target;
        graph.addConditionalEdges(node.id, (state) => state.branch ?? "__end__", {
            ...destinations,
            __end__: langgraph_1.END,
        });
    }
    const input = definition.nodes.find((node) => node.type === "input");
    const output = definition.nodes.find((node) => node.type === "output");
    if (input)
        graph.addEdge(langgraph_1.START, input.id);
    if (output)
        graph.addEdge(output.id, langgraph_1.END);
    return {
        graph: graph.compile(),
        agentByNode: new Map(definition.nodes
            .filter((node) => node.type === "agent")
            .map((node) => [node.id, agentById.get(node.config.agentId ?? "")])),
        issues,
    };
}
async function runAgentThroughRuntime(runtime, agent, state, meta) {
    let lastContent;
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
                const payload = event.payload;
                if (payload && "content" in payload)
                    lastContent = payload.content;
                else
                    lastContent = event.payload;
            }
            if (event.type === "agent.failed") {
                const payload = event.payload;
                throw new runtime_1.AgentExecutionFailedError(payload?.error ?? "Agent execution failed");
            }
        }
    }
    catch (error) {
        if (error instanceof runtime_1.UnsupportedBackendError || error instanceof runtime_1.AgentExecutionFailedError) {
            throw error;
        }
        throw error;
    }
    return lastContent;
}
//# sourceMappingURL=workflowCompiler.js.map