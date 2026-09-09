import { isDefaultExportSpan, LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import { ExecutionTelemetry, type TelemetryCaptureMode } from "../../../../src/observability/telemetry";

export interface ObservabilityRuntime { telemetry: ExecutionTelemetry; shutdown(): Promise<void>; }

export function createObservabilityRuntime(): ObservabilityRuntime {
  const enabled = process.env.OBSERVABILITY_ENABLED === "true";
  const captureMode = parseCaptureMode(process.env.OBSERVABILITY_CAPTURE_MODE);
  const maxPayloadChars = boundedNumber(process.env.OBSERVABILITY_MAX_PAYLOAD_CHARS, 8_000, 256, 100_000);
  const telemetry = new ExecutionTelemetry({ enabled, captureMode, maxPayloadChars });
  if (!enabled) return { telemetry, shutdown: async () => {} };
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    console.warn("Observability enabled but Langfuse credentials are missing; continuing without deep tracing.");
    return { telemetry: ExecutionTelemetry.disabled(), shutdown: async () => {} };
  }
  try {
    const sampleRate = boundedNumber(process.env.OBSERVABILITY_SAMPLE_RATE, 1, 0, 1);
    const processor = new LangfuseSpanProcessor({ publicKey, secretKey, baseUrl: process.env.LANGFUSE_BASE_URL, environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.NODE_ENV ?? "development", release: process.env.LANGFUSE_RELEASE, shouldExportSpan: ({ otelSpan }) => isDefaultExportSpan(otelSpan) });
    const sdk = new NodeSDK({ sampler: new TraceIdRatioBasedSampler(sampleRate), spanProcessors: [processor] });
    sdk.start();
    console.log("Deep observability enabled.");
    return { telemetry, shutdown: async () => { try { await sdk.shutdown(); } catch (error) { console.warn("Observability shutdown failed.", error); } } };
  } catch (error) {
    console.warn("Observability initialization failed; continuing without deep tracing.", error);
    return { telemetry: ExecutionTelemetry.disabled(), shutdown: async () => {} };
  }
}

function parseCaptureMode(value: string | undefined): TelemetryCaptureMode { return value === "full" || value === "metadata-only" ? value : "redacted"; }
function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) { const number = Number(value ?? fallback); return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback; }
