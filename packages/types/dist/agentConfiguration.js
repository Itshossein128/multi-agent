"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_PROVIDER_SCHEMAS = void 0;
exports.modelSettingsSchema = modelSettingsSchema;
exports.credentialIssues = credentialIssues;
exports.assertNoCredentials = assertNoCredentials;
exports.validateAgent = validateAgent;
exports.removeAgentNodes = removeAgentNodes;
const sampling = [
    { key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.1 },
    { key: "topP", label: "Top P", min: 0, max: 1, step: 0.05 },
    { key: "maxTokens", label: "Maximum output tokens", min: 1, max: 65536, step: 1 },
];
/** Shared UI/runtime capability registry. Omitted settings use provider/model defaults. */
exports.API_PROVIDER_SCHEMAS = {
    openai: sampling,
    anthropic: sampling.map((field) => field.key === "temperature" ? { ...field, max: 1 } : field),
    google: sampling,
    gemini: sampling,
};
function modelSettingsSchema(backend) {
    if (backend.type !== "api")
        return [];
    const fields = exports.API_PROVIDER_SCHEMAS[backend.provider.toLowerCase()] ?? [];
    // OpenAI reasoning models do not support the ordinary sampling controls.
    return backend.provider.toLowerCase() === "openai" && /^(o[134](?:-|$)|gpt-5)/i.test(backend.model)
        ? fields.filter((field) => field.key === "maxTokens") : fields;
}
const secretKey = /^(?:.*[_-])?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|oauth[_-]?token|password|secret|authorization|credentials?|private[_-]?key)$/i;
function credentialIssues(value) {
    let found = false;
    const visit = (item) => {
        if (typeof item === "string") {
            if (/\b(?:sk-|AIza)[a-zA-Z0-9_-]{12,}|Bearer\s+(?!\[redacted\])\S+|-----BEGIN .*PRIVATE KEY-----|(?:api[_-]?key|password|secret|token)\s*[:=]\s*(?!\[redacted\])[^\s"},]+/i.test(item))
                found = true;
            try {
                const url = new URL(item);
                if (url.username || url.password || [...url.searchParams.keys()].some((key) => secretKey.test(key) || /token/i.test(key)))
                    found = true;
            }
            catch { /* ordinary text */ }
        }
        else if (Array.isArray(item))
            item.forEach(visit);
        else if (item && typeof item === "object")
            for (const [key, child] of Object.entries(item)) {
                if ((secretKey.test(key) || /apiKey|accessToken|refreshToken|clientSecret|authToken|privateKey|password|secret|authorization|credential|^token$|^env$/i.test(key)) && child !== undefined)
                    found = true;
                visit(child);
            }
    };
    visit(value);
    return found ? ["Credentials belong in server runtime configuration, not agent or workflow data."] : [];
}
function assertNoCredentials(value) {
    const issues = credentialIssues(value);
    if (issues.length)
        throw new Error(issues[0]);
}
function validateAgent(agent) {
    const errors = credentialIssues(agent);
    const backend = agent?.backend;
    if (typeof agent?.name !== "string" || !agent.name.trim())
        errors.push("Name is required.");
    if (!backend || !["api", "cli", "local"].includes(backend.type))
        return [...errors, "A valid backend type is required."];
    if (typeof backend.provider !== "string" || !backend.provider.trim())
        errors.push("Backend provider is required.");
    if (backend.type !== "cli" && (typeof backend.model !== "string" || !backend.model.trim()))
        errors.push("Model is required for API and local backends.");
    if (agent.enabled !== undefined && typeof agent.enabled !== "boolean")
        errors.push("Enabled must be a boolean.");
    if (typeof agent.systemPrompt !== "string" || typeof agent.description !== "string")
        errors.push("Prompt and description must be strings.");
    if (!Array.isArray(agent.tools) || agent.tools.some((id) => typeof id !== "string" || !id.trim()))
        errors.push("Tool IDs must be nonempty strings.");
    if (!agent.metadata || typeof agent.metadata !== "object" || Array.isArray(agent.metadata) || Object.entries(agent.metadata).some(([key, value]) => !key.trim() || !["string", "number", "boolean"].includes(typeof value)))
        errors.push("Metadata values must be strings, numbers, or booleans.");
    if (backend.type === "api" && backend.settings) {
        const fields = modelSettingsSchema(backend);
        for (const [key, value] of Object.entries(backend.settings)) {
            const schema = fields.find((field) => field.key === key);
            if (!schema || typeof value !== "number" || !Number.isFinite(value) || value < schema.min || value > schema.max || (schema.step === 1 && !Number.isInteger(value)))
                errors.push(`Invalid or unsupported model setting: ${key}.`);
        }
        if (backend.provider.toLowerCase() === "anthropic" && backend.settings.temperature !== undefined && backend.settings.topP !== undefined)
            errors.push("Choose temperature or Top P for Anthropic, not both.");
    }
    if (backend.type === "local" && backend.baseUrl) {
        try {
            const url = new URL(backend.baseUrl);
            if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
                throw new Error();
        }
        catch {
            errors.push("Base URL must be an HTTP(S) URL without credentials, query parameters, or a fragment.");
        }
    }
    const policy = agent.executionPolicy;
    if (policy?.workspaceRoot && (!/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(policy.workspaceRoot) || /[\r\n\0]/.test(policy.workspaceRoot)))
        errors.push("Workspace root must be an absolute path without control characters.");
    if (policy?.allowedCommands && (!Array.isArray(policy.allowedCommands) || policy.allowedCommands.some((command) => typeof command !== "string" || !command.trim() || /[\r\n\0]/.test(command))))
        errors.push("Allowed commands must be nonempty, one per line.");
    if (policy?.shell === "disabled" && policy.allowedCommands?.length)
        errors.push("Remove allowed commands or enable restricted shell access.");
    if (policy?.filesystem && !["none", "read", "read-write"].includes(policy.filesystem))
        errors.push("Invalid filesystem policy.");
    if (policy?.shell && !["disabled", "restricted", "full"].includes(policy.shell))
        errors.push("Invalid shell policy.");
    if (policy?.network !== undefined && typeof policy.network !== "boolean")
        errors.push("Network policy must be a boolean.");
    if (backend.type === "cli" && (backend.executable && /[\r\n\0]/.test(backend.executable) || backend.args && (!Array.isArray(backend.args) || backend.args.some((arg) => typeof arg !== "string" || arg.includes("\0")))))
        errors.push("Invalid executable or argument list.");
    if (agent.memory) {
        const memory = agent.memory;
        if (typeof memory.enabled !== "boolean" || memory.type !== "run" || !["agent", "node"].includes(memory.scope) || !["read", "write", "read_write"].includes(memory.mode) || !Number.isInteger(memory.maxEntries) || memory.maxEntries < 1 || memory.maxEntries > 100)
            errors.push("Memory must use run scope with 1–100 entries and a valid read/write mode.");
    }
    return errors;
}
/** Remove only this agent's node instances and their incident edges. */
function removeAgentNodes(workflow, agentId) {
    const removed = new Set(workflow.nodes.filter((node) => node.type === "agent" && node.config.agentId === agentId).map((node) => node.id));
    return { ...workflow, nodes: workflow.nodes.filter((node) => !removed.has(node.id)), edges: workflow.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)) };
}
//# sourceMappingURL=agentConfiguration.js.map