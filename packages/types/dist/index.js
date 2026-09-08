"use strict";
/**
 * Canonical shared workflow and run domain models.
 *
 * This package is used by both web and server runtime so execution and UI
 * share the same contract for workflow definitions and event streams.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKFLOW_NODE_TYPES = exports.NODE_TYPE_META = void 0;
exports.createApiBackend = createApiBackend;
exports.agentBackendLabel = agentBackendLabel;
exports.agentRequiresModel = agentRequiresModel;
exports.agentHasConfiguredModel = agentHasConfiguredModel;
exports.migrateAgentRecord = migrateAgentRecord;
exports.isWorkflowNodeType = isWorkflowNodeType;
exports.uid = uid;
exports.nowIso = nowIso;
exports.createAgentRecord = createAgentRecord;
exports.createNode = createNode;
exports.createEdge = createEdge;
exports.createEmptyDefinition = createEmptyDefinition;
exports.nodeConfig = nodeConfig;
function createApiBackend(provider = "openai", model = "gpt-4o") {
    return { type: "api", provider, model };
}
/** Human-readable model/provider label for UI chips and validation messages. */
function agentBackendLabel(backend) {
    if (backend.type === "cli") {
        return backend.model ? `${backend.provider}:${backend.model}` : backend.provider;
    }
    if (backend.type === "local") {
        return `${backend.provider}/${backend.model}`;
    }
    return backend.model || backend.provider;
}
function agentRequiresModel(backend) {
    return backend.type === "api" || backend.type === "local";
}
function agentHasConfiguredModel(agent) {
    if (agent.backend.type === "cli") {
        return Boolean(agent.backend.provider.trim());
    }
    return Boolean(agent.backend.model.trim());
}
function inferApiProvider(model, explicit) {
    if (explicit?.trim())
        return explicit.trim().toLowerCase();
    const lower = model.toLowerCase();
    if (lower.includes("claude"))
        return "anthropic";
    if (lower.includes("gemini"))
        return "google";
    if (lower.startsWith("gpt") || lower.includes("o1") || lower.includes("o3"))
        return "openai";
    return "openai";
}
/**
 * Normalize persisted / inbound agent records to the current schema.
 * Migrates `{ model, provider? }` → `{ backend: { type: "api", ... } }`.
 */
function migrateAgentRecord(raw) {
    const record = (raw ?? {});
    const stamp = nowIso();
    let backend = record.backend;
    if (!backend || typeof backend !== "object" || !("type" in backend)) {
        const model = typeof record.model === "string" && record.model.trim()
            ? record.model.trim()
            : "gpt-4o";
        const metaProvider = typeof record.metadata?.provider === "string" ? String(record.metadata.provider) : undefined;
        backend = createApiBackend(inferApiProvider(model, record.provider ?? metaProvider), model);
    }
    return {
        id: typeof record.id === "string" && record.id ? record.id : uid("agent"),
        name: typeof record.name === "string" && record.name.trim() ? record.name : "New Agent",
        description: typeof record.description === "string" ? record.description : "",
        backend,
        systemPrompt: typeof record.systemPrompt === "string" ? record.systemPrompt : "",
        tools: Array.isArray(record.tools) ? record.tools.filter((t) => typeof t === "string") : [],
        executionPolicy: record.executionPolicy,
        metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
            ? record.metadata
            : {},
        createdAt: typeof record.createdAt === "string" ? record.createdAt : stamp,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : stamp,
    };
}
exports.NODE_TYPE_META = {
    agent: {
        label: "Agent",
        description: "AI agent with model, prompt, and tools",
        iconBg: "bg-indigo-500/15",
        iconText: "text-indigo-300",
        border: "border-indigo-500/30",
        borderSelected: "border-indigo-400",
        chipBg: "bg-indigo-950/50",
    },
    tool: {
        label: "Tool",
        description: "Executable tool / function call",
        iconBg: "bg-amber-500/15",
        iconText: "text-amber-300",
        border: "border-amber-500/30",
        borderSelected: "border-amber-400",
        chipBg: "bg-amber-950/50",
    },
    approval: {
        label: "Approval",
        description: "Pause and wait for human approval",
        iconBg: "bg-cyan-500/15",
        iconText: "text-cyan-300",
        border: "border-cyan-500/30",
        borderSelected: "border-cyan-400",
        chipBg: "bg-cyan-950/50",
    },
    memory: {
        label: "Memory",
        description: "Read / write workflow memory",
        iconBg: "bg-purple-500/15",
        iconText: "text-purple-300",
        border: "border-purple-500/30",
        borderSelected: "border-purple-400",
        chipBg: "bg-purple-950/50",
    },
    condition: {
        label: "Condition",
        description: "Router with conditional branches",
        iconBg: "bg-orange-500/15",
        iconText: "text-orange-300",
        border: "border-orange-500/30",
        borderSelected: "border-orange-400",
        chipBg: "bg-orange-950/50",
    },
    input: {
        label: "Input",
        description: "Workflow entry point",
        iconBg: "bg-emerald-500/15",
        iconText: "text-emerald-300",
        border: "border-emerald-500/30",
        borderSelected: "border-emerald-400",
        chipBg: "bg-emerald-950/50",
    },
    output: {
        label: "Output",
        description: "Workflow exit point",
        iconBg: "bg-blue-500/15",
        iconText: "text-blue-300",
        border: "border-blue-500/30",
        borderSelected: "border-blue-400",
        chipBg: "bg-blue-950/50",
    },
};
exports.WORKFLOW_NODE_TYPES = [
    "agent",
    "tool",
    "condition",
    "approval",
    "memory",
    "input",
    "output",
];
function isWorkflowNodeType(value) {
    return exports.WORKFLOW_NODE_TYPES.includes(value);
}
function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso() {
    return new Date().toISOString();
}
function createAgentRecord(input) {
    const stamp = nowIso();
    const backend = input?.backend ??
        createApiBackend(input?.provider ?? "openai", input?.model ?? "gpt-4o");
    return {
        id: uid("agent"),
        name: input?.name ?? "New Agent",
        description: "",
        backend,
        systemPrompt: "",
        tools: [],
        metadata: {},
        createdAt: stamp,
        updatedAt: stamp,
    };
}
function createNode(type, position, options) {
    let config;
    switch (type) {
        case "agent":
            config = { agentId: options?.agentId ?? null };
            break;
        case "tool":
            config = { toolId: uid("tool"), name: "New Tool", description: "", config: {} };
            break;
        case "approval":
            config = { message: "Approve to continue?", approvalType: "manual", timeoutSeconds: 300 };
            break;
        case "memory":
            config = { memoryType: "short_term", mode: "read_write", key: "" };
            break;
        case "condition":
            config = {
                branches: [
                    { key: "yes", label: "Yes" },
                    { key: "no", label: "No" },
                ],
            };
            break;
        case "input":
            config = { inputKey: "input", description: "" };
            break;
        case "output":
            config = { outputKey: "output", description: "" };
            break;
    }
    return {
        id: uid(type),
        type,
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        config,
    };
}
function createEdge(input) {
    return {
        id: uid("edge"),
        source: input.source,
        target: input.target,
        kind: input.kind ?? "normal",
        label: input.label ?? "",
        branchKey: input.branchKey ?? "",
    };
}
function createEmptyDefinition(name) {
    return {
        id: uid("wf"),
        name: name ?? "Untitled Workflow",
        nodes: [],
        edges: [],
        updatedAt: nowIso(),
    };
}
function nodeConfig(node) {
    return node.config;
}
//# sourceMappingURL=index.js.map