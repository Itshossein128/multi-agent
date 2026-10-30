import path from "node:path";
import type { AgentRecord } from "@multi-agent/types";
import {
  assertExecutionPolicy as baseAssertExecutionPolicy,
  ExecutionPolicyError,
  withResolvedWorkspaceRoot,
} from "../agents/runtime/executionPolicy";
import { SandboxExecutionBarrier } from "./sandboxExecutionBarrier";
import {
  SandboxBoundaryViolationError,
  SandboxHostProtectionViolationError,
} from "./types";

export { ExecutionPolicyError, withResolvedWorkspaceRoot };

/**
 * Validates agent execution policy with sandbox confinement and host protection checks.
 *
 * Ensures:
 * 1. Standard base execution policies are satisfied (shell permissions, network, filesystem).
 * 2. Agent workspaceRoot does not target protected host paths (e.g. /home/hossein/Desktop/projects/building-management).
 * 3. When strict sandbox confinement is enabled or when targeting sandbox workspaces,
 *    workspaceRoot is strictly confined within canonicalSandboxRoot.
 */
export function assertSandboxExecutionPolicy(
  agent: AgentRecord,
  barrier: SandboxExecutionBarrier = new SandboxExecutionBarrier(),
): void {
  // First assert standard base execution policy
  baseAssertExecutionPolicy(agent);

  const workspaceRoot = agent.executionPolicy?.workspaceRoot
    || (agent.backend.type === "process" ? agent.backend.workspaceRoot : undefined);

  if (workspaceRoot) {
    const canonical = SandboxExecutionBarrier.canonicalizePath(workspaceRoot);

    // 1. Host protection: forbidden paths are strictly blocked
    for (const forbidden of barrier.forbiddenPaths) {
      if (canonical === forbidden || canonical.startsWith(forbidden + path.sep)) {
        throw new SandboxHostProtectionViolationError(workspaceRoot, "execute");
      }
    }

    // 2. Strict sandbox confinement check if configured
    const strictConfinement = process.env.SANDBOX_STRICT_CONFINEMENT === "true"
      || (typeof (agent.executionPolicy as any)?.sandboxConfinement === "boolean" && (agent.executionPolicy as any).sandboxConfinement);

    if (strictConfinement) {
      barrier.assertWorkspaceConfinement(workspaceRoot);
    }
  }
}

/**
 * Convenience alias for assertSandboxExecutionPolicy
 */
export const assertExecutionPolicy = assertSandboxExecutionPolicy;
