import type { AgentBackend } from "@multi-agent/types";
import type { AgentExecutor } from "./types";
import { ExecutionTelemetry } from "../../observability/telemetry";
export declare class AgentExecutorFactory {
    private readonly telemetry;
    constructor(telemetry?: ExecutionTelemetry);
    create(backend: AgentBackend): AgentExecutor;
}
export declare const agentExecutorFactory: AgentExecutorFactory;
