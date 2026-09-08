"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentExecutionFailedError = exports.UnsupportedBackendError = void 0;
const types_1 = require("@multi-agent/types");
class UnsupportedBackendError extends Error {
    backend;
    constructor(backend, detail) {
        const key = `${backend.type}/${"provider" in backend ? backend.provider : "unknown"}`;
        super(detail ?? `Executor not registered for backend: ${key} (${(0, types_1.agentBackendLabel)(backend)})`);
        this.name = "UnsupportedBackendError";
        this.backend = backend;
    }
}
exports.UnsupportedBackendError = UnsupportedBackendError;
class AgentExecutionFailedError extends Error {
    constructor(message) {
        super(message);
        this.name = "AgentExecutionFailedError";
    }
}
exports.AgentExecutionFailedError = AgentExecutionFailedError;
//# sourceMappingURL=errors.js.map