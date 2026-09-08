"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentExecutorFactory = exports.AgentExecutorFactory = void 0;
const apiAgentExecutor_1 = require("./apiAgentExecutor");
const notImplementedExecutor_1 = require("./notImplementedExecutor");
class AgentExecutorFactory {
    create(backend) {
        if (backend.type === "api") {
            return new apiAgentExecutor_1.ApiAgentExecutor();
        }
        if (backend.type === "cli") {
            switch (backend.provider) {
                case "codex":
                    return new notImplementedExecutor_1.CodexCliExecutor();
                case "claude-code":
                    return new notImplementedExecutor_1.ClaudeCodeCliExecutor();
                case "agy":
                    return new notImplementedExecutor_1.AgyCliExecutor();
                default:
                    return new notImplementedExecutor_1.NotImplementedAgentExecutor(backend);
            }
        }
        if (backend.type === "local") {
            if (backend.provider === "ollama") {
                return new notImplementedExecutor_1.OllamaLocalExecutor(backend.model);
            }
            return new notImplementedExecutor_1.NotImplementedAgentExecutor(backend);
        }
        const exhaustive = backend;
        return new notImplementedExecutor_1.NotImplementedAgentExecutor(exhaustive);
    }
}
exports.AgentExecutorFactory = AgentExecutorFactory;
exports.agentExecutorFactory = new AgentExecutorFactory();
//# sourceMappingURL=agentExecutorFactory.js.map