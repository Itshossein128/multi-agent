"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRuntime = void 0;
const agentExecutorFactory_1 = require("./agentExecutorFactory");
const types_1 = require("@multi-agent/types");
const runtimeMemory_1 = require("./runtimeMemory");
const shortTermMemory_1 = require("./shortTermMemory");
const telemetry_1 = require("../../observability/telemetry");
const executionPolicy_1 = require("./executionPolicy");
const workerRuntime_1 = require("./workerRuntime");
const cliAgentExecutor_1 = require("./cliAgentExecutor");
/** Shared executor boundary, with injected long-term services and caller-owned short-term state. */
class AgentRuntime {
    memoryDependencies;
    telemetry;
    executorFactory;
    maxExecutionMs;
    constructor(executorFactory = undefined, memoryDependencies, telemetry = telemetry_1.ExecutionTelemetry.disabled(), maxExecutionMs = configuredAgentTimeout(), workerRuntime) {
        this.memoryDependencies = memoryDependencies;
        this.telemetry = telemetry;
        this.executorFactory = executorFactory ?? new agentExecutorFactory_1.AgentExecutorFactory(telemetry, workerRuntime ?? new workerRuntime_1.LocalProcessWorkerRuntime((0, cliAgentExecutor_1.cliRuntimePolicyFromEnvironment)()));
        this.maxExecutionMs = maxExecutionMs;
    }
    async *execute(input) {
        const errors = (0, types_1.validateAgent)(input.agent);
        if (input.agent.enabled === false)
            errors.push("Agent is disabled. Enable it before execution.");
        if (errors.length) {
            yield { type: "agent.failed", timestamp: (0, types_1.nowIso)(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: errors.join(" ") } };
            throw new Error(errors.join(" "));
        }
        try {
            (0, executionPolicy_1.assertExecutionPolicy)(input.agent);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield { type: "agent.failed", timestamp: (0, types_1.nowIso)(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { error: message } };
            throw error instanceof executionPolicy_1.ExecutionPolicyError ? error : new executionPolicy_1.ExecutionPolicyError(message);
        }
        const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(this.maxExecutionMs)]) : AbortSignal.timeout(this.maxExecutionMs);
        signal.throwIfAborted();
        input = { ...input, signal };
        const memory = input.agent.memory;
        const shortEnabled = memory?.enabled && memory.shortTerm?.enabled !== false;
        const key = (0, shortTermMemory_1.historyKey)(input);
        const store = input.memoryStore ?? new Map();
        const maxEntries = (0, shortTermMemory_1.boundedInteger)(memory?.maxEntries, 20, 100);
        const maxTokens = (0, shortTermMemory_1.boundedInteger)(memory?.shortTerm?.maxTokens, 4096, 16384);
        const checkpointEntries = input.shortTermHistories?.[key]?.entries ?? [];
        const prior = input.shortTermHistories ? checkpointEntries : (store.get(key) ?? []).map((entry, i) => ({ ...entry, id: String(i) }));
        const history = shortEnabled && memory?.mode !== "write"
            ? (0, shortTermMemory_1.boundHistory)({ entries: prior, maxEntries, maxTokens }).entries.map(({ input, output }) => ({ input, output })) : [];
        if (shortEnabled && memory?.mode !== "write")
            yield { type: "memory.read", timestamp: (0, types_1.nowIso)(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { entries: history.length, scope: memory?.scope, tier: "short_term" } };
        const longTerm = new runtimeMemory_1.RuntimeMemory(input, this.memoryDependencies, this.telemetry);
        // Caller context cannot smuggle memory into the executor when long-term access is disabled/denied.
        let memoryContext;
        if (longTerm.enabled) {
            const read = await longTerm.read();
            for (const event of read.events)
                yield event;
            longTerm.assertResult(read.events);
            memoryContext = read.context;
        }
        const executor = this.executorFactory.create(input.agent.backend);
        let output;
        let completion;
        let failed = false;
        for await (const event of executor.execute({ ...input, context: { ...input.context, history, memoryContext } })) {
            input.signal?.throwIfAborted();
            if (event.type === "agent.completed") {
                output = event.payload?.content ?? event.payload;
                completion = event;
                // Hold success until required memory writes have succeeded.
                continue;
            }
            if (event.type === "agent.failed")
                failed = true;
            yield event;
        }
        input.signal?.throwIfAborted();
        if (!completion || failed)
            return;
        if (longTerm.enabled) {
            const events = await longTerm.afterSuccess(output);
            for (const event of events)
                yield event;
            longTerm.assertResult(events);
        }
        yield completion;
        input.signal?.throwIfAborted();
        if (shortEnabled && memory?.mode !== "read") {
            if (input.shortTermHistories) {
                const prefix = `${input.nodeId}:`;
                const index = checkpointEntries.filter(e => e.id.startsWith(prefix)).reduce((n, e) => Math.max(n, Number(e.id.slice(prefix.length)) || 0), 0) + 1;
                const clip = (value) => {
                    const serialized = JSON.stringify(value ?? null);
                    return Buffer.byteLength(serialized) <= maxTokens / 4 ? value : (0, shortTermMemory_1.boundText)(serialized, Math.floor(maxTokens / 4));
                };
                input.onShortTermUpdate?.({ [key]: { entries: [{ id: `${prefix}${index}`, input: clip(input.input), output: clip(output) }], maxEntries, maxTokens } });
            }
            else {
                // Preserve the public Phase 5 Map contract for standalone callers.
                store.set(key, maxEntries ? [...(store.get(key) ?? []), { input: input.input, output }].slice(-maxEntries) : []);
            }
            yield { type: "memory.write", timestamp: (0, types_1.nowIso)(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload: { entries: Math.min(prior.length + 1, maxEntries), scope: memory?.scope, tier: "short_term" } };
        }
    }
}
exports.AgentRuntime = AgentRuntime;
function configuredAgentTimeout() {
    const value = Number(process.env.AGENT_MAX_DURATION_MS ?? 120_000);
    return Number.isInteger(value) && value >= 1_000 && value <= 60 * 60_000 ? value : 120_000;
}
//# sourceMappingURL=agentRuntime.js.map