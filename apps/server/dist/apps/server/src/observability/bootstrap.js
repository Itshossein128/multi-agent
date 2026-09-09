"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createObservabilityRuntime = createObservabilityRuntime;
const otel_1 = require("@langfuse/otel");
const sdk_node_1 = require("@opentelemetry/sdk-node");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const telemetry_1 = require("../../../../src/observability/telemetry");
function createObservabilityRuntime() {
    const enabled = process.env.OBSERVABILITY_ENABLED === "true";
    const captureMode = parseCaptureMode(process.env.OBSERVABILITY_CAPTURE_MODE);
    const maxPayloadChars = boundedNumber(process.env.OBSERVABILITY_MAX_PAYLOAD_CHARS, 8_000, 256, 100_000);
    const telemetry = new telemetry_1.ExecutionTelemetry({ enabled, captureMode, maxPayloadChars });
    if (!enabled)
        return { telemetry, shutdown: async () => { } };
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (!publicKey || !secretKey) {
        console.warn("Observability enabled but Langfuse credentials are missing; continuing without deep tracing.");
        return { telemetry: telemetry_1.ExecutionTelemetry.disabled(), shutdown: async () => { } };
    }
    try {
        const sampleRate = boundedNumber(process.env.OBSERVABILITY_SAMPLE_RATE, 1, 0, 1);
        const processor = new otel_1.LangfuseSpanProcessor({ publicKey, secretKey, baseUrl: process.env.LANGFUSE_BASE_URL, environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.NODE_ENV ?? "development", release: process.env.LANGFUSE_RELEASE, shouldExportSpan: ({ otelSpan }) => (0, otel_1.isDefaultExportSpan)(otelSpan) });
        const sdk = new sdk_node_1.NodeSDK({ sampler: new sdk_trace_base_1.TraceIdRatioBasedSampler(sampleRate), spanProcessors: [processor] });
        sdk.start();
        console.log("Deep observability enabled.");
        return { telemetry, shutdown: async () => { try {
                await sdk.shutdown();
            }
            catch (error) {
                console.warn("Observability shutdown failed.", error);
            } } };
    }
    catch (error) {
        console.warn("Observability initialization failed; continuing without deep tracing.", error);
        return { telemetry: telemetry_1.ExecutionTelemetry.disabled(), shutdown: async () => { } };
    }
}
function parseCaptureMode(value) { return value === "full" || value === "metadata-only" ? value : "redacted"; }
function boundedNumber(value, fallback, min, max) { const number = Number(value ?? fallback); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback; }
//# sourceMappingURL=bootstrap.js.map