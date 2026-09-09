"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotImplementedToolExecutor = exports.UnsupportedToolCategoryError = void 0;
class UnsupportedToolCategoryError extends Error {
    category;
    constructor(category) {
        super(`Tool category "${category}" is not implemented yet.`);
        this.category = category;
        this.name = "UnsupportedToolCategoryError";
    }
}
exports.UnsupportedToolCategoryError = UnsupportedToolCategoryError;
/**
 * Placeholder for future HTTP / database / search / file / MCP / CLI / custom executors.
 * Fails explicitly — never falls back to a no-op success.
 */
class NotImplementedToolExecutor {
    category;
    constructor(category) {
        this.category = category;
    }
    async execute(_input) {
        void _input;
        throw new UnsupportedToolCategoryError(this.category);
    }
}
exports.NotImplementedToolExecutor = NotImplementedToolExecutor;
//# sourceMappingURL=notImplementedToolExecutor.js.map