export type TelemetryCaptureMode = "full" | "redacted" | "metadata-only";
export interface TelemetryConfig {
    enabled: boolean;
    captureMode: TelemetryCaptureMode;
    maxPayloadChars: number;
}
export interface WorkflowTelemetryContext {
    runId: string;
    workflowId: string;
    taskId?: string;
    input?: unknown;
}
export interface AgentTelemetryContext {
    runId: string;
    workflowId?: string;
    nodeId: string;
    agentId: string;
    agentName?: string;
    backendType?: string;
    provider?: string;
    model?: string;
    input?: unknown;
}
/** Server-side only privacy boundary for all deep-telemetry payloads. */
export declare class TelemetrySanitizer {
    private readonly mode;
    private readonly maxChars;
    constructor(mode?: TelemetryCaptureMode, maxChars?: number);
    sanitize(value: unknown): unknown;
    private walk;
    private limit;
}
/** Small runtime-facing boundary; it intentionally knows nothing about RunEvent/SSE. */
export declare class ExecutionTelemetry {
    private readonly config;
    readonly sanitizer: TelemetrySanitizer;
    constructor(config: TelemetryConfig);
    static disabled(): ExecutionTelemetry;
    get enabled(): boolean;
    traceIdForRun(runId: string): Promise<string>;
    withWorkflow<T>(context: WorkflowTelemetryContext, fn: () => Promise<T>): Promise<T>;
    withAgent<T>(context: AgentTelemetryContext, fn: () => Promise<T>): Promise<T>;
    withGeneration<T>(context: AgentTelemetryContext, fn: () => Promise<T>): Promise<T>;
    withMemory<T>(name: "memory.retrieve" | "memory.write", context: Record<string, unknown>, fn: () => Promise<T>): Promise<T>;
    private withObservation;
}
