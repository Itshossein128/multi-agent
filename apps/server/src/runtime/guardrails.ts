import type { WorkflowValidationLimits } from "../compiler/validation";

export interface RuntimeGuardrails extends WorkflowValidationLimits {
  maxRunDurationMs: number;
  recursionLimit: number;
  maxWorkflowSteps: number;
  maxConcurrentBranches: number;
  maxNodeRetryAttempts: number;
  maxNodeRetryBackoffMs: number;
}

/** Server-owned bounds. Browser-supplied workflows never control these limits. */
export function runtimeGuardrailsFromEnvironment(env = process.env): RuntimeGuardrails {
  return {
    maxNodes: bounded(env.WORKFLOW_MAX_NODES, 100, 1, 1_000),
    maxEdges: bounded(env.WORKFLOW_MAX_EDGES, 250, 1, 5_000),
    maxBranches: bounded(env.WORKFLOW_MAX_BRANCHES, 25, 1, 100),
    maxRunDurationMs: bounded(env.RUN_MAX_DURATION_MS, 15 * 60_000, 1_000, 24 * 60 * 60_000),
    recursionLimit: bounded(env.WORKFLOW_RECURSION_LIMIT, 100, 10, 10_000),
    maxWorkflowSteps: bounded(env.WORKFLOW_MAX_STEPS, 1_000, 1, 100_000),
    maxConcurrentBranches: bounded(env.WORKFLOW_MAX_CONCURRENT_BRANCHES, 8, 1, 100),
    maxNodeRetryAttempts: bounded(env.NODE_RETRY_MAX_ATTEMPTS, 3, 1, 10),
    maxNodeRetryBackoffMs: bounded(env.NODE_RETRY_MAX_BACKOFF_MS, 30_000, 0, 300_000),
    supportedToolCategories: ["function", "http"],
    allowToolSideEffects: env.TOOL_ALLOW_SIDE_EFFECTS === "true",
  };
}

function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
