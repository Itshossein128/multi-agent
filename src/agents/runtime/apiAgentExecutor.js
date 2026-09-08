"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiAgentExecutor = void 0;
const types_1 = require("@multi-agent/types");
const errors_1 = require("./errors");
/**
 * Wraps the existing API/LLM provider stack behind AgentExecutor.
 * Credentials remain an env/runtime concern — never taken from the agent record.
 */
class ApiAgentExecutor {
    getFactory;
    constructor(getFactory = loadLlmFactory) {
        this.getFactory = getFactory;
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
            const model = this.getFactory().getModel(agent.backend.provider, {
                model: agent.backend.model,
            });
            const result = await model.invoke([
                { role: "system", content: systemPromptFor(agent) },
                { role: "user", content: serializeInput(input.input) },
            ]);
            const content = result.content;
            yield baseEvent("agent.output", input, { content });
            yield baseEvent("agent.completed", input, { content });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../core/llmFactory");
    return mod.llmFactory;
}
//# sourceMappingURL=apiAgentExecutor.js.map