import { AgentExecutorFactory } from "./agentExecutorFactory";
import type { AgentExecutionEvent, AgentExecutionInput } from "./types";
import type { RuntimeMemoryDependencies } from "../../memory/contracts";
/** Shared executor boundary, with injected long-term services and caller-owned short-term state. */
export declare class AgentRuntime {
    private readonly executorFactory;
    private readonly memoryDependencies?;
    constructor(executorFactory?: AgentExecutorFactory, memoryDependencies?: RuntimeMemoryDependencies | undefined);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
