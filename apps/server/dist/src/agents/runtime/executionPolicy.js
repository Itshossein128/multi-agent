"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionPolicyError = void 0;
exports.assertExecutionPolicy = assertExecutionPolicy;
const node_path_1 = __importDefault(require("node:path"));
/** Thrown before an executor is selected when persisted policy disallows a run. */
class ExecutionPolicyError extends Error {
    constructor(message) {
        super(message);
        this.name = "ExecutionPolicyError";
    }
}
exports.ExecutionPolicyError = ExecutionPolicyError;
/**
 * Apply the policy at the server-side runtime boundary. CLI execution is always
 * opt-in: it needs a workspace plus an explicit shell permission. This avoids
 * treating an omitted policy as unrestricted local process access.
 */
function assertExecutionPolicy(agent) {
    const { backend, executionPolicy: policy } = agent;
    if ((backend.type === "api" || backend.type === "local") && policy?.network === false) {
        throw new ExecutionPolicyError(`Agent "${agent.name}" forbids network access, but its ${backend.type} backend requires it.`);
    }
    if (backend.type !== "cli")
        return;
    if (!policy || policy.shell === undefined || policy.shell === "disabled") {
        throw new ExecutionPolicyError(`Agent "${agent.name}" must explicitly allow CLI execution with shell policy "restricted" or "full".`);
    }
    if (policy.filesystem === "none") {
        throw new ExecutionPolicyError(`Agent "${agent.name}" forbids filesystem access, so its CLI backend cannot run.`);
    }
    if (!policy.workspaceRoot || !node_path_1.default.isAbsolute(policy.workspaceRoot)) {
        throw new ExecutionPolicyError(`Agent "${agent.name}" must provide an absolute workspaceRoot for CLI execution.`);
    }
    if (policy.shell === "restricted") {
        const executable = backend.executable || backend.provider;
        const command = node_path_1.default.basename(executable);
        if (!policy.allowedCommands?.some((allowed) => allowed === executable || allowed === command)) {
            throw new ExecutionPolicyError(`CLI command "${command}" is not permitted by this agent's restricted allowedCommands policy.`);
        }
    }
}
//# sourceMappingURL=executionPolicy.js.map