"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunExecutor = void 0;
const types_1 = require("@multi-agent/types");
const langGraphEventAdapter_1 = require("../adapters/langGraphEventAdapter");
const workflowCompiler_1 = require("../compiler/workflowCompiler");
const runtime_1 = require("../../../../src/agents/runtime");
const runStore_1 = require("./runStore");
class RunExecutor {
    store;
    constructor(store = new runStore_1.RunStore()) {
        this.store = store;
    }
    getStore() { return this.store; }
    start(request) {
        const id = (0, types_1.uid)("run");
        const stamp = (0, types_1.nowIso)();
        const run = { id, workflowId: request.workflow.id, taskId: request.taskId, status: "queued", startedAt: stamp, input: request.input ?? {}, metadata: {} };
        this.store.create(run);
        this.store.append(id, { id: (0, types_1.uid)("event"), runId: id, type: "run.started", timestamp: stamp, sequence: 0, payload: { workflowId: request.workflow.id } });
        void this.execute(id, request);
        return id;
    }
    cancel(runId) { return this.store.cancel(runId); }
    async execute(runId, request) {
        this.store.update(runId, { status: "running" });
        const adapter = new langGraphEventAdapter_1.LangGraphEventAdapter();
        try {
            const compiled = (0, workflowCompiler_1.compileWorkflow)(request.workflow, request.agents, {
                runId,
                workflowId: request.workflow.id,
                onAgentEvent: (event) => {
                    for (const runEvent of (0, runtime_1.mapAgentExecutionEvent)(event, runId)) {
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
                for (const event of adapter.adapt(raw, runId, request.workflow, request.agents))
                    this.store.append(runId, event);
            }
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