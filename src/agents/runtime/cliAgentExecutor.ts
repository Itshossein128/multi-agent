import path from "node:path";
import fs from "node:fs";
import { nowIso, type AgentBackend } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { AgentExecutionFailedError } from "./errors";
import type { WorkerRuntime, WorkerSpec } from "./workerRuntime";
import { ContainerWorkerRuntime, LocalProcessWorkerRuntime, containerWorkerPolicyFromEnvironment } from "./workerRuntime";
import { NO_WORKER_CREDENTIALS, type WorkerCredentialResolver, type WorkerLaunchSecrets } from "./workerCredentials";

export interface CliRuntimePolicy {
  enabled: boolean;
  workerMode: CliWorkerMode;
  allowedExecutables: string[];
  workspaceRoots: string[];
  maxOutputBytes: number;
}

export type CliWorkerMode = "local" | "container";

export function cliWorkerModeFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): CliWorkerMode {
  const configured = env.CLI_WORKER_MODE?.trim() || "local";
  if (configured === "local" || configured === "container") return configured;
  throw new Error(`Invalid CLI_WORKER_MODE "${configured}". Expected "local" or "container".`);
}

export function cliRuntimePolicyFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): CliRuntimePolicy {
  const list = (value?: string) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const configuredMax = Number(env.CLI_AGENT_MAX_OUTPUT_BYTES ?? 1024 * 1024);
  return {
    enabled: env.CLI_AGENT_ENABLED === "true",
    workerMode: cliWorkerModeFromEnvironment(env),
    allowedExecutables: list(env.CLI_AGENT_ALLOWED_EXECUTABLES),
    workspaceRoots: list(env.CLI_AGENT_WORKSPACE_ROOTS).map((root) => path.resolve(root)),
    maxOutputBytes: Number.isInteger(configuredMax) && configuredMax >= 1024 && configuredMax <= 16 * 1024 * 1024 ? configuredMax : 1024 * 1024,
  };
}

export function resolveCliSpawnExecutable(
  executable: string,
  allowedExecutables: string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
  workerMode: CliWorkerMode = "local",
): string {
  // Container commands are resolved by the image. Resolving them against the
  // host would leak host-only absolute paths into a Linux worker invocation.
  if (workerMode === "container") return executable;

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

function resolveFromPath(command: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const hasExt = path.extname(command).length > 0;
  const exts = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
    : [""];
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

export class CliAgentExecutor implements AgentExecutor {
  private readonly workerRuntime: WorkerRuntime;
  constructor(
    workerRuntime: WorkerRuntime | undefined = undefined,
    private readonly runtimePolicy: CliRuntimePolicy = cliRuntimePolicyFromEnvironment(),
    private readonly credentialResolver: WorkerCredentialResolver = NO_WORKER_CREDENTIALS,
  ) {
    this.workerRuntime = workerRuntime ?? (runtimePolicy.workerMode === "container"
      ? new ContainerWorkerRuntime(runtimePolicy, containerWorkerPolicyFromEnvironment())
      : new LocalProcessWorkerRuntime(runtimePolicy));
  }

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    if (input.agent.backend.type !== "cli") throw new AgentExecutionFailedError("CliAgentExecutor requires a CLI backend.");
    const backend = input.agent.backend;
    const policy = input.agent.executionPolicy!;
    const executable = backend.executable || defaultCliExecutable(backend.provider);

    // The worker runtime also asserts policy, but doing it here provides an early rejection
    if (!this.runtimePolicy.enabled) throw new Error("CLI agent execution is disabled on this server. Set CLI_AGENT_ENABLED=true and configure server allowlists.");

    const spawnExecutable = resolveCliSpawnExecutable(
      executable,
      this.runtimePolicy.allowedExecutables,
      process.env,
      this.runtimePolicy.workerMode,
    );
    const args = commandArgs(backend, this.runtimePolicy.workerMode);

    yield event("agent.started", input, { provider: backend.provider, executable: spawnExecutable, args });

    try {
      let launchSecrets: WorkerLaunchSecrets | undefined;
      if (input.credentialPrincipal) {
        try {
          launchSecrets = await this.credentialResolver.resolve({
            tenantId: input.credentialPrincipal.tenantId,
            principalId: input.credentialPrincipal.principalId,
            runId: input.runId,
            agentId: input.agent.id,
            provider: backend.provider,
          });
        } catch {
          throw new Error("CLI credential resolution failed.");
        }
      }
      const spec: WorkerSpec = {
        runId: input.runId,
        nodeId: input.nodeId,
        agentId: input.agent.id,
        executable: spawnExecutable,
        args,
        cwd: policy.workspaceRoot!,
        timeoutMs: Number(process.env.AGENT_MAX_DURATION_MS ?? 120_000),
        maxOutputBytes: this.runtimePolicy.maxOutputBytes,
        workspaceAccess: policy.filesystem === "read-write" ? "read-write" : "read-only",
        network: policy.network === true,
      };

      const handle = await this.workerRuntime.start(spec, input.signal, prompt(input), launchSecrets);

      try {
        const result = await this.workerRuntime.wait(handle.workerId);
        input.signal?.throwIfAborted();

        if (result.reason === "output_limit") throw new Error(result.error || "Output limit exceeded");
        if (result.reason === "timeout") throw new Error(result.error || "Process timed out");
        if (result.reason === "spawn_error") throw new Error(result.error || "Spawn error");
        if (result.reason === "cancelled") throw new Error("Worker cancelled");

        if (result.code !== 0) {
          const detail = (result.stderr || result.stdout || "no output").trim();
          const clipped = detail.length > 2_000 ? `${detail.slice(0, 2_000)}…` : detail;
          throw new Error(`CLI command "${executable}" exited with code ${result.code}: ${clipped || "no output"}`);
        }
        yield event("agent.output", input, { content: result.stdout });
        yield event("agent.completed", input, { content: result.stdout });
      } finally {
        await this.workerRuntime.cleanup(handle.workerId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield event("agent.failed", input, { error: message });
      throw new AgentExecutionFailedError(message);
    }
  }
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

export function defaultCliExecutable(provider: string): string {
  return provider === "claude-code" ? "claude" : provider;
}

function commandArgs(backend: Extract<AgentBackend, { type: "cli" }>, workerMode: CliWorkerMode): string[] {
  const explicit = backend.args?.filter((arg) => arg.length > 0);
  const args = backend.provider === "codex"
    ? codexArgs(explicit)
    : backend.provider === "claude-code"
      ? claudeArgs(explicit, workerMode === "container")
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

/** Non-interactive Claude defaults for a Docker-isolated worker only. */
function claudeArgs(explicit: string[] | undefined, allowPermissionBypass: boolean): string[] {
  const args = ensureFlags(explicit, ["--print", "--output-format", "text"]);
  // Nested Claude permission prompts conflict with headless container runs.
  // Docker remains the security sandbox; local workers must retain Claude's
  // permission model. Do not use --bare (it disables OAuth).
  if (allowPermissionBypass
    && !args.includes("--dangerously-skip-permissions")
    && !args.includes("--permission-mode")
    && !args.includes("--allow-dangerously-skip-permissions")) {
    args.push("--dangerously-skip-permissions");
  }
  return args;
}

function ensureFlags(explicit: string[] | undefined, required: string[]): string[] {
  const args = [...(explicit ?? [])];
  if (!args.includes("--print")) args.unshift("--print");
  if (!args.includes("--output-format")) args.push("--output-format", "text");
  if (required.includes("--disable-slash-commands") && !args.includes("--disable-slash-commands")) args.push("--disable-slash-commands");
  return args;
}
