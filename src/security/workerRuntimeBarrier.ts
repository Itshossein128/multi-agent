import path from "node:path";
import type { WorkerHandle, WorkerRuntime, WorkerSpec } from "../agents/runtime/workerRuntime";
import type { WorkerLaunchSecrets } from "../agents/runtime/workerCredentials";
import { SandboxExecutionBarrier } from "./sandboxExecutionBarrier";
import { SandboxBoundaryViolationError, SandboxHostProtectionViolationError } from "./types";

/**
 * Validates and confines a WorkerSpec so subprocess execution cannot escape
 * the designated sandbox root or access forbidden host paths.
 */
export function applySandboxWorkerBarrier(
  spec: WorkerSpec,
  barrier: SandboxExecutionBarrier = new SandboxExecutionBarrier(),
): WorkerSpec {
  const cwd = spec.cwd ? path.resolve(spec.cwd) : barrier.canonicalSandboxRoot;

  // 1. Assert cwd is allowed and within sandbox root
  barrier.assertExecutionAllowed(cwd, spec.executable);

  // 2. Scan arguments for forbidden host paths or unsafe path traversal targeting forbidden locations
  if (Array.isArray(spec.args)) {
    for (const arg of spec.args) {
      if (typeof arg === "string" && (path.isAbsolute(arg) || arg.includes("..") || arg.includes("building-management"))) {
        // If argument looks like a path, assert it is allowed
        const candidatePath = path.isAbsolute(arg) ? arg : path.resolve(cwd, arg);
        // Only check forbidden host paths (read/write forbidden)
        for (const forbidden of barrier.forbiddenPaths) {
          const canonicalCandidate = SandboxExecutionBarrier.canonicalizePath(candidatePath);
          if (canonicalCandidate === forbidden || canonicalCandidate.startsWith(forbidden + path.sep)) {
            throw new SandboxHostProtectionViolationError(arg, "execute");
          }
        }
      }
    }
  }

  return {
    ...spec,
    cwd,
  };
}

/**
 * Decorates a WorkerRuntime instance with mandatory sandbox execution barrier enforcement.
 */
export class SandboxedWorkerRuntime implements WorkerRuntime {
  constructor(
    private readonly inner: WorkerRuntime,
    private readonly barrier: SandboxExecutionBarrier = new SandboxExecutionBarrier(),
  ) {}

  start(
    spec: WorkerSpec,
    signal?: AbortSignal,
    input?: string,
    launchSecrets?: WorkerLaunchSecrets,
  ): Promise<WorkerHandle> {
    const confinedSpec = applySandboxWorkerBarrier(spec, this.barrier);
    return this.inner.start(confinedSpec, signal, input, launchSecrets);
  }

  stream(workerId: string) {
    return this.inner.stream(workerId);
  }

  wait(workerId: string) {
    return this.inner.wait(workerId);
  }

  cancel(workerId: string, reason?: string) {
    return this.inner.cancel(workerId, reason);
  }

  cleanup(workerId: string) {
    return this.inner.cleanup(workerId);
  }
}
