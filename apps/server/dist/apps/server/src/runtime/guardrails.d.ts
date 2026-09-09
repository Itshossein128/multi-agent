import type { WorkflowValidationLimits } from "../compiler/validation";
export interface RuntimeGuardrails extends WorkflowValidationLimits {
    maxRunDurationMs: number;
    recursionLimit: number;
}
/** Server-owned bounds. Browser-supplied workflows never control these limits. */
export declare function runtimeGuardrailsFromEnvironment(env?: NodeJS.ProcessEnv): RuntimeGuardrails;
