import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { CliRuntimePolicy } from "./cliAgentExecutor";

export type WorkerTerminationReason =
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"
  | "output_limit"
  | "spawn_error";

export interface WorkerSpec {
  runId: string;
  nodeId: string;
  agentId: string;
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  maxOutputBytes: number;
  workspaceAccess?: "read-only" | "read-write";
  network?: boolean;
}

export interface WorkerHandle {
  workerId: string;
  runId: string;
  pid?: number;
}

export interface WorkerEvent {
  type: "stdout" | "stderr" | "error" | "exit";
  data?: string;
  code?: number;
  error?: Error;
}

export interface WorkerResult {
  code: number | null;
  stdout: string;
  stderr: string;
  reason: WorkerTerminationReason;
  error?: string;
}

export interface WorkerRuntime {
  start(spec: WorkerSpec, signal?: AbortSignal, input?: string): Promise<WorkerHandle>;
  stream(workerId: string): AsyncIterable<WorkerEvent>;
  wait(workerId: string): Promise<WorkerResult>;
  cancel(workerId: string, reason?: string): Promise<void>;
  cleanup(workerId: string): Promise<void>;
}

const DEFAULT_WORKER_ENV_KEYS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "COLORTERM",
  "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "LC_MESSAGES",
  "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "NODE_ENV",
]);

const INJECTION_ENV_NAMES = new Set([
  "NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV", "CDPATH", "PYTHONPATH",
  "PYTHONHOME", "RUBYOPT", "PERL5OPT", "GIT_SSH_COMMAND", "GIT_CONFIG_COMMAND",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
]);

function isProtectedWorkerEnvKey(key: string): boolean {
  const upperKey = key.toUpperCase();
  return INJECTION_ENV_NAMES.has(upperKey)
    || upperKey.startsWith("LD_")
    || upperKey.startsWith("DYLD_")
    || upperKey.startsWith("CLI_AGENT_")
    || upperKey.includes("SECRET")
    || upperKey.includes("KEY")
    || upperKey.includes("TOKEN")
    || upperKey.includes("PASSWORD")
    || upperKey.endsWith("_PAT")
    || upperKey.includes("DATABASE")
    || upperKey.startsWith("AUTH_");
}

/**
 * Build a child environment without forwarding process-injection variables.
 * Secret variables are opt-in through WORKER_ALLOWED_ENV_KEYS because local
 * CLI providers may legitimately authenticate from the host environment.
 */
export function buildWorkerEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  workerEnv?: Record<string, string | undefined>,
  explicitlyAllowedKeys: string[] = [],
): Record<string, string> {
  const result: Record<string, string> = {};

  const allowedKeys = new Set([
    ...DEFAULT_WORKER_ENV_KEYS,
    ...explicitlyAllowedKeys.map((key) => key.trim()).filter(Boolean),
  ]);
  const explicitlyAllowed = new Set(explicitlyAllowedKeys.map((key) => key.trim()).filter(Boolean));

  for (const [key, value] of Object.entries(baseEnv)) {
    if (!value) continue;
    if (!allowedKeys.has(key) || INJECTION_ENV_NAMES.has(key.toUpperCase())) continue;
    if (isProtectedWorkerEnvKey(key) && !explicitlyAllowed.has(key)) continue;
    result[key] = value;
  }

  if (workerEnv) {
    for (const [key, value] of Object.entries(workerEnv)) {
      if (!value) continue;
      if (isProtectedWorkerEnvKey(key) || !allowedKeys.has(key)) continue;
      result[key] = value;
    }
  }

  return result;
}

export class LocalProcessWorkerRuntime implements WorkerRuntime {
  private workers = new Map<string, {
    child: ChildProcess;
    spec: WorkerSpec;
    events: WorkerEvent[];
    resolvers: ((event: WorkerEvent) => void)[];
    waitPromise?: Promise<WorkerResult>;
    stdout: string;
    stderr: string;
    bytes: number;
    reason: WorkerTerminationReason;
    killTimer?: NodeJS.Timeout;
    errorMsg?: string;
    completed: boolean;
    terminationRequested: boolean;
  }>();

  constructor(
    private readonly policy: CliRuntimePolicy,
    private readonly spawnFn: typeof spawn = spawn
  ) {}

  private assertServerPolicy(spec: WorkerSpec): void {
    if (!this.policy.enabled) throw new Error("CLI agent execution is disabled on this server. Set CLI_AGENT_ENABLED=true and configure server allowlists.");
    if (!Number.isFinite(spec.maxOutputBytes) || spec.maxOutputBytes < 1) throw new Error("Worker maxOutputBytes must be a positive number.");
    if (!Number.isFinite(spec.timeoutMs) || spec.timeoutMs < 0) throw new Error("Worker timeoutMs must be a non-negative number.");

    if (!fs.existsSync(spec.cwd)) {
      throw new Error(`CLI workspace "${spec.cwd}" does not exist.`);
    }

    const cwdStat = fs.statSync(spec.cwd);
    if (!cwdStat.isDirectory()) throw new Error(`CLI workspace "${spec.cwd}" is not a directory.`);
    const resolvedCwd = fs.realpathSync(spec.cwd);
    const workspaceAllowed = this.policy.workspaceRoots.some((root) => {
      if (!fs.existsSync(root)) return false;
      const resolvedRoot = fs.realpathSync(root);
      if (resolvedCwd === resolvedRoot) return true;
      const rel = path.relative(resolvedRoot, resolvedCwd);
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    });

    if (!workspaceAllowed) throw new Error(`CLI workspace "${resolvedCwd}" is not allowed by the server runtime.`);

    const executableIsPath = path.isAbsolute(spec.executable) || spec.executable.includes("/") || spec.executable.includes("\\");
    const executableAllowed = executableIsPath
      ? this.policy.allowedExecutables.some((allowed) => {
        if (!path.isAbsolute(allowed)) return false;
        try {
          return fs.realpathSync(allowed) === fs.realpathSync(spec.executable);
        } catch {
          return false;
        }
      })
      : this.policy.allowedExecutables.includes(spec.executable) || this.policy.allowedExecutables.some((allowed) => path.isAbsolute(allowed) && this.matchesBareCommand(allowed, spec.executable));

    if (!executableAllowed) throw new Error(`CLI executable "${spec.executable}" is not allowed by the server runtime.`);
  }

  private matchesBareCommand(absoluteAllowed: string, bare: string): boolean {
    const base = path.basename(absoluteAllowed).toLowerCase();
    const name = bare.toLowerCase();
    return base === name || base === `${name}.exe` || base.replace(/\.exe$/i, "") === name;
  }

  private log(event: string, context: Record<string, unknown>) {
    const safeContext = { ...context };
    delete safeContext.env;
    console.info(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event, ...safeContext }));
  }

  async start(spec: WorkerSpec, signal?: AbortSignal, input?: string): Promise<WorkerHandle> {
    if (signal?.aborted) throw new Error("Worker cancelled before starting");

    this.assertServerPolicy(spec);

    const workerId = `worker-${randomUUID()}`;
    const startMs = Date.now();

    const explicitlyAllowedEnv = (process.env.WORKER_ALLOWED_ENV_KEYS ?? "")
      .split(",").map((key) => key.trim()).filter(Boolean);
    const env = buildWorkerEnv(process.env, spec.env, explicitlyAllowedEnv);

    const child = this.spawnFn(spec.executable, spec.args, { cwd: spec.cwd, shell: false, env: env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] }) as ChildProcess;

    const state: {
      child: ChildProcess;
      spec: WorkerSpec;
      events: WorkerEvent[];
      resolvers: ((event: WorkerEvent) => void)[];
      waitPromise?: Promise<WorkerResult>;
      stdout: string;
      stderr: string;
      bytes: number;
      reason: WorkerTerminationReason;
      killTimer?: NodeJS.Timeout;
      errorMsg?: string;
      completed: boolean;
      terminationRequested: boolean;
    } = {
      child,
      spec,
      events: [],
      resolvers: [],
      stdout: "",
      stderr: "",
      bytes: 0,
      reason: "completed",
      completed: false,
      errorMsg: undefined,
      terminationRequested: false,
    };

    this.workers.set(workerId, state);

    this.log("worker.started", { workerId, runId: spec.runId, agentId: spec.agentId, nodeId: spec.nodeId, executable: spec.executable });

    const emit = (event: WorkerEvent) => {
      state.events.push(event);
      while (state.resolvers.length) state.resolvers.shift()!(event);
    };

    const handleChunk = (chunk: Buffer, isErr: boolean) => {
      if (state.reason !== "completed" && state.reason !== "failed") return; // Skip if already terminating
      const text = chunk.toString();
      state.bytes += Buffer.byteLength(text);
      if (state.bytes > spec.maxOutputBytes) {
        state.reason = "output_limit";
        state.errorMsg = `CLI output exceeded the ${spec.maxOutputBytes}-byte server limit.`;
        this.terminateChild(workerId);
        emit({ type: "error", error: new Error(state.errorMsg) });
        return;
      }
      if (isErr) state.stderr += text;
      else state.stdout += text;
      emit({ type: isErr ? "stderr" : "stdout", data: text });
    };

    child.stdout?.on("data", (chunk) => handleChunk(chunk, false));
    child.stderr?.on("data", (chunk) => handleChunk(chunk, true));

    child.on("error", (error) => {
      if (!state.completed && state.reason === "completed") {
        state.reason = "spawn_error";
        state.errorMsg = error.message;
      }
      emit({ type: "error", error });
      this.log("worker.error", { workerId, runId: spec.runId, error: error.message, durationMs: Date.now() - startMs });
    });

    let timer: NodeJS.Timeout | undefined;
    if (spec.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (!state.completed) {
          state.reason = "timeout";
          state.errorMsg = `Worker timed out after ${spec.timeoutMs}ms`;
          this.terminateChild(workerId);
          emit({ type: "error", error: new Error(state.errorMsg) });
        }
      }, spec.timeoutMs);
    }

    const abort = () => {
      if (!state.completed) {
        state.reason = "cancelled";
        this.terminateChild(workerId);
      }
    };
    signal?.addEventListener("abort", abort, { once: true });

    // Resolve only after the process and both stdio streams have closed. This
    // prevents a fast process from returning before the final stdout chunk has
    // reached the data handler (which is observable with short-lived CLIs).
    state.waitPromise = new Promise<WorkerResult>((resolve) => {
      let childClosed = false;
      let code: number | null = null;
      let stdoutClosed = !child.stdout;
      let stderrClosed = !child.stderr;
      const finish = () => {
        if (!childClosed || !stdoutClosed || !stderrClosed) return;
        state.completed = true;
        clearTimeout(timer);
        clearTimeout(state.killTimer);
        signal?.removeEventListener("abort", abort);

        if (state.reason === "completed" && code !== 0) state.reason = "failed";
        emit({ type: "exit", code: code ?? undefined });
        this.log("worker.completed", { workerId, runId: spec.runId, reason: state.reason, exitCode: code, durationMs: Date.now() - startMs });
        resolve({ code, stdout: state.stdout, stderr: state.stderr, reason: state.reason, error: state.errorMsg });
      };
      child.stdout?.on("close", () => { stdoutClosed = true; finish(); });
      child.stderr?.on("close", () => { stderrClosed = true; finish(); });
      child.on("close", (exitCode) => { code = exitCode ?? null; childClosed = true; finish(); });
    });

    if (input) {
      child.stdin?.write(input);
      child.stdin?.end();
    }

    return { workerId, runId: spec.runId, pid: child.pid };
  }

  private terminateChild(workerId: string) {
    const state = this.workers.get(workerId);
    if (!state || state.completed || state.terminationRequested) return;
    state.terminationRequested = true;

    try {
      state.child.kill("SIGTERM");
      state.killTimer = setTimeout(() => {
        if (!state.completed) {
          try { state.child.kill("SIGKILL"); } catch { /* ignore */ }
        }
      }, 500);
    } catch {
      // ignore
    }
  }

  async *stream(workerId: string): AsyncIterable<WorkerEvent> {
    const state = this.workers.get(workerId);
    if (!state) throw new Error(`Worker ${workerId} not found`);

    let index = 0;
    while (true) {
      if (index < state.events.length) {
        const event = state.events[index++];
        yield event;
        if (event.type === "exit") break;
      } else {
        if (state.completed) return;
        await new Promise<WorkerEvent>((resolve) => state.resolvers.push(resolve));
      }
    }
  }

  wait(workerId: string): Promise<WorkerResult> {
    const state = this.workers.get(workerId);
    if (!state) throw new Error(`Worker ${workerId} not found`);
    return state.waitPromise!;
  }

  async cancel(workerId: string, reason?: string): Promise<void> {
    const state = this.workers.get(workerId);
    if (!state || state.completed) return;
    this.log("worker.cancelled", { workerId, reason });
    state.reason = "cancelled";
    this.terminateChild(workerId);
  }

  async cleanup(workerId: string): Promise<void> {
    const state = this.workers.get(workerId);
    if (state) {
      if (!state.completed) {
        state.reason = "cancelled";
        this.terminateChild(workerId);
        await state.waitPromise;
      }
      clearTimeout(state.killTimer);
      this.workers.delete(workerId);
    }
  }
}

export interface ContainerWorkerPolicy {
  image: string;
  dockerExecutable: string;
  allowNetwork: boolean;
  memory: string;
  cpus: string;
  pidsLimit: number;
  user: string;
}

export function containerWorkerPolicyFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): ContainerWorkerPolicy {
  return {
    image: env.CLI_WORKER_IMAGE?.trim() ?? "",
    dockerExecutable: env.CLI_WORKER_DOCKER_EXECUTABLE?.trim() || "docker",
    allowNetwork: env.CLI_WORKER_ALLOW_NETWORK === "true",
    memory: env.CLI_WORKER_MEMORY?.trim() || "1g",
    cpus: env.CLI_WORKER_CPUS?.trim() || "1",
    pidsLimit: boundedPositive(env.CLI_WORKER_PIDS_LIMIT, 128, 16, 4096),
    user: env.CLI_WORKER_USER?.trim() || "65534:65534",
  };
}

/**
 * Docker-backed isolation profile for untrusted CLI work. The container image
 * and all isolation settings are server-owned; workflow/agent records cannot
 * weaken them. Images must be pinned by digest to prevent tag drift.
 */
export class ContainerWorkerRuntime implements WorkerRuntime {
  private readonly delegate: LocalProcessWorkerRuntime;
  private readonly containers = new Map<string, string>();

  constructor(
    private readonly cliPolicy: CliRuntimePolicy,
    private readonly containerPolicy: ContainerWorkerPolicy = containerWorkerPolicyFromEnvironment(),
    private readonly spawnFn: typeof spawn = spawn,
  ) {
    this.delegate = new LocalProcessWorkerRuntime({ ...cliPolicy, allowedExecutables: [containerPolicy.dockerExecutable] }, spawnFn);
  }

  async start(spec: WorkerSpec, signal?: AbortSignal, input?: string): Promise<WorkerHandle> {
    if (!/@sha256:[a-f0-9]{64}$/i.test(this.containerPolicy.image)) {
      throw new Error("Hardened CLI worker requires CLI_WORKER_IMAGE pinned with an @sha256 digest.");
    }
    const containerName = `agent-worker-${randomUUID()}`;
    const allowedEnvKeys = (process.env.WORKER_ALLOWED_ENV_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
    const dockerSpec: WorkerSpec = {
      ...spec,
      executable: this.containerPolicy.dockerExecutable,
      args: buildContainerArgs(spec, this.containerPolicy, containerName, allowedEnvKeys),
    };
    const handle = await this.delegate.start(dockerSpec, signal, input);
    this.containers.set(handle.workerId, containerName);
    return handle;
  }

  stream(workerId: string): AsyncIterable<WorkerEvent> { return this.delegate.stream(workerId); }
  wait(workerId: string): Promise<WorkerResult> { return this.delegate.wait(workerId); }

  async cancel(workerId: string, reason?: string): Promise<void> {
    await this.delegate.cancel(workerId, reason);
    await this.removeContainer(workerId);
  }

  async cleanup(workerId: string): Promise<void> {
    try { await this.delegate.cleanup(workerId); }
    finally { await this.removeContainer(workerId); }
  }

  private async removeContainer(workerId: string): Promise<void> {
    const name = this.containers.get(workerId);
    if (!name) return;
    this.containers.delete(workerId);
    await new Promise<void>((resolve) => {
      const child = this.spawnFn(this.containerPolicy.dockerExecutable, ["rm", "-f", name], { shell: false, stdio: "ignore" });
      child.once("error", () => resolve());
      child.once("close", () => resolve());
    });
  }
}

export function buildContainerArgs(spec: WorkerSpec, policy: ContainerWorkerPolicy, name: string, allowedEnvKeys: string[]): string[] {
  const network = spec.network === true && policy.allowNetwork ? "bridge" : "none";
  const mountMode = spec.workspaceAccess === "read-write" ? "rw" : "ro";
  return [
    "run", "--rm", "--name", name, "--interactive",
    "--network", network,
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", String(policy.pidsLimit),
    "--memory", policy.memory,
    "--cpus", policy.cpus,
    "--user", policy.user,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    "--workdir", "/workspace",
    "--mount", `type=bind,source=${spec.cwd},target=/workspace,readonly=${mountMode === "ro"}`,
    ...allowedEnvKeys.filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)).flatMap((key) => ["--env", key]),
    policy.image,
    spec.executable,
    ...spec.args,
  ];
}

function boundedPositive(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
