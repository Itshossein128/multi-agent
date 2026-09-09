"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionTelemetry = exports.TelemetrySanitizer = void 0;
const tracing_1 = require("@langfuse/tracing");
const SECRET_KEY = /authorization|api[_-]?key|token|secret|password|cookie|private[_-]?key/i;
const SECRET_VALUE = /(?:sk|pk|api)[_-][a-z0-9_-]{8,}|bearer\s+[a-z0-9._-]+/gi;
/** Server-side only privacy boundary for all deep-telemetry payloads. */
class TelemetrySanitizer {
    mode;
    maxChars;
    constructor(mode = "redacted", maxChars = 8_000) {
        this.mode = mode;
        this.maxChars = maxChars;
    }
    sanitize(value) {
        if (this.mode === "metadata-only")
            return value === undefined ? undefined : { captured: false };
        return this.limit(this.walk(value, new WeakSet()));
    }
    walk(value, seen) {
        if (typeof value === "string")
            return value.replace(SECRET_VALUE, "[REDACTED]");
        if (value === null || typeof value !== "object")
            return value;
        if (seen.has(value))
            return "[Circular]";
        seen.add(value);
        if (Array.isArray(value))
            return value.slice(0, 100).map(item => this.walk(item, seen));
        return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : this.walk(item, seen)]));
    }
    limit(value) {
        let serialized;
        try {
            serialized = JSON.stringify(value);
        }
        catch {
            return "[Unserializable]";
        }
        if (serialized.length <= this.maxChars)
            return value;
        return { truncated: true, originalChars: serialized.length, preview: serialized.slice(0, this.maxChars) };
    }
}
exports.TelemetrySanitizer = TelemetrySanitizer;
/** Small runtime-facing boundary; it intentionally knows nothing about RunEvent/SSE. */
class ExecutionTelemetry {
    config;
    sanitizer;
    constructor(config) {
        this.config = config;
        this.sanitizer = new TelemetrySanitizer(config.captureMode, config.maxPayloadChars);
    }
    static disabled() { return new ExecutionTelemetry({ enabled: false, captureMode: "metadata-only", maxPayloadChars: 1 }); }
    get enabled() { return this.config.enabled; }
    traceIdForRun(runId) { return (0, tracing_1.createTraceId)(runId); }
    async withWorkflow(context, fn) {
        return this.withObservation("workflow.run", "chain", context, fn, context.runId);
    }
    async withAgent(context, fn) {
        return this.withObservation("agent.execution", "agent", context, fn);
    }
    async withGeneration(context, fn) {
        return this.withObservation("model.generation", "generation", context, fn);
    }
    async withMemory(name, context, fn) {
        return this.withObservation(name, name === "memory.retrieve" ? "retriever" : "span", context, fn);
    }
    async withObservation(name, asType, context, fn, stableTraceSeed) {
        if (!this.enabled)
            return fn();
        const attributes = { input: this.sanitizer.sanitize(context.input), metadata: this.sanitizer.sanitize({ ...context, input: undefined }) };
        let invoked = false;
        let completed = false;
        let completedResult;
        try {
            const parentSpanContext = stableTraceSeed ? { traceId: await this.traceIdForRun(stableTraceSeed), spanId: "0000000000000001", traceFlags: 1 } : undefined;
            return await (0, tracing_1.startActiveObservation)(name, async (observation) => {
                try {
                    invoked = true;
                    const result = await fn();
                    completed = true;
                    completedResult = result;
                    try {
                        observation.update({ output: this.sanitizer.sanitize(result) });
                    }
                    catch (error) {
                        console.warn("Observability update failed.", safeError(error));
                    }
                    return result;
                }
                catch (error) {
                    try {
                        observation.update({ level: "ERROR", statusMessage: safeError(error) });
                    }
                    catch (updateError) {
                        console.warn("Observability error update failed.", safeError(updateError));
                    }
                    throw error;
                }
            }, {
                asType,
                ...(parentSpanContext ? { parentSpanContext } : {}),
                ...attributes,
            });
        }
        catch (error) {
            // Never repeat a side-effecting operation merely because telemetry failed.
            if (completed)
                return completedResult;
            // Setup failures happen before user code is called and are safe to bypass.
            if (!invoked && isTelemetryFailure(error)) {
                console.warn("Observability operation failed; continuing execution.", safeError(error));
                return fn();
            }
            throw error;
        }
    }
}
exports.ExecutionTelemetry = ExecutionTelemetry;
function safeError(error) { return error instanceof Error ? error.message.replace(SECRET_VALUE, "[REDACTED]").slice(0, 1_000) : String(error).slice(0, 1_000); }
function isTelemetryFailure(error) { return Boolean(error?.name?.includes("OpenTelemetry") || error?.message?.includes("Langfuse")); }
//# sourceMappingURL=telemetry.js.map