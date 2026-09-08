import type { AgentExecutionEvent, AgentExecutionInput, AgentExecutor } from "./types";
type ChatModel = {
    invoke: (messages: unknown[]) => Promise<{
        content: unknown;
    }>;
};
type LLMFactoryLike = {
    getModel: (provider: string, options?: {
        model?: string;
    }) => ChatModel;
};
/**
 * Wraps the existing API/LLM provider stack behind AgentExecutor.
 * Credentials remain an env/runtime concern — never taken from the agent record.
 */
export declare class ApiAgentExecutor implements AgentExecutor {
    private readonly getFactory;
    constructor(getFactory?: () => LLMFactoryLike);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
export {};
