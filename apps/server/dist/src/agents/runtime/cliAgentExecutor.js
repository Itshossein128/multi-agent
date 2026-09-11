"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CliAgentExecutor = void 0;
exports.cliRuntimePolicyFromEnvironment = cliRuntimePolicyFromEnvironment;
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("@multi-agent/types");
const errors_1 = require("./errors");
function cliRuntimePolicyFromEnvironment(env = process.env) {
    const list = (value) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const configuredMax = Number(env.CLI_AGENT_MAX_OUTPUT_BYTES ?? 1024 * 1024);
    return {
        enabled: env.CLI_AGENT_ENABLED === "true",
        allowedExecutables: list(env.CLI_AGENT_ALLOWED_EXECUTABLES),
        workspaceRoots: list(env.CLI_AGENT_WORKSPACE_ROOTS).map((root) => node_path_1.default.resolve(root)),
        maxOutputBytes: Number.isInteger(configuredMax) && configuredMax >= 1024 && configuredMax <= 16 * 1024 * 1024 ? configuredMax : 1024 * 1024,
    };
}
/** Executes a configured CLI directly (never through a shell) in its approved workspace. */
class CliAgentExecutor {
    spawn;
    runtimePolicy;
    constructor(spawn = node_child_process_1.spawn, runtimePolicy = cliRuntimePolicyFromEnvironment()) {
        this.spawn = spawn;
        this.runtimePolicy = runtimePolicy;
    }
    async *execute(input) {
        if (input.agent.backend.type !== "cli")
            throw new errors_1.AgentExecutionFailedError("CliAgentExecutor requires a CLI backend.");
        const backend = input.agent.backend;
        const policy = input.agent.executionPolicy;
        const executable = backend.executable || defaultExecutable(backend.provider);
        this.assertServerPolicy(executable, policy.workspaceRoot);
        const args = commandArgs(backend);
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
            const [stdout, stderr, code] = await Promise.all([
                read(child.stdout, this.runtimePolicy.maxOutputBytes, child),
                read(child.stderr, this.runtimePolicy.maxOutputBytes, child),
                waitForExit(child),
            ]);
            signal?.throwIfAborted();
            if (code !== 0)
                throw new Error(`CLI command "${executable}" exited with code ${code}: ${stderr || "no stderr"}`);
            return stdout;
        }
        finally {
            signal?.removeEventListener("abort", abort);
        }
    }
    assertServerPolicy(executable, cwd) {
        if (!this.runtimePolicy.enabled)
            throw new Error("CLI agent execution is disabled on this server. Set CLI_AGENT_ENABLED=true and configure server allowlists.");
        const executableAllowed = executable.includes(node_path_1.default.sep)
            ? this.runtimePolicy.allowedExecutables.some((allowed) => node_path_1.default.isAbsolute(allowed) && node_path_1.default.resolve(allowed) === node_path_1.default.resolve(executable))
            : this.runtimePolicy.allowedExecutables.includes(executable);
        if (!executableAllowed)
            throw new Error(`CLI executable "${executable}" is not allowed by the server runtime.`);
        const resolvedCwd = node_path_1.default.resolve(cwd);
        const workspaceAllowed = this.runtimePolicy.workspaceRoots.some((root) => resolvedCwd === root || resolvedCwd.startsWith(`${root}${node_path_1.default.sep}`));
        if (!workspaceAllowed)
            throw new Error(`CLI workspace "${resolvedCwd}" is not allowed by the server runtime.`);
    }
}
exports.CliAgentExecutor = CliAgentExecutor;
async function read(stream, limit, child) {
    let value = "";
    let bytes = 0;
    for await (const chunk of stream) {
        const text = chunk.toString();
        bytes += Buffer.byteLength(text);
        if (bytes > limit) {
            child.kill("SIGTERM");
            throw new Error(`CLI output exceeded the ${limit}-byte server limit.`);
        }
        value += text;
    }
    return value;
}
function waitForExit(child) {
    return new Promise((resolve, reject) => {
        child.once("error", (error) => reject(error));
        child.once("close", (code) => resolve(code));
    });
}
function prompt(input) {
    const serialize = (value) => typeof value === "string" ? value : JSON.stringify(value ?? {});
    const history = (input.context?.history ?? []);
    return [
        input.agent.systemPrompt ? `SYSTEM INSTRUCTIONS:\n${input.agent.systemPrompt}` : "",
        ...history.map((entry) => `PREVIOUS USER INPUT:\n${serialize(entry.input)}\nPREVIOUS ASSISTANT OUTPUT:\n${serialize(entry.output)}`),
        typeof input.context?.memoryContext === "string" && input.context.memoryContext ? `MEMORY CONTEXT:\n${input.context.memoryContext}` : "",
        `USER INPUT:\n${serialize(input.input)}`,
    ].filter(Boolean).join("\n\n");
}
function event(type, input, payload) {
    return { type, timestamp: (0, types_1.nowIso)(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload };
}
function defaultExecutable(provider) {
    return provider === "claude-code" ? "claude" : provider;
}
function commandArgs(backend) {
    const explicit = backend.args?.filter((arg) => arg.length > 0);
    const args = explicit?.length ? [...explicit] : backend.provider === "codex"
        ? ["exec", "-"]
        : backend.provider === "claude-code"
            ? ["--print", "--output-format", "text"]
            : backend.provider === "agy"
                ? ["--print", "--output-format", "text", "--disable-slash-commands"]
                : [];
    if (backend.model && !args.some((arg) => arg === "--model" || arg === "-m"))
        args.push("--model", backend.model);
    return args;
}
//# sourceMappingURL=cliAgentExecutor.js.map