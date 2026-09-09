"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDEMPOTENCY_METADATA_KEY = exports.MemoryAccessError = void 0;
exports.requireAccess = requireAccess;
exports.sameNamespace = sameNamespace;
exports.canUseNamespace = canUseNamespace;
exports.requireNamespaces = requireNamespaces;
exports.canAccessMemory = canAccessMemory;
exports.namespaceKey = namespaceKey;
exports.normalizeContent = normalizeContent;
exports.contentHash = contentHash;
exports.publicMemory = publicMemory;
exports.isLive = isLive;
exports.matchesFilters = matchesFilters;
exports.boundedInteger = boundedInteger;
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("../contracts");
const types_1 = require("@multi-agent/types");
var contracts_2 = require("../contracts");
Object.defineProperty(exports, "MemoryAccessError", { enumerable: true, get: function () { return contracts_2.MemoryAccessDeniedError; } });
function requireAccess(access) {
    if (!access || typeof access.principalId !== "string" || !access.principalId.trim() || typeof access.tenantId !== "string" || !access.tenantId.trim() || !Array.isArray(access.readableNamespaces) || !Array.isArray(access.writableNamespaces))
        throw new contracts_1.MemoryAccessDeniedError();
}
function sameNamespace(a, b) { return a.scope === b.scope && a.id === b.id; }
function canUseNamespace(namespace, access, write = false) {
    requireAccess(access);
    return (0, types_1.isMemoryNamespace)(namespace) && (write ? access.writableNamespaces : access.readableNamespaces).some(n => (0, types_1.isMemoryNamespace)(n) && sameNamespace(n, namespace))
        && !(namespace.scope === "agent" && access.agentId !== undefined && namespace.id !== access.agentId)
        && !(namespace.scope === "workflow" && access.workflowId !== undefined && namespace.id !== access.workflowId);
}
function requireNamespaces(namespaces, access, write = false) {
    requireAccess(access);
    if (!Array.isArray(namespaces) || namespaces.some(n => !canUseNamespace(n, access, write)))
        throw new contracts_1.MemoryAccessDeniedError();
}
function canAccessMemory(memory, access, write = false) {
    return memory.tenantId === access.tenantId && canUseNamespace(memory.namespace, access, write)
        && !(memory.visibility === "private" && access.agentId !== undefined && (memory.namespace.scope === "agent" ? memory.namespace.id : memory.source.agentId) !== access.agentId)
        && !(memory.visibility === "workflow" && access.workflowId !== undefined && (memory.namespace.scope === "workflow" ? memory.namespace.id : memory.source.workflowId) !== access.workflowId);
}
function namespaceKey(tenant, namespace) { return JSON.stringify([tenant, namespace.scope, namespace.id]); }
function normalizeContent(content) { return content.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim().replace(/[.!?]+$/u, ""); }
function contentHash(content) { return (0, node_crypto_1.createHash)("sha256").update(normalizeContent(content), "utf8").digest("hex"); }
/** Reserved application identity state; never writable or exposed through public metadata. */
exports.IDEMPOTENCY_METADATA_KEY = "__memory_idempotency";
function publicMemory(memory) {
    const { embedding: _embedding, embeddingMetadata: _embeddingMetadata, ...rest } = memory;
    const result = structuredClone(rest);
    if (result.metadata) {
        delete result.metadata[exports.IDEMPOTENCY_METADATA_KEY];
        if (!Object.keys(result.metadata).length)
            delete result.metadata;
    }
    return result;
}
function isLive(memory, now) { return memory.status === "active" && (!memory.expiresAt || Date.parse(memory.expiresAt) > now); }
function matchesFilters(memory, filters) {
    const contains = (value, filter) => {
        if (Array.isArray(filter))
            return Array.isArray(value) && filter.every(f => value.some(v => contains(v, f)));
        if (filter && typeof filter === "object")
            return !!value && typeof value === "object" && Object.entries(filter).every(([key, f]) => Object.prototype.hasOwnProperty.call(value, key) && contains(value[key], f));
        return value === filter;
    };
    return !filters || contains(memory.metadata ?? {}, filters);
}
function boundedInteger(value, fallback, maximum) {
    if (value === undefined)
        return fallback;
    if (!Number.isFinite(value) || value < 0)
        throw new contracts_1.MemoryValidationError("Invalid memory limit");
    return Math.min(maximum, Math.floor(value));
}
//# sourceMappingURL=access.js.map