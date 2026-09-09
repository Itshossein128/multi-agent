import { createTraceId, startActiveObservation } from "@langfuse/tracing";

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

const SECRET_KEY = /authorization|api[_-]?key|token|secret|password|cookie|private[_-]?key/i;
const SECRET_VALUE = /(?:sk|pk|api)[_-][a-z0-9_-]{8,}|bearer\s+[a-z0-9._-]+/gi;

/** Server-side only privacy boundary for all deep-telemetry payloads. */
export class TelemetrySanitizer {
  constructor(private readonly mode: TelemetryCaptureMode = "redacted", private readonly maxChars = 8_000) {}

  sanitize(value: unknown): unknown {
    if (this.mode === "metadata-only") return value === undefined ? undefined : { captured: false };
    return this.limit(this.walk(value, new WeakSet<object>()));
  }

  private walk(value: unknown, seen: WeakSet<object>): unknown {
    if (typeof value === "string") return value.replace(SECRET_VALUE, "[REDACTED]");
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(item => this.walk(item, seen));
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : this.walk(item, seen)]));
  }

  private limit(value: unknown): unknown {
    let serialized: string;
    try { serialized = JSON.stringify(value); } catch { return "[Unserializable]"; }
    if (serialized.length <= this.maxChars) return value;
    return { truncated: true, originalChars: serialized.length, preview: serialized.slice(0, this.maxChars) };
  }
}

/** Small runtime-facing boundary; it intentionally knows nothing about RunEvent/SSE. */
export class ExecutionTelemetry {
  readonly sanitizer: TelemetrySanitizer;

  constructor(private readonly config: TelemetryConfig) {
    this.sanitizer = new TelemetrySanitizer(config.captureMode, config.maxPayloadChars);
  }

  static disabled() { return new ExecutionTelemetry({ enabled: false, captureMode: "metadata-only", maxPayloadChars: 1 }); }
  get enabled() { return this.config.enabled; }
  traceIdForRun(runId: string) { return createTraceId(runId); }

  async withWorkflow<T>(context: WorkflowTelemetryContext, fn: () => Promise<T>): Promise<T> {
    return this.withObservation("workflow.run", "chain", context as unknown as Record<string, unknown>, fn, context.runId);
  }

  async withAgent<T>(context: AgentTelemetryContext, fn: () => Promise<T>): Promise<T> {
    return this.withObservation("agent.execution", "agent", context as unknown as Record<string, unknown>, fn);
  }

  async withGeneration<T>(context: AgentTelemetryContext, fn: () => Promise<T>): Promise<T> {
    return this.withObservation("model.generation", "generation", context as unknown as Record<string, unknown>, fn);
  }

  async withMemory<T>(name: "memory.retrieve" | "memory.write", context: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    return this.withObservation(name, name === "memory.retrieve" ? "retriever" : "span", context, fn);
  }

  private async withObservation<T>(name: string, asType: string, context: Record<string, unknown>, fn: () => Promise<T>, stableTraceSeed?: string): Promise<T> {
    if (!this.enabled) return fn();
    const attributes = { input: this.sanitizer.sanitize(context.input), metadata: this.sanitizer.sanitize({ ...context, input: undefined }) };
    let invoked = false;
    let completed = false;
    let completedResult: T;
    try {
      const parentSpanContext = stableTraceSeed ? { traceId: await this.traceIdForRun(stableTraceSeed), spanId: "0000000000000001", traceFlags: 1 } : undefined;
      return await startActiveObservation(name, async (observation: any) => {
        try {
          invoked = true;
          const result = await fn();
          completed = true;
          completedResult = result;
          try { observation.update({ output: this.sanitizer.sanitize(result) }); } catch (error) { console.warn("Observability update failed.", safeError(error)); }
          return result;
        } catch (error) {
          try { observation.update({ level: "ERROR", statusMessage: safeError(error) }); } catch (updateError) { console.warn("Observability error update failed.", safeError(updateError)); }
          throw error;
        }
      }, {
        asType,
        ...(parentSpanContext ? { parentSpanContext } : {}),
        ...attributes,
      } as any) as T;
    } catch (error) {
      // Never repeat a side-effecting operation merely because telemetry failed.
      if (completed) return completedResult!;
      // Setup failures happen before user code is called and are safe to bypass.
      if (!invoked && isTelemetryFailure(error)) { console.warn("Observability operation failed; continuing execution.", safeError(error)); return fn(); }
      throw error;
    }
  }
}

function safeError(error: unknown) { return error instanceof Error ? error.message.replace(SECRET_VALUE, "[REDACTED]").slice(0, 1_000) : String(error).slice(0, 1_000); }
function isTelemetryFailure(error: unknown) { return Boolean((error as { name?: string })?.name?.includes("OpenTelemetry") || (error as Error)?.message?.includes("Langfuse")); }
