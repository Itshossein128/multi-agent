import path from "node:path";
import fs from "node:fs";
import {
  SandboxBoundaryViolationError,
  SandboxHostProtectionViolationError,
  type SandboxExecutionPolicy,
} from "./types";

export interface SandboxExecutionBarrierOptions {
  sandboxRoot?: string;
  canonicalSandboxRoot?: string;
  forbiddenPaths?: string[];
  forbiddenHostPaths?: string[];
  allowedExecutables?: string[];
  processTimeoutMs?: number;
}

/**
 * Sandboxed Execution Barrier
 *
 * Confines all agent file inspections, test executions, and code modifications
 * strictly to the designated sandbox workspace (e.g. workspaces/building-management-sandbox).
 * Blocks write/delete access to host repositories (e.g. /home/hossein/Desktop/projects/building-management)
 * and rejects path traversal escapes (../../) fail-closed.
 */
export class SandboxExecutionBarrier {
  readonly canonicalSandboxRoot: string;
  readonly forbiddenPaths: readonly string[];
  readonly allowedExecutables: readonly string[];
  readonly processTimeoutMs: number;

  constructor(
    sandboxRootOrPolicy?: string | SandboxExecutionPolicy | SandboxExecutionBarrierOptions,
    forbiddenPaths?: string[],
  ) {
    let rawRoot: string;
    let rawForbidden: string[] = [];
    let executables: string[] = ["git", "pnpm", "npm", "pytest", "node", "python3"];
    let timeoutMs = 300_000;

    if (typeof sandboxRootOrPolicy === "string") {
      rawRoot = sandboxRootOrPolicy;
      if (Array.isArray(forbiddenPaths)) {
        rawForbidden = [...forbiddenPaths];
      }
    } else if (sandboxRootOrPolicy && typeof sandboxRootOrPolicy === "object") {
      const opts = sandboxRootOrPolicy as SandboxExecutionBarrierOptions;
      rawRoot = opts.canonicalSandboxRoot ?? opts.sandboxRoot ?? path.resolve(process.cwd(), "workspaces/building-management-sandbox");
      rawForbidden = opts.forbiddenHostPaths ?? opts.forbiddenPaths ?? [];
      if (opts.allowedExecutables) {
        executables = [...opts.allowedExecutables];
      }
      if (typeof opts.processTimeoutMs === "number") {
        timeoutMs = opts.processTimeoutMs;
      }
    } else {
      rawRoot = path.resolve(process.cwd(), "workspaces/building-management-sandbox");
    }

    if (!rawForbidden.length && process.env.SANDBOX_FORBIDDEN_HOST_PATHS) {
      rawForbidden = process.env.SANDBOX_FORBIDDEN_HOST_PATHS.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (!rawForbidden.length) {
      rawForbidden = ["/home/hossein/Desktop/projects/building-management"];
    }

    this.canonicalSandboxRoot = SandboxExecutionBarrier.canonicalizePath(rawRoot);
    this.forbiddenPaths = Object.freeze(rawForbidden.map((p) => SandboxExecutionBarrier.canonicalizePath(p)));
    this.allowedExecutables = Object.freeze([...executables]);
    this.processTimeoutMs = timeoutMs;
  }

  /**
   * Resolve and canonicalize path, handling non-existent subpaths and symlinks
   */
  static canonicalizePath(targetPath: string): string {
    const resolved = path.resolve(targetPath);
    try {
      if (fs.existsSync(resolved)) {
        return path.resolve(fs.realpathSync.native(resolved));
      }
    } catch {
      // Fall through to walk up directory hierarchy
    }

    // If target itself does not exist yet (e.g. creating a new file in the sandbox),
    // canonicalize the highest existing ancestor directory to resolve any symlinks or traversals.
    let current = resolved;
    const parts: string[] = [];
    while (current && current !== path.dirname(current)) {
      if (fs.existsSync(current)) {
        try {
          const canonicalBase = path.resolve(fs.realpathSync.native(current));
          return path.resolve(canonicalBase, ...parts);
        } catch {
          break;
        }
      }
      parts.unshift(path.basename(current));
      current = path.dirname(current);
    }

    return resolved;
  }

  /**
   * Assert that a target path is permitted under the sandbox policy.
   * Throws SandboxHostProtectionViolationError if accessing protected host paths.
   * Throws SandboxBoundaryViolationError if write operations escape the sandbox root.
   */
  assertPathAllowed(targetPath: string, mode: "read" | "write" = "write"): void {
    const canonicalTarget = SandboxExecutionBarrier.canonicalizePath(targetPath);

    // 1. Explicit forbidden host path check (read and write forbidden)
    for (const forbidden of this.forbiddenPaths) {
      if (canonicalTarget === forbidden || canonicalTarget.startsWith(forbidden + path.sep)) {
        throw new SandboxHostProtectionViolationError(targetPath, mode);
      }
    }

    // 2. Write operations must resolve strictly inside sandbox root
    if (mode === "write") {
      const isWithinSandbox =
        canonicalTarget === this.canonicalSandboxRoot ||
        canonicalTarget.startsWith(this.canonicalSandboxRoot + path.sep);

      if (!isWithinSandbox) {
        throw new SandboxBoundaryViolationError(targetPath, this.canonicalSandboxRoot);
      }
    }
  }

  /**
   * Check whether a target path is allowed without throwing.
   */
  isPathAllowed(targetPath: string, mode: "read" | "write" = "write"): boolean {
    try {
      this.assertPathAllowed(targetPath, mode);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Assert that command execution is permitted:
   * - cwd must be strictly inside the sandbox root
   * - cwd must not be in forbidden host paths
   * - executable binary (if checked) must be in allowedExecutables
   */
  assertExecutionAllowed(cwd: string, executable?: string): void {
    this.assertPathAllowed(cwd, "write");

    if (executable) {
      const base = path.basename(executable).toLowerCase();
      const isAllowed = this.allowedExecutables.some((allowed) => {
        const allowedBase = path.basename(allowed).toLowerCase();
        return (
          allowed === executable ||
          allowedBase === base ||
          allowedBase === `${base}.exe` ||
          base === `${allowedBase}.exe`
        );
      });

      if (!isAllowed) {
        throw new Error(`Executable "${executable}" is not permitted by sandbox execution policy.`);
      }
    }
  }

  /**
   * Ensure that an agent workspace root conforms strictly to the sandbox.
   */
  assertWorkspaceConfinement(workspaceRoot: string): void {
    const canonical = SandboxExecutionBarrier.canonicalizePath(workspaceRoot);
    this.assertPathAllowed(canonical, "write");
  }

  toPolicy(): SandboxExecutionPolicy {
    return {
      canonicalSandboxRoot: this.canonicalSandboxRoot,
      forbiddenHostPaths: [...this.forbiddenPaths],
      allowedExecutables: [...this.allowedExecutables],
      processTimeoutMs: this.processTimeoutMs,
    };
  }
}
