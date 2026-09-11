import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
export type LocalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** Ollama and LM Studio adapters use their documented local HTTP APIs; no API key is persisted. */
export declare class LocalAgentExecutor implements AgentExecutor {
    private readonly fetchImpl;
    constructor(fetchImpl?: LocalFetch);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
    private invoke;
}
