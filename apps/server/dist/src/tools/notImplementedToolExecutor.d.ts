import type { ToolRecord } from "@multi-agent/types";
import type { ToolExecutionInput, ToolExecutor } from "./types";
export declare class UnsupportedToolCategoryError extends Error {
    readonly category: ToolRecord["category"];
    constructor(category: ToolRecord["category"]);
}
/**
 * Placeholder for future HTTP / database / search / file / MCP / CLI / custom executors.
 * Fails explicitly — never falls back to a no-op success.
 */
export declare class NotImplementedToolExecutor implements ToolExecutor {
    private readonly category;
    constructor(category: ToolRecord["category"]);
    execute(_input: ToolExecutionInput): Promise<Record<string, unknown>>;
}
