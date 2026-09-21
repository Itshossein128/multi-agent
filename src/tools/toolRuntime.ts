import type { ToolRecord } from "@multi-agent/types";
import { toolExecutorFactory } from "./toolExecutorFactory";
import type { ToolExecutorFactory } from "./toolExecutorFactory";
import { boundJsonValue, boundedBytesFromEnvironment } from "../runtime/boundedValue";
import type { CredentialGateway } from "../security/credentialGateway";

export class ToolPolicyError extends Error {}

/** Server-side tool boundary: impact policy and timeout apply before category dispatch. */
export class ToolRuntime {
  constructor(private readonly timeoutMs = configuredTimeout(), private readonly allowSideEffects = process.env.TOOL_ALLOW_SIDE_EFFECTS === "true", private readonly executors: Pick<ToolExecutorFactory, "create"> = toolExecutorFactory, private readonly maxOutputBytes = boundedBytesFromEnvironment(process.env.TOOL_MAX_OUTPUT_BYTES, 256 * 1024), private readonly credentialGateway?: CredentialGateway) {}
  async execute(tool: ToolRecord, input: Record<string, unknown>, parentSignal?: AbortSignal, context?: { runId?: string; credentialPrincipal?: { tenantId: string; principalId: string } }) {
    if (!tool.enabled) throw new ToolPolicyError(`Tool "${tool.name}" is disabled.`);
    if (tool.impact !== "read-only" && !this.allowSideEffects) throw new ToolPolicyError(`Tool "${tool.name}" requires server approval because it is ${tool.impact}.`);
    const signal = parentSignal ? AbortSignal.any([parentSignal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    const output = await this.executors.create(tool.category).execute({ tool, input, signal, ...context });
    return boundJsonValue(output, this.maxOutputBytes) as Record<string, unknown>;
  }
}
function configuredTimeout() { const value = Number(process.env.TOOL_MAX_DURATION_MS ?? 30_000); return Number.isInteger(value) && value >= 1_000 && value <= 60 * 60_000 ? value : 30_000; }
