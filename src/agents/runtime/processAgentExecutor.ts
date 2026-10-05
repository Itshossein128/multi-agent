import path from "node:path";
import fs from "node:fs";
import { nowIso, type AgentRecord } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { AgentExecutionFailedError } from "./errors";
import type { WorkerRuntime, WorkerSpec } from "./workerRuntime";
import { ContainerWorkerRuntime, LocalProcessWorkerRuntime, containerWorkerPolicyFromEnvironment } from "./workerRuntime";
import { configuredAgentTimeout } from "./agentTimeout";

export interface ProcessRuntimePolicy {
  enabled: boolean;
  workerMode: "local" | "container";
  trustedHostAllowed: boolean;
  allowedCommands: string[];
  allowedArgPatterns: RegExp[];
  workspaceRoots: string[];
  maxOutputBytes: number;
}

export function processRuntimePolicyFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): ProcessRuntimePolicy {
  const list = (value?: string) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const maxBytes = Number(env.PROCESS_AGENT_MAX_OUTPUT_BYTES ?? 1024 * 1024);
  const configuredMode = env.CLI_WORKER_MODE?.trim() || "local";
  const workerMode = configuredMode === "container" ? "container" : "local";

  const rawPatterns = list(env.PROCESS_AGENT_ALLOWED_ARG_PATTERNS);
  const allowedArgPatterns: RegExp[] = [];
  for (const pat of rawPatterns) {
    try {
      allowedArgPatterns.push(new RegExp(pat));
    } catch (err) {
      throw new AgentExecutionFailedError(
        `Invalid process argument regex pattern "${pat}": ${err instanceof Error ? err.message : String(err)}. Server policy fails closed.`
      );
    }
  }

  return {
    enabled: env.PROCESS_AGENT_ENABLED === "true",
    workerMode,
    // Explicit opt-in required; never defaults to true in non-production
    trustedHostAllowed: env.PROCESS_AGENT_TRUSTED_HOST_ALLOWED === "true",
    allowedCommands: list(env.PROCESS_AGENT_ALLOWED_COMMANDS),
    allowedArgPatterns,
    workspaceRoots: list(env.PROCESS_AGENT_WORKSPACE_ROOTS).map((root) => path.resolve(root)),
    maxOutputBytes: Number.isInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 16 * 1024 * 1024 ? maxBytes : 1024 * 1024,
  };
}

export class ProcessAgentExecutor implements AgentExecutor {
  private readonly workerRuntime: WorkerRuntime;

  constructor(
    workerRuntime: WorkerRuntime | undefined = undefined,
    private readonly runtimePolicy: ProcessRuntimePolicy = processRuntimePolicyFromEnvironment(),
  ) {
    const cliEquivalentPolicy = {
      enabled: runtimePolicy.enabled,
      workerMode: runtimePolicy.workerMode,
      allowedExecutables: runtimePolicy.allowedCommands,
      workspaceRoots: runtimePolicy.workspaceRoots,
      maxOutputBytes: runtimePolicy.maxOutputBytes,
    };
    this.workerRuntime = workerRuntime ?? (runtimePolicy.workerMode === "container"
      ? new ContainerWorkerRuntime(cliEquivalentPolicy, containerWorkerPolicyFromEnvironment())
      : new LocalProcessWorkerRuntime(cliEquivalentPolicy));
  }

  async *execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent> {
    if (input.agent.backend.type !== "process") {
      throw new AgentExecutionFailedError("ProcessAgentExecutor requires a process backend.");
    }
    const backend = input.agent.backend;

    if (!this.runtimePolicy.enabled) {
      const msg = "Process agent execution is disabled on this server. Set PROCESS_AGENT_ENABLED=true and configure server allowlists.";
      yield event("agent.failed", input, { error: msg });
      throw new AgentExecutionFailedError(msg);
    }

    // Tenant / isolation check: host execution is trusted-only
    if (this.runtimePolicy.workerMode === "local" && !this.runtimePolicy.trustedHostAllowed) {
      const msg = "Local process host execution is restricted to trusted operators (PROCESS_AGENT_TRUSTED_HOST_ALLOWED=true). Multi-tenant execution requires container isolation or fails closed.";
      yield event("agent.failed", input, { error: msg });
      throw new AgentExecutionFailedError(msg);
    }

    const command = backend.command?.trim();
    if (!command || /[\r\n\0]/.test(command)) {
      throw new AgentExecutionFailedError("Invalid process command specified.");
    }

    // Verify canonical command identity against allowlist
    const spawnExecutable = resolveProcessExecutable(command, this.runtimePolicy.allowedCommands, this.runtimePolicy.workerMode);

    // Validate arguments against operator patterns and forbidden characters (Spec Kit FR-002)
    const args = backend.args ?? [];
    validateProcessArgs(args, this.runtimePolicy.allowedArgPatterns);

    // Resolve workspace
    const requestedCwd = backend.workspaceRoot || input.agent.executionPolicy?.workspaceRoot || this.runtimePolicy.workspaceRoots[0] || process.cwd();
    const resolvedCwd = path.resolve(requestedCwd);

    if (this.runtimePolicy.workspaceRoots.length > 0) {
      const workspaceAllowed = this.runtimePolicy.workspaceRoots.some((root) => {
        const resolvedRoot = path.resolve(root);
        if (resolvedCwd === resolvedRoot) return true;
        const rel = path.relative(resolvedRoot, resolvedCwd);
        return !rel.startsWith("..") && !path.isAbsolute(rel);
      });
      if (!workspaceAllowed) {
        const msg = `Process working directory "${resolvedCwd}" is not within allowed workspace roots.`;
        yield event("agent.failed", input, { error: msg });
        throw new AgentExecutionFailedError(msg);
      }
    }

    yield event("agent.started", input, { command: spawnExecutable, args, cwd: resolvedCwd });

    try {
      const spec: WorkerSpec = {
        runId: input.runId,
        nodeId: input.nodeId,
        agentId: input.agent.id,
        executable: spawnExecutable,
        args,
        cwd: resolvedCwd,
        timeoutMs: configuredAgentTimeout(),
        maxOutputBytes: this.runtimePolicy.maxOutputBytes,
        workspaceAccess: input.agent.executionPolicy?.filesystem === "read-write" ? "read-write" : "read-only",
        network: input.agent.executionPolicy?.network === true,
      };

      const workerInput = serializeProcessInput(input);
      const handle = await this.workerRuntime.start(spec, input.signal, workerInput);

      try {
        const result = await this.workerRuntime.wait(handle.workerId);
        input.signal?.throwIfAborted();

        if (result.reason === "output_limit") throw new Error(result.error || "Output limit exceeded");
        if (result.reason === "timeout") throw new Error(result.error || "Process timed out");
        if (result.reason === "spawn_error") throw new Error(result.error || "Spawn error");
        if (result.reason === "cancelled") throw new Error("Process execution cancelled");

        if (result.code !== 0) {
          const detail = (result.stderr || result.stdout || "no output").trim();
          const clipped = detail.length > 2_000 ? `${detail.slice(0, 2_000)}…` : detail;
          throw new Error(`Process "${command}" exited with code ${result.code}: ${clipped}`);
        }

        const outputContent = result.stdout.trim();
        yield event("agent.output", input, { content: outputContent });
        yield event("agent.completed", input, { content: outputContent });
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

export function validateProcessArgs(args: string[], allowedPatterns: RegExp[]): void {
  if (args.length > 0 && allowedPatterns.length === 0) {
    throw new AgentExecutionFailedError("Process arguments are not permitted unless server-approved argument patterns are configured.");
  }

  for (const arg of args) {
    if (/[\0\r\n;&|`$><]/.test(arg)) {
      throw new AgentExecutionFailedError(`Process argument "${arg}" contains forbidden shell metacharacters.`);
    }
    if (["-e", "--eval", "-c", "--command"].includes(arg)) {
      throw new AgentExecutionFailedError(`Process argument "${arg}" is a restricted interpreter execution flag.`);
    }
    if (allowedPatterns.length > 0) {
      const matches = allowedPatterns.some((pattern) => {
        // Enforce full-string match and strip stateful /g or /y flags
        const flags = pattern.flags.replace(/[gy]/g, "");
        const source = pattern.source.startsWith("^") && pattern.source.endsWith("$")
          ? pattern.source
          : `^(?:${pattern.source})$`;
        const statelessRegex = new RegExp(source, flags);
        return statelessRegex.test(arg);
      });
      if (!matches) {
        throw new AgentExecutionFailedError(`Process argument "${arg}" does not match server-approved argument patterns.`);
      }
    }
  }
}

export function resolveProcessExecutable(
  command: string,
  allowedCommands: string[],
  workerMode: "local" | "container",
): string {
  if (workerMode === "container") {
    const allowed = allowedCommands.some((item) => item === command || path.basename(item) === command);
    if (!allowed) {
      throw new AgentExecutionFailedError(`Process command "${command}" is not on the server-approved allowlist.`);
    }
    return command;
  }

  // Local mode: Canonical path check
  const hasSep = command.includes("/") || command.includes("\\");
  let candidatePath: string | undefined;

  if (hasSep || path.isAbsolute(command)) {
    candidatePath = path.resolve(command);
  } else {
    candidatePath = resolveFromSystemPath(command);
  }

  if (!candidatePath || !fs.existsSync(candidatePath)) {
    throw new AgentExecutionFailedError(`Process command "${command}" is not on the server-approved allowlist.`);
  }

  let canonicalCandidate: string;
  try {
    canonicalCandidate = fs.realpathSync(candidatePath);
  } catch {
    throw new AgentExecutionFailedError(`Could not resolve canonical path for process command "${command}".`);
  }

  const isApproved = allowedCommands.some((allowed) => {
    let allowedPath: string | undefined;
    if (allowed.includes("/") || allowed.includes("\\") || path.isAbsolute(allowed)) {
      allowedPath = path.resolve(allowed);
    } else {
      allowedPath = resolveFromSystemPath(allowed);
    }
    if (allowedPath && fs.existsSync(allowedPath)) {
      try {
        return fs.realpathSync(allowedPath) === canonicalCandidate;
      } catch {
        return false;
      }
    }
    return false;
  });

  if (!isApproved) {
    throw new AgentExecutionFailedError(
      `Process command "${command}" (canonical path: "${canonicalCandidate}") is not on the server-approved allowlist.`
    );
  }

  return canonicalCandidate;
}

function resolveFromSystemPath(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? `${name}${ext}` : name);
      try {
        if (fs.existsSync(full)) {
          fs.accessSync(full, fs.constants.X_OK);
          return full;
        }
      } catch {
        // continue search
      }
    }
  }
  return undefined;
}

function serializeProcessInput(input: AgentExecutionInput): string {
  if (typeof input.input === "string") return input.input;
  return JSON.stringify({
    input: input.input,
    context: input.context,
    systemPrompt: input.agent.systemPrompt,
  });
}

function event(type: AgentExecutionEvent["type"], input: AgentExecutionInput, payload: unknown): AgentExecutionEvent {
  return {
    type,
    timestamp: nowIso(),
    agentId: input.agent.id,
    nodeId: input.nodeId,
    runId: input.runId,
    payload,
  };
}
