import path from "node:path";
import type { AgentRecord } from "@multi-agent/types";

/** Thrown before an executor is selected when persisted policy disallows a run. */
export class ExecutionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionPolicyError";
  }
}

/**
 * Apply the policy at the server-side runtime boundary. CLI execution is always
 * opt-in: it needs a workspace plus an explicit shell permission. This avoids
 * treating an omitted policy as unrestricted local process access.
 */
export function assertExecutionPolicy(agent: AgentRecord): void {
  const { backend, executionPolicy: policy } = agent;

  if ((backend.type === "api" || backend.type === "local") && policy?.network === false) {
    throw new ExecutionPolicyError(`Agent "${agent.name}" forbids network access, but its ${backend.type} backend requires it.`);
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
    const executable = backend.executable || (backend.provider === "claude-code" ? "claude" : backend.provider);
    const command = path.basename(executable);
    if (!policy.allowedCommands?.some((allowed) => allowed === executable || allowed === command)) {
      throw new ExecutionPolicyError(`CLI command "${command}" is not permitted by this agent's restricted allowedCommands policy.`);
    }
  }
}
