import { ExecutionTelemetry } from "../../../../src/observability/telemetry";
export interface ObservabilityRuntime {
    telemetry: ExecutionTelemetry;
    shutdown(): Promise<void>;
}
export declare function createObservabilityRuntime(): ObservabilityRuntime;
