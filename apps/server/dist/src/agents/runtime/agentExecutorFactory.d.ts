import type { AgentBackend } from "@multi-agent/types";
import type { AgentExecutor } from "./types";
import { ExecutionTelemetry } from "../../observability/telemetry";
import type { WorkerRuntime } from "./workerRuntime";
export declare class AgentExecutorFactory {
    private readonly telemetry;
    private readonly workerRuntime;
    constructor(telemetry?: ExecutionTelemetry, workerRuntime?: WorkerRuntime);
    create(backend: AgentBackend): AgentExecutor;
}
export declare const agentExecutorFactory: AgentExecutorFactory;
