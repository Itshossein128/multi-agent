import type { ToolRecord } from "@multi-agent/types";
export interface ToolExecutionInput {
    tool: ToolRecord;
    input: Record<string, unknown>;
}
/** Backend-agnostic tool execution contract. Category-specific engines implement this. */
export interface ToolExecutor {
    execute(input: ToolExecutionInput): Promise<Record<string, unknown>>;
}
