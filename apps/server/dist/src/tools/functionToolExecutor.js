"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FunctionToolExecutor = void 0;
/**
 * Safe local echo executor for the "function" category — no network, filesystem,
 * or process access. Proves the test-tool wiring end to end without any I/O.
 */
class FunctionToolExecutor {
    async execute({ tool, input }) {
        return { ...tool.configuration, ...input };
    }
}
exports.FunctionToolExecutor = FunctionToolExecutor;
//# sourceMappingURL=functionToolExecutor.js.map