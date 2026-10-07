import path from "node:path";
import type { AgentRecord } from "@multi-agent/types";
import { defaultCliExecutable } from "./cliProviderDefaults";

/** Thrown before an executor is selected when persisted policy disallows a run. */
export class ExecutionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionPolicyError";
  }
}

function firstAbsoluteEnvPath(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    // CLI_AGENT_WORKSPACE_ROOTS may be a comma-separated allowlist.
    const first = raw.split(",")[0]?.trim();
    if (!first) continue;
    const resolved = path.resolve(first);
    if (path.isAbsolute(resolved)) return resolved;
  }
  return undefined;
}

/**
 * Ensure CLI/process agents have an absolute workspaceRoot before policy checks.
 * Prefers an existing absolute policy/backend root; otherwise uses
 * STUDIO_WORKSPACE_STORAGE_ROOT or the first CLI_AGENT_WORKSPACE_ROOTS entry.
 */
export function withResolvedWorkspaceRoot(
  agent: AgentRecord,
  env: NodeJS.ProcessEnv = process.env,
): AgentRecord {
  const backend = agent.backend;
  if (backend.type !== "cli" && backend.type !== "process") return agent;

  const existing =
    (typeof agent.executionPolicy?.workspaceRoot === "string" && agent.executionPolicy.workspaceRoot.trim())
    || (backend.type === "process" && typeof backend.workspaceRoot === "string" ? backend.workspaceRoot.trim() : "");
  if (existing && path.isAbsolute(existing)) {
    if (agent.executionPolicy?.workspaceRoot === existing) return agent;
    return {
      ...agent,
      executionPolicy: { ...(agent.executionPolicy ?? {}), workspaceRoot: existing },
    };
  }

  const fallback = firstAbsoluteEnvPath(env, [
    "STUDIO_WORKSPACE_STORAGE_ROOT",
    "CLI_AGENT_WORKSPACE_ROOTS",
    "PROCESS_AGENT_WORKSPACE_ROOTS",
    "WORKSPACE_DIR",
  ]);
  if (!fallback) return agent;

  return {
    ...agent,
    executionPolicy: {
      ...(agent.executionPolicy ?? {}),
      workspaceRoot: fallback,
      filesystem: agent.executionPolicy?.filesystem ?? "read-write",
    },
    backend: backend.type === "process" ? { ...backend, workspaceRoot: fallback } : backend,
  };
}

/**
 * Apply the policy at the server-side runtime boundary. CLI execution is always
 * opt-in: it needs a workspace plus an explicit shell permission. This avoids
 * treating an omitted policy as unrestricted local process access.
 */
export function assertExecutionPolicy(agent: AgentRecord): void {
  const { backend, executionPolicy: policy } = agent;

  if ((backend.type === "api" || backend.type === "local" || backend.type === "webhook") && policy?.network === false) {
    throw new ExecutionPolicyError(`Agent "${agent.name}" forbids network access, but its ${backend.type} backend requires it.`);
  }

  if (backend.type === "process") {
    if (policy?.filesystem === "none") {
      throw new ExecutionPolicyError(`Agent "${agent.name}" forbids filesystem access, so its process backend cannot run.`);
    }
    const workspaceRoot = backend.workspaceRoot || policy?.workspaceRoot;
    if (workspaceRoot && !path.isAbsolute(workspaceRoot)) {
      throw new ExecutionPolicyError(`Agent "${agent.name}" must provide an absolute workspaceRoot for process execution.`);
    }
    return;
  }

  if (backend.type !== "cli") return;
  if (!policy || policy.shell === undefined || policy.shell === "disabled") {
    throw new ExecutionPolicyError(`Agent "${agent.name}" must explicitly allow CLI execution with shell policy "restricted" or "full".`);
  }
  if (policy.filesystem === "none") {
    throw new ExecutionPolicyError(`Agent "${agent.name}" forbids filesystem access, so its CLI backend cannot run.`);
  }
  if (!policy.workspaceRoot || !path.isAbsolute(policy.workspaceRoot)) {
    throw new ExecutionPolicyError(`Agent "${agent.name}" must provide an absolute workspaceRoot for CLI execution.`);
  }
  if (policy.shell === "restricted") {
    const executable = backend.executable || defaultCliExecutable(backend.provider);
    const command = path.basename(executable);
    if (!policy.allowedCommands?.some((allowed) => allowed === executable || allowed === command)) {
      throw new ExecutionPolicyError(`CLI command "${command}" is not permitted by this agent's restricted allowedCommands policy.`);
    }
  }
}
