"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentRuntime = void 0;
const agentExecutorFactory_1 = require("./agentExecutorFactory");
/**
 * Thin runtime boundary: resolve an executor from the agent backend, then stream events.
 * Kept inside the existing server process — not a distributed service.
 */
class AgentRuntime {
    executorFactory;
    constructor(executorFactory = agentExecutorFactory_1.agentExecutorFactory) {
        this.executorFactory = executorFactory;
    }
    async *execute(input) {
        const executor = this.executorFactory.create(input.agent.backend);
        yield* executor.execute(input);
    }
}
exports.AgentRuntime = AgentRuntime;
//# sourceMappingURL=agentRuntime.js.map