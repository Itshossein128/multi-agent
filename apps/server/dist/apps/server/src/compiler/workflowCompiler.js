"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsupportedPhase4NodeError = void 0;
exports.compileWorkflow = compileWorkflow;
const langgraph_1 = require("@langchain/langgraph");
const types_1 = require("@multi-agent/types");
const runtime_1 = require("../../../../src/agents/runtime");
const shortTermMemory_1 = require("../../../../src/agents/runtime/shortTermMemory");
const validation_1 = require("./validation");
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
    shortTermHistories: (0, langgraph_1.Annotation)({ reducer: shortTermMemory_1.mergeHistories, default: () => ({}) }),
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
    const runId = options.runId ?? "run-local";
    const runtime = options.runtime ?? new runtime_1.AgentRuntime();
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
                        : state.lastValue === undefined ? state.input : { content: state.lastValue },
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
            if (agent.enabled === false)
                throw new Error(`Agent "${agent.name}" is disabled`);
            const agentErrors = (0, types_1.validateAgent)(agent);
            if (agentErrors.length)
                throw new Error(agentErrors.join(" "));
            let shortTermHistories = {};
            const value = options.agentRunner
                ? await options.agentRunner(agent, state, { runId, nodeId: node.id })
                : await runAgentThroughRuntime(agent, state, {
                    runId,
                    nodeId: node.id,
                    workflowId: options.workflowId ?? definition.id,
                    onAgentEvent: options.onAgentEvent,
                    runtime,
                    memoryAccess: options.memoryAccess,
                    onShortTermUpdate: update => { shortTermHistories = (0, shortTermMemory_1.mergeHistories)(shortTermHistories, update); },
                    signal: options.signal,
                });
            return { lastValue: value, shortTermHistories };
        });
    }
    for (const edge of definition.edges) {
        const source = nodesById.get(edge.source);
        if (source?.type === "condition" || edge.kind === "conditional")
            continue;
        // Dynamic workflow node ids are not in the static StateGraph type map.
        graph.addEdge(edge.source, edge.target);
    }
    for (const node of definition.nodes.filter((candidate) => candidate.type === "condition")) {
        const outgoing = definition.edges.filter((edge) => edge.source === node.id && edge.kind === "conditional");
        const destinations = {};
        for (const edge of outgoing)
            destinations[edge.branchKey] = edge.target;
        graph.addConditionalEdges(node.id, (state) => state.branch ?? "__end__", { ...destinations, __end__: langgraph_1.END });
    }
    const input = definition.nodes.find((node) => node.type === "input");
    const output = definition.nodes.find((node) => node.type === "output");
    if (input)
        graph.addEdge(langgraph_1.START, input.id);
    if (output)
        graph.addEdge(output.id, langgraph_1.END);
    const compiled = graph.compile({ checkpointer: options.runId ? (options.checkpointer ?? new langgraph_1.MemorySaver()) : undefined });
    return {
        graph: options.runId ? compiled.withConfig({ configurable: { thread_id: runId } }) : compiled,
        agentByNode: new Map(definition.nodes
            .filter((node) => node.type === "agent")
            .map((node) => [node.id, agentById.get(node.config.agentId ?? "")])),
        issues,
    };
}
async function runAgentThroughRuntime(agent, state, meta) {
    let lastContent;
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
            const payload = event.payload;
            lastContent = payload && "content" in payload ? payload.content : event.payload;
        }
        if (event.type === "agent.failed") {
            throw new runtime_1.AgentExecutionFailedError(event.payload?.error ?? "Agent execution failed");
        }
    }
    return lastContent;
}
//# sourceMappingURL=workflowCompiler.js.map