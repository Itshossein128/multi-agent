import { spawn } from "node:child_process";

export interface SpawnToolProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
}

export interface SpawnToolProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  error?: Error;
}

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function isCancellationAbort(signal: AbortSignal): boolean {
  if (!signal.aborted) return false;
  const reason = signal.reason as { name?: unknown } | undefined;
  return reason?.name !== "TimeoutError";
}

/**
 * Non-blocking child-process execution for Studio tools.
 * Keeps the server's Node.js event loop free so Postgres lease heartbeats,
 * HTTP/SSE traffic, and concurrent MCP tool calls never stall.
 */
export function spawnToolProcess(
  executable: string,
  args: string[],
  options: SpawnToolProcessOptions,
): Promise<SpawnToolProcessResult> {
  const maxBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise((resolve) => {
    if (options.signal && isCancellationAbort(options.signal)) {
      resolve({
        status: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: true,
        error: new Error("Tool execution cancelled."),
      });
      return;
    }

    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let killEscalationTimer: NodeJS.Timeout | undefined;

    const terminate = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // already exited
      }
      killEscalationTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, 2_000);
      killEscalationTimer.unref?.();
    };

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (killEscalationTimer) clearTimeout(killEscalationTimer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finish = (result: SpawnToolProcessResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAbort = () => {
      if (options.signal && isCancellationAbort(options.signal)) {
        cancelled = true;
        terminate();
      }
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    timeoutTimer.unref?.();

    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutBytes >= maxBytes) return;
      const remaining = maxBytes - stdoutBytes;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stdoutChunks.push(slice);
      stdoutBytes += slice.length;
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrBytes >= maxBytes) return;
      const remaining = maxBytes - stderrBytes;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      stderrChunks.push(slice);
      stderrBytes += slice.length;
    });

    child.once("error", (err) => {
      finish({
        status: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
        cancelled,
        error: err,
      });
    });

    child.once("close", (code) => {
      finish({
        status: code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        timedOut,
        cancelled,
        ...(timedOut ? { error: new Error(`Process timed out after ${options.timeoutMs}ms`) } : {}),
        ...(cancelled ? { error: new Error("Tool execution cancelled.") } : {}),
      });
    });
  });
}
