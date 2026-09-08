import type { AgentBackend } from "@multi-agent/types";
export declare class UnsupportedBackendError extends Error {
    readonly backend: AgentBackend;
    constructor(backend: AgentBackend, detail?: string);
}
export declare class AgentExecutionFailedError extends Error {
    constructor(message: string);
}
