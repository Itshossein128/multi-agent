"use strict";
/**
 * Canonical shared workflow and run domain models.
 *
 * This package is used by both web and server runtime so execution and UI
 * share the same contract for workflow definitions and event streams.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEP_GATED_CANONICAL_STATUSES = exports.CANONICAL_STATUS_TRANSITIONS = exports.LEGACY_TO_CANONICAL_STATUS = exports.removeAgentNodes = exports.API_PROVIDER_SCHEMAS = exports.modelSettingsSchema = exports.validateAgent = exports.credentialIssues = exports.assertNoCredentials = exports.WORKFLOW_NODE_TYPES = exports.NODE_TYPE_META = void 0;
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
exports.serializeWorkflowDefinition = serializeWorkflowDefinition;
exports.deserializeWorkflowDefinition = deserializeWorkflowDefinition;
exports.createEmptyDefinition = createEmptyDefinition;
exports.createSingleAgentWorkflow = createSingleAgentWorkflow;
exports.nodeConfig = nodeConfig;
exports.removeToolNodes = removeToolNodes;
exports.migrateWorkflowToolNodes = migrateWorkflowToolNodes;
exports.toCanonicalStatus = toCanonicalStatus;
exports.canTransitionStatus = canTransitionStatus;
exports.isStatusDependencyGated = isStatusDependencyGated;
exports.isCompletedStatus = isCompletedStatus;
__exportStar(require("./memory"), exports);
__exportStar(require("./toolConfiguration"), exports);
__exportStar(require("./approval"), exports);
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
        enabled: record.enabled !== false,
        memory: record.memory,
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
        enabled: true,
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
            config = { toolId: options?.toolId ?? null };
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
        ...(input.metadata ? { metadata: structuredCloneSafe(input.metadata) } : {}),
    };
}
/**
 * Return the workflow domain payload without React Flow-only fields.
 * Positions remain as layout metadata on domain nodes; execution is defined
 * exclusively by node types/configuration and edge endpoints.
 */
function serializeWorkflowDefinition(definition) {
    if (!definition || typeof definition !== "object")
        throw new Error("Workflow definition must be an object.");
    if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
        throw new Error("Workflow definition must contain nodes and edges arrays.");
    }
    return structuredCloneSafe({
        id: definition.id,
        name: definition.name,
        nodes: definition.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            position: { x: node.position.x, y: node.position.y },
            config: node.config,
        })),
        edges: definition.edges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            kind: edge.kind,
            label: edge.label,
            branchKey: edge.branchKey,
            ...(edge.metadata ? { metadata: edge.metadata } : {}),
        })),
        updatedAt: definition.updatedAt,
        ...(definition.ownerId ? { ownerId: definition.ownerId } : {}),
        ...(definition.tenantId ? { tenantId: definition.tenantId } : {}),
    });
}
/**
 * Normalize a persisted workflow back into the domain model. The legacy edge
 * `type` field is accepted during migration, but never emitted by serialization.
 */
function deserializeWorkflowDefinition(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("Workflow definition must be an object.");
    }
    const value = raw;
    if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
        throw new Error("Workflow definition must contain nodes and edges arrays.");
    }
    const definition = {
        ...value,
        nodes: value.nodes.map((rawNode) => {
            const node = (rawNode ?? {});
            const position = (node.position ?? {});
            return {
                ...node,
                id: typeof node.id === "string" ? node.id : "",
                type: node.type,
                position: {
                    x: typeof position.x === "number" && Number.isFinite(position.x) ? position.x : 0,
                    y: typeof position.y === "number" && Number.isFinite(position.y) ? position.y : 0,
                },
                config: node.config && typeof node.config === "object" && !Array.isArray(node.config) ? node.config : {},
            };
        }),
        edges: value.edges.map((rawEdge) => {
            const edge = (rawEdge ?? {});
            return {
                ...edge,
                kind: edge.kind ?? edge.type ?? "normal",
                label: typeof edge.label === "string" ? edge.label : "",
                branchKey: typeof edge.branchKey === "string" ? edge.branchKey : "",
            };
        }),
    };
    return serializeWorkflowDefinition(definition);
}
function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
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
function createSingleAgentWorkflow(agent, name = "Single Agent Task Workflow") {
    const inputNode = createNode("input", { x: 100, y: 100 });
    const agentNode = createNode("agent", { x: 300, y: 100 }, { agentId: agent.id });
    const outputNode = createNode("output", { x: 500, y: 100 });
    const edge1 = createEdge({ source: inputNode.id, target: agentNode.id });
    const edge2 = createEdge({ source: agentNode.id, target: outputNode.id });
    return {
        id: uid("wf-task"),
        name,
        nodes: [inputNode, agentNode, outputNode],
        edges: [edge1, edge2],
        updatedAt: nowIso(),
    };
}
function nodeConfig(node) {
    return node.config;
}
/** Remove only this tool's node instances and their incident edges. */
function removeToolNodes(workflow, toolId) {
    const removed = new Set(workflow.nodes.filter((node) => node.type === "tool" && node.config.toolId === toolId).map((node) => node.id));
    return { ...workflow, nodes: workflow.nodes.filter((node) => !removed.has(node.id)), edges: workflow.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)) };
}
/**
 * Upgrade legacy inline tool nodes (`{ toolId, name, description, config }`) into
 * registry references, synthesizing a ToolRecord per unique legacy node when one
 * isn't already present in `tools`. Idempotent — nodes already in the new
 * `{ toolId }` shape are left untouched.
 */
function migrateWorkflowToolNodes(definition, tools) {
    const known = new Set(tools.map((tool) => tool.id));
    const newTools = [];
    const nodes = definition.nodes.map((node) => {
        if (node.type !== "tool")
            return node;
        const config = node.config;
        const isLegacy = "name" in config || "description" in config || "config" in config;
        if (!isLegacy && (config.toolId === null || (typeof config.toolId === "string" && known.has(config.toolId))))
            return node;
        const stamp = nowIso();
        const id = typeof config.toolId === "string" && config.toolId && !known.has(config.toolId) ? config.toolId : uid("tool");
        const record = {
            id,
            name: typeof config.name === "string" && config.name.trim() ? config.name : "Migrated Tool",
            description: typeof config.description === "string" ? config.description : "",
            category: "function",
            inputSchema: { type: "object", properties: {} },
            outputSchema: { type: "object", properties: {} },
            configuration: config.config && typeof config.config === "object" ? config.config : {},
            enabled: true,
            impact: "read-only",
            metadata: {},
            createdAt: stamp,
            updatedAt: stamp,
        };
        known.add(id);
        newTools.push(record);
        return { ...node, config: { toolId: id } };
    });
    return { definition: { ...definition, nodes }, newTools };
}
var agentConfiguration_1 = require("./agentConfiguration");
Object.defineProperty(exports, "assertNoCredentials", { enumerable: true, get: function () { return agentConfiguration_1.assertNoCredentials; } });
Object.defineProperty(exports, "credentialIssues", { enumerable: true, get: function () { return agentConfiguration_1.credentialIssues; } });
Object.defineProperty(exports, "validateAgent", { enumerable: true, get: function () { return agentConfiguration_1.validateAgent; } });
Object.defineProperty(exports, "modelSettingsSchema", { enumerable: true, get: function () { return agentConfiguration_1.modelSettingsSchema; } });
Object.defineProperty(exports, "API_PROVIDER_SCHEMAS", { enumerable: true, get: function () { return agentConfiguration_1.API_PROVIDER_SCHEMAS; } });
Object.defineProperty(exports, "removeAgentNodes", { enumerable: true, get: function () { return agentConfiguration_1.removeAgentNodes; } });
exports.LEGACY_TO_CANONICAL_STATUS = {
    todo: "backlog",
    planning: "ready",
    in_progress: "running",
    waiting_tool: "blocked",
    review: "waiting_for_human",
    done: "completed",
};
function toCanonicalStatus(status) {
    if (status in exports.LEGACY_TO_CANONICAL_STATUS) {
        return exports.LEGACY_TO_CANONICAL_STATUS[status];
    }
    return status;
}
exports.CANONICAL_STATUS_TRANSITIONS = {
    backlog: ["ready", "queued", "running", "cancelled"],
    ready: ["backlog", "queued", "running", "cancelled"],
    queued: ["running", "ready", "cancelled"],
    running: ["blocked", "waiting_for_human", "completed", "failed", "cancelled", "ready"],
    blocked: ["running", "ready", "failed", "cancelled"],
    waiting_for_human: ["running", "completed", "failed", "cancelled"],
    completed: ["ready", "backlog"],
    failed: ["ready", "queued", "running", "backlog"],
    cancelled: ["ready", "backlog"],
};
exports.DEP_GATED_CANONICAL_STATUSES = [
    "queued",
    "running",
    "waiting_for_human",
    "completed",
];
function canTransitionStatus(from, to) {
    if (from === to)
        return false;
    const canonicalFrom = toCanonicalStatus(from);
    const canonicalTo = toCanonicalStatus(to);
    if (canonicalFrom === canonicalTo)
        return true;
    return (exports.CANONICAL_STATUS_TRANSITIONS[canonicalFrom] ?? []).includes(canonicalTo);
}
function isStatusDependencyGated(status) {
    return exports.DEP_GATED_CANONICAL_STATUSES.includes(toCanonicalStatus(status));
}
function isCompletedStatus(status) {
    return toCanonicalStatus(status) === "completed";
}
//# sourceMappingURL=index.js.map