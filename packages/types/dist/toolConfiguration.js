"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOOL_IMPACTS = exports.TOOL_CATEGORIES = void 0;
exports.createToolRecord = createToolRecord;
exports.migrateToolRecord = migrateToolRecord;
exports.validateTool = validateTool;
const agentConfiguration_1 = require("./agentConfiguration");
// Local copies of index.ts's uid/nowIso to avoid a circular module dependency
// (index.ts re-exports from this file).
function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso() {
    return new Date().toISOString();
}
exports.TOOL_CATEGORIES = [
    "function",
    "http",
    "database",
    "search",
    "file",
    "mcp",
    "cli",
    "custom",
];
exports.TOOL_IMPACTS = ["read-only", "write", "external", "high-impact"];
function createToolRecord(input) {
    const stamp = nowIso();
    return {
        id: uid("tool"),
        name: input?.name ?? "New Tool",
        description: input?.description ?? "",
        category: input?.category ?? "function",
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: {} },
        configuration: {},
        enabled: true,
        impact: "read-only",
        metadata: {},
        createdAt: stamp,
        updatedAt: stamp,
    };
}
function asJsonObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : { type: "object", properties: {} };
}
function asConfiguration(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const entries = Object.entries(value).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v));
    return Object.fromEntries(entries);
}
/** Normalize persisted / inbound tool records to the current schema. */
function migrateToolRecord(raw) {
    const record = (raw ?? {});
    const stamp = nowIso();
    return {
        id: typeof record.id === "string" && record.id ? record.id : uid("tool"),
        name: typeof record.name === "string" && record.name.trim() ? record.name : "New Tool",
        description: typeof record.description === "string" ? record.description : "",
        category: exports.TOOL_CATEGORIES.includes(record.category) ? record.category : "function",
        inputSchema: asJsonObject(record.inputSchema),
        outputSchema: asJsonObject(record.outputSchema),
        configuration: asConfiguration(record.configuration),
        enabled: record.enabled !== false,
        impact: exports.TOOL_IMPACTS.includes(record.impact) ? record.impact : "read-only",
        metadata: asConfiguration(record.metadata),
        createdAt: typeof record.createdAt === "string" ? record.createdAt : stamp,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : stamp,
    };
}
function validateTool(tool) {
    const errors = (0, agentConfiguration_1.credentialIssues)(tool);
    if (typeof tool?.name !== "string" || !tool.name.trim())
        errors.push("Tool name is required.");
    if (!exports.TOOL_CATEGORIES.includes(tool?.category))
        errors.push("A valid tool category is required.");
    if (!exports.TOOL_IMPACTS.includes(tool?.impact))
        errors.push("A valid tool impact/permission level is required.");
    if (tool.enabled !== undefined && typeof tool.enabled !== "boolean")
        errors.push("Enabled must be a boolean.");
    if (typeof tool.description !== "string")
        errors.push("Description must be a string.");
    if (!tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema))
        errors.push("Input schema must be a JSON object.");
    if (!tool.outputSchema || typeof tool.outputSchema !== "object" || Array.isArray(tool.outputSchema))
        errors.push("Output schema must be a JSON object.");
    if (!tool.configuration || typeof tool.configuration !== "object" || Array.isArray(tool.configuration) || Object.entries(tool.configuration).some(([key, value]) => !key.trim() || !["string", "number", "boolean"].includes(typeof value)))
        errors.push("Configuration values must be strings, numbers, or booleans.");
    if (!tool.metadata || typeof tool.metadata !== "object" || Array.isArray(tool.metadata) || Object.entries(tool.metadata).some(([key, value]) => !key.trim() || !["string", "number", "boolean"].includes(typeof value)))
        errors.push("Metadata values must be strings, numbers, or booleans.");
    return errors;
}
//# sourceMappingURL=toolConfiguration.js.map