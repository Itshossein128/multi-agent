"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentExecutorFactory = exports.AgentExecutorFactory = void 0;
const apiAgentExecutor_1 = require("./apiAgentExecutor");
const notImplementedExecutor_1 = require("./notImplementedExecutor");
const cliAgentExecutor_1 = require("./cliAgentExecutor");
const localAgentExecutor_1 = require("./localAgentExecutor");
const telemetry_1 = require("../../observability/telemetry");
const workerRuntime_1 = require("./workerRuntime");
const cliAgentExecutor_2 = require("./cliAgentExecutor");
class AgentExecutorFactory {
    telemetry;
    workerRuntime;
    constructor(telemetry = telemetry_1.ExecutionTelemetry.disabled(), workerRuntime = new workerRuntime_1.LocalProcessWorkerRuntime((0, cliAgentExecutor_2.cliRuntimePolicyFromEnvironment)())) {
        this.telemetry = telemetry;
        this.workerRuntime = workerRuntime;
    }
    create(backend) {
        if (backend.type === "api") {
            return new apiAgentExecutor_1.ApiAgentExecutor(undefined, this.telemetry);
        }
        if (backend.type === "cli") {
            return new cliAgentExecutor_1.CliAgentExecutor(this.workerRuntime);
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