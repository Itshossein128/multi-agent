import type { AgentBackend } from "@multi-agent/types";
import type { AgentExecutor } from "./types";
export declare class AgentExecutorFactory {
    create(backend: AgentBackend): AgentExecutor;
}
export declare const agentExecutorFactory: AgentExecutorFactory;
