"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaLocalExecutor = exports.AgyCliExecutor = exports.ClaudeCodeCliExecutor = exports.CodexCliExecutor = exports.NotImplementedAgentExecutor = void 0;
const types_1 = require("@multi-agent/types");
const errors_1 = require("./errors");
/**
 * Placeholder for future CLI / local backends.
 * Fails explicitly — never falls back to API execution.
 */
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
/** Future Codex CLI integration boundary. */
class CodexCliExecutor extends NotImplementedAgentExecutor {
    constructor() {
        super({ type: "cli", provider: "codex" });
    }
}
exports.CodexCliExecutor = CodexCliExecutor;
/** Future Claude Code CLI integration boundary. */
class ClaudeCodeCliExecutor extends NotImplementedAgentExecutor {
    constructor() {
        super({ type: "cli", provider: "claude-code" });
    }
}
exports.ClaudeCodeCliExecutor = ClaudeCodeCliExecutor;
/** Future agy CLI integration boundary. */
class AgyCliExecutor extends NotImplementedAgentExecutor {
    constructor() {
        super({ type: "cli", provider: "agy" });
    }
}
exports.AgyCliExecutor = AgyCliExecutor;
/** Future Ollama local runtime boundary. */
class OllamaLocalExecutor extends NotImplementedAgentExecutor {
    constructor(model = "llama3") {
        super({ type: "local", provider: "ollama", model });
    }
}
exports.OllamaLocalExecutor = OllamaLocalExecutor;
//# sourceMappingURL=notImplementedExecutor.js.map