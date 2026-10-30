/**
 * Sandboxed Execution Boundary and Host Protection Types
 *
 * Defines the confinement policies, host directory barriers, and violation error types
 * ensuring that agent file operations and subprocess executions remain strictly inside
 * designated workspaces with zero mutation to host repositories.
 */

export interface SandboxExecutionPolicy {
  /** Canonical directory where agent read/write/exec operations are confined */
  canonicalSandboxRoot: string;
  /** Explicitly forbidden host paths (read/write forbidden) */
  forbiddenHostPaths: string[];
  /** Allowed command binaries in the sandbox */
  allowedExecutables: string[];
  /** Maximum execution duration per process (ms) */
  processTimeoutMs: number;
}

export class SandboxHostProtectionViolationError extends Error {
  constructor(public readonly targetPath: string, public readonly attemptedAction: string) {
    super(`Security policy violation: Agent attempted ${attemptedAction} on protected host path "${targetPath}"`);
    this.name = "SandboxHostProtectionViolationError";
    Object.setPrototypeOf(this, SandboxHostProtectionViolationError.prototype);
  }
}

export class SandboxBoundaryViolationError extends Error {
  constructor(public readonly targetPath: string, public readonly sandboxRoot: string) {
    super(`Security policy violation: Path "${targetPath}" resolves outside sandbox root "${sandboxRoot}"`);
    this.name = "SandboxBoundaryViolationError";
    Object.setPrototypeOf(this, SandboxBoundaryViolationError.prototype);
  }
}
