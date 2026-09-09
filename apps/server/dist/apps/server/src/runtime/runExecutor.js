"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunExecutor = void 0;
const types_1 = require("@multi-agent/types");
const langGraphEventAdapter_1 = require("../adapters/langGraphEventAdapter");
const workflowCompiler_1 = require("../compiler/workflowCompiler");
const runStore_1 = require("./runStore");
const runtime_1 = require("../../../../src/agents/runtime");
function mapAgentEvents(event, runId) {
    return (0, runtime_1.mapAgentExecutionEvent)(event, runId);
}
class RunExecutor {
    store;
    agentRuntime;
    checkpointer;
    constructor(store = new runStore_1.RunStore(), agentRuntime = new runtime_1.AgentRuntime(), checkpointer) {
        this.store = store;
        this.agentRuntime = agentRuntime;
        this.checkpointer = checkpointer;
    }
    getStore() { return this.store; }
    startAgentTest(request, memoryAccess) {
        const errors = (0, types_1.validateAgent)(request.agent);
        if (request.agent.enabled === false)
            errors.push("Agent is disabled. Enable it before execution.");
        if (errors.length)
            throw new Error(errors.join(" "));
        const id = (0, types_1.uid)("run");
        const stamp = (0, types_1.nowIso)();
        this.store.create({ id, workflowId: `agent-test:${request.agent.id}`, status: "running", startedAt: stamp, input: request.input, metadata: { kind: "agent-test" } }, memoryAccess);
        this.store.append(id, { id: (0, types_1.uid)("event"), runId: id, agentId: request.agent.id, type: "run.started", timestamp: stamp, sequence: 0, payload: {} });
        void this.executeAgentTest(id, request, memoryAccess);
        return id;
    }
    async executeAgentTest(runId, request, memoryAccess) {
        try {
            let output = {};
            for await (const event of this.agentRuntime.execute({ agent: request.agent, input: request.input, runId, nodeId: `test:${request.agent.id}`, signal: this.store.signal(runId), memoryStore: new Map(), memoryAccess, onBackgroundEvent: event => { for (const mapped of mapAgentEvents(event, runId))
                    this.store.append(runId, mapped); } })) {
                for (const mapped of mapAgentEvents(event, runId))
                    this.store.append(runId, mapped);
                if (event.type === "agent.completed")
                    output = { content: event.payload?.content };
                if (event.type === "agent.failed")
                    throw new Error(event.payload?.error ?? "Agent failed");
            }
            this.store.signal(runId)?.throwIfAborted();
            this.store.update(runId, { status: "completed", completedAt: (0, types_1.nowIso)(), output });
            this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "run.completed", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { output } });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.store.update(runId, { status: this.store.signal(runId)?.aborted ? "cancelled" : "failed", completedAt: (0, types_1.nowIso)(), error: message });
            this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "run.failed", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { error: message } });
        }
    }
    start(request, memoryAccess) {
        const id = (0, types_1.uid)("run");
        const stamp = (0, types_1.nowIso)();
        const run = { id, workflowId: request.workflow.id, taskId: request.taskId, status: "queued", startedAt: stamp, input: request.input ?? {}, metadata: {} };
        this.store.create(run, memoryAccess);
        this.store.append(id, { id: (0, types_1.uid)("event"), runId: id, type: "run.started", timestamp: stamp, sequence: 0, payload: { workflowId: request.workflow.id } });
        void this.execute(id, request, memoryAccess);
        return id;
    }
    cancel(runId) { return this.store.cancel(runId); }
    async execute(runId, request, memoryAccess) {
        this.store.update(runId, { status: "running" });
        const adapter = new langGraphEventAdapter_1.LangGraphEventAdapter();
        try {
            const compiled = (0, workflowCompiler_1.compileWorkflow)(request.workflow, request.agents, {
                runId,
                runtime: this.agentRuntime,
                checkpointer: this.checkpointer,
                memoryAccess,
                signal: this.store.signal(runId),
                workflowId: request.workflow.id,
                onAgentEvent: (event) => {
                    for (const runEvent of mapAgentEvents(event, runId)) {
                        this.store.append(runId, runEvent);
                    }
                },
            });
            const stream = await compiled.graph.streamEvents({ input: request.input ?? {}, output: {}, memory: {} }, { version: "v3", streamMode: ["tasks", "updates", "values", "messages"], signal: this.store.signal(runId), configurable: { thread_id: runId } });
            let output;
            for await (const raw of stream) {
                const rawRecord = raw;
                if (rawRecord.method === "values" && rawRecord.params?.data && typeof rawRecord.params.data === "object") {
                    const values = rawRecord.params.data;
                    if (values.output)
                        output = values.output;
                }
                // Agent lifecycle comes from AgentRuntime exactly once, not the graph task adapter.
                for (const event of adapter.adapt(raw, runId, request.workflow, request.agents)) {
                    if (!event.type.startsWith("agent."))
                        this.store.append(runId, event);
                }
            }
            this.store.signal(runId)?.throwIfAborted();
            this.store.update(runId, { status: "completed", completedAt: (0, types_1.nowIso)(), output });
            this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "run.completed", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { output } });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const unsupported = error instanceof workflowCompiler_1.UnsupportedPhase4NodeError;
            if (unsupported)
                this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "node.failed", timestamp: (0, types_1.nowIso)(), nodeId: error.nodeId, sequence: 0, payload: { error: message } });
            this.store.update(runId, { status: this.store.signal(runId)?.aborted ? "cancelled" : "failed", completedAt: (0, types_1.nowIso)(), error: message });
            this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "run.failed", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { error: message } });
        }
    }
}
exports.RunExecutor = RunExecutor;
//# sourceMappingURL=runExecutor.js.map