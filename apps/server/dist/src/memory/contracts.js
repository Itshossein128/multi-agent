"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryConflictError = exports.MemoryValidationError = exports.MemoryAccessDeniedError = void 0;
class MemoryAccessDeniedError extends Error {
    constructor(message = "Memory access denied.") { super(message); this.name = "MemoryAccessDeniedError"; }
}
exports.MemoryAccessDeniedError = MemoryAccessDeniedError;
class MemoryValidationError extends Error {
    constructor(message) { super(message); this.name = "MemoryValidationError"; }
}
exports.MemoryValidationError = MemoryValidationError;
class MemoryConflictError extends Error {
    constructor(message = "Memory changed; reload and retry.") { super(message); this.name = "MemoryConflictError"; }
}
exports.MemoryConflictError = MemoryConflictError;
//# sourceMappingURL=contracts.js.map