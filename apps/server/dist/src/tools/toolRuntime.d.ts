import type { ToolRecord } from "@multi-agent/types";
import type { ToolExecutorFactory } from "./toolExecutorFactory";
export declare class ToolPolicyError extends Error {
}
/** Server-side tool boundary: impact policy and timeout apply before category dispatch. */
export declare class ToolRuntime {
    private readonly timeoutMs;
    private readonly allowSideEffects;
    private readonly executors;
    constructor(timeoutMs?: number, allowSideEffects?: boolean, executors?: Pick<ToolExecutorFactory, "create">);
    execute(tool: ToolRecord, input: Record<string, unknown>, parentSignal?: AbortSignal): Promise<Record<string, unknown>>;
}
