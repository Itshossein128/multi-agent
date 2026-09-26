import type { ToolRecord } from "@multi-agent/types";
import { enforceSchema, type JsonSchema } from "@multi-agent/types";
import { toolExecutorFactory } from "./toolExecutorFactory";
import type { ToolExecutorFactory } from "./toolExecutorFactory";
import { boundJsonValue, boundedBytesFromEnvironment } from "../runtime/boundedValue";
import type { CredentialGateway } from "../security/credentialGateway";

export class ToolPolicyError extends Error {}

export interface ToolIdempotencyStore {
  get(key: string): Promise<Record<string, unknown> | undefined> | (Record<string, unknown> | undefined);
  set(key: string, value: Record<string, unknown>): Promise<void> | void;
}

class InMemoryToolIdempotencyStore implements ToolIdempotencyStore {
  private readonly values = new Map<string, Record<string, unknown>>();
  get(key: string) { return this.values.get(key); }
  set(key: string, value: Record<string, unknown>) {
    if (this.values.size >= 10_000 && !this.values.has(key)) this.values.delete(this.values.keys().next().value!);
    this.values.set(key, structuredClone(value));
  }
}

/** Server-side tool boundary: impact policy and timeout apply before category dispatch. */
export class ToolRuntime {
  constructor(private readonly timeoutMs = configuredTimeout(), private readonly allowSideEffects = process.env.TOOL_ALLOW_SIDE_EFFECTS === "true", private readonly executors: Pick<ToolExecutorFactory, "create"> = toolExecutorFactory, private readonly maxOutputBytes = boundedBytesFromEnvironment(process.env.TOOL_MAX_OUTPUT_BYTES, 256 * 1024), private readonly credentialGateway?: CredentialGateway, private readonly idempotency: ToolIdempotencyStore = new InMemoryToolIdempotencyStore()) {}
  async execute(tool: ToolRecord, input: Record<string, unknown>, parentSignal?: AbortSignal, context?: { runId?: string; credentialPrincipal?: { tenantId: string; principalId: string }; idempotencyKey?: string; approvalGranted?: boolean }) {
    if (!tool.enabled) throw new ToolPolicyError(`Tool "${tool.name}" is disabled.`);
    const policy = tool.executionPolicy ?? { requiresApproval: tool.impact !== "read-only", idempotency: tool.impact === "read-only" ? "optional" : "required", retryable: tool.impact === "read-only" } as const;
    if (tool.impact !== "read-only" && (!this.allowSideEffects && !context?.approvalGranted)) throw new ToolPolicyError(`Tool "${tool.name}" requires server approval because it is ${tool.impact}.`);
    const idempotencyKey = context?.idempotencyKey;
    if (policy.idempotency === "required" && !idempotencyKey) throw new ToolPolicyError(`Tool "${tool.name}" requires an idempotency key.`);
    const cacheKey = idempotencyKey ? `${context?.credentialPrincipal?.tenantId ?? "anonymous"}:${tool.id}:${idempotencyKey}` : undefined;
    if (cacheKey) {
      const cached = await this.idempotency.get(cacheKey);
      if (cached) return structuredClone(cached);
    }
    // Boundary: validate the declared input contract before the tool executes.
    // Stable codes make rejections machine-readable; diagnostics never echo values.
    enforceSchema(tool.inputSchema as JsonSchema, input, { code: "TOOL_INPUT_INVALID", phase: "tool input" });
    const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    const output = await this.executors.create(tool.category).execute({ tool, input, signal, ...context, idempotencyKey });
    // Boundary: bound first, then validate the *bounded* output against the
    // declared output contract before it can reach events or persistence.
    const bounded = boundJsonValue(output, this.maxOutputBytes) as Record<string, unknown>;
    enforceSchema(tool.outputSchema as JsonSchema, bounded, { code: "TOOL_OUTPUT_INVALID", phase: "tool output" });
    if (cacheKey) await this.idempotency.set(cacheKey, bounded);
    return bounded;
  }
}
function configuredTimeout() { const value = Number(process.env.TOOL_MAX_DURATION_MS ?? 30_000); return Number.isInteger(value) && value >= 1_000 && value <= 60 * 60_000 ? value : 30_000; }
