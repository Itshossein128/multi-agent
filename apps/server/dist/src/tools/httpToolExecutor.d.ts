import type { ToolExecutionInput, ToolExecutor } from "./types";
export type ToolFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** Executes a configured HTTP endpoint; callers cannot replace its destination through input. */
export declare class HttpToolExecutor implements ToolExecutor {
    private readonly fetchImpl;
    constructor(fetchImpl?: ToolFetch);
    execute({ tool, input, signal }: ToolExecutionInput): Promise<Record<string, unknown>>;
}
