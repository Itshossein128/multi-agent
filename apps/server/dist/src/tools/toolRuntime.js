"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRuntime = exports.ToolPolicyError = void 0;
const toolExecutorFactory_1 = require("./toolExecutorFactory");
class ToolPolicyError extends Error {
}
exports.ToolPolicyError = ToolPolicyError;
/** Server-side tool boundary: impact policy and timeout apply before category dispatch. */
class ToolRuntime {
    timeoutMs;
    allowSideEffects;
    constructor(timeoutMs = configuredTimeout(), allowSideEffects = process.env.TOOL_ALLOW_SIDE_EFFECTS === "true") {
        this.timeoutMs = timeoutMs;
        this.allowSideEffects = allowSideEffects;
    }
    async execute(tool, input, parentSignal) {
        if (!tool.enabled)
            throw new ToolPolicyError(`Tool "${tool.name}" is disabled.`);
        if (tool.impact !== "read-only" && !this.allowSideEffects)
            throw new ToolPolicyError(`Tool "${tool.name}" requires server approval because it is ${tool.impact}.`);
        const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
        return toolExecutorFactory_1.toolExecutorFactory.create(tool.category).execute({ tool, input, signal });
    }
}
exports.ToolRuntime = ToolRuntime;
function configuredTimeout() { const value = Number(process.env.TOOL_MAX_DURATION_MS ?? 30_000); return Number.isInteger(value) && value >= 1_000 && value <= 60 * 60_000 ? value : 30_000; }
//# sourceMappingURL=toolRuntime.js.map