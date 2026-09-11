"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotImplementedAgentExecutor = void 0;
const types_1 = require("@multi-agent/types");
const errors_1 = require("./errors");
/** Fails explicitly for an unknown backend and never falls back to API execution. */
class NotImplementedAgentExecutor {
    backend;
    constructor(backend) {
        this.backend = backend;
    }
    async *execute(input) {
        const key = `${this.backend.type}:${"provider" in this.backend ? this.backend.provider : "unknown"}`;
        const message = `Backend "${key}" is not implemented yet.`;
        yield {
            type: "agent.failed",
            timestamp: (0, types_1.nowIso)(),
            agentId: input.agent.id,
            nodeId: input.nodeId,
            runId: input.runId,
            payload: { error: message },
        };
        throw new errors_1.UnsupportedBackendError(this.backend, message);
    }
}
exports.NotImplementedAgentExecutor = NotImplementedAgentExecutor;
//# sourceMappingURL=notImplementedExecutor.js.map