import { AgentExecutorFactory } from "./agentExecutorFactory";
import type { AgentExecutionEvent, AgentExecutionInput } from "./types";
import type { RuntimeMemoryDependencies } from "../../memory/contracts";
import { ExecutionTelemetry } from "../../observability/telemetry";
/** Shared executor boundary, with injected long-term services and caller-owned short-term state. */
export declare class AgentRuntime {
    private readonly memoryDependencies?;
    readonly telemetry: ExecutionTelemetry;
    private readonly executorFactory;
    private readonly maxExecutionMs;
    constructor(executorFactory?: Pick<AgentExecutorFactory, "create"> | undefined, memoryDependencies?: RuntimeMemoryDependencies | undefined, telemetry?: ExecutionTelemetry, maxExecutionMs?: number);
    execute(input: AgentExecutionInput): AsyncIterable<AgentExecutionEvent>;
}
