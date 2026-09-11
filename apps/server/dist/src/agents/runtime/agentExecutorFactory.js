"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentExecutorFactory = exports.AgentExecutorFactory = void 0;
const apiAgentExecutor_1 = require("./apiAgentExecutor");
const notImplementedExecutor_1 = require("./notImplementedExecutor");
const cliAgentExecutor_1 = require("./cliAgentExecutor");
const localAgentExecutor_1 = require("./localAgentExecutor");
const telemetry_1 = require("../../observability/telemetry");
class AgentExecutorFactory {
    telemetry;
    constructor(telemetry = telemetry_1.ExecutionTelemetry.disabled()) {
        this.telemetry = telemetry;
    }
    create(backend) {
        if (backend.type === "api") {
            return new apiAgentExecutor_1.ApiAgentExecutor(undefined, this.telemetry);
        }
        if (backend.type === "cli") {
            return new cliAgentExecutor_1.CliAgentExecutor();
        }
        if (backend.type === "local") {
            if (backend.provider === "ollama" || backend.provider === "lmstudio")
                return new localAgentExecutor_1.LocalAgentExecutor();
            return new notImplementedExecutor_1.NotImplementedAgentExecutor(backend);
        }
        const exhaustive = backend;
        return new notImplementedExecutor_1.NotImplementedAgentExecutor(exhaustive);
    }
}
exports.AgentExecutorFactory = AgentExecutorFactory;
exports.agentExecutorFactory = new AgentExecutorFactory();
//# sourceMappingURL=agentExecutorFactory.js.map