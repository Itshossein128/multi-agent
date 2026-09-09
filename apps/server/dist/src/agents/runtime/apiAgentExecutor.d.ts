import { type AgentModelSettings } from "@multi-agent/types";
import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
import { ExecutionTelemetry } from "../../observability/telemetry";
type ChatModel = {
    invoke: (messages: unknown[], options?: {
        signal?: AbortSignal;
    }) => Promise<{
        content: unknown;
    }>;
};
type LLMFactoryLike = {
    getModel: (provider: string, options?: {
        model?: string;
        settings?: AgentModelSettings;
    }) => ChatModel;
};
/**
 * Wraps the existing API/LLM provider stack behind AgentExecutor.
 * Credentials remain an env/runtime concern — never taken from the agent record.
 */
export declare class ApiAgentExecutor implements AgentExecutor {
    private readonly getFactory;
    private readonly telemetry;
    constructor(getFactory?: () => LLMFactoryLike, telemetry?: ExecutionTelemetry);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
export {};
