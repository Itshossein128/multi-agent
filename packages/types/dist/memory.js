"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMemoryNamespace = isMemoryNamespace;
function isMemoryNamespace(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const item = value;
    return ["agent", "workflow", "project", "organization", "user"].includes(String(item.scope))
        && typeof item.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(item.id)
        && Object.keys(item).every((key) => key === "scope" || key === "id");
}
//# sourceMappingURL=memory.js.map