"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunExecutor = void 0;
const langgraph_1 = require("@langchain/langgraph");
const types_1 = require("@multi-agent/types");
const langGraphEventAdapter_1 = require("../adapters/langGraphEventAdapter");
const workflowCompiler_1 = require("../compiler/workflowCompiler");
const runStore_1 = require("./runStore");
const runtime_1 = require("../../../../src/agents/runtime");
const telemetry_1 = require("../../../../src/observability/telemetry");
const validation_1 = require("../compiler/validation");
const guardrails_1 = require("./guardrails");
const logging_1 = require("../logging");
function mapAgentEvents(event, runId) {
    return (0, runtime_1.mapAgentExecutionEvent)(event, runId);
}
class RunExecutor {
    store;
    agentRuntime;
    checkpointer;
    telemetry;
    guardrails;
    toolRuntime;
    checkpointers = new Map();
    pausedContext = new Map();
    constructor(store = new runStore_1.InMemoryRunStore(), agentRuntime = new runtime_1.AgentRuntime(), checkpointer, telemetry = telemetry_1.ExecutionTelemetry.disabled(), guardrails = (0, guardrails_1.runtimeGuardrailsFromEnvironment)(), toolRuntime) {
        this.store = store;
        this.agentRuntime = agentRuntime;
        this.checkpointer = checkpointer;
        this.telemetry = telemetry;
        this.guardrails = guardrails;
        this.toolRuntime = toolRuntime;
    }
    getStore() { return this.store; }
    appendAgentEvent(runId, event) {
        for (const runEvent of mapAgentEvents(event, runId)) {
            if (runEvent.nodeId && (runEvent.type === "node.started" || runEvent.type === "agent.started" || runEvent.type === "tool.started")) {
                this.store.update(runId, { currentNodeId: runEvent.nodeId });
            }
            this.store.append(runId, runEvent);
        }
    }
    /** Restore in-memory pause maps after a durable hydrate so waiting runs can resume. */
    restorePausedRun(runId, context, checkpointer) {
        this.pausedContext.set(runId, context);
        this.checkpointers.set(runId, checkpointer);
    }
    startAgentTest(request, memoryAccess, principal) {
        const errors = (0, types_1.validateAgent)(request.agent);
        if (request.agent.enabled === false)
            errors.push("Agent is disabled. Enable it before execution.");
        if (errors.length)
            throw new Error(errors.join(" "));
        const id = (0, types_1.uid)("run");
        const stamp = (0, types_1.nowIso)();
        const ownerId = principal?.userId;
        const tenantId = principal?.tenantId;
        this.store.create({ id, workflowId: `agent-test:${request.agent.id}`, status: "running", startedAt: stamp, input: request.input, metadata: { kind: "agent-test" }, ownerId, tenantId }, memoryAccess, undefined, principal);
        this.store.append(id, { id: (0, types_1.uid)("event"), runId: id, agentId: request.agent.id, type: "run.created", timestamp: stamp, sequence: 0, payload: {} });
        this.store.append(id, { id: (0, types_1.uid)("event"), runId: id, agentId: request.agent.id, type: "run.started", timestamp: stamp, sequence: 0, payload: {} });
        void this.executeAgentTest(id, request, memoryAccess);
        return id;
    }
    async executeAgentTest(runId, request, memoryAccess) {
        try {
            let output = {};
            for await (const event of this.agentRuntime.execute({ agent: request.agent, input: request.input, runId, nodeId: `test:${request.agent.id}`, signal: this.store.signal(runId), memoryStore: new Map(), memoryAccess, onBackgroundEvent: event => { this.appendAgentEvent(runId, event); } })) {
                this.appendAgentEvent(runId, event);
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
            const cancelled = Boolean(this.store.signal(runId)?.aborted);
            this.store.update(runId, { status: cancelled ? "cancelled" : "failed", completedAt: (0, types_1.nowIso)(), error: message });
            this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: cancelled ? "run.cancelled" : "run.failed", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { error: message, ...(cancelled ? { cancelled: true } : {}) } });
        }
    }
    start(request, memoryAccess, principal) {
        const issues = (0, validation_1.validateWorkflow)(request.workflow, request.agents, this.guardrails, request.tools);
        const errors = issues.filter(issue => issue.level === "error");
        if (errors.length)
            throw new Error(errors.map(issue => `${issue.code}: ${issue.message}`).join(" "));
        const id = (0, types_1.uid)("run");
        const stamp = (0, types_1.nowIso)();
        const ownerId = principal?.userId;
        const tenantId = principal?.tenantId;
        const run = { id, workflowId: request.workflow.id, taskId: request.taskId, status: "queued", startedAt: stamp, input: request.input ?? {}, metadata: request.metadata ?? {}, ownerId, tenantId };
        this.store.create(run, memoryAccess, { workflow: request.workflow, agents: request.agents, tools: request.tools }, principal);
        logging_1.log.info("run.started", { runId: id, workflowId: request.workflow.id, taskId: request.taskId });
        this.store.append(id, { id: (0, types_1.uid)("event"), runId: id, type: "run.created", timestamp: stamp, sequence: 0, payload: { workflowId: request.workflow.id } });
        this.store.append(id, { id: (0, types_1.uid)("event"), runId: id, type: "run.started", timestamp: stamp, sequence: 0, payload: { workflowId: request.workflow.id } });
        void this.execute(id, request, memoryAccess);
        return id;
    }
    retry(runId, memoryAccess) {
        const entry = this.store.get(runId);
        if (!entry)
            throw new Error("Run not found");
        if (entry.run.status !== "failed" && entry.run.status !== "cancelled") {
            throw new Error("Only failed or cancelled runs can be retried");
        }
        const workflow = this.store.getWorkflowSnapshot?.(runId) ?? entry.workflowSnapshot;
        const agents = this.store.getAgentSnapshot?.(runId) ?? entry.agentsSnapshot;
        const tools = this.store.getToolSnapshot?.(runId) ?? entry.toolsSnapshot;
        if (!workflow || !agents?.length)
            throw new Error("Run definition snapshot is not available for retry");
        return this.start({
            workflow,
            agents,
            tools,
            input: entry.run.input ?? {},
            metadata: { ...entry.run.metadata, retriedFromRunId: runId },
            taskId: entry.run.taskId,
        }, memoryAccess, entry.run.ownerId && entry.run.tenantId ? { userId: entry.run.ownerId, tenantId: entry.run.tenantId } : undefined);
    }
    cancel(runId) {
        const entry = this.store.get(runId);
        if (!entry)
            return false;
        if (["completed", "failed", "cancelled"].includes(entry.run.status))
            return false;
        if (entry.run.status === "waiting_for_human") {
            // No in-flight promise is awaiting the abort signal — the stream already
            // returned when the graph paused. Finalize cancellation directly.
            for (const approval of this.store.listApprovals(runId)) {
                if (approval.status === "requested") {
                    this.store.clearApprovalTimer(runId, approval.id);
                    this.store.updateApproval(runId, approval.id, { status: "cancelled", resolvedAt: (0, types_1.nowIso)() });
                }
            }
            this.pausedContext.delete(runId);
            this.checkpointers.delete(runId);
            this.store.setPausedContext?.(runId, null);
            this.store.update(runId, { status: "cancelled", completedAt: (0, types_1.nowIso)() });
            this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "run.cancelled", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { cancelled: true } });
            return true;
        }
        return this.store.cancel(runId);
    }
    resolveApproval(runId, approvalId, decision) {
        const approval = this.store.getApproval(runId, approvalId);
        if (!approval)
            throw new Error("Approval not found");
        if (approval.status !== "requested")
            throw new Error("Approval has already been resolved.");
        this.store.clearApprovalTimer(runId, approvalId);
        const stamp = (0, types_1.nowIso)();
        this.store.updateApproval(runId, approvalId, { status: decision.decision, resolvedAt: stamp, response: decision.response });
        this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: decision.decision === "approved" ? "human_approval.approved" : "human_approval.rejected", nodeId: approval.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId, decision: decision.decision, response: decision.response } });
        this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "human_approval.resolved", nodeId: approval.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId, decision: decision.decision, response: decision.response } });
        this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "run.resumed", nodeId: approval.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId } });
        this.store.update(runId, { status: "running" });
        void this.continueAfterApproval(runId, decision);
    }
    async continueAfterApproval(runId, decision) {
        const context = this.pausedContext.get(runId);
        const checkpointer = this.checkpointers.get(runId);
        if (!context || !checkpointer) {
            this.fail(runId, new Error("Run is not resumable."));
            return;
        }
        this.pausedContext.delete(runId);
        try {
            const compiled = (0, workflowCompiler_1.compileWorkflow)(context.workflow, context.agents, {
                runId,
                runtime: this.agentRuntime,
                toolRuntime: this.toolRuntime,
                checkpointer,
                memoryAccess: context.memoryAccess,
                signal: this.store.signal(runId),
                workflowId: context.workflow.id,
                tools: context.tools,
                onAgentEvent: (event) => { this.appendAgentEvent(runId, event); },
            });
            await this.runGraph(runId, compiled, new langgraph_1.Command({ resume: decision }), context.workflow, context.agents, context.memoryAccess, context.tools);
        }
        catch (error) {
            this.fail(runId, error);
        }
    }
    async execute(runId, request, memoryAccess) {
        if (this.telemetry.enabled) {
            const traceId = await this.telemetry.traceIdForRun(runId);
            this.store.update(runId, { metadata: { ...(this.store.get(runId)?.run.metadata ?? {}), observability: { provider: "langfuse", traceId } } });
        }
        return this.telemetry.withWorkflow({ runId, workflowId: request.workflow.id, taskId: request.taskId, input: request.input }, () => this.executeWorkflow(runId, request, memoryAccess));
    }
    async executeWorkflow(runId, request, memoryAccess) {
        this.store.update(runId, { status: "running" });
        const timeout = setTimeout(() => this.store.cancel(runId), this.guardrails.maxRunDurationMs);
        // Approvals require checkpointing to pause/resume — a per-run MemorySaver is
        // retained across the initial run and any resume, unlike the ad-hoc default
        // compileWorkflow would otherwise create fresh on every call.
        const checkpointer = typeof this.checkpointer === "object" ? this.checkpointer : new langgraph_1.MemorySaver();
        this.checkpointers.set(runId, checkpointer);
        try {
            const compiled = (0, workflowCompiler_1.compileWorkflow)(request.workflow, request.agents, {
                runId,
                runtime: this.agentRuntime,
                toolRuntime: this.toolRuntime,
                checkpointer,
                memoryAccess,
                signal: this.store.signal(runId),
                workflowId: request.workflow.id,
                tools: request.tools,
                onAgentEvent: (event) => {
                    this.appendAgentEvent(runId, event);
                },
            });
            await this.runGraph(runId, compiled, { input: request.input ?? {}, output: {}, memory: {} }, request.workflow, request.agents, memoryAccess, request.tools);
        }
        catch (error) {
            this.fail(runId, error);
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async runGraph(runId, compiled, input, workflow, agents, memoryAccess, tools) {
        const adapter = new langGraphEventAdapter_1.LangGraphEventAdapter();
        const stream = await compiled.graph.streamEvents(input, { version: "v3", streamMode: ["tasks", "updates", "values", "messages"], signal: this.store.signal(runId), recursionLimit: this.guardrails.recursionLimit, configurable: { thread_id: runId } });
        let output;
        for await (const raw of stream) {
            const rawRecord = raw;
            if (rawRecord.method === "updates" && rawRecord.params?.node === "__interrupt__") {
                const values = rawRecord.params.data?.values ?? [];
                for (const item of values)
                    this.handleApprovalRequested(runId, item);
                continue;
            }
            if (rawRecord.method === "values" && rawRecord.params?.data && typeof rawRecord.params.data === "object") {
                const values = rawRecord.params.data;
                if (values.output)
                    output = values.output;
            }
            // Agent lifecycle comes from AgentRuntime exactly once, not the graph task adapter.
            for (const event of adapter.adapt(raw, runId, workflow, agents)) {
                if (!event.type.startsWith("agent."))
                    this.store.append(runId, event);
            }
        }
        this.store.signal(runId)?.throwIfAborted();
        const state = await compiled.graph.getState({ configurable: { thread_id: runId } });
        if (state.next.length > 0) {
            // Paused at a human approval node — leave status as waiting_for_human and
            // retain enough context to recompile and resume once it is resolved.
            const context = { workflow, agents, tools, memoryAccess };
            this.pausedContext.set(runId, context);
            this.store.setPausedContext?.(runId, context);
            return;
        }
        this.pausedContext.delete(runId);
        this.checkpointers.delete(runId);
        this.store.setPausedContext?.(runId, null);
        this.store.update(runId, { status: "completed", completedAt: (0, types_1.nowIso)(), output });
        this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "run.completed", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { output } });
    }
    handleApprovalRequested(runId, item) {
        const value = item.value;
        const stamp = (0, types_1.nowIso)();
        const request = {
            id: item.id,
            runId,
            nodeId: value.nodeId,
            status: "requested",
            message: value.message,
            requestedAt: stamp,
            context: value.context && typeof value.context === "object" ? value.context : undefined,
            metadata: {},
        };
        this.store.addApproval(runId, request, value.timeoutSeconds);
        this.store.update(runId, { status: "waiting_for_human", currentNodeId: value.nodeId });
        this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "run.paused", nodeId: value.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId: item.id } });
        this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "human_approval.requested", nodeId: value.nodeId, timestamp: stamp, sequence: 0, payload: { approvalId: item.id, message: value.message, approvalType: value.approvalType, timeoutSeconds: value.timeoutSeconds } });
        if (value.approvalType === "timeout" && value.timeoutSeconds > 0) {
            const timer = setTimeout(() => {
                try {
                    this.resolveApproval(runId, item.id, { decision: "approved" });
                }
                catch { /* already resolved by a human in the meantime */ }
            }, value.timeoutSeconds * 1000);
            this.store.setApprovalTimer(runId, item.id, timer);
        }
    }
    /** Re-arm timeout approvals after process restart when remaining time can be computed. */
    rearmApprovalTimers(runId) {
        for (const approval of this.store.listApprovals(runId)) {
            if (approval.status !== "requested")
                continue;
            const timeoutSeconds = Number(approval.metadata?.timeoutSeconds
                ?? this.store.get(runId)?.events.find((event) => event.type === "human_approval.requested" && event.payload.approvalId === approval.id)?.payload?.timeoutSeconds);
            if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
                continue;
            const elapsedMs = Date.now() - Date.parse(approval.requestedAt);
            const remaining = Math.max(0, timeoutSeconds * 1000 - elapsedMs);
            const timer = setTimeout(() => {
                try {
                    this.resolveApproval(runId, approval.id, { decision: "approved" });
                }
                catch { /* already resolved */ }
            }, remaining);
            this.store.setApprovalTimer(runId, approval.id, timer);
        }
    }
    fail(runId, error) {
        const message = error instanceof Error ? error.message : String(error);
        const unsupported = error instanceof workflowCompiler_1.UnsupportedPhase4NodeError;
        if (unsupported)
            this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: "node.failed", timestamp: (0, types_1.nowIso)(), nodeId: error.nodeId, sequence: 0, payload: { error: message } });
        this.pausedContext.delete(runId);
        this.checkpointers.delete(runId);
        this.store.setPausedContext?.(runId, null);
        const cancelled = Boolean(this.store.signal(runId)?.aborted);
        this.store.update(runId, { status: cancelled ? "cancelled" : "failed", completedAt: (0, types_1.nowIso)(), error: message });
        this.store.append(runId, { id: (0, types_1.uid)("event"), runId, type: cancelled ? "run.cancelled" : "run.failed", timestamp: (0, types_1.nowIso)(), sequence: 0, payload: { error: message, ...(cancelled ? { cancelled: true } : {}) } });
        const logPayload = { runId, workflowId: this.store.get(runId)?.run.workflowId, taskId: this.store.get(runId)?.run.taskId, error: message };
        if (cancelled)
            logging_1.log.info("run.cancelled", logPayload);
        else
            logging_1.log.error("run.failed", logPayload);
    }
}
exports.RunExecutor = RunExecutor;
//# sourceMappingURL=runExecutor.js.map