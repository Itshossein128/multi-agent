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
  allowedRoots?: string[];
  forbiddenPaths?: string[];
  forbiddenHostPaths?: string[];
  allowedExecutables?: string[];
  processTimeoutMs?: number;
}

const DEFAULT_SANDBOX_ALLOWED_EXECUTABLES: readonly string[] = [
  "git",
  "pnpm",
  "npm",
  "npx",
  "pytest",
  "node",
  "python3",
  "python",
  "codex",
  "claude",
  "agy",
  "cursor",
  "playwright",
  "google-chrome",
  "chromium",
  "bash",
  "uv",
];

/**
 * Sandboxed Execution Barrier
 *
 * Confines all agent file inspections, test executions, and code modifications
 * strictly to the designated sandbox workspace (e.g. workspaces/building-management-sandbox)
 * or explicitly authorized workspace roots.
 * Blocks write/delete access to host repositories (e.g. /home/hossein/Desktop/projects/building-management)
 * unless explicitly cleared via SANDBOX_FORBIDDEN_HOST_PATHS=none, and rejects path traversal escapes (../../) fail-closed.
 */
export class SandboxExecutionBarrier {
  readonly canonicalSandboxRoot: string;
  readonly allowedRoots: readonly string[];
  readonly forbiddenPaths: readonly string[];
  readonly allowedExecutables: readonly string[];
  readonly processTimeoutMs: number;

  constructor(
    sandboxRootOrPolicy?: string | SandboxExecutionPolicy | SandboxExecutionBarrierOptions,
    forbiddenPaths?: string[],
  ) {
    let rawRoot: string;
    let rawAllowedRoots: string[] = [];
    let rawForbidden: string[] = [];
    let explicitForbiddenProvided = false;
    let executables: string[] = [...DEFAULT_SANDBOX_ALLOWED_EXECUTABLES];
    let timeoutMs = 300_000;

    if (typeof sandboxRootOrPolicy === "string") {
      rawRoot = sandboxRootOrPolicy;
      if (Array.isArray(forbiddenPaths)) {
        rawForbidden = [...forbiddenPaths];
        explicitForbiddenProvided = true;
      }
    } else if (sandboxRootOrPolicy && typeof sandboxRootOrPolicy === "object") {
      const opts = sandboxRootOrPolicy as SandboxExecutionBarrierOptions;
      rawRoot =
        opts.canonicalSandboxRoot ??
        opts.sandboxRoot ??
        process.env.SANDBOX_CANONICAL_ROOT?.trim() ??
        path.resolve(process.cwd(), "workspaces/building-management-sandbox");
      if (Array.isArray(opts.allowedRoots)) {
        rawAllowedRoots = [...opts.allowedRoots];
      }
      if (Array.isArray(opts.forbiddenHostPaths)) {
        rawForbidden = [...opts.forbiddenHostPaths];
        explicitForbiddenProvided = true;
      } else if (Array.isArray(opts.forbiddenPaths)) {
        rawForbidden = [...opts.forbiddenPaths];
        explicitForbiddenProvided = true;
      }
      if (opts.allowedExecutables) {
        executables = [...opts.allowedExecutables];
      }
      if (typeof opts.processTimeoutMs === "number") {
        timeoutMs = opts.processTimeoutMs;
      }
    } else {
      rawRoot =
        process.env.SANDBOX_CANONICAL_ROOT?.trim() ||
        path.resolve(process.cwd(), "workspaces/building-management-sandbox");
    }

    if (!rawAllowedRoots.length && process.env.SANDBOX_ALLOWED_ROOTS) {
      rawAllowedRoots = process.env.SANDBOX_ALLOWED_ROOTS
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const extraEnvExecutables = [
      ...(process.env.SANDBOX_ALLOWED_EXECUTABLES ?? "").split(","),
      ...(process.env.CLI_AGENT_ALLOWED_EXECUTABLES ?? "").split(","),
    ]
      .map((s) => s.trim())
      .filter(Boolean);
    for (const exe of extraEnvExecutables) {
      if (!executables.includes(exe)) {
        executables.push(exe);
      }
    }

    let explicitlyClearedForbidden = false;
    if (!explicitForbiddenProvided && process.env.SANDBOX_FORBIDDEN_HOST_PATHS) {
      const envForbiddenRaw = process.env.SANDBOX_FORBIDDEN_HOST_PATHS.trim();
      if (envForbiddenRaw.toLowerCase() === "none") {
        rawForbidden = [];
        explicitlyClearedForbidden = true;
      } else {
        rawForbidden = envForbiddenRaw.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    if (!explicitForbiddenProvided && !explicitlyClearedForbidden && !rawForbidden.length) {
      rawForbidden = ["/home/hossein/Desktop/projects/building-management"];
    }

    this.canonicalSandboxRoot = SandboxExecutionBarrier.canonicalizePath(rawRoot);
    const canonicalExtras = rawAllowedRoots
      .map((r) => SandboxExecutionBarrier.canonicalizePath(r))
      .filter((r) => r !== this.canonicalSandboxRoot);
    this.allowedRoots = Object.freeze([this.canonicalSandboxRoot, ...canonicalExtras]);
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

    // 2. Write operations must resolve strictly inside sandbox root or configured allowedRoots
    if (mode === "write") {
      const isWithinSandbox = this.allowedRoots.some(
        (root) => canonicalTarget === root || canonicalTarget.startsWith(root + path.sep),
      );

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
