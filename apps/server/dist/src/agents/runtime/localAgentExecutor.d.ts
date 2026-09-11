import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
export type LocalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export interface LocalRuntimePolicy {
    allowedOrigins: string[];
}
export declare function localRuntimePolicyFromEnvironment(env?: NodeJS.ProcessEnv): LocalRuntimePolicy;
/** Ollama and LM Studio adapters use their documented local HTTP APIs; no API key is persisted. */
export declare class LocalAgentExecutor implements AgentExecutor {
    private readonly fetchImpl;
    private readonly runtimePolicy;
    constructor(fetchImpl?: LocalFetch, runtimePolicy?: LocalRuntimePolicy);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
    private invoke;
}
