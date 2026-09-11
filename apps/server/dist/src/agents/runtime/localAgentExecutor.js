"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalAgentExecutor = void 0;
const types_1 = require("@multi-agent/types");
const errors_1 = require("./errors");
/** Ollama and LM Studio adapters use their documented local HTTP APIs; no API key is persisted. */
class LocalAgentExecutor {
    fetchImpl;
    constructor(fetchImpl = fetch) {
        this.fetchImpl = fetchImpl;
    }
    async *execute(input) {
        if (input.agent.backend.type !== "local")
            throw new errors_1.AgentExecutionFailedError("LocalAgentExecutor requires a local backend.");
        const backend = input.agent.backend;
        yield event("agent.started", input, { provider: backend.provider, model: backend.model });
        try {
            const content = await this.invoke(backend, input);
            yield event("agent.output", input, { content });
            yield event("agent.completed", input, { content });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield event("agent.failed", input, { error: message });
            throw new errors_1.AgentExecutionFailedError(message);
        }
    }
    async invoke(backend, input) {
        const baseUrl = backend.baseUrl || (backend.provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234");
        const ollama = backend.provider === "ollama";
        const response = await this.fetchImpl(new URL(ollama ? "/api/chat" : "/v1/chat/completions", baseUrl), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: input.signal,
            body: JSON.stringify(ollama
                ? { model: backend.model, stream: false, messages: messages(input) }
                : { model: backend.model, messages: messages(input) }),
        });
        const body = await response.json().catch(() => undefined);
        if (!response.ok)
            throw new Error(`Local ${backend.provider} request failed (${response.status}): ${body?.error?.message ?? body?.error ?? "unknown error"}`);
        const content = ollama ? body?.message?.content : body?.choices?.[0]?.message?.content;
        if (content === undefined)
            throw new Error(`Local ${backend.provider} response did not contain assistant content.`);
        return content;
    }
}
exports.LocalAgentExecutor = LocalAgentExecutor;
function messages(input) {
    const system = input.agent.systemPrompt || "You are a helpful workflow agent.";
    const value = typeof input.input === "string" ? input.input : JSON.stringify(input.input ?? {});
    return [{ role: "system", content: system }, { role: "user", content: value }];
}
function event(type, input, payload) {
    return { type, timestamp: (0, types_1.nowIso)(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload };
}
//# sourceMappingURL=localAgentExecutor.js.map