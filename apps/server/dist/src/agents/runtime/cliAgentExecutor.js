"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CliAgentExecutor = void 0;
exports.cliRuntimePolicyFromEnvironment = cliRuntimePolicyFromEnvironment;
exports.resolveCliSpawnExecutable = resolveCliSpawnExecutable;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const types_1 = require("@multi-agent/types");
const errors_1 = require("./errors");
const workerRuntime_1 = require("./workerRuntime");
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
function resolveCliSpawnExecutable(executable, allowedExecutables, env = process.env) {
    if (node_path_1.default.isAbsolute(executable) || executable.includes("/") || executable.includes("\\")) {
        return node_path_1.default.resolve(executable);
    }
    const bare = executable.toLowerCase();
    const fromAllowlist = allowedExecutables.find((allowed) => {
        if (!node_path_1.default.isAbsolute(allowed))
            return false;
        const base = node_path_1.default.basename(allowed).toLowerCase();
        return base === bare || base === `${bare}.exe` || base.replace(/\.exe$/i, "") === bare;
    });
    if (fromAllowlist)
        return node_path_1.default.resolve(fromAllowlist);
    const resolved = resolveFromPath(executable, env);
    if (resolved)
        return resolved;
    return executable;
}
function resolveFromPath(command, env) {
    const dirs = (env.PATH ?? "").split(node_path_1.default.delimiter).filter(Boolean);
    const hasExt = node_path_1.default.extname(command).length > 0;
    const exts = process.platform === "win32"
        ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
        : [""];
    const ordered = process.platform === "win32"
        ? [...exts.filter((ext) => ext.toUpperCase() === ".EXE"), ...exts.filter((ext) => ![".EXE", ".CMD", ".BAT"].includes(ext.toUpperCase()))]
        : exts;
    for (const dir of dirs) {
        for (const ext of ordered) {
            const candidate = node_path_1.default.join(dir, hasExt ? command : `${command}${ext}`);
            try {
                node_fs_1.default.accessSync(candidate, node_fs_1.default.constants.F_OK);
                if (process.platform === "win32" && /\.(cmd|bat)$/i.test(candidate))
                    continue;
                return candidate;
            }
            catch {
                /* keep searching */
            }
        }
    }
    return undefined;
}
class CliAgentExecutor {
    workerRuntime;
    runtimePolicy;
    constructor(workerRuntime = new workerRuntime_1.LocalProcessWorkerRuntime(cliRuntimePolicyFromEnvironment()), runtimePolicy = cliRuntimePolicyFromEnvironment()) {
        this.workerRuntime = workerRuntime;
        this.runtimePolicy = runtimePolicy;
    }
    async *execute(input) {
        if (input.agent.backend.type !== "cli")
            throw new errors_1.AgentExecutionFailedError("CliAgentExecutor requires a CLI backend.");
        const backend = input.agent.backend;
        const policy = input.agent.executionPolicy;
        const executable = backend.executable || defaultExecutable(backend.provider);
        // The worker runtime also asserts policy, but doing it here provides an early rejection
        if (!this.runtimePolicy.enabled)
            throw new Error("CLI agent execution is disabled on this server. Set CLI_AGENT_ENABLED=true and configure server allowlists.");
        const spawnExecutable = resolveCliSpawnExecutable(executable, this.runtimePolicy.allowedExecutables);
        const args = commandArgs(backend);
        yield event("agent.started", input, { provider: backend.provider, executable: spawnExecutable, args });
        try {
            const spec = {
                runId: input.runId,
                nodeId: input.nodeId,
                agentId: input.agent.id,
                executable: spawnExecutable,
                args,
                cwd: policy.workspaceRoot,
                timeoutMs: Number(process.env.AGENT_MAX_DURATION_MS ?? 120_000),
                maxOutputBytes: this.runtimePolicy.maxOutputBytes,
            };
            const handle = await this.workerRuntime.start(spec, input.signal, prompt(input));
            try {
                const result = await this.workerRuntime.wait(handle.workerId);
                input.signal?.throwIfAborted();
                if (result.reason === "output_limit")
                    throw new Error(result.error || "Output limit exceeded");
                if (result.reason === "timeout")
                    throw new Error(result.error || "Process timed out");
                if (result.reason === "spawn_error")
                    throw new Error(result.error || "Spawn error");
                if (result.reason === "cancelled")
                    throw new Error("Worker cancelled");
                if (result.code !== 0)
                    throw new Error(`CLI command "${executable}" exited with code ${result.code}: ${result.stderr || "no stderr"}`);
                yield event("agent.output", input, { content: result.stdout });
                yield event("agent.completed", input, { content: result.stdout });
            }
            finally {
                await this.workerRuntime.cleanup(handle.workerId);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield event("agent.failed", input, { error: message });
            throw new errors_1.AgentExecutionFailedError(message);
        }
    }
}
exports.CliAgentExecutor = CliAgentExecutor;
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
    const args = backend.provider === "codex"
        ? codexArgs(explicit)
        : backend.provider === "claude-code"
            ? ensureFlags(explicit, ["--print", "--output-format", "text"])
            : backend.provider === "agy"
                ? ensureFlags(explicit, ["--print", "--output-format", "text", "--disable-slash-commands"])
                : [...(explicit ?? [])];
    if (backend.model && !args.some((arg) => arg === "--model" || arg === "-m"))
        args.push("--model", backend.model);
    return args;
}
function codexArgs(explicit) {
    const custom = [...(explicit ?? [])];
    if (custom[0] === "exec")
        custom.shift();
    return ["exec", ...custom, ...(custom.includes("-") ? [] : ["-"])];
}
function ensureFlags(explicit, required) {
    const args = [...(explicit ?? [])];
    if (!args.includes("--print"))
        args.unshift("--print");
    if (!args.includes("--output-format"))
        args.push("--output-format", "text");
    if (required.includes("--disable-slash-commands") && !args.includes("--disable-slash-commands"))
        args.push("--disable-slash-commands");
    return args;
}
//# sourceMappingURL=cliAgentExecutor.js.map