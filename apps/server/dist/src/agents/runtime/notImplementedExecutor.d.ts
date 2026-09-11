import type { AgentBackend } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
/** Fails explicitly for an unknown backend and never falls back to API execution. */
export declare class NotImplementedAgentExecutor implements AgentExecutor {
    private readonly backend;
    constructor(backend: AgentBackend);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
