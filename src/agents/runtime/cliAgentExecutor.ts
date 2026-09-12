import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nowIso, type AgentBackend } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { AgentExecutionFailedError } from "./errors";

type SpawnedProcess = {
  stdin: { write(value: string): void; end(): void };
  stdout: AsyncIterable<Buffer | string>;
  stderr: AsyncIterable<Buffer | string>;
  once(event: "error" | "close", listener: (value: Error | number | null) => void): void;
  kill(signal?: NodeJS.Signals): void;
};
export type CliSpawn = (executable: string, args: string[], options: { cwd: string; shell: false; stdio: ["pipe", "pipe", "pipe"] }) => SpawnedProcess;

export interface CliRuntimePolicy {
  enabled: boolean;
  allowedExecutables: string[];
  workspaceRoots: string[];
  maxOutputBytes: number;
}

export function cliRuntimePolicyFromEnvironment(env: NodeJS.ProcessEnv = process.env): CliRuntimePolicy {
  const list = (value?: string) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const configuredMax = Number(env.CLI_AGENT_MAX_OUTPUT_BYTES ?? 1024 * 1024);
  return {
    enabled: env.CLI_AGENT_ENABLED === "true",
    allowedExecutables: list(env.CLI_AGENT_ALLOWED_EXECUTABLES),
    workspaceRoots: list(env.CLI_AGENT_WORKSPACE_ROOTS).map((root) => path.resolve(root)),
    maxOutputBytes: Number.isInteger(configuredMax) && configuredMax >= 1024 && configuredMax <= 16 * 1024 * 1024 ? configuredMax : 1024 * 1024,
  };
}

/**
 * Map a policy-checked command name to something `spawn(..., { shell: false })` can
 * actually execute. On Windows, npm global shims are `.cmd` files and cannot be
 * spawned without a shell — prefer an allowlisted absolute `.exe`, then PATH `.exe`.
 */
export function resolveCliSpawnExecutable(executable: string, allowedExecutables: string[], env: NodeJS.ProcessEnv = process.env): string {
  if (path.isAbsolute(executable) || executable.includes("/") || executable.includes("\\")) {
    return path.resolve(executable);
  }

  const bare = executable.toLowerCase();
  const fromAllowlist = allowedExecutables.find((allowed) => {
    if (!path.isAbsolute(allowed)) return false;
    const base = path.basename(allowed).toLowerCase();
    return base === bare || base === `${bare}.exe` || base.replace(/\.exe$/i, "") === bare;
  });
  if (fromAllowlist) return path.resolve(fromAllowlist);

  const resolved = resolveFromPath(executable, env);
  if (resolved) return resolved;
  return executable;
}

function resolveFromPath(command: string, env: NodeJS.ProcessEnv): string | undefined {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const hasExt = path.extname(command).length > 0;
  const exts = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
  // Prefer native binaries; skip shell shims that require `shell: true`.
  const ordered = process.platform === "win32"
    ? [...exts.filter((ext) => ext.toUpperCase() === ".EXE"), ...exts.filter((ext) => ![".EXE", ".CMD", ".BAT"].includes(ext.toUpperCase()))]
    : exts;

  for (const dir of dirs) {
    for (const ext of ordered) {
      const candidate = path.join(dir, hasExt ? command : `${command}${ext}`);
      try {
        fs.accessSync(candidate, fs.constants.F_OK);
        if (process.platform === "win32" && /\.(cmd|bat)$/i.test(candidate)) continue;
        return candidate;
      } catch {
        /* keep searching */
      }
    }
  }
  return undefined;
}

/** Executes a configured CLI directly (never through a shell) in its approved workspace. */
export class CliAgentExecutor implements AgentExecutor {
  constructor(
    private readonly spawn: CliSpawn = nodeSpawn as unknown as CliSpawn,
    private readonly runtimePolicy: CliRuntimePolicy = cliRuntimePolicyFromEnvironment(),
  ) { }

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    if (input.agent.backend.type !== "cli") throw new AgentExecutionFailedError("CliAgentExecutor requires a CLI backend.");
    const backend = input.agent.backend;
    const policy = input.agent.executionPolicy!;
    const executable = backend.executable || defaultExecutable(backend.provider);
    this.assertServerPolicy(executable, policy.workspaceRoot!);
    const spawnExecutable = resolveCliSpawnExecutable(executable, this.runtimePolicy.allowedExecutables);
    const args = commandArgs(backend);
    yield event("agent.started", input, { provider: backend.provider, executable: spawnExecutable, args });
    try {
      const output = await this.run(spawnExecutable, args, policy.workspaceRoot!, prompt(input), input.signal);
      yield event("agent.output", input, { content: output });
      yield event("agent.completed", input, { content: output });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield event("agent.failed", input, { error: message });
      throw new AgentExecutionFailedError(message);
    }
  }

  private async run(executable: string, args: string[], cwd: string, input: string, signal?: AbortSignal): Promise<string> {
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
      if (code !== 0) throw new Error(`CLI command "${executable}" exited with code ${code}: ${stderr || "no stderr"}`);
      return stdout;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  private assertServerPolicy(executable: string, cwd: string): void {
    if (!this.runtimePolicy.enabled) throw new Error("CLI agent execution is disabled on this server. Set CLI_AGENT_ENABLED=true and configure server allowlists.");
    const executableAllowed = executable.includes(path.sep) || path.isAbsolute(executable)
      ? this.runtimePolicy.allowedExecutables.some((allowed) => path.isAbsolute(allowed) && path.resolve(allowed) === path.resolve(executable))
      : this.runtimePolicy.allowedExecutables.includes(executable)
      || this.runtimePolicy.allowedExecutables.some((allowed) => path.isAbsolute(allowed) && matchesBareCommand(allowed, executable));
    if (!executableAllowed) throw new Error(`CLI executable "${executable}" is not allowed by the server runtime.`);
    const resolvedCwd = path.resolve(cwd);
    const workspaceAllowed = this.runtimePolicy.workspaceRoots.some((root) => {
      const resolvedRoot = path.resolve(root);
      return resolvedCwd === resolvedRoot || resolvedCwd.startsWith(`${resolvedRoot}${path.sep}`);
    });
    if (!workspaceAllowed) throw new Error(`CLI workspace "${resolvedCwd}" is not allowed by the server runtime.`);
  }
}

function matchesBareCommand(absoluteAllowed: string, bare: string): boolean {
  const base = path.basename(absoluteAllowed).toLowerCase();
  const name = bare.toLowerCase();
  return base === name || base === `${name}.exe` || base.replace(/\.exe$/i, "") === name;
}

async function read(stream: AsyncIterable<Buffer | string>, limit: number, child: SpawnedProcess): Promise<string> {
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
function waitForExit(child: SpawnedProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once("error", (error) => reject(error));
    child.once("close", (code) => resolve(code as number | null));
  });
}
function prompt(input: AgentExecutionInput): string {
  const serialize = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value ?? {});
  const history = (input.context?.history ?? []) as { input: unknown; output: unknown }[];
  return [
    input.agent.systemPrompt ? `SYSTEM INSTRUCTIONS:\n${input.agent.systemPrompt}` : "",
    ...history.map((entry) => `PREVIOUS USER INPUT:\n${serialize(entry.input)}\nPREVIOUS ASSISTANT OUTPUT:\n${serialize(entry.output)}`),
    typeof input.context?.memoryContext === "string" && input.context.memoryContext ? `MEMORY CONTEXT:\n${input.context.memoryContext}` : "",
    `USER INPUT:\n${serialize(input.input)}`,
  ].filter(Boolean).join("\n\n");
}
function event(type: AgentExecutionEvent["type"], input: AgentExecutionInput, payload: unknown): AgentExecutionEvent {
  return { type, timestamp: nowIso(), agentId: input.agent.id, nodeId: input.nodeId, runId: input.runId, payload };
}

function defaultExecutable(provider: string): string {
  return provider === "claude-code" ? "claude" : provider;
}

function commandArgs(backend: Extract<AgentBackend, { type: "cli" }>): string[] {
  const explicit = backend.args?.filter((arg) => arg.length > 0);
  // Provider-specific non-interactive flags are invariants, not merely defaults.
  // Saved custom arguments must never be able to accidentally start a TUI in a
  // child process whose stdin/stderr are pipes rather than terminals.
  const args = backend.provider === "codex"
    ? codexArgs(explicit)
    : backend.provider === "claude-code"
      ? ensureFlags(explicit, ["--print", "--output-format", "text"])
      : backend.provider === "agy"
        ? ensureFlags(explicit, ["--print", "--output-format", "text", "--disable-slash-commands"])
        : [...(explicit ?? [])];
  if (backend.model && !args.some((arg) => arg === "--model" || arg === "-m")) args.push("--model", backend.model);
  return args;
}

function codexArgs(explicit?: string[]): string[] {
  const custom = [...(explicit ?? [])];
  if (custom[0] === "exec") custom.shift();
  return ["exec", ...custom, ...(custom.includes("-") ? [] : ["-"])];
}

function ensureFlags(explicit: string[] | undefined, required: string[]): string[] {
  const args = [...(explicit ?? [])];
  if (!args.includes("--print")) args.unshift("--print");
  if (!args.includes("--output-format")) args.push("--output-format", "text");
  if (required.includes("--disable-slash-commands") && !args.includes("--disable-slash-commands")) args.push("--disable-slash-commands");
  return args;
}
