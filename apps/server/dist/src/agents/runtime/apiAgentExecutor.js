"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiAgentExecutor = void 0;
const types_1 = require("@multi-agent/types");
const errors_1 = require("./errors");
const llmFactory_1 = require("../core/llmFactory");
const telemetry_1 = require("../../observability/telemetry");
/**
 * Wraps the existing API/LLM provider stack behind AgentExecutor.
 * Credentials remain an env/runtime concern — never taken from the agent record.
 */
class ApiAgentExecutor {
    getFactory;
    telemetry;
    constructor(getFactory = loadLlmFactory, telemetry = telemetry_1.ExecutionTelemetry.disabled()) {
        this.getFactory = getFactory;
        this.telemetry = telemetry;
    }
    async *execute(input) {
        const { agent, runId, nodeId } = input;
        if (agent.backend.type !== "api") {
            throw new errors_1.AgentExecutionFailedError(`ApiAgentExecutor cannot run backend type "${agent.backend.type}"`);
        }
        yield baseEvent("agent.started", input, {
            provider: agent.backend.provider,
            model: agent.backend.model,
        });
        try {
            const startedAt = Date.now();
            yield baseEvent("llm.started", input, { provider: agent.backend.provider, model: agent.backend.model });
            const model = this.getFactory().getModel(agent.backend.provider, {
                model: agent.backend.model,
                settings: agent.backend.settings,
            });
            const history = (input.context?.history ?? []);
            const messages = [
                { role: "system", content: systemPromptFor(agent) },
                ...history.flatMap((entry) => [{ role: "user", content: serializeInput(entry.input) }, { role: "assistant", content: serializeInput(entry.output) }]),
                ...(typeof input.context?.memoryContext === "string" && input.context.memoryContext
                    ? [{ role: "user", content: input.context.memoryContext }] : []),
                { role: "user", content: serializeInput(input.input) },
            ];
            const telemetryContext = { runId, workflowId: input.workflowId, nodeId, agentId: agent.id, agentName: agent.name, backendType: agent.backend.type, provider: agent.backend.provider, model: agent.backend.model, input: messages };
            const result = await this.telemetry.withAgent(telemetryContext, () => this.telemetry.withGeneration(telemetryContext, () => model.invoke(messages, { signal: input.signal })));
            const content = result.content;
            yield baseEvent("llm.completed", input, { provider: agent.backend.provider, model: agent.backend.model, durationMs: Date.now() - startedAt });
            yield baseEvent("agent.output", input, { content });
            yield baseEvent("agent.completed", input, { content });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield baseEvent("llm.failed", input, { provider: agent.backend.provider, model: agent.backend.model, error: message.slice(0, 500) });
            yield baseEvent("agent.failed", input, { error: message });
            throw new errors_1.AgentExecutionFailedError(message);
        }
    }
}
exports.ApiAgentExecutor = ApiAgentExecutor;
function systemPromptFor(agent) {
    return agent.systemPrompt || "You are a helpful workflow agent.";
}
function serializeInput(value) {
    if (typeof value === "string")
        return value;
    try {
        return JSON.stringify(value ?? {});
    }
    catch {
        return String(value);
    }
}
function baseEvent(type, input, payload) {
    return {
        type,
        timestamp: (0, types_1.nowIso)(),
        agentId: input.agent.id,
        nodeId: input.nodeId,
        runId: input.runId,
        payload,
    };
}
function loadLlmFactory() {
    return llmFactory_1.llmFactory;
}
//# sourceMappingURL=apiAgentExecutor.js.map