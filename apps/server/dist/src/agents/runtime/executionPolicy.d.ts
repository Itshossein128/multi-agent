import type { AgentRecord } from "@multi-agent/types";
/** Thrown before an executor is selected when persisted policy disallows a run. */
export declare class ExecutionPolicyError extends Error {
    constructor(message: string);
}
/**
 * Apply the policy at the server-side runtime boundary. CLI execution is always
 * opt-in: it needs a workspace plus an explicit shell permission. This avoids
 * treating an omitted policy as unrestricted local process access.
 */
export declare function assertExecutionPolicy(agent: AgentRecord): void;
