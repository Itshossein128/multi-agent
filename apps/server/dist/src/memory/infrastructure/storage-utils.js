"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_MEMORY_CANDIDATES = exports.MemoryDuplicateError = exports.MemoryVersionConflictError = void 0;
exports.bounds = bounds;
exports.validateEmbedding = validateEmbedding;
exports.validateMemory = validateMemory;
exports.validateScope = validateScope;
exports.contains = contains;
exports.cosine = cosine;
const contracts_1 = require("../contracts");
const types_1 = require("@multi-agent/types");
class MemoryVersionConflictError extends contracts_1.MemoryConflictError {
    constructor() { super("Memory version conflict or record not found"); this.name = "MemoryVersionConflictError"; }
}
exports.MemoryVersionConflictError = MemoryVersionConflictError;
class MemoryDuplicateError extends contracts_1.MemoryConflictError {
    constructor() { super("Memory identity or idempotency key already exists"); this.name = "MemoryDuplicateError"; }
}
exports.MemoryDuplicateError = MemoryDuplicateError;
exports.MAX_MEMORY_CANDIDATES = 500;
function bounds(query) {
    if (!Number.isInteger(query.limit) || query.limit < 1 || !Number.isInteger(query.offset ?? 0) || (query.offset ?? 0) < 0)
        throw new contracts_1.MemoryValidationError("Invalid memory search bounds");
    return { limit: Math.min(query.limit, exports.MAX_MEMORY_CANDIDATES), offset: query.offset ?? 0 };
}
function validateEmbedding(vector, metadata) {
    if (!vector)
        return;
    if (!metadata || vector.length !== metadata.dimensions || !vector.length || vector.some(v => !Number.isFinite(v)) || !vector.some(v => v !== 0))
        throw new contracts_1.MemoryValidationError("Invalid memory embedding or metadata");
}
function validateMemory(memory) {
    validateScope(memory.tenantId, [memory.namespace]);
    if (!memory.id || !Number.isInteger(memory.version) || memory.version < 1)
        throw new contracts_1.MemoryValidationError("Invalid memory identity or version");
    validateEmbedding(memory.embedding, memory.embeddingMetadata);
}
function validateScope(tenantId, namespaces = []) {
    if (typeof tenantId !== "string" || !tenantId.trim() || !Array.isArray(namespaces) || namespaces.some(n => !(0, types_1.isMemoryNamespace)(n)))
        throw new contracts_1.MemoryValidationError("Memory tenant and exact namespaces are required");
}
/** Matches JSONB containment for JSON objects/arrays and scalar values. */
function contains(value, filter) {
    if (Array.isArray(filter))
        return Array.isArray(value) && filter.every(f => value.some(v => contains(v, f)));
    if (filter && typeof filter === "object")
        return !!value && typeof value === "object" && Object.entries(filter).every(([k, v]) => contains(value[k], v));
    return value === filter;
}
function cosine(a, b) {
    return a.reduce((sum, v, i) => sum + v * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b));
}
//# sourceMappingURL=storage-utils.js.map