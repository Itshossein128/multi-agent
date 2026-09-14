import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { CliRuntimePolicy } from "./cliAgentExecutor";
import {
  assertAllowedCredentialContainerPath,
  PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES,
  sha256Hex,
  type WorkerCredentialFile,
  type WorkerLaunchSecrets,
} from "./workerCredentials";

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
  start(spec: WorkerSpec, signal?: AbortSignal, input?: string, launchSecrets?: WorkerLaunchSecrets): Promise<WorkerHandle>;
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
 * WORKER_ALLOWED_ENV_KEYS is for non-secret compatibility variables only.
 * Credentials use the separate trusted launch-secret channel in every mode.
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
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!value) continue;
    if (!allowedKeys.has(key) || INJECTION_ENV_NAMES.has(key.toUpperCase())) continue;
    if (isProtectedWorkerEnvKey(key)) continue;
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
    private readonly spawnFn: typeof spawn = spawn,
    private readonly explicitlyAllowedEnvironmentKeys?: ReadonlyArray<string>,
  ) { }

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

  async start(spec: WorkerSpec, signal?: AbortSignal, input?: string, launchSecrets?: WorkerLaunchSecrets): Promise<WorkerHandle> {
    if (signal?.aborted) throw new Error("Worker cancelled before starting");

    this.assertServerPolicy(spec);

    const workerId = `worker-${randomUUID()}`;
    const startMs = Date.now();

    const explicitlyAllowedEnv = this.explicitlyAllowedEnvironmentKeys
      ? [...this.explicitlyAllowedEnvironmentKeys]
      : workerAllowedEnvironmentKeys();
    const launchEnvironment = validatedLaunchEnvironment(launchSecrets);
    const redactionEnvironment = launchSecretRedactionValues(launchSecrets);
    const env = { ...buildWorkerEnv(process.env, spec.env, explicitlyAllowedEnv), ...launchEnvironment };

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

    const stdoutRedactor = new LaunchSecretStreamRedactor(redactionEnvironment);
    const stderrRedactor = new LaunchSecretStreamRedactor(redactionEnvironment);
    const appendSafeText = (safeText: string, isErr: boolean) => {
      if (!safeText) return;
      if (isErr) state.stderr += safeText;
      else state.stdout += safeText;
      emit({ type: isErr ? "stderr" : "stdout", data: safeText });
    };

    const handleChunk = (chunk: Buffer, isErr: boolean) => {
      if (state.reason !== "completed" && state.reason !== "failed") return; // Skip if already terminating
      const rawText = chunk.toString();
      state.bytes += Buffer.byteLength(rawText);
      if (state.bytes > spec.maxOutputBytes) {
        state.reason = "output_limit";
        state.errorMsg = `CLI output exceeded the ${spec.maxOutputBytes}-byte server limit.`;
        this.terminateChild(workerId);
        emit({ type: "error", error: new Error(state.errorMsg) });
        return;
      }
      appendSafeText((isErr ? stderrRedactor : stdoutRedactor).push(rawText), isErr);
    };

    child.stdout?.on("data", (chunk) => handleChunk(chunk, false));
    child.stderr?.on("data", (chunk) => handleChunk(chunk, true));

    child.on("error", (error) => {
      if (!state.completed && state.reason === "completed") {
        state.reason = "spawn_error";
        state.errorMsg = redactLaunchSecretValues(error.message, redactionEnvironment);
      }
      const safeError = new Error(redactLaunchSecretValues(error.message, redactionEnvironment));
      emit({ type: "error", error: safeError });
      this.log("worker.error", { workerId, runId: spec.runId, error: safeError.message, durationMs: Date.now() - startMs });
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
      child.stdout?.on("close", () => { appendSafeText(stdoutRedactor.flush(), false); stdoutClosed = true; finish(); });
      child.stderr?.on("close", () => { appendSafeText(stderrRedactor.flush(), true); stderrClosed = true; finish(); });
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

const TRUSTED_LAUNCH_SECRET_ENV_NAMES = new Set(Object.values(PROVIDER_CREDENTIAL_ENVIRONMENT_NAMES).flatMap((names) => [...names]));

function isSupportedLaunchSecretName(key: string): boolean {
  return TRUSTED_LAUNCH_SECRET_ENV_NAMES.has(key) && !INJECTION_ENV_NAMES.has(key.toUpperCase());
}

function launchSecretRedactionValues(launchSecrets?: WorkerLaunchSecrets): Record<string, string> {
  const values: Record<string, string> = { ...validatedLaunchEnvironment(launchSecrets) };
  for (const file of launchSecrets?.files ?? []) {
    const asUtf8 = file.content.toString("utf8");
    if (asUtf8) values[`file:${file.containerPath}`] = asUtf8;
  }
  return values;
}

function workerAllowedEnvironmentKeys(): string[] {
  return (process.env.WORKER_ALLOWED_ENV_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);
}

function resolveHostExecutable(executable: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (path.isAbsolute(executable) || executable.includes("/") || executable.includes("\\")) {
    const resolved = path.resolve(executable);
    fs.accessSync(resolved, fs.constants.F_OK);
    return resolved;
  }
  const extensions = process.platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.COM").split(";").filter((extension) => !/\.(cmd|bat)$/i.test(extension))
    : [""];
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, path.extname(executable) ? executable : `${executable}${extension}`);
      try {
        fs.accessSync(candidate, fs.constants.F_OK);
        return fs.realpathSync(candidate);
      } catch { /* continue */ }
    }
  }
  throw new Error(`Container runtime executable "${executable}" is not available on the server.`);
}

function validatedLaunchEnvironment(launchSecrets?: WorkerLaunchSecrets): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(launchSecrets?.environment ?? {})) {
    if (!isSupportedLaunchSecretName(key)) {
      throw new Error("Trusted launch secret contains an unsupported environment name.");
    }
    if (!value) throw new Error("Trusted launch secrets must not contain empty values.");
    result[key] = value;
  }
  return result;
}

function redactLaunchSecretValues(value: string, launchEnvironment: Readonly<Record<string, string>>): string {
  return Object.values(launchEnvironment)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, secret) => redacted.split(secret).join("[REDACTED]"), value);
}

class LaunchSecretStreamRedactor {
  private pending = "";
  private readonly secrets: string[];
  private readonly retainedCharacters: number;

  constructor(launchEnvironment: Readonly<Record<string, string>>) {
    this.secrets = Object.values(launchEnvironment).filter(Boolean).sort((left, right) => right.length - left.length);
    this.retainedCharacters = Math.max(0, ...this.secrets.map((secret) => secret.length - 1));
  }

  push(value: string): string {
    if (!this.secrets.length) return value;
    this.pending += value;
    const decisionLimit = Math.max(0, this.pending.length - this.retainedCharacters);
    if (!decisionLimit) return "";
    let cursor = 0;
    let emitted = "";
    while (cursor < decisionLimit) {
      const matches = this.secrets
        .map((secret) => ({ secret, index: this.pending.indexOf(secret, cursor) }))
        .filter((match) => match.index >= 0)
        .sort((left, right) => left.index - right.index || right.secret.length - left.secret.length);
      const match = matches[0];
      if (!match || match.index >= decisionLimit) {
        emitted += this.pending.slice(cursor, decisionLimit);
        cursor = decisionLimit;
        break;
      }
      emitted += this.pending.slice(cursor, match.index) + "[REDACTED]";
      cursor = match.index + match.secret.length;
    }
    this.pending = this.pending.slice(cursor);
    return emitted;
  }

  flush(): string {
    const emitted = this.redact(this.pending);
    this.pending = "";
    return emitted;
  }

  private redact(value: string): string {
    return this.secrets.reduce((redacted, secret) => redacted.split(secret).join("[REDACTED]"), value);
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

export const CONTAINER_CLI_PATHS = {
  home: "/home/worker",
  config: "/home/worker/.config",
  cache: "/home/worker/.cache",
  data: "/home/worker/.local/share",
  codexHome: "/home/worker/.codex",
  claudeConfig: "/home/worker/.claude",
  temp: "/tmp",
} as const;

const CONTAINER_ENVIRONMENT: Readonly<Record<string, string>> = {
  HOME: CONTAINER_CLI_PATHS.home,
  XDG_CONFIG_HOME: CONTAINER_CLI_PATHS.config,
  XDG_CACHE_HOME: CONTAINER_CLI_PATHS.cache,
  XDG_DATA_HOME: CONTAINER_CLI_PATHS.data,
  CODEX_HOME: CONTAINER_CLI_PATHS.codexHome,
  CLAUDE_CONFIG_DIR: CONTAINER_CLI_PATHS.claudeConfig,
  // Claude Code 2.1.270 requires bubblewrap when subprocess env scrub is enabled.
  // This worker image does not ship bubblewrap; the hardened Docker profile is
  // already the isolation boundary, so scrub stays off for container workers only.
  CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "0",
  CLAUDE_CODE_SKIP_PROMPT_HISTORY: "1",
  TMPDIR: CONTAINER_CLI_PATHS.temp,
  TMP: CONTAINER_CLI_PATHS.temp,
  TEMP: CONTAINER_CLI_PATHS.temp,
};

const CONTAINER_RESERVED_ENV_KEYS = new Set(Object.keys(CONTAINER_ENVIRONMENT));

export const CONTAINER_HOME_INIT_SCRIPT = [
  "umask 077",
  `mkdir -p ${CONTAINER_CLI_PATHS.codexHome} ${CONTAINER_CLI_PATHS.claudeConfig} ${CONTAINER_CLI_PATHS.config} ${CONTAINER_CLI_PATHS.cache} ${CONTAINER_CLI_PATHS.data}`,
  `chmod 700 ${CONTAINER_CLI_PATHS.codexHome} ${CONTAINER_CLI_PATHS.claudeConfig} ${CONTAINER_CLI_PATHS.config} ${CONTAINER_CLI_PATHS.cache} ${CONTAINER_CLI_PATHS.data}`,
  'exec "$@"',
].join("; ");

/** Keeps the container (and home tmpfs) alive so credentials can be injected and recovered. */
export const CONTAINER_CREDENTIAL_HOLDER_SCRIPT = [
  "umask 077",
  `mkdir -p ${CONTAINER_CLI_PATHS.codexHome} ${CONTAINER_CLI_PATHS.claudeConfig} ${CONTAINER_CLI_PATHS.config} ${CONTAINER_CLI_PATHS.cache} ${CONTAINER_CLI_PATHS.data}`,
  `chmod 700 ${CONTAINER_CLI_PATHS.codexHome} ${CONTAINER_CLI_PATHS.claudeConfig} ${CONTAINER_CLI_PATHS.config} ${CONTAINER_CLI_PATHS.cache} ${CONTAINER_CLI_PATHS.data}`,
  "while [ ! -f /tmp/.worker-stop ]; do sleep 0.2; done",
].join("; ");

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

export function assertContainerWorkerConfiguration(
  executable: string,
  cliPolicy: CliRuntimePolicy,
  containerPolicy: ContainerWorkerPolicy,
): void {
  if (!cliPolicy.enabled) {
    throw new Error("CLI agent execution is disabled on this server. Set CLI_AGENT_ENABLED=true and configure server allowlists.");
  }
  if (!/(@sha256:[a-f0-9]{64}|^sha256:[a-f0-9]{64})$/i.test(containerPolicy.image)) {
    throw new Error("Hardened CLI worker requires CLI_WORKER_IMAGE pinned with an @sha256 digest or content-addressed sha256 image id.");
  }
  if (executable.includes("\\") || /^[A-Za-z]:[\\/]/.test(executable)) {
    throw new Error(`Container CLI executable "${executable}" must be an in-container command name or POSIX path.`);
  }
  if (!cliPolicy.allowedExecutables.includes(executable)) {
    throw new Error(`Container CLI executable "${executable}" is not allowed by the server runtime.`);
  }
}

type ContainerSession = {
  name: string;
  files: ReadonlyArray<WorkerCredentialFile>;
  persistRefreshedFiles?: WorkerLaunchSecrets["persistRefreshedFiles"];
  holderOnly: boolean;
};

/**
 * Docker-backed isolation profile for untrusted CLI work. The container image
 * and all isolation settings are server-owned; workflow/agent records cannot
 * weaken them. Images must be pinned by digest to prevent tag drift.
 *
 * Credential files use a create → inject → exec → recover → rm lifecycle so
 * material lives only in the per-run home tmpfs and is destroyed with the
 * container. Environment credentials still use docker run --rm.
 */
export class ContainerWorkerRuntime implements WorkerRuntime {
  private readonly delegate: LocalProcessWorkerRuntime;
  private readonly dockerExecutable: string;
  private readonly sessions = new Map<string, ContainerSession>();

  constructor(
    private readonly cliPolicy: CliRuntimePolicy,
    private readonly containerPolicy: ContainerWorkerPolicy = containerWorkerPolicyFromEnvironment(),
    private readonly spawnFn: typeof spawn = spawn,
  ) {
    this.dockerExecutable = resolveHostExecutable(containerPolicy.dockerExecutable);
    const dockerClientEnvironmentKeys = workerAllowedEnvironmentKeys().filter((key) => !isProtectedWorkerEnvKey(key));
    this.delegate = new LocalProcessWorkerRuntime(
      { ...cliPolicy, allowedExecutables: [this.dockerExecutable] },
      spawnFn,
      dockerClientEnvironmentKeys,
    );
  }

  async start(spec: WorkerSpec, signal?: AbortSignal, input?: string, launchSecrets?: WorkerLaunchSecrets): Promise<WorkerHandle> {
    assertContainerWorkerConfiguration(spec.executable, this.cliPolicy, this.containerPolicy);
    const files = [...(launchSecrets?.files ?? [])];
    for (const file of files) {
      assertAllowedCredentialContainerPath(file.containerPath);
      if (!file.content.length) throw new Error("Trusted credential files must not be empty.");
      if (!Number.isInteger(file.mode) || (file.mode !== 0o600 && file.mode !== 0o400)) {
        throw new Error("Trusted credential files require a restrictive file mode.");
      }
    }

    const containerName = `agent-worker-${randomUUID()}`;
    const allowedEnvKeys = workerAllowedEnvironmentKeys();
    const launchEnvironment = validatedLaunchEnvironment(launchSecrets);
    for (const key of Object.keys(launchEnvironment)) {
      if (CONTAINER_RESERVED_ENV_KEYS.has(key)) throw new Error("Trusted launch secrets cannot override fixed container environment paths or hardening settings.");
    }

    if (files.length === 0) {
      const dockerSpec: WorkerSpec = {
        ...spec,
        env: undefined,
        executable: this.dockerExecutable,
        args: buildContainerArgs(spec, this.containerPolicy, containerName, allowedEnvKeys, Object.keys(launchEnvironment)),
      };
      const handle = await this.delegate.start(dockerSpec, signal, input, launchSecrets);
      this.sessions.set(handle.workerId, { name: containerName, files: [], holderOnly: false });
      return handle;
    }

    await this.dockerCommand([
      ...buildContainerCreateArgs(spec, this.containerPolicy, containerName, allowedEnvKeys, Object.keys(launchEnvironment)),
    ]);

    try {
      await this.dockerCommand(["start", containerName]);
      await this.injectCredentialFiles(containerName, files);

      const dockerSpec: WorkerSpec = {
        ...spec,
        env: undefined,
        executable: this.dockerExecutable,
        args: buildContainerExecArgs(spec, this.containerPolicy, containerName, Object.keys(launchEnvironment)),
      };
      const handle = await this.delegate.start(dockerSpec, signal, input, launchSecrets);
      this.sessions.set(handle.workerId, {
        name: containerName,
        files,
        persistRefreshedFiles: launchSecrets?.persistRefreshedFiles,
        holderOnly: true,
      });
      return handle;
    } catch (error) {
      await this.forceRemoveContainer(containerName);
      throw error;
    }
  }

  stream(workerId: string): AsyncIterable<WorkerEvent> { return this.delegate.stream(workerId); }
  wait(workerId: string): Promise<WorkerResult> { return this.delegate.wait(workerId); }

  async cancel(workerId: string, reason?: string): Promise<void> {
    await this.delegate.cancel(workerId, reason);
    await this.finalizeSession(workerId);
  }

  async cleanup(workerId: string): Promise<void> {
    try { await this.delegate.cleanup(workerId); }
    finally { await this.finalizeSession(workerId); }
  }

  private async finalizeSession(workerId: string): Promise<void> {
    const session = this.sessions.get(workerId);
    if (!session) return;
    this.sessions.delete(workerId);
    try {
      if (session.holderOnly && session.files.length) {
        await this.recoverAndPersistCredentialFiles(session);
      }
    } finally {
      await this.forceRemoveContainer(session.name);
    }
  }

  private async injectCredentialFiles(containerName: string, files: ReadonlyArray<WorkerCredentialFile>): Promise<void> {
    for (const file of files) {
      const mode = (file.mode & 0o777).toString(8).padStart(3, "0");
      const marker = `/tmp/.credential-mode-${file.containerPath.replace(/[^\w.-]+/g, "_")}`;
      await this.dockerCommandWithStdin(
        [
          "exec", "-i", "-u", this.containerPolicy.user,
          containerName, "/bin/bash", "-c",
          `umask 077; cat > '${file.containerPath}' && chmod ${mode} '${file.containerPath}' && actual="$(stat -c %a '${file.containerPath}')" && test "$actual" = "${mode}" && printf '%s' "$actual" > '${marker}'`,
        ],
        file.content,
      );
    }
  }

  private async recoverAndPersistCredentialFiles(session: ContainerSession): Promise<void> {
    const refreshed: WorkerCredentialFile[] = [];
    for (const original of session.files) {
      try {
        const content = await this.dockerCommandCapture([
          "exec", "-u", this.containerPolicy.user, session.name, "/bin/cat", original.containerPath,
        ]);
        const contentSha256 = sha256Hex(content);
        if (contentSha256 === original.contentSha256) continue;
        refreshed.push({
          containerPath: original.containerPath,
          content,
          mode: original.mode,
          contentSha256,
        });
      } catch {
        // Missing or unreadable credential after failure/cancel: skip writeback.
      }
    }
    if (refreshed.length && session.persistRefreshedFiles) {
      await session.persistRefreshedFiles(refreshed);
    }
  }

  private async forceRemoveContainer(name: string): Promise<void> {
    await new Promise<void>((resolve) => {
      const child = this.spawnFn(this.dockerExecutable, ["rm", "-f", name], { shell: false, stdio: "ignore" });
      child.once("error", () => resolve());
      child.once("close", () => resolve());
    });
  }

  private dockerCommand(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.dockerExecutable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Docker command failed with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      });
    });
  }

  private dockerCommandCapture(args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.dockerExecutable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      let stderr = "";
      child.stdout?.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`Docker capture failed with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      });
    });
  }

  private dockerCommandWithStdin(args: string[], input: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawnFn(this.dockerExecutable, args, { shell: false, stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Docker inject failed with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      });
      child.stdin?.write(input);
      child.stdin?.end();
    });
  }
}

export function buildContainerArgs(
  spec: WorkerSpec,
  policy: ContainerWorkerPolicy,
  name: string,
  allowedEnvKeys: string[],
  launchSecretNames: string[] = [],
): string[] {
  return [
    "run", "--rm",
    ...buildContainerIsolationArgs(spec, policy, name, allowedEnvKeys, launchSecretNames),
    policy.image,
    "/bin/bash", "-c", CONTAINER_HOME_INIT_SCRIPT, "worker-init", spec.executable,
    ...spec.args,
  ];
}

export function buildContainerCreateArgs(
  spec: WorkerSpec,
  policy: ContainerWorkerPolicy,
  name: string,
  allowedEnvKeys: string[],
  launchSecretNames: string[] = [],
): string[] {
  return [
    "create",
    ...buildContainerIsolationArgs(spec, policy, name, allowedEnvKeys, launchSecretNames),
    policy.image,
    "/bin/bash", "-c", CONTAINER_CREDENTIAL_HOLDER_SCRIPT,
  ];
}

export function buildContainerExecArgs(
  spec: WorkerSpec,
  policy: ContainerWorkerPolicy,
  name: string,
  launchSecretNames: string[] = [],
): string[] {
  return [
    "exec",
    "--interactive",
    "-u", policy.user,
    "-w", "/workspace",
    ...Object.entries(CONTAINER_ENVIRONMENT).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    ...launchSecretNames
      .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !CONTAINER_RESERVED_ENV_KEYS.has(key) && isSupportedLaunchSecretName(key))
      .flatMap((key) => ["--env", key]),
    name,
    spec.executable,
    ...spec.args,
  ];
}

function buildContainerIsolationArgs(
  spec: WorkerSpec,
  policy: ContainerWorkerPolicy,
  name: string,
  allowedEnvKeys: string[],
  launchSecretNames: string[],
): string[] {
  const network = spec.network === true && policy.allowNetwork ? "bridge" : "none";
  const mountMode = spec.workspaceAccess === "read-write" ? "rw" : "ro";
  return [
    "--name", name, "--interactive",
    "--network", network,
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", String(policy.pidsLimit),
    "--memory", policy.memory,
    "--cpus", policy.cpus,
    "--user", policy.user,
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    "--tmpfs", `${CONTAINER_CLI_PATHS.home}:rw,noexec,nosuid,nodev,size=128m,mode=1777`,
    "--workdir", "/workspace",
    "--mount", `type=bind,source=${spec.cwd},target=/workspace,readonly=${mountMode === "ro"}`,
    ...Object.entries(CONTAINER_ENVIRONMENT).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    ...allowedEnvKeys
      .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !CONTAINER_RESERVED_ENV_KEYS.has(key) && !isProtectedWorkerEnvKey(key))
      .flatMap((key) => ["--env", key]),
    ...launchSecretNames
      .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !CONTAINER_RESERVED_ENV_KEYS.has(key) && isSupportedLaunchSecretName(key))
      .flatMap((key) => ["--env", key]),
  ];
}

function boundedPositive(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
