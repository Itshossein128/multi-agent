"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalAgentExecutor = void 0;
exports.localRuntimePolicyFromEnvironment = localRuntimePolicyFromEnvironment;
const types_1 = require("@multi-agent/types");
const errors_1 = require("./errors");
function localRuntimePolicyFromEnvironment(env = process.env) {
    const configured = (env.LOCAL_MODEL_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
    return { allowedOrigins: configured.length ? configured.map(normalizeOrigin) : [
            "http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434",
            "http://127.0.0.1:1234", "http://localhost:1234", "http://[::1]:1234",
        ] };
}
/** Ollama and LM Studio adapters use their documented local HTTP APIs; no API key is persisted. */
class LocalAgentExecutor {
    fetchImpl;
    runtimePolicy;
    constructor(fetchImpl = fetch, runtimePolicy = localRuntimePolicyFromEnvironment()) {
        this.fetchImpl = fetchImpl;
        this.runtimePolicy = runtimePolicy;
    }
    async *execute(input) {
        if (input.agent.backend.type !== "local")
            throw new errors_1.AgentExecutionFailedError("LocalAgentExecutor requires a local backend.");
        const backend = input.agent.backend;
        yield event("agent.started", input, { provider: backend.provider, model: backend.model });
        const startedAt = Date.now();
        yield event("llm.started", input, { provider: backend.provider, model: backend.model });
        try {
            const content = await this.invoke(backend, input);
            yield event("llm.completed", input, { provider: backend.provider, model: backend.model, durationMs: Date.now() - startedAt });
            yield event("agent.output", input, { content });
            yield event("agent.completed", input, { content });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield event("llm.failed", input, { provider: backend.provider, model: backend.model, error: message.slice(0, 500) });
            yield event("agent.failed", input, { error: message });
            throw new errors_1.AgentExecutionFailedError(message);
        }
    }
    async invoke(backend, input) {
        const baseUrl = backend.baseUrl || (backend.provider === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234");
        const ollama = backend.provider === "ollama";
        const origin = normalizeOrigin(baseUrl);
        if (!this.runtimePolicy.allowedOrigins.includes(origin))
            throw new Error(`Local model origin "${origin}" is not allowed by the server runtime.`);
        const settings = backend.settings ?? {};
        const response = await this.fetchImpl(new URL(ollama ? "/api/chat" : "/v1/chat/completions", baseUrl), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: input.signal,
            body: JSON.stringify(ollama
                ? { model: backend.model, stream: false, messages: messages(input), options: { temperature: settings.temperature, top_p: settings.topP, num_predict: settings.maxTokens } }
                : { model: backend.model, messages: messages(input), temperature: settings.temperature, top_p: settings.topP, max_tokens: settings.maxTokens }),
        });
        const body = await response.json().catch(() => undefined);
        const record = body && typeof body === "object" ? body : undefined;
        const error = record?.error;
        const errorMessage = error && typeof error === "object" && "message" in error ? String(error.message) : error === undefined ? "unknown error" : String(error);
        if (!response.ok)
            throw new Error(`Local ${backend.provider} request failed (${response.status}): ${errorMessage.slice(0, 500)}`);
        const content = ollama ? nestedContent(record?.message) : lmStudioContent(record?.choices);
        if (typeof content !== "string")
            throw new Error(`Local ${backend.provider} response did not contain assistant content.`);
        return content;
    }
}
exports.LocalAgentExecutor = LocalAgentExecutor;
function messages(input) {
    const system = input.agent.systemPrompt || "You are a helpful workflow agent.";
    const value = typeof input.input === "string" ? input.input : JSON.stringify(input.input ?? {});
    const history = (input.context?.history ?? []);
    return [
        { role: "system", content: system },
        ...history.flatMap((entry) => [{ role: "user", content: typeof entry.input === "string" ? entry.input : JSON.stringify(entry.input ?? {}) }, { role: "assistant", content: typeof entry.output === "string" ? entry.output : JSON.stringify(entry.output ?? {}) }]),
        ...(typeof input.context?.memoryContext === "string" && input.context.memoryContext ? [{ role: "user", content: input.context.memoryContext }] : []),
        { role: "user", content: value },
    ];
}
function event(type, input, payload) {
    return { type, timestamp: (0, types_1.nowIso)(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload };
}
function normalizeOrigin(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        throw new Error("Local model URL must use HTTP(S) without embedded credentials.");
    return url.origin;
}
function nestedContent(value) {
    return value && typeof value === "object" ? value.content : undefined;
}
function lmStudioContent(value) {
    if (!Array.isArray(value))
        return undefined;
    return nestedContent(value[0] && typeof value[0] === "object" ? value[0].message : undefined);
}
//# sourceMappingURL=localAgentExecutor.js.map