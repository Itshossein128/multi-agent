import { ExecutionTelemetry, TelemetrySanitizer } from "../src/observability/telemetry";

describe("execution telemetry privacy boundary", () => {
  it("redacts credential-shaped fields and truncates oversized data", () => {
    const sanitizer = new TelemetrySanitizer("redacted", 80);
    expect(sanitizer.sanitize({ authorization: "Bearer very-secret-token", nested: { api_key: "sk_1234567890" } }))
      .toEqual({ authorization: "[REDACTED]", nested: { api_key: "[REDACTED]" } });
    expect(sanitizer.sanitize("x".repeat(200))).toMatchObject({ truncated: true, originalChars: 202 });
  });

  it("is a no-op when disabled and never requires an exporter", async () => {
    const telemetry = ExecutionTelemetry.disabled();
    await expect(telemetry.withWorkflow({ runId: "run-1", workflowId: "workflow-1" }, async () => "completed"))
      .resolves.toBe("completed");
  });

  it("derives a stable valid trace id for a workflow run", async () => {
    const telemetry = ExecutionTelemetry.disabled();
    const first = await telemetry.traceIdForRun("run-1");
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    await expect(telemetry.traceIdForRun("run-1")).resolves.toBe(first);
  });
});
