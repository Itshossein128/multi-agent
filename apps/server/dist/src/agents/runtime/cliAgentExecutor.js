"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CliAgentExecutor = void 0;
const node_child_process_1 = require("node:child_process");
const types_1 = require("@multi-agent/types");
const errors_1 = require("./errors");
/** Executes a configured CLI directly (never through a shell) in its approved workspace. */
class CliAgentExecutor {
    spawn;
    constructor(spawn = node_child_process_1.spawn) {
        this.spawn = spawn;
    }
    async *execute(input) {
        if (input.agent.backend.type !== "cli")
            throw new errors_1.AgentExecutionFailedError("CliAgentExecutor requires a CLI backend.");
        const backend = input.agent.backend;
        const policy = input.agent.executionPolicy;
        const executable = backend.executable || backend.provider;
        const args = [...(backend.args ?? [])];
        yield event("agent.started", input, { provider: backend.provider, executable, args });
        try {
            const output = await this.run(executable, args, policy.workspaceRoot, prompt(input), input.signal);
            yield event("agent.output", input, { content: output });
            yield event("agent.completed", input, { content: output });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield event("agent.failed", input, { error: message });
            throw new errors_1.AgentExecutionFailedError(message);
        }
    }
    async run(executable, args, cwd, input, signal) {
        const child = this.spawn(executable, args, { cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
        const abort = () => child.kill("SIGTERM");
        signal?.addEventListener("abort", abort, { once: true });
        try {
            child.stdin.write(input);
            child.stdin.end();
            const [stdout, stderr, code] = await Promise.all([read(child.stdout), read(child.stderr), waitForExit(child)]);
            signal?.throwIfAborted();
            if (code !== 0)
                throw new Error(`CLI command "${executable}" exited with code ${code}: ${stderr || "no stderr"}`);
            return stdout;
        }
        finally {
            signal?.removeEventListener("abort", abort);
        }
    }
}
exports.CliAgentExecutor = CliAgentExecutor;
async function read(stream) {
    let value = "";
    for await (const chunk of stream)
        value += chunk.toString();
    return value;
}
function waitForExit(child) {
    return new Promise((resolve, reject) => {
        child.once("error", (error) => reject(error));
        child.once("close", (code) => resolve(code));
    });
}
function prompt(input) {
    return typeof input.input === "string" ? input.input : JSON.stringify(input.input ?? {});
}
function event(type, input, payload) {
    return { type, timestamp: (0, types_1.nowIso)(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload };
}
//# sourceMappingURL=cliAgentExecutor.js.map