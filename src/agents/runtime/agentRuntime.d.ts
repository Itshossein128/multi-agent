import { AgentExecutorFactory } from "./agentExecutorFactory";
import type { AgentExecutionEvent, AgentExecutionInput } from "./types";
/**
 * Thin runtime boundary: resolve an executor from the agent backend, then stream events.
 * Kept inside the existing server process — not a distributed service.
 */
export declare class AgentRuntime {
    private readonly executorFactory;
    constructor(executorFactory?: AgentExecutorFactory);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
